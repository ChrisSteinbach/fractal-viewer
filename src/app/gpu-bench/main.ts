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
import { SOFTWARE_RENDERER_RE } from "../render-backend";
import {
  rotationMatrix4,
  symmetryRotation4,
  toTransform4,
} from "../../fractal/affine4";
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
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  estimateEscapeDistance,
} from "../../fractal/escape-de";
import type { EscapeDE } from "../../fractal/escape-de";
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
  estimateDistanceRefined,
  SURFACE_FOLD_BEAM_WIDTH,
} from "../../fractal/surface-de";
import type { SurfaceDE } from "../../fractal/surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  deHasFolds4,
  estimateDistance4,
  estimateDistance4Refined,
} from "../../fractal/surface-de-4d";
import type { SurfaceDE4 } from "../../fractal/surface-de-4d";
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_SHADE_BYTES,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  surfaceGpuWorkgroupBytes,
} from "../../fractal/surface-de-gpu";
import type {
  SurfaceGpu4View,
  SurfaceGpuPose,
} from "../../fractal/surface-de-gpu";
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
import type {
  SurfaceComputeFrame,
  SurfaceComputeFrameSpec,
} from "../surface-compute";
import { surfaceSlotColors, surfaceTrapIndices } from "../surface-slots";

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
  /** Kaleidoscope symmetry (fr-q0h6 lit the 4D path) — spelled out per
   * scenario exactly like {@link ScenarioDef3D.symmetry}, so an order-1 leg
   * says so rather than defaulting silently. */
  symmetry: SymmetryParams;
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

/** The preset re-centers Barnsley's coordinates (FERN_SCALE 0.3 around
 * FERN_CENTER — see presets.ts), so the fern spans roughly ±0.75 x ±1.5
 * around the origin; a straight-on close camera frames it fully. Shared by
 * the two fern scenarios (`fern` and fr-hiyu's `xform-color`), which differ
 * only in their color authoring — the same framing keeps them visually
 * comparable in the bench's own screenshots. */
const FERN_CAMERA: Pick<ScenarioDef3D, "cameraPos" | "lookAt"> = {
  cameraPos: [0, 0, 4.2],
  lookAt: [0, 0, 0],
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

/**
 * fr-hiyu's authored flam3 color pairs, one per Barnsley map, in
 * `FERN_MAPS` order (stem, frond, left leaflet, right leaflet — see
 * presets.ts). NONE of them is what the absent fields resolve to:
 * `derivedColorIndex` would spread four maps 0, 1/3, 2/3, 1 and
 * `DEFAULT_COLOR_SPEED` would put every speed at 0.5, so all eight numbers
 * here are off the fallback, and the speeds deliberately span the range the
 * walk supports — 0, 0.35, 0.85, 1.
 *
 * Assigned against Barnsley's weights (1 / 85 / 7 / 7) rather than
 * arbitrarily, so each one shows up in the render:
 * - the STEM is the rarest map (1%) and SLAMS the coordinate to the
 *   gradient's far end (speed 1), so the trunk keeps its own color despite
 *   how seldom it is picked;
 * - the FROND runs 85% of steps and relaxes toward the near end at 0.35 —
 *   a few steps of memory rather than a snap, which is the continuous
 *   gradient the flam3 walk exists for (and the arm most sensitive to the
 *   blend's exact shape, since it compounds);
 * - the LEFT leaflet PINS the coordinate (speed 0): geometry with no color
 *   contribution at all, the sharpest CPU/GPU divergence detector in the
 *   set — a kernel still blending at the old hard-coded 0.5 would drag the
 *   coordinate to 0.55 on every left-leaflet pick and visibly wash the
 *   gradient;
 * - the RIGHT leaflet sits near the top of the range (0.85).
 */
const XFORM_COLOR_PAIRS: ReadonlyArray<
  Required<Pick<Transform, "colorIndex" | "colorSpeed">>
> = [
  { colorIndex: 0.92, colorSpeed: 1 }, // f1 stem (weight 1)
  { colorIndex: 0.08, colorSpeed: 0.35 }, // f2 frond (weight 85)
  { colorIndex: 0.55, colorSpeed: 0 }, // f3 left leaflet (weight 7)
  { colorIndex: 0.74, colorSpeed: 0.85 }, // f4 right leaflet (weight 7)
];

/** Barnsley's fern with {@link XFORM_COLOR_PAIRS} authored onto every map —
 * the `xform-color` scenario's system (fr-hiyu). The geometry is the stock
 * preset, deliberately: keeping it identical to the `fern` scenario's makes
 * the two entries a controlled pair, differing in the color authoring and
 * nothing else. */
function xformColorFern(): Transform[] {
  return barnsleyFern().map((t, i) => ({ ...t, ...XFORM_COLOR_PAIRS[i] }));
}

const SCENARIOS: ScenarioDef[] = [
  {
    kind: "3d",
    name: "sierpinski",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
    ...SIERPINSKI_CAMERA,
  },
  {
    kind: "3d",
    name: "fern",
    transforms: barnsleyFern(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "ember",
    ...FERN_CAMERA,
  },
  {
    kind: "3d",
    name: "xform-color",
    transforms: xformColorFern(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    // A gradient palette is load-bearing here: the color walk only runs on
    // the structural (colorLUT / colorMode 1) path, so under "legacy" both
    // engines would color per transform and the authored pairs would go
    // entirely unread. "spectrum" spreads hue widely across the gradient, so
    // a wrong slot reads as a hue shift rather than a shade of one hue.
    paletteId: "spectrum",
    ...FERN_CAMERA,
    // Uniquely pins (fr-hiyu): the per-transform colorIndex/colorSpeed pair
    // the kernels' structural walk reads off each Slot, and the walk formula
    // itself at speeds either side of the old hard-coded 0.5. Every OTHER
    // scenario here leaves both fields absent, so between them they only ever
    // exercise the DERIVED fallback — a kernel that packed the pair and then
    // ignored it (or kept dividing by a uniform colorDenom) would pass the
    // whole suite without this entry. See xformColorFern for the values and
    // why each was chosen.
  },
  {
    kind: "3d",
    name: "swirl",
    transforms: swirlFlame(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "spectrum",
    cameraPos: [2.6, 1.9, 2.6],
    lookAt: [0, 0, 0],
  },
  {
    kind: "3d",
    name: "kaleido",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 5, plane: "xz" },
    paletteId: "aurora",
    ...SIERPINSKI_CAMERA,
  },
  {
    kind: "3d",
    name: "variation-zoo",
    transforms: variationZoo(),
    finalTransform: variationZooLens(),
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
    symmetry: { order: 1, plane: "xz" },
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
  {
    kind: "4d",
    name: "kaleido-4d",
    system: hyperfern,
    finalTransform: null,
    // A genuinely 4D kaleidoscope: a w-plane AND a nonzero twist, so copy k
    // is a DOUBLE rotation (two orthogonal planes turning at once) — the
    // case that has no 3D counterpart at all. Order 4 with a 4-map system
    // packs 16 expanded slots, well inside MAX_TRANSFORMS.
    symmetry: { order: 4, plane: "zw", twist: 1 },
    rotation: BENCH_TUMBLE,
    // "transform" coloring is load-bearing here: it is the ONE color kind
    // that folds a picked slot back onto its base map, so a kernel that
    // dropped the fold would paint each copy a different hue while the CPU
    // oracle repeats the base palette around the kaleidoscope.
    paletteId: "legacy",
    colorMode: "transform",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // Uniquely pins (fr-q0h6): the 4D kernel's symmetry expansion — Slot4's
    // four post-rotation rows and `hasPost`, the copy-major slot order and
    // its inherited weights/color pair, and Params4's `baseTransformCount`
    // fold. Every other 4D scenario here is order 1, where all of that is
    // zero-filled and inert.
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
    plane: def.symmetry.plane,
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
  const prepared4: PreparedChaosGame4 = prepareChaosGame4(
    transforms4,
    final4,
    def.symmetry,
  );
  // Lensed cloud: the view (bounds/center/radius statistics below) derives
  // from the explorer cloud exactly the way the app's own explorer cloud
  // does — through the final-transform lens when the scenario has one, not
  // the pre-lens orbit — and through the kaleidoscope, which widens it.
  const cloud = runChaosGame4(
    transforms4,
    EXPLORER_CLOUD_POINTS,
    mulberry32(SEED),
    final4,
    def.symmetry,
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
        order: def.symmetry.order,
        plane: def.symmetry.plane,
        twist: def.symmetry.twist ?? 0,
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
      plane: def.symmetry.plane,
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
// mandelboxKifs — the brief §3.7 measurement. Since fr-55s1 the section
// also pins the kernel's SECOND descent core: a fold-free system compiles
// `core: "affine"` — the width-4 refined ladder — and is compared against
// `estimateDistanceRefined`, the estimator THAT core mirrors. Which core
// and which oracle is inferred per system from `deHasFolds(de)`, exactly
// as surface-de.ts's own estimators route. Runs only when `?surface=1`
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
  /** fr-p8bc shade A/B leg probe widths (`--surface-shade-width`, e.g.
   * "1,4"), default empty — the leg skips (silently) when this is empty. */
  surfaceShadeWidths: number[];
  /** Invalid `surfaceShadeWidth` tokens dropped while parsing
   * `surfaceShadeWidths` above (non-numeric or < 1) — unlike the other list
   * params' silent `parseSurfaceIntList` filter, this one is user-facing
   * enough (hand-typed while chasing fr-p8bc's verdict) that a typo is
   * reported rather than silently doing nothing. Merged into the section's
   * `notes` by `runSurfaceShadeAbLeg`'s caller, since `parseSurfaceConfig`
   * runs before the section's `results` object exists. */
  shadeWidthNotes: string[];
  /** fr-b72d opt-in leg (`--surface-aff4-sweep=1`): per-kaleidoscope-order
   * affine4 eval-kernel timing (slab vs no-slab, fr-d0nn's register-
   * pressure probe). Default false — the leg is silent and never runs in
   * CI; see `runSurfaceAff4SweepLeg`'s doc. */
  aff4Sweep: boolean;
}

interface SurfaceKernelConfig {
  /** Which descent body the kernel carries (fr-55s1; fr-dlxh; fr-rsp6).
   * "fold" is the frontier this section was built around; "affine" is the
   * fixed width-4 refined ladder, where `variant`/`stage2` are inert (the
   * generator ignores them) and `width` is always the ladder's own 4;
   * "escape" is the forward escape-time loop, where `variant`/`stage2` are
   * likewise inert and `width` is carried only for a readable label (the
   * generator ignores it too); "affine4" is that ladder ONE DIMENSION UP
   * behind the view lift (fr-dlxh M3) — same inert options as "affine",
   * same fixed width 4 (`buildSurfaceDE4`'s `beamWidth`); "fold4" (fr-rsp6
   * M4) is the fold frontier ONE DIMENSION UP behind the same view lift —
   * `variant` is always "private" (the frontier is function-scope private
   * by construction, module doc) and `width` is LIVE like "fold"'s, so
   * unlike "affine4" it keeps a real width sweep and its own
   * production/informational split. */
  core: "fold" | "affine" | "escape" | "affine4" | "fold4";
  variant: SurfaceVariant;
  width: number;
  stage2: boolean;
  wg: number;
}

interface SurfaceAgreementRow {
  system: string;
  core: "fold" | "affine" | "escape" | "affine4" | "fold4";
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
   * not kernel disagreement). AFFINE-core rows always gate (fr-55s1):
   * their ladder is fixed at {@link SURFACE_AFFINE_LADDER_WIDTH}, which
   * IS the oracle's production `beamWidth`, so there is no width sweep
   * and every row is like against like. Escape and affine4 rows gate the
   * same way (fr-dlxh) — neither has a width to sweep. FOLD4 rows gate
   * like "fold"'s, not affine4's (fr-rsp6 M4): the fold frontier's
   * production width is the same fixed `SURFACE_FOLD_BEAM_WIDTH`
   * constant, one dimension up, so only rows at that width compare like
   * against like — narrower rows are the same fr-5rvk erosion
   * measurement, informational only. */
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
   * jittered, next 200 uniform, last 100 exact on-attractor. Always zeros
   * on an escape row — `escapeQueries`' uniform/boundary/cluster mix
   * doesn't share this layout, and `excluded` below is that leg's own
   * query-mix diagnostic. */
  failuresByClass: { jittered: number; uniform: number; exact: number };
  /** fr-dlxh escape + affine4 legs, and fr-rsp6's fold4 leg: queries a
   * pre-hoc stability gate excluded before computing `failures` —
   * `n - stableCount`. The escape leg's gate is the f32-vs-f64 orbit
   * ensemble (`compareSurfaceEscapeAgreement`'s doc); the affine4 and
   * fold4 legs' is the oracle-continuity classifier ({@link
   * surface4QueryStable} — bisection queries parked on beam-selection
   * discontinuities), fold4's evaluated against the PLAIN `estimateDistance4`
   * composed oracle rather than the refined one. `undefined` on every
   * 3D fold/affine/lens row (nothing is ever excluded there). */
  excluded?: number;
  /** fr-dlxh escape leg only: stable-classified failures POST-HOC
   * verified as shadow flips (the GPU's value matched a 1..4-ULP
   * neighbor orbit's fround value — {@link escapeShadowFlipVerified});
   * excluded from `failures` but capped ({@link SURFACE_ESCAPE_FLIP_CAP}). */
  chaoticFlips?: number;
  /** fr-dlxh escape leg only: the shared escape-core pipeline's compile
   * time (identical across every escape row — one pipeline serves all four
   * systems, like the M0 affine leg's). */
  compileMs?: number;
  /** fr-dlxh escape leg only: this system's own GPU dispatch wall time. */
  gpuMs?: number;
}

interface SurfaceCrossCheckRow {
  /** "shared-vs-private": identical (width, stage2) must be EXACTLY equal
   * (same arithmetic, different frontier storage) — mismatches fail the
   * verdict. "stage2-on-vs-off": informational only — the fr-kidj stage-2
   * skips are value no-ops in exact arithmetic, but f32 rounding may flip
   * marginal frontier insertions, so deltas are reported, never gated.
   * "slabext-on-vs-off" (fr-rsp6 M4): the fold4 leg's `slabExt` A/B on
   * `fold4Boxfold` (`sliceHalfW` 0) — `segmentRadius4(q, 0)` is `length(q)`
   * bit for bit there (surface-de-gpu.ts's `slabExt` doc), so this is
   * TOLERANCE-gated like the opt-in aff4 sweep leg's own slab/no-slab
   * check ({@link SURFACE_AFF4_SWEEP_TOL_FACTOR}), not `shared-vs-private`'s
   * exact-equality rule — mismatches past tolerance fail the verdict
   * through the section's own `fold4SlabExtFailed` flag, not the generic
   * any-mismatch cross-check gate. */
  kind: "shared-vs-private" | "stage2-on-vs-off" | "slabext-on-vs-off";
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
  /** Status mismatches where exactly one side HIT, excluded from the gate
   * per {@link boundaryFlipRule} clause (c): the CPU march's own closest
   * approach lands at the hitting side's `t` (same trajectory, same point)
   * within a factor of {@link SURFACE_SILHOUETTE_RATIO_BAND} of the
   * acceptance threshold, so which side of `d < eps` each arithmetic landed
   * on is f32-vs-f64 noise rather than estimator disagreement. Kept apart
   * from {@link boundaryFlips} — that rule proves same trajectory via a
   * shared terminal `t`, which a hit-vs-miss pair can never have, since the
   * miss runs on to the sphere exit. Measured: 1 ray per leg on Iris Xe
   * (0.6% and 2% of eps from the threshold).
   *
   * READ THE COUNT, not just the verdict. Each flip is individually noise,
   * but the rule excuses them one ray at a time and cannot see a pattern:
   * an eps or hit-floor that differed between the two sides would flip
   * every silhouette ray in the SAME direction and still be excluded here,
   * showing up only as a count in the dozens against a `gpuHits`/`cpuHits`
   * imbalance to match. That is why this is its own field rather than
   * folded into {@link boundaryFlips}. */
  silhouetteFlips: number;
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
  /** `(statusMismatches − boundaryFlips − silhouetteFlips) + hitTFailures` —
   * any nonzero fails the section. */
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
  /** Escape frame leg only (fr-dlxh): whole-frame GPU hit rate vs a
   * strided CPU sanity march's rate — the timing legs' rate-band idiom in
   * place of a per-pixel comparison (see the leg's design comment). */
  sanityGpuHitRate?: number;
  sanityCpuHitRate?: number;
  /** ifs4 frame leg only (fr-dlxh 4D): a SECOND frame rendered by the
   * SAME renderer at a different `view4` (rotated rotor, different w0) —
   * the per-frame view-repack proof (`spec.view4` is per-renderFrame
   * state, exactly scene.ts's live rotor/slice contract). Same numbers as
   * the primary frame's, gated by the call site under the same rules. */
  view2?: {
    wallMs: number;
    gpuMs: number;
    passes: number;
    truncated: boolean;
    counts: { hit: number; miss: number; exhausted: number; active: number };
    sanityGpuHitRate: number;
    sanityCpuHitRate: number;
  };
}

/** One arm's {@link SurfaceComputeFrame} timing/status, sliced for a
 * {@link SurfaceShadeAbRow}. */
interface ShadeAbArmResult {
  wallMs: number;
  gpuMs: number;
  marchMs: number;
  shadeMs: number;
  passes: number;
  truncated: boolean;
  counts: { hit: number; miss: number; exhausted: number; active: number };
}

/**
 * fr-p8bc shade A/B leg — one row per (pose, probe width): the PRODUCTION
 * `SurfaceComputeRenderer` at shipped-parity (`shadeDeWidth =
 * SURFACE_FOLD_BEAM_WIDTH`, "baseline") against a cheap-shade-probe-width
 * renderer ("cheap"), same DE/frame-spec/raster otherwise. Purely
 * informational (see `runSurfaceShadeAbLeg`'s doc) — this is the measured
 * verdict for fr-p8bc, not a section gate.
 */
interface SurfaceShadeAbRow {
  pose: "standard" | "near";
  probeWidth: number;
  raster: { width: number; height: number };
  baseline: ShadeAbArmResult;
  cheap: ShadeAbArmResult;
  diff: {
    /** Pixels where any of R/G/B differs at all (not just over the report
     * threshold below). */
    diffPixels: number;
    totalPixels: number;
    /** Mean |Δ| over R/G/B, averaged over `diffPixels` ONLY — background/
     * agreeing pixels are identical by construction (identical march
     * kernel, identical per-pixel hash dither in both arms) and would
     * dilute an all-pixels mean toward ~0 regardless of how different the
     * actually-shaded pixels are. */
    meanAbsDeltaDiffPixels: number;
    /** Largest single-channel |Δ| over every pixel. */
    maxAbsDelta: number;
    /** Percent of ALL pixels (not just `diffPixels`) whose largest channel
     * delta exceeds {@link SURFACE_SHADE_AB_DIFF_THRESHOLD}. */
    pctPixelsOver8: number;
  };
  /** The two arms' terminal ray-status tallies (`counts`) disagree. The
   * march kernel and its ray derivation are IDENTICAL between arms (only
   * the shade probe width differs) and the hash dither is per-pixel
   * deterministic, so hit sets must match by construction — a mismatch
   * here is a march determinism bug, not a shading difference. Surfaced
   * prominently, never gated (this leg is informational). */
  hitMismatch: boolean;
  /** Set when either arm's frame resolved null (superseded/lost) or
   * truncated — the diff numbers above are still computed where possible
   * but are not a fair like-for-like comparison. */
  suspect?: boolean;
  reason?: string;
}

/**
 * fr-b72d opt-in sweep leg — one (order, variant) timing row. `usPerQuery`
 * is derived from `minMs` (the least-noise-contaminated estimate of the
 * kernel's own cost), not `meanMs`. `reps` is normally
 * {@link SURFACE_AFF4_SWEEP_REPS}, but reads lower when a timed dispatch
 * blew past {@link SURFACE_AFF4_SWEEP_REP_CAP_MS} and the loop stopped
 * early — `minMs`/`meanMs` still cover exactly the reps that ran.
 */
interface SurfaceAff4SweepRow {
  order: number;
  variant: "slab" | "noslab";
  n: number;
  reps: number;
  minMs: number;
  meanMs: number;
  usPerQuery: number;
}

/**
 * fr-b72d opt-in sweep leg — one order's slab-vs-noslab exact-equality
 * check (see {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}'s doc for why the two
 * variants are expected to agree). `withinTolerance` false means the leg
 * fails the section — see `runSurfaceAff4SweepLeg`'s doc.
 */
interface SurfaceAff4SweepAgreement {
  order: number;
  n: number;
  mismatches: number;
  maxAbs: number;
  withinTolerance: boolean;
}

/**
 * fr-b72d opt-in sweep leg's structured result (`config.aff4Sweep`,
 * `surfaceAff4Sweep=1`) — see `runSurfaceAff4SweepLeg`'s doc for what it
 * measures. Every row/agreement entry is duplicated as a human-readable
 * line in `results.notes` (the `computeFrame4` leg's dual-reporting
 * convention), so a headless run's stdout discloses it via the existing
 * `note:` printer without a bespoke stdout formatter.
 */
interface SurfaceAff4SweepResult {
  rows: SurfaceAff4SweepRow[];
  agreement: SurfaceAff4SweepAgreement[];
  /** The leg's two pipelines compile once each and serve every order (the
   * kernel text is order-independent — symmetry order is a params value,
   * not a codegen option). */
  compileMs: { slab: number; noslab: number };
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
  /** fr-55s1 stage C: leg A over the lens field class
   * (lensMandelboxOverAffine) — the affine core under the 81-branch
   * mandelbox lens, marched by the app's exact ray derivation. Gates like
   * {@link marchUnproject}. */
  marchUnprojectLens?: SurfaceUnprojectRow | SkippedResult;
  /** fr-tzdg leg B (informational + canvas artifact) — absent until run;
   * SkippedResult when mandelboxKifs was excluded or the renderer broke. */
  computeFrame?: SurfaceComputeFrameRow | SkippedResult;
  /** fr-55s1 stage C: leg B over the lens field class — the PRODUCTION
   * SurfaceComputeRenderer on lensMandelboxOverAffine (affine core +
   * 81-branch mandelbox lens, branch-scaled priors). Gates like
   * {@link computeFrame} (zero hits on real hardware fails). */
  computeFrameLens?: SurfaceComputeFrameRow | SkippedResult;
  /** fr-dlxh: leg B over the escape class — the PRODUCTION renderer on
   * escMandelbox through `{ kind: "escape" }` (forward-orbit core, no
   * maps buffer, unscaled priors). Gates like {@link computeFrame}, plus
   * the strided CPU sanity march's hit-rate band on real hardware. */
  computeFrameEscape?: SurfaceComputeFrameRow | SkippedResult;
  /** fr-dlxh 4D (stage B2): leg B over the ifs4 class — the PRODUCTION
   * renderer on aff4Kaleido through `{ kind: "ifs4" }` (affine4 ladder
   * core, GpuMap4 maps, the REQUIRED `view4` spec field), plus a
   * second-view4 frame from the same renderer ({@link
   * SurfaceComputeFrameRow.view2}). Gates like {@link computeFrameEscape}
   * — zero hits on real hardware, the rate band on untruncated frames —
   * plus ONE strengthened clause: a COMPLETED frame with zero hits while
   * the CPU sanity march hit fails on ANY adapter. The kaleido slice's
   * correct rates are SPARSE (~0.02-0.04 at the harness pose — a twisted
   * order-3 sweep of two ~0.5-scale maps is dust), so the 0.15 band alone
   * cannot tell broken-empty from correct-sparse there; completed-empty
   * against CPU-found hits is deterministic breakage evidence, not
   * slowness. NOTE: the headless runner's stdout printer predates this
   * field — the row also lands in `notes` (the frame-row voice) so the
   * run's summary discloses it; results.json carries the full row. */
  computeFrame4?: SurfaceComputeFrameRow | SkippedResult;
  /** fr-p8bc shade A/B leg (informational + canvas artifacts) — absent when
   * `surfaceShadeWidths` is empty (the default, silent) or every requested
   * width was skipped (see `runSurfaceShadeAbLeg`'s doc); never affects
   * {@link SurfaceDeResults.verdict}. */
  shadeAb?: SurfaceShadeAbRow[];
  /** fr-b72d opt-in leg (`config.aff4Sweep`, `surfaceAff4Sweep=1`) —
   * `surfaceShadeWidths`' "absent when not requested" convention, not
   * {@link computeFrame4}'s always-attempted `SkippedResult` shape: absent
   * when off (the default, silent), when skipped on a software adapter
   * without `surfaceForce=1` (noted), or before the first order's kernels
   * ever compiled; otherwise holds whatever orders completed even if a
   * later order threw (progressive — see `runSurfaceAff4SweepLeg`'s doc).
   * Gates {@link SurfaceDeResults.verdict} on a slab/no-slab disagreement
   * beyond {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}, or on an unhandled
   * error mid-sweep (also noted either way). */
  aff4Sweep?: SurfaceAff4SweepResult;
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
/** How many un-excluded status mismatches a march-unproject row describes
 * ray-by-ray before it stops printing (fr-7tl3). Sized for the handful of
 * silhouette rays a healthy leg produces, not for a broken kernel. */
const SURFACE_MISMATCH_DIAG_CAP = 8;
/** How far the CPU march's closest approach may sit from the acceptance
 * threshold — as a factor either side of `d / eps == 1` — and still count
 * as a silhouette flip rather than a real disagreement (fr-7tl3). Matches
 * the `1.5·eps` convention the both-hit graze branch already uses, and
 * discriminates sharply: the two measured flips read 0.994 and 1.02, while
 * a solid hit the other side never approached, or a genuinely empty ray,
 * reads orders of magnitude away. */
const SURFACE_SILHOUETTE_RATIO_BAND = 1.5;

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

/** The affine core's ladder width (fr-55s1): fixed at the CPU oracle's
 * production `SurfaceDE.beamWidth`, which `buildSurfaceDE` always sets to
 * 4 and `surface-material.ts`'s affine arm hardcodes. Unlike the fold
 * frontier there is no width to sweep — so every affine agreement row is
 * a GATING row. */
const SURFACE_AFFINE_LADDER_WIDTH = 4;

/** fr-dlxh: how many of the escape eval leg's 700 queries per system the
 * f32-stability gate (`compareSurfaceEscapeAgreement`'s doc) may exclude
 * before the leg stops trusting its own `failures` count and fails the
 * section outright — 20%. The pin is STRUCTURAL (the classifier must not
 * eat the leg — a 20% exclusion still gates 560 queries), not a
 * statistical fit: under the seven-orbit ensemble classifier the
 * deliberately-worst archetype (escMandelboxRot: off-axis M, negative
 * weight) measured ~93/700 excluded on the design mix, where the
 * single-twin classifier's 28/700 had let the real Iris driver flip 6
 * "stable" rows. A jump past 20% means the gate is masking real kernel
 * disagreement behind "chaotic orbit," not absorbing expected f32
 * noise. */
const SURFACE_ESCAPE_EXCLUDED_CAP = 140;

/** fr-dlxh M3: how many of the affine4 leg's 700 queries per system the
 * oracle-continuity gate ({@link surface4QueryStable}) may exclude before
 * the leg stops trusting its own `failures` count and fails the section —
 * 3%. Structural, like the escape cap: far above the measured census
 * (5/2800 total, worst system 3/700 — see the classifier's doc) but tight
 * enough that growth means something changed: a beam ladder whose
 * discontinuity set fattens from "bisection-parked knife edges" to a
 * measurable fraction of a uniform-ball mix is masking real kernel
 * disagreement behind "edge-parked", not absorbing expected f32 noise. */
const SURFACE_AFFINE4_EXCLUDED_CAP = 21;

/** fr-rsp6 M4: the starting point for how many of the fold4 eval leg's 700
 * queries per system the oracle-continuity gate ({@link surface4QueryStable},
 * `refined=false`) may exclude before that system's row stops trusting its
 * own `failures` count — {@link SURFACE_AFFINE4_EXCLUDED_CAP}'s 3%, one
 * estimator class over. NOT a floor to silently widen: a system whose
 * measured census clears this gets an entry in {@link
 * SURFACE_FOLD4_EXCLUDED_CAP_OVERRIDES} instead, each with the measured
 * number that justified it — fold frontiers select among far more branches
 * per level (81/243 vs the affine ladder's 4), so a denser discontinuity
 * set than M3's is plausible on its own, not proof of a kernel bug, but
 * every widening stays disclosed rather than assumed. */
const SURFACE_FOLD4_EXCLUDED_CAP = 21;

/** Per-system overrides for {@link SURFACE_FOLD4_EXCLUDED_CAP} — each entry
 * is `ceil(measured * 1.5) / 700` per this leg's own cap-widening rule,
 * filled in only after a real SwiftShader run measured that system's
 * exclusion census past the 3% starting point. Empty until measurement
 * says otherwise. */
const SURFACE_FOLD4_EXCLUDED_CAP_OVERRIDES: Record<string, number> = {};

/** {@link SURFACE_FOLD4_EXCLUDED_CAP}'s per-system lookup, overrides first. */
function fold4ExcludedCap(system: string): number {
  return (
    SURFACE_FOLD4_EXCLUDED_CAP_OVERRIDES[system] ?? SURFACE_FOLD4_EXCLUDED_CAP
  );
}

/** fr-rsp6 M4's slabExt A/B gate on `fold4Boxfold` (`sliceHalfW` 0): the
 * same noise/real boundary as {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}, scaled
 * by the system's own `boundingRadius` like every other surface eval
 * tolerance in this file — see `runSurfaceDeSection`'s fold4 slabExt block
 * for why `sliceHalfW: 0` makes the two kernel variants mathematically
 * bit-identical. */
const SURFACE_FOLD4_SLABEXT_TOL_FACTOR = 1e-5;

/** fr-b72d opt-in sweep leg (`runSurfaceAff4SweepLeg`): the kaleidoscope
 * orders it times the affine4 eval kernel at. 1 and 6 are the two measured
 * endpoints (compute 1.7x faster than fragment GLSL at order 1, ~35x
 * SLOWER at order 6, real Iris Xe); 2/3/4 fill in the unmeasured middle. */
const SURFACE_AFF4_SWEEP_ORDERS = [1, 2, 3, 4, 6];
/** fr-b72d sweep leg: the occupancy-saturating query batch on a real
 * adapter — tiled up from {@link affine4Queries}' 700-query mix (see the
 * leg's doc for why tiling, not resampling). */
const SURFACE_AFF4_SWEEP_BATCH = 65536;
/** fr-b72d sweep leg: the batch size under `acquired.software` (SwiftShader
 * CI/dev boxes) — 5 orders × 2 variants × (1 warmup + 5 timed) dispatches at
 * the full 65536-query batch would be unbearably slow on a software
 * rasterizer, and the leg's software-adapter job is only to prove it
 * dispatches and agrees, never to produce a meaningful timing curve.
 * Real-driver runs (`surfaceForce` irrelevant — a real adapter always uses
 * the full batch) always use {@link SURFACE_AFF4_SWEEP_BATCH}. */
const SURFACE_AFF4_SWEEP_BATCH_SW = 8192;
/** fr-b72d sweep leg: timed dispatches per (order, variant), after one
 * untimed warmup dispatch (which also supplies the agreement-gate value —
 * see the leg's doc). */
const SURFACE_AFF4_SWEEP_REPS = 5;
/** fr-b72d sweep leg: a single timed dispatch beyond this is a hang risk,
 * not a measurement worth waiting out — the rep loop stops after it and
 * reports however many reps actually completed. */
const SURFACE_AFF4_SWEEP_REP_CAP_MS = 10_000;
/** fr-b72d sweep leg's slab/no-slab agreement gate: at `sliceHalfW: 0` the
 * two kernel variants are mathematically bit-identical
 * (`segmentRadius4(q, 0)` is `length(q)` bit for bit — surface-de-gpu.ts's
 * `slabExt` doc), so any elementwise mismatch is either FMA/contraction
 * noise (small, informational) or a real divergence between the two code
 * paths (gating). This is the noise/real boundary, scaled by the system's
 * own `boundingRadius` like every other surface eval tolerance in this
 * file. */
const SURFACE_AFF4_SWEEP_TOL_FACTOR = 1e-5;

/** `surface-de.ts`'s `NO_SYMMETRY`, duplicated (it isn't exported) like
 * this file's other cross-module mirrors. */
const SURFACE_NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

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

/** fr-p8bc shade A/B leg raster — leg A's 96x54 on BOTH adapter kinds,
 * smaller than leg B's (SURFACE_FRAME_WIDTH 256x144) by measured
 * necessity: the full-width BASELINE arm is the leg's cost ceiling
 * (~108-516 ms/hit on Iris — the standard pose's silhouette-graze hits
 * probe the deepest fold trees and measured the WORST), and at 128x72 a
 * 600 s/pose budget still truncated both poses, which makes the image
 * diff meaningless. ~650 (standard) / ~1.9k (near) hit pixels keep the
 * diff statistics meaningful; the amplified diff canvas carries the
 * eyeball. */
const SURFACE_SHADE_AB_WIDTH = 96;
const SURFACE_SHADE_AB_HEIGHT = 54;
const SURFACE_SHADE_AB_WIDTH_SW = 96;
const SURFACE_SHADE_AB_HEIGHT_SW = 54;
/** Per-frame budget — sized for the leg's WORST arm, the full-width
 * baseline (see the raster comment above: 600 s/pose at 128x72 measured
 * TRUNCATED at both poses; 96x54 is 0.56x the rays with headroom on
 * top). The cheap arms finish in seconds-to-a-minute; only the baseline
 * ever spends this. The headless runner stretches its section timeout
 * when this leg is requested (gpu-flame-bench.mjs). */
const SURFACE_SHADE_AB_BUDGET_MS = 900_000;
const SURFACE_SHADE_AB_BUDGET_SW_MS = 300_000;

/** fr-p8bc shade A/B leg's "near" pose distance factor, vs. the standard
 * bench pose's `SURFACE_POSE_DIST_FACTOR` (2.4, far-field — mostly
 * background/miss rays). Closer in means hits dominate the raster: the
 * shading-BOUND regime the standard pose lacks and the one fr-p8bc's probe
 * width actually needs to be measured in. */
const SURFACE_SHADE_AB_NEAR_DIST_FACTOR = 1.4;

/** fr-p8bc shade A/B diff: doubles as the amplified-diff canvas's per-channel
 * multiplier (`min(255, |Δ| × 8)`, so an 8-level channel delta already
 * saturates to visible) and the `pctPixelsOver8` report threshold — the
 * field's own name is this constant's value, so the two never drift apart. */
const SURFACE_SHADE_AB_DIFF_THRESHOLD = 8;

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

/** fr-55s1 M0 (a): the sierpinski-shaped 4-map affine base
 * `scripts/surface-fold.verify.mjs`'s LENS_HASH is built on — no fold
 * anywhere, so `deHasFolds` routes it to the AFFINE core and its refined
 * oracle. Deliberately the lens archetype's BASE: stage B wraps this exact
 * system in a fold FINAL, and an M0 row that already agrees isolates the
 * lens wrapper as the only new thing there. */
function surfaceAffineTetra(): Transform[] {
  return [
    {
      id: 0,
      position: [0.35, 0.35, 0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.35, -0.35, 0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 2,
      position: [0.35, -0.35, -0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 3,
      position: [-0.35, 0.35, -0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];
}

/** fr-55s1 M0 (b): the affine core's RICH case — three rotated maps whose
 * per-axis scales differ, run under a kaleidoscope (order 3, `systemDefs`)
 * and an affine FINAL lens, so one row exercises the fr-x029 sector sweep,
 * the packed final-lens prologue/epilogue and the fr-zkt2 sphere-floor exit
 * at once (that exit is live exactly on ANISOTROPIC maps, whose
 * certificates lose a sigmaMin/sigmaMax factor per level; on isotropic
 * ones it provably never fires). The anisotropy is deliberately SMALL —
 * ratio 1.037 against `CONFORMAL_RATIO`'s 1.05 — because past that
 * `analyzeSurfaceSystem` reports "degraded" rather than "eligible", and an
 * agreement system should sit inside the mode's own eligible set. */
function surfaceAffineTwist(): Transform[] {
  return [
    {
      id: 0,
      position: [0.32, 0.18, -0.12],
      rotation: [0.35, 0.2, 0.1],
      scale: [0.42, 0.405, 0.41],
    },
    {
      id: 1,
      position: [-0.28, 0.3, 0.22],
      rotation: [0.1, -0.45, 0.25],
      scale: [0.405, 0.42, 0.41],
    },
    {
      id: 2,
      position: [0.05, -0.34, 0.3],
      rotation: [-0.2, 0.15, 0.5],
      scale: [0.41, 0.405, 0.42],
    },
  ];
}

/** {@link surfaceAffineTwist}'s AFFINE final lens — rotated, offset and
 * isotropically shrunk, so `SurfaceDE.final` is non-identity and the
 * kernel's packed `finalM*`/`finalT*`/`finalSigmaMin` path carries real
 * work (an absent final packs the identity and proves nothing). */
function surfaceAffineTwistFinal(): Transform {
  return {
    id: 99,
    position: [0.12, -0.08, 0.05],
    rotation: [0.25, 0.15, -0.3],
    scale: [0.85, 0.85, 0.85],
  };
}

/** fr-55s1 stage B (M1a): the LENS_HASH archetype's FINAL —
 * scripts/surface-fold.verify.mjs:52's fr-g58b lens verbatim (boxfold
 * weight 0.55 over a rotated, offset, shrunk affine part). Sits over
 * {@link surfaceAffineTetra}, so the M1 row pins the lens wrapper around
 * the SAME affine core M0's affineTetra row pins bare. */
function surfaceLensBoxfoldFinal(): Transform {
  return {
    id: 90,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
  };
}

/** fr-55s1 stage B (M1b): a mandelbox FINAL at weight 1 — fr-zx34's field
 * class (4-map affine base under a mandelbox lens) and the sweep's 81-branch
 * worst case, so the agreement row covers the spherefold shell guard, the
 * `b += 26` box-expansion skip and the per-s box re-triple in one system. */
function surfaceLensMandelboxFinal(): Transform {
  return {
    id: 91,
    position: [0.1, 0.05, -0.1],
    rotation: [0.15, -0.2, 0.25],
    scale: [0.85, 0.85, 0.85],
    variations: [{ type: "mandelbox", weight: 1 }],
  };
}

/** fr-55s1 stage B (M1c)'s BASE: the fr-5rvk two-map pure-boxfold pair
 * (scripts/surface-fold.verify.mjs's BOXFOLD_HASH shape, also
 * surface-de-gpu.test.ts's `foldSystemTransforms`) — a minimal eligible
 * FOLD base, so the lens leg pins the wrapper around the fold core too. */
function surfaceFoldBoxfoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** fr-55s1 stage B (M1c): a spherefold FINAL over the boxfold pair — the
 * 3-branch sweep (s0/s1/mid incl. the SPHEREFOLD_MID_MIN_R shell guard)
 * seeding FOLD-core descents, `descendLens`'s other inner route. */
function surfaceLensSpherefoldFinal(): Transform {
  return {
    id: 92,
    position: [-0.05, 0.1, 0.08],
    rotation: [0.1, 0.2, -0.15],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "spherefold", weight: 0.8 }],
  };
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

/** fr-dlxh M3 (a): the affine4 core's pure-DE baseline — four contracting,
 * near-isotropic maps whose LIVE w blocks (positions straddling 0, three
 * w-mixing rotations, one explicitly pinned `w.scale`) push the attractor
 * genuinely off the `w = 0` slice, so the 4x4 inverse maps carry real w
 * arithmetic everywhere. Queried at the identity rotor / `w0 = 0` /
 * zero-thickness slice (the shipped default view). Also aff4Slab's base:
 * that def re-views these EXACT maps through a w-mixing rotor + thick
 * slab, so any disagreement there isolates the view/segment machinery. */
function surfaceAff4Tetra(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.35, 0.3],
      rotation: [0, 0, 0],
      scale: [0.52, 0.52, 0.52],
      w: { position: 0.12, rotation: { xw: 0.4 } },
    },
    {
      id: 1,
      position: [-0.45, 0.3, -0.25],
      rotation: [0.2, 0.1, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.1, rotation: { yw: 0.3 } },
    },
    {
      id: 2,
      position: [0.3, -0.4, 0.2],
      rotation: [0, 0.3, 0.1],
      scale: [0.48, 0.48, 0.48],
      w: { position: 0.08, rotation: { zw: -0.35 } },
    },
    {
      id: 3,
      position: [-0.2, -0.3, -0.35],
      rotation: [0.1, 0, 0.25],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.14, scale: 0.48 },
    },
  ];
}

/** fr-dlxh M3 (b): the fr-u91x sector-sweep case — two 4D maps under a
 * TWISTED order-3 kaleidoscope (`plane: "xz", twist: 1`, a genuine double
 * rotation), so `stepSector4`'s one whole backward 4x4 (`stepBack4`, never
 * a (cos, sin) pair) carries real w mixing. Queried at a NONZERO `w0`
 * inside the attractor's w support (the def scales it from the probed
 * radius), identity rotor. */
function surfaceAff4Kaleido(): Transform[] {
  return [
    {
      id: 0,
      position: [0.45, 0.1, 0.2],
      rotation: [0, 0.2, 0],
      scale: [0.55, 0.55, 0.55],
      w: { position: 0.3, rotation: { xw: 0.35 } },
    },
    {
      id: 1,
      position: [-0.2, 0.4, -0.3],
      rotation: [0.15, 0, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.2, rotation: { zw: 0.25 } },
    },
  ];
}

/** fr-dlxh M3 (c)'s BASE: three contracting maps with live w blocks — the
 * 4D final-lens system's inner attractor (see {@link surfaceAff4Final}). */
function surfaceAff4FinalBase(): Transform[] {
  return [
    {
      id: 0,
      position: [0.35, 0.25, -0.3],
      rotation: [0.1, 0, 0.2],
      scale: [0.5, 0.5, 0.5],
      w: { position: 0.1, rotation: { yw: 0.3 } },
    },
    {
      id: 1,
      position: [-0.3, 0.35, 0.25],
      rotation: [0, 0.25, 0],
      scale: [0.52, 0.52, 0.52],
      w: { position: -0.12, rotation: { xw: -0.2 } },
    },
    {
      id: 2,
      position: [0.2, -0.35, -0.2],
      rotation: [0.3, 0.1, 0],
      scale: [0.48, 0.48, 0.48],
      w: { position: 0.06, scale: 0.5 },
    },
  ];
}

/** fr-dlxh M3 (c): a 4D affine FINAL lens with a live w block (w offset +
 * yw rotation over a rotated, offset, isotropically shrunk affine part —
 * surface-de-gpu.test.ts's `fourDFinalTransform` shape with a smaller w
 * offset, so the posed slice still cuts the lensed set), exercising the
 * packed `final4M`/`final4T`/`final4SigmaMin` tail and the oracle's own
 * lens prologue. The def views it through a NON-identity `xw` pose rotor. */
function surfaceAff4Final(): Transform {
  return {
    id: 99,
    position: [0.2, -0.1, 0.15],
    rotation: [0.3, -0.2, 0.1],
    scale: [0.7, 0.7, 0.7],
    w: { position: -0.05, rotation: { yw: 0.2 } },
  };
}

/** fr-rsp6 M4's boxfold base: `surface-de-4d.test.ts`'s `pureBoxfoldPair4`
 * verbatim (same numbers, same seed of live w blocks) — bench and CPU
 * tests pin the identical system on purpose. Isometric branches only
 * (sigma_c = 1 on every one of the 81), so `fold4Boxfold` is the fold4
 * leg's cheapest, cleanest-selection-boundary fixture; `fold4Kaleido` and
 * `fold4Slab` below reuse it under different views/symmetry. */
function surfaceFold4Boxfold(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      w: { position: 0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** fr-rsp6 M4's mandelbox base: `surface-de-4d.test.ts`'s
 * `pureMandelboxPair4` verbatim — the RETUNED weights (1.3/1.2) and small
 * scales (0.12/0.13) the CPU suite settled on so the width-12 frontier
 * actually SATURATES at a shallow depth (~20): see that test file's doc
 * for why a naive weight/scale rescale of 3D's own pair spreads u-space
 * out too far and never saturates, which would defeat the point of a
 * 243-branch (mandelbox = boxfold × spherefold) fixture. Do NOT swap in a
 * deeper/heavier variant here — the CPU oracle at 243 branches × 700
 * queries × 7 classifier probes is already this leg's most expensive CPU
 * work. */
function surfaceFold4Mandelbox(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, -0.15, 0.1],
      rotation: [0.2, 0.4, 0],
      scale: [0.12, 0.12, 0.12],
      w: { position: 0.15, rotation: { xw: 0.25 } },
      variations: [{ type: "mandelbox", weight: 1.3 }],
    },
    {
      id: 1,
      position: [-0.25, 0.2, -0.2],
      rotation: [0.1, 0, 0.3],
      scale: [0.13, 0.13, 0.13],
      w: { position: -0.15, rotation: { xw: 0.25 } },
      variations: [{ type: "mandelbox", weight: 1.2 }],
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

/** Like {@link parseSurfaceIntList}, but for `surfaceShadeWidth`: default
 * `[]` (absent = leg skipped) and every dropped token is reported instead
 * of silently vanishing — see `SurfaceSectionConfig.shadeWidthNotes`'s doc
 * for why this one param gets that treatment. */
function parseSurfaceShadeWidths(raw: string | null): {
  widths: number[];
  notes: string[];
} {
  if (raw === null) return { widths: [], notes: [] };
  const widths: number[] = [];
  const notes: string[] = [];
  for (const token of raw.split(",").map((s) => s.trim())) {
    if (token.length === 0) continue;
    const n = Number.parseInt(token, 10);
    if (Number.isInteger(n) && n >= 1) {
      widths.push(n);
    } else {
      notes.push(
        `surfaceShadeWidth: ignoring invalid entry "${token}" (must be a positive integer)`,
      );
    }
  }
  return { widths, notes };
}

/** URL-param surface config, all optional: `surfaceWidths` (agreement,
 * default 12,4), `surfaceTimingWidths` (default 12,8,6,4),
 * `surfaceVariants` (default shared,private), `surfaceWg` (shared default
 * 32; private uses 64 unless the param is given, in which case both use
 * it), `surfaceSize` (march raster, default 320x180), `surfaceCapMs`
 * (per-timing-config wall cap, default 120000), `surfaceSystems`
 * (all|synthetic — synthetic skips the mandelboxKifs preset),
 * `surfaceTiming` (0 skips timing), `surfaceForce` (1 runs timing even on
 * a software adapter), `surfaceShadeWidth` (fr-p8bc shade A/B leg probe
 * widths, e.g. "1,4"; default empty — leg skipped), `surfaceAff4Sweep`
 * (fr-b72d opt-in per-order affine4 timing sweep, "1" = on; default off —
 * see `runSurfaceAff4SweepLeg`'s doc). */
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
  const shadeWidths = parseSurfaceShadeWidths(params.get("surfaceShadeWidth"));
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
    surfaceShadeWidths: shadeWidths.widths,
    shadeWidthNotes: shadeWidths.notes,
    aff4Sweep: params.get("surfaceAff4Sweep") === "1",
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
 *
 * The cloud is rolled through the system's own FINAL transform and
 * kaleidoscope (fr-55s1): the on-attractor class only means anything if it
 * samples the set the DE actually describes. Both default to the
 * fold systems' existing arguments, so their query sets are unchanged.
 */
function surfaceQueries(
  transforms: Transform[],
  radius: number,
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = SURFACE_NO_SYMMETRY,
): Vec3[] {
  const cloud = runChaosGame(
    transforms,
    SURFACE_CLOUD_POINTS,
    mulberry32(101),
    finalTransform,
    symmetry,
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

/**
 * fr-dlxh: the escape eval leg's own query mix — `surfaceQueries`' chaos-game
 * sampling is unsound here (a single EXPANDING map has no attractor to
 * scatter a cloud onto), so this samples directly: 400 uniform cube points,
 * 200 bisected onto the `DE < 0.02` near-boundary shell (the region a
 * distance estimator most needs to be right in), and 100 clustered on the
 * map's own fixed offset (deep "inside", non-escaping by construction for
 * every eligible map). 700 total, every component `Math.fround`ed — see
 * `surfaceQueries`' doc for why (the kernel only ever sees f32 query points).
 *
 * The near-boundary batch starts `a` SMALL (unscaled by `R`, so it is very
 * likely inside the non-escaping set) and `b` at a fresh uniform cube point
 * (very likely escaping) — opposite sides of the `DE == 0.02` crossing more
 * often than not — then bisects 24 times: each step keeps whichever half
 * agrees with `a`'s own predicate, so both ends close in on the crossing.
 * `a` (not the midpoint) is what gets pushed — see the module's inline
 * comment where that happens.
 */
function escapeQueries(de: EscapeDE, seed: number): Vec3[] {
  const R = de.boundingRadius;
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  const half = 1.2 * R;
  const uniformCubePoint = (): Vec3 => [
    Math.fround((rng() - 0.5) * 2 * half),
    Math.fround((rng() - 0.5) * 2 * half),
    Math.fround((rng() - 0.5) * 2 * half),
  ];
  for (let i = 0; i < 400; i++) {
    out.push(uniformCubePoint());
  }
  const nearBoundary = (p: Vec3): boolean =>
    estimateEscapeDistance(de, p) < 0.02;
  for (let i = 0; i < 200; i++) {
    let a: Vec3 = [
      (rng() - 0.5) * 1.2,
      (rng() - 0.5) * 1.2,
      (rng() - 0.5) * 1.2,
    ];
    let b = uniformCubePoint();
    const pa = nearBoundary(a);
    for (let step = 0; step < 24; step++) {
      const mid: Vec3 = [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ];
      if (nearBoundary(mid) === pa) {
        a = mid;
      } else {
        b = mid;
      }
    }
    // The final `a` — see the doc above.
    out.push([Math.fround(a[0]), Math.fround(a[1]), Math.fround(a[2])]);
  }
  for (let i = 0; i < 100; i++) {
    const s = rng() * 0.5;
    out.push([
      Math.fround(de.t[0] + (rng() - 0.5) * s),
      Math.fround(de.t[1] + (rng() - 0.5) * s),
      Math.fround(de.t[2] + (rng() - 0.5) * s),
    ]);
  }
  return out;
}

/** The affine4 leg's tolerance/query radius rule: the lens GROWS or shrinks
 * the visible set, so error scales from the set the DE actually describes —
 * M0's `foldFinal ? visibleBoundingRadius : boundingRadius` analog one
 * dimension up. ONE definition, shared by the query generator and the
 * comparator so the two cannot drift. */
function surface4ToleranceR(de: SurfaceDE4): number {
  return de.final ? de.visibleBoundingRadius : de.boundingRadius;
}

/**
 * fr-dlxh M3 (fr-rsp6 M4 reuses it for fold4): the affine4/fold4 eval legs'
 * COMPOSED f64 oracle — the exact function the kernel computes per query,
 * CPU-side. The view lift first (`q4 = Mᵀ · (q, w0)` where M is the
 * row-major pose rotor — component `i` reads M's COLUMN `i`, exactly the
 * packed rotorInv rows), then the fr-wa6o half-extent seeded from M's w
 * ROW times `sliceHalfW` (the kernel's `rotorInvWCol4() * params.sliceHalfW`),
 * then the inner estimator at cutoff 0 — which applies `de.final`/kaleidoscope
 * ITSELF, so nothing is pre-applied here. `refined` (default `true`, M3's
 * only mode) picks `estimateDistance4Refined`; fold4 (M4) passes `false` for
 * PLAIN `estimateDistance4` — `descendFold4`'s refine=FALSE path, the
 * estimator the fold4 GLSL/WGSL body actually marches, 3D's fold-core
 * precedent one dimension up. The kernel does the same lift in f32; the
 * eval tolerance absorbs that quantization (the queries are already
 * `Math.fround`ed, so both sides start from the identical point).
 */
function estimateSurface4Composed(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  q: Vec3,
  refined = true,
): number {
  const rot = view4.rotor;
  const p: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    p[i] =
      rot[i] * q[0] +
      rot[4 + i] * q[1] +
      rot[8 + i] * q[2] +
      rot[12 + i] * view4.w0;
  }
  let ext: Vec4 | null = null;
  if (view4.sliceHalfW > 0) {
    ext = [
      rot[12] * view4.sliceHalfW,
      rot[13] * view4.sliceHalfW,
      rot[14] * view4.sliceHalfW,
      rot[15] * view4.sliceHalfW,
    ];
  }
  return refined
    ? estimateDistance4Refined(de, p, 0, ext)
    : estimateDistance4(de, p, ext);
}

/**
 * fr-dlxh M3: the affine4 leg's ORACLE-CONTINUITY classifier — the escape
 * leg's pre-hoc ensemble shape ({@link escapeQueryStable}) minus the GPU
 * modeling it doesn't need: no fround twin, no shadow orbits, just the
 * COMPOSED f64 oracle at the query's six ±1-f32-ULP axis neighbors (the
 * queries are fround'ed, so that grid is the input's own resolution; the
 * neighbor construction is escapeQueryStable's verbatim). STABLE iff all
 * seven values lie within tol/2 of the value at `q`; unstable rows are
 * excluded from the fail gate (capped — {@link
 * SURFACE_AFFINE4_EXCLUDED_CAP}).
 *
 * WHY (first-SwiftShader-run verdict): the refined beam's mins absorb f32
 * trajectory flips — but they cannot absorb standing ON a beam-SELECTION
 * boundary. The query mix's 24-step chord bisection narrows its bracket
 * to ~1 f32 ULP, so when a chord's predicate flip is caused by a
 * beam-selection discontinuity (~3e-2 value step) rather than a smooth
 * crossing, the pushed query parks exactly on the step. Measured: 2 of
 * 2800 queries (one per w0≠0 system, both bisection-class) failed at
 * +2.66e-2/−3.56e-2 while the f64 ORACLE ITSELF returned the GPU's value
 * 1-2 query-ULPs away (gaps 1.3e-8 / 2.3e-9) — both sides of such an
 * edge are valid conservative bounds, so pointwise comparison THERE is
 * the wrong question, exactly the escape leg's chaotic-orbit exclusion
 * one estimator class over (and cheaper: pure discontinuity detection).
 * The full-mix census: 5/2800 excluded (1/1/0/3), both GPU flips among
 * them — the other three parked rows happened to land the same side on
 * both processors.
 *
 * fr-rsp6 M4 reuses this verbatim for the fold4 leg, `refined=false` so the
 * probed neighbors and the caller's `cpu` value are the SAME PLAIN estimator
 * — fold frontiers select among far more branches per level (81/243 vs the
 * affine ladder's 4), so a denser discontinuity set is plausible on its own
 * (see {@link SURFACE_FOLD4_EXCLUDED_CAP}'s doc).
 */
function surface4QueryStable(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  q: Vec3,
  cpu: number,
  tol: number,
  refined = true,
): boolean {
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const p: Vec3 = [q[0], q[1], q[2]];
      const base = Math.fround(p[axis]);
      const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38);
      p[axis] = Math.fround(base + dir * step);
      if (
        Math.abs(estimateSurface4Composed(de, view4, p, refined) - cpu) >
        tol / 2
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * fr-dlxh M3: the affine4 eval leg's own query mix — `surfaceQueries`'
 * 3D chaos-game sampling doesn't know the view lift, and `escapeQueries`'
 * sizes assume an escape basin, so this leg samples VIEW-space directly
 * (the kernel's own input space), `escapeQueries`' structure at the
 * slice's scale: 400 uniform in the view-space ball of radius
 * `1.2 · max(sliceVisR, 0.25 · R4)` centered on the origin (`sliceVisR`
 * is the packer's slice-adjusted visible radius — the slab's widest 3D
 * shadow — recomputed here from {@link surface4ToleranceR}; when the
 * pose puts the whole slice outside the visible ball it degenerates to
 * 0, so `0.5 · R4` stands in and queries still exist), 200 chord-bisected
 * toward the COMPOSED oracle's `DE < 0.02 · R4` crossing (a slice through
 * fractal dust has a THIN sublevel set, so chords that never straddle it
 * simply converge near their far end — extra uniform samples, harmless
 * and deterministic), and 100 clustered on the view origin (the slice's
 * central region). 700 total, every component `Math.fround`ed — see
 * `surfaceQueries`' doc for why (the kernel only ever sees f32 points).
 *
 * fr-rsp6 M4 reuses this verbatim for the fold4 leg (`refined=false`,
 * threaded into every `estimateSurface4Composed` call below including the
 * boundary-bisection predicate) rather than forking a fold-shaped twin —
 * the sampling GEOMETRY (ball radius, bisection depth, cluster spread)
 * doesn't depend on which estimator decides "near the boundary", only on
 * the system's own scale.
 */
function affine4Queries(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  seed: number,
  refined = true,
): Vec3[] {
  const R4 = de.boundingRadius;
  const visR = surface4ToleranceR(de);
  const minW = Math.max(Math.abs(view4.w0) - view4.sliceHalfW, 0);
  const sliceVisRRaw = Math.sqrt(Math.max(visR * visR - minW * minW, 0));
  const sliceVisR = sliceVisRRaw > 0 ? sliceVisRRaw : 0.5 * R4;
  const rq = 1.2 * Math.max(sliceVisR, 0.25 * R4);
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  const uniformBallPoint = (): Vec3 => {
    // Rejection sampling off the enclosing cube — deterministic for a
    // seeded RNG (acceptance ~52%, so the loop terminates fast).
    for (;;) {
      const x = (rng() - 0.5) * 2;
      const y = (rng() - 0.5) * 2;
      const z = (rng() - 0.5) * 2;
      if (x * x + y * y + z * z <= 1) {
        return [x * rq, y * rq, z * rq];
      }
    }
  };
  for (let i = 0; i < 400; i++) {
    const p = uniformBallPoint();
    out.push([Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])]);
  }
  const threshold = 0.02 * R4;
  const nearBoundary = (p: Vec3): boolean =>
    estimateSurface4Composed(de, view4, p, refined) < threshold;
  for (let i = 0; i < 200; i++) {
    let a: Vec3 = [
      (rng() - 0.5) * 0.5 * rq,
      (rng() - 0.5) * 0.5 * rq,
      (rng() - 0.5) * 0.5 * rq,
    ];
    let b = uniformBallPoint();
    const pa = nearBoundary(a);
    for (let step = 0; step < 24; step++) {
      const mid: Vec3 = [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ];
      if (nearBoundary(mid) === pa) {
        a = mid;
      } else {
        b = mid;
      }
    }
    // The final `a` — escapeQueries' convention, see its doc.
    out.push([Math.fround(a[0]), Math.fround(a[1]), Math.fround(a[2])]);
  }
  for (let i = 0; i < 100; i++) {
    const s = rng() * 0.5 * rq;
    out.push([
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
    ]);
  }
  return out;
}

/**
 * fr-dlxh: the bench's f32 twin of `estimateEscapeDistance` — every
 * intermediate `Math.fround`ed, the same duplicated-emulator discipline
 * this file's CPU march emulators already follow (`surfaceCpuMarch` et
 * al.). Comparing this against the f64 oracle in isolation, before either
 * touches the GPU, separates f32-vs-f64 ORBIT divergence (a forward
 * iteration is chaotic — a single clamp-boundary rounding flip early on can
 * send the whole trajectory somewhere else, and unlike the IFS beam
 * estimators there is no min-of-several-chains to absorb it) from actual
 * kernel arithmetic bugs. See `compareSurfaceEscapeAgreement`'s doc for how
 * the gap between the two oracles is used.
 */
function estimateEscapeDistanceF32(de: EscapeDE, p: Vec3): number {
  const f = Math.fround;
  const m = de.m.map(f);
  const t = de.t.map(f);
  const w = f(de.w);
  const g = f(de.derivGrowth);
  let vx = f(p[0]);
  let vy = f(p[1]);
  let vz = f(p[2]);
  let dr = 1;
  let r = f(Math.sqrt(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))));
  const fold = (x: number): number =>
    f(f(2 * Math.max(-1, Math.min(1, x))) - x);
  for (let i = 0; i < ESCAPE_TIME_ITERATIONS && r <= de.boundingRadius; i++) {
    let yx = f(f(f(f(m[0] * vx) + f(m[1] * vy)) + f(m[2] * vz)) + t[0]);
    let yy = f(f(f(f(m[3] * vx) + f(m[4] * vy)) + f(m[5] * vz)) + t[1]);
    let yz = f(f(f(f(m[6] * vx) + f(m[7] * vy)) + f(m[8] * vz)) + t[2]);
    let localL = 1;
    if (de.foldKind !== 2) {
      yx = fold(yx);
      yy = fold(yy);
      yz = fold(yz);
    }
    if (de.foldKind !== 1) {
      const r2 = f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz));
      const s = f(1 / Math.max(0.25, Math.min(1, r2)));
      yx = f(yx * s);
      yy = f(yy * s);
      yz = f(yz * s);
      localL = s;
    }
    vx = f(w * yx);
    vy = f(w * yy);
    vz = f(w * yz);
    dr = f(f(f(g * localL) * dr) + 1);
    r = f(Math.sqrt(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))));
  }
  return r / dr;
}

/**
 * fr-dlxh: the ENSEMBLE half of the escape stability classifier. The
 * fround twin alone tests ONE f32 realization, and that is measurably
 * not enough: the first real-Iris `--display=:0` run flipped 6 queries
 * the fround-only classifier had called stable (maxAbs 4.1e-1 on
 * escMandelboxRot) while SwiftShader — whose rounding tracks fround
 * closely — flipped none. There is no boundary-proximity predictor to
 * reach for instead: every fold here is C0-CONTINUOUS at its branch
 * boundaries (foldAxis and sphereFoldFactor agree from both sides, only
 * derivatives flip), so passing near one injects only ULP-scale error —
 * a margin classifier built on that model measured 384-400/700
 * exclusions on systems whose GPU rows are ULP-perfect. The real
 * discontinuity is the ESCAPE-DECISION dichotomy: exponential noise
 * growth (~8x/iteration) can flip whether a marginal orbit ever crosses
 * the r > R bailout at all, and dr then differs by orders of magnitude.
 * Which seeds flip is realization-dependent, so the classifier BRACKETS
 * the marginal set empirically: perturb the query by one f32 ULP along
 * each axis in each direction (6 variants + the base) and demand every
 * fround orbit agree with the f64 oracle — an orbit that survives all
 * seven is far from the dichotomy under any faithful f32's noise.
 */
function escapeQueryStable(
  de: EscapeDE,
  q: Vec3,
  cpu64: number,
  tol: number,
): boolean {
  if (Math.abs(estimateEscapeDistanceF32(de, q) - cpu64) > tol / 2) {
    return false;
  }
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const p: Vec3 = [q[0], q[1], q[2]];
      const base = Math.fround(p[axis]);
      const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38);
      p[axis] = Math.fround(base + dir * step);
      if (Math.abs(estimateEscapeDistanceF32(de, p) - cpu64) > tol / 2) {
        return false;
      }
    }
  }
  return true;
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
 * `distFactor` × visibleBoundingRadius (default `SURFACE_POSE_DIST_FACTOR`
 * 2.4 — every existing caller), vertical fov 60° — packed into the kernel's
 * {@link SurfaceGpuPose}. `distFactor` is fr-p8bc's shade A/B leg's hook for
 * its closer "near" pose ({@link SURFACE_SHADE_AB_NEAR_DIST_FACTOR}); no
 * other caller passes it. */
function buildSurfacePose(
  // Structural pick, not the whole DE: the escape frame leg (fr-dlxh)
  // frames its bailout ball through the same pose math.
  de: Pick<SurfaceDE, "visibleBoundingRadius">,
  rasterWidth: number,
  rasterHeight: number,
  distFactor: number = SURFACE_POSE_DIST_FACTOR,
): SurfaceGpuPose {
  const target: Vec3 = [0, 0, 0];
  const radius = distFactor * de.visibleBoundingRadius;
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
/** The estimator a system's kernel marches (fr-55s1) — the freeze loop's
 * routing, verbatim: fold base maps the plain descent, fold-free ones the
 * refined ladder; both route a `foldFinal` through `descendLens`
 * internally, so the march emulators stay one call either way. */
function surfaceMarchEstimate(de: SurfaceDE, p: Vec3, eps: number): number {
  return deHasFolds(de)
    ? estimateDistance(de, p, eps)
    : estimateDistanceRefined(de, p, eps);
}

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
    const d = surfaceMarchEstimate(de, p, eps);
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
function surfaceInvProjView(
  de: Pick<SurfaceDE, "boundingRadius">,
  pose: SurfaceGpuPose,
): Float32Array {
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
 * surfaceCpuMarch's: f64 accumulation, {@link surfaceMarchEstimate} (the
 * system's own core estimator since fr-55s1), the same
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
    const d = surfaceMarchEstimate(de, p, eps);
    steps++;
    if (d < eps) return { status: SURFACE_GPU_RAY_HIT, t };
    t += d * de.stepScale;
  }
}

function surfaceRayStatusName(status: number): string {
  if (status === SURFACE_GPU_RAY_HIT) return "HIT";
  if (status === SURFACE_GPU_RAY_MISS) return "MISS";
  if (status === SURFACE_GPU_RAY_EXHAUSTED) return "EXHAUSTED";
  if (status === SURFACE_GPU_RAY_ACTIVE) return "ACTIVE";
  return `?${String(status)}`;
}

/**
 * {@link surfaceCpuMarchState}'s loop run for its CLOSEST APPROACH instead
 * of its terminal event: the smallest `d / eps` the march ever sampled, and
 * where. A ray that misses by f64 noise reports a ratio just above 1 — the
 * signature of a silhouette graze, where the two sides' f32 trajectories
 * legitimately disagree about whether the surface was touched. A genuinely
 * empty ray reports a ratio orders of magnitude above it.
 *
 * This is what the silhouetteFlips exclusion GATES on (fr-7tl3), not merely
 * what a row prints: a terminal `t` says where a march stopped, and for a
 * hit-vs-miss pair those places are unrelated by construction, but the
 * closest approach says where it came NEAREST — the one place both sides
 * can be compared. `tAtMin` is therefore the evidence that two marches
 * tracked the same trajectory, and `minRatio` the evidence that the
 * acceptance test itself was the marginal quantity.
 */
function surfaceCpuMarchApproach(
  de: SurfaceDE,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
): { minRatio: number; tAtMin: number } {
  const radius = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return { minRatio: Infinity, tAtMin: -1 };
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return { minRatio: Infinity, tAtMin: -1 };
  let t = Math.max(-b - sq, 0);
  let minRatio = Infinity;
  let tAtMin = -1;
  for (let steps = 0; steps < maxSteps && t <= tFar; steps++) {
    const eps = Math.max(
      pixelEps * t,
      de.boundingRadius * SURFACE_GPU_HIT_FLOOR,
    );
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = surfaceMarchEstimate(de, p, eps);
    const ratio = d / eps;
    if (ratio < minRatio) {
      minRatio = ratio;
      tAtMin = t;
    }
    if (d < eps) break;
    t += d * de.stepScale;
  }
  return { minRatio, tAtMin };
}

/**
 * fr-7tl3: what a status mismatch the boundary rule did not cover prints
 * about ITSELF — whether it went on to be excluded as a silhouette flip or
 * to fail the gate (the caller tags which). The aggregate counters name a
 * count, never a ray, so the first move on a red verdict used to be
 * re-deriving the ray by hand from the leg's pose; this puts its index,
 * direction, both terminal states, and the two pieces of evidence that
 * distinguish a silhouette flip from a diverged trajectory on the record
 * instead:
 *
 * - `oracle` — the CPU oracle's distance at the HITTING side's endpoint,
 *   relative to that endpoint's own acceptance eps (the same question the
 *   both-hit graze branch asks). Below ~1.5 the hitting side stopped on a
 *   genuine surface point, so the other side merely stepped past it.
 * - `approach` — the caller's already-computed {@link surfaceCpuMarchApproach}
 *   result (closest approach in eps units), supplied rather than recomputed
 *   here — the caller already needed it for the silhouetteFlips test. Just
 *   above 1 means the f64 march came within rounding of a hit.
 */
function describeSurfaceUnprojectMismatch(
  de: SurfaceDE,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  approach: { minRatio: number; tAtMin: number },
  info: {
    ray: number;
    px: number;
    py: number;
    gpuStatus: number;
    gpuT: number;
    cpuStatus: number;
    cpuT: number;
    tol: number;
  },
): string {
  const hitT =
    info.gpuStatus === SURFACE_GPU_RAY_HIT
      ? info.gpuT
      : info.cpuStatus === SURFACE_GPU_RAY_HIT
        ? info.cpuT
        : -1;
  let oracle = "n/a (neither side hit)";
  if (hitT >= 0) {
    const p: Vec3 = [
      ro[0] + rd[0] * hitT,
      ro[1] + rd[1] * hitT,
      ro[2] + rd[2] * hitT,
    ];
    const eps = Math.max(
      pixelEps * hitT,
      de.boundingRadius * SURFACE_GPU_HIT_FLOOR,
    );
    const d = estimateDistance(de, p, eps * 1.5);
    const side = info.gpuStatus === SURFACE_GPU_RAY_HIT ? "gpu" : "cpu";
    oracle =
      `${side} endpoint d/eps=${(d / eps).toExponential(2)} ` +
      `(d=${d.toExponential(2)} eps=${eps.toExponential(2)})`;
  }
  return (
    `ray=${String(info.ray)} px=${String(info.px)},${String(info.py)} ` +
    `gpu=${surfaceRayStatusName(info.gpuStatus)}@t=${info.gpuT.toExponential(4)} ` +
    `cpu=${surfaceRayStatusName(info.cpuStatus)}@t=${info.cpuT.toExponential(4)} ` +
    `|dt|=${Math.abs(info.gpuT - info.cpuT).toExponential(2)} tol=${info.tol.toExponential(2)} ` +
    `rd=[${rd.map((v) => v.toFixed(6)).join(",")}] ` +
    `oracle: ${oracle} ` +
    `approach: minD/eps=${approach.minRatio.toExponential(2)}@t=${approach.tAtMin.toExponential(4)}`
  );
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
  /** Which kernel core this system is entitled to, and therefore which CPU
   * oracle `cpu` below holds — both inferred from the DE by `deHasFolds`,
   * exactly as `surface-de.ts`'s own estimators route (fr-55s1). Widened to
   * the shared `"fold" | "affine" | "escape"` vocabulary (fr-dlxh), though
   * this state never actually carries "escape": `buildSurfaceDE` refuses
   * escape-time shapes by design, so those systems live in the separate
   * {@link SurfaceEscapeSystemState} array below instead — its own `de`
   * (`EscapeDE`) shares almost none of `SurfaceDE`'s fields, so there is no
   * single state shape the two could usefully share. */
  core: "fold" | "affine" | "escape";
  de: SurfaceDE;
  /** The authored system behind `de`, passed to `surface-slots.ts`'s
   * `surfaceSlotColors`/`surfaceTrapIndices` so the bench shades with the
   * app's exact keying rather than a copy of it. */
  transforms: Transform[];
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

/** One escape-time system's frozen state (fr-dlxh): the forward-map DE, its
 * own dedicated query set (`escapeQueries`, not `surfaceQueries` — a single
 * expanding map has no attractor to scatter a chaos-game cloud onto), and
 * the f64/f32 CPU-oracle pair the eval leg's stability gate is built from
 * (`compareSurfaceEscapeAgreement`'s doc). No `buffers.maps`: the escape
 * kernel core never declares binding 1 (surface-de-gpu.ts module doc), so
 * this state — unlike {@link SurfaceSystemState} — has no maps buffer to
 * carry. */
interface SurfaceEscapeSystemState {
  name: string;
  de: EscapeDE;
  queries: Vec3[];
  /** `estimateEscapeDistance` (f64) — the CPU oracle. */
  cpu64: number[];
  /** `estimateEscapeDistanceF32` — the bench's fround twin, evaluated at
   * the SAME points, so any gap against `cpu64` isolates f32-vs-f64 orbit
   * divergence from kernel arithmetic (see its doc). */
  cpu32: number[];
  /** Per-query stability: `|cpu32 − cpu64| <= tol/2`. Only stable queries
   * enter the GPU agreement gate — see `compareSurfaceEscapeAgreement`. */
  stable: boolean[];
  buffers?: {
    params: GPUBuffer;
    input: GPUBuffer;
    output: GPUBuffer;
    staging: GPUBuffer;
    bindGroup: GPUBindGroup;
  };
}

/** One affine4 (4D) agreement system's frozen state (fr-dlxh M3): the built
 * `SurfaceDE4`, the frozen per-system view (rotor + w0 + sliceHalfW — the
 * packer's {@link SurfaceGpu4View}), its own view-space query set
 * ({@link affine4Queries}) and the COMPOSED f64 oracle values
 * ({@link estimateSurface4Composed} — view lift + `estimateDistance4Refined`,
 * the exact function the kernel computes). The buffer set mirrors
 * {@link SurfaceSystemState}'s maps-bound shape: unlike escape, the affine4
 * core DOES declare binding 1 (`array<GpuMap4>`, `packSurfaceGpuMaps4`). */
interface Surface4SystemState {
  name: string;
  de: SurfaceDE4;
  view4: SurfaceGpu4View;
  /** The authored system behind `de` — the ifs frame leg's
   * `surfaceSlotColors`/`surfaceTrapIndices` keying (SurfaceSystemState's
   * field, mirrored so the ifs4 frame leg shades with the app's exact
   * slot keying too). */
  transforms: Transform[];
  queries: Vec3[];
  cpu: number[];
  /** Per-query oracle continuity: the six ±1-f32-ULP neighbors' f64 oracle
   * values all within tol/2 of `cpu` ({@link surface4QueryStable}). Only
   * stable queries enter the fail gate — see `compareSurface4Agreement`. */
  stable: boolean[];
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

/** The escape core's 3-binding interface (surface-de-gpu.ts's contract): 0 =
 * params uniform, 2 = input storage read, 3 = output storage read_write —
 * binding 1 (maps) is not declared by the escape kernel (its one forward
 * map rides the params uniform's 208..271 variant block instead), so it is
 * not declared here either. A bind group built against this layout must
 * skip binding 1 too, or `createBindGroup` throws (extra entry, no matching
 * layout slot). */
function surfaceEscapeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "surface-de escape bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
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

/** {@link ensureSurfaceEvalBuffers}'s escape-core twin (fr-dlxh): the same
 * lazy-create-once contract, minus the maps buffer/binding — the escape
 * kernel's one forward map rides `packEscapeGpuParams`' params uniform,
 * never a storage binding (see {@link surfaceEscapeBindGroupLayout}). */
async function ensureSurfaceEscapeEvalBuffers(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sys: SurfaceEscapeSystemState,
): Promise<NonNullable<SurfaceEscapeSystemState["buffers"]>> {
  if (sys.buffers) return sys.buffers;
  const n = sys.queries.length;
  const paramsData = packEscapeGpuParams(sys.de, { itemCount: n, cutoff: 0 });
  const inputData = new Float32Array(n * 4);
  sys.queries.forEach((q, i) => {
    inputData[i * 4] = q[0];
    inputData[i * 4 + 1] = q[1];
    inputData[i * 4 + 2] = q[2];
  });
  const params = await createSurfaceBuffer(
    device,
    `surface-de escape params ${sys.name}`,
    paramsData.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(params, 0, paramsData);
  const input = await createSurfaceBuffer(
    device,
    `surface-de escape queries ${sys.name}`,
    inputData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(input, 0, inputData);
  const output = await createSurfaceBuffer(
    device,
    `surface-de escape results ${sys.name}`,
    n * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const staging = await createSurfaceBuffer(
    device,
    `surface-de escape staging ${sys.name}`,
    n * 4,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const bindGroup = device.createBindGroup({
    label: `surface-de escape bind group ${sys.name}`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 2, resource: { buffer: input } },
      { binding: 3, resource: { buffer: output } },
    ],
  });
  sys.buffers = { params, input, output, staging, bindGroup };
  return sys.buffers;
}

function destroySurfaceEscapeEvalBuffers(sys: SurfaceEscapeSystemState): void {
  if (!sys.buffers) return;
  sys.buffers.params.destroy();
  sys.buffers.input.destroy();
  sys.buffers.output.destroy();
  sys.buffers.staging.destroy();
  sys.buffers = undefined;
}

/** {@link ensureSurfaceEvalBuffers}' affine4 twin (fr-dlxh M3): the same
 * lazy-create-once contract and the same four bindings, with the 4D packers
 * — `packSurface4GpuParams` (the frozen block + the 208.. 4D variant tail,
 * fed the system's frozen view) and `packSurfaceGpuMaps4` (`GpuMap4`
 * layout at binding 1). Eval params mirror the composed oracle's call:
 * itemCount = query count, cutoff 0, no footprint (the 4D packer THROWS on
 * one — the oracle takes none). */
async function ensureSurface4EvalBuffers(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sys: Surface4SystemState,
): Promise<NonNullable<Surface4SystemState["buffers"]>> {
  if (sys.buffers) return sys.buffers;
  const n = sys.queries.length;
  const paramsData = packSurface4GpuParams(sys.de, sys.view4, {
    itemCount: n,
    cutoff: 0,
  });
  // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
  const mapsData = new Float32Array(packSurfaceGpuMaps4(sys.de));
  const inputData = new Float32Array(n * 4);
  sys.queries.forEach((q, i) => {
    inputData[i * 4] = q[0];
    inputData[i * 4 + 1] = q[1];
    inputData[i * 4 + 2] = q[2];
  });
  const params = await createSurfaceBuffer(
    device,
    `surface-de affine4 params ${sys.name}`,
    paramsData.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(params, 0, paramsData);
  const maps = await createSurfaceBuffer(
    device,
    `surface-de affine4 maps ${sys.name}`,
    mapsData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(maps, 0, mapsData);
  const input = await createSurfaceBuffer(
    device,
    `surface-de affine4 queries ${sys.name}`,
    inputData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(input, 0, inputData);
  const output = await createSurfaceBuffer(
    device,
    `surface-de affine4 results ${sys.name}`,
    n * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const staging = await createSurfaceBuffer(
    device,
    `surface-de affine4 staging ${sys.name}`,
    n * 4,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const bindGroup = device.createBindGroup({
    label: `surface-de affine4 bind group ${sys.name}`,
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

function destroySurface4EvalBuffers(sys: Surface4SystemState): void {
  if (!sys.buffers) return;
  sys.buffers.params.destroy();
  sys.buffers.maps.destroy();
  sys.buffers.input.destroy();
  sys.buffers.output.destroy();
  sys.buffers.staging.destroy();
  sys.buffers = undefined;
}

/** Shared by every eval leg (fold/affine/lens AND escape, fr-dlxh): the
 * dispatch body only ever touches the query count and the three bindings
 * every eval bind group carries in common (results/staging/bindGroup — the
 * escape core's params/queries/results trio, or the maps-bound legs'
 * params/maps/queries/results, land the same three names either way), so
 * ONE function serves both {@link SurfaceSystemState} and {@link
 * SurfaceEscapeSystemState} through this narrower structural parameter
 * type rather than forking a byte-identical twin. */
async function runSurfaceEvalDispatch(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  sys: {
    queries: Vec3[];
    buffers?: {
      output: GPUBuffer;
      staging: GPUBuffer;
      bindGroup: GPUBindGroup;
    };
  },
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

/** The standard surface eval tolerance — `compareSurfaceAgreement`'s formula,
 * factored out so its escape-leg twin ({@link compareSurfaceEscapeAgreement})
 * uses the IDENTICAL bound rather than a second copy that could drift. */
function surfaceEvalTol(cpu: number, R: number): number {
  return Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(cpu), 0.05 * R));
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
    const tol = surfaceEvalTol(cpu, R);
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
    core: cfg.core,
    variant: cfg.variant,
    width: cfg.width,
    stage2: cfg.stage2,
    wg: cfg.wg,
    n: sys.cpu.length,
    maxAbsErr,
    maxRelErr,
    p99AbsErr,
    gating: cfg.core === "affine" || cfg.width === SURFACE_FOLD_BEAM_WIDTH,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    failuresByClass,
  };
}

/**
 * {@link compareSurfaceAgreement}'s escape-leg twin (fr-dlxh). A forward
 * escape-time orbit is CHAOTIC — with no beam-of-several-chains to absorb a
 * clamp-boundary rounding flip the way the IFS beam estimators do, an f32
 * trajectory can diverge from its f64 twin long before either orbit
 * escapes, producing total DE disagreement that is orbit chaos, not a
 * kernel bug (measured on the canonical query mix: 2/700 on the axis-aligned
 * mandelbox, 28/700 on the rotated, negative-weight one, both at
 * `maxAbs` ~1.17). So this gate compares GPU against the f64 oracle only on
 * queries `sys.stable` already marked f32-stable against that SAME f64
 * oracle — `excluded` reports how many were skipped, and the caller pins
 * that fraction (never silently loses its teeth) by failing the section
 * outright if too many queries end up excluded. */
/**
 * fr-dlxh: the eval leg's POST-HOC flip verification — fr-7tl3's
 * per-mismatch discipline lifted from the march legs. A stable-classified
 * query can still fail when the GPU's f32 rounding seeds (FMA
 * contraction, reciprocal rounding) push a marginal orbit across the
 * escape dichotomy in a direction none of the classifier's seven fround
 * orbits explored — measured on real Iris: 6 such flips under the
 * single-twin classifier, still 2 under the ensemble. Chaos guarantees
 * SOME orbit always sits in the crack, so instead of ever-wider pre-hoc
 * exclusion, each residual failure must PROVE itself a shadow flip: some
 * fround orbit within a 1..4-ULP single-axis perturbation family of the
 * query must reproduce the GPU's value within tolerance — i.e. the GPU
 * answered with a legitimate f32 shadow of a neighboring orbit. An
 * unverified failure stays a failure (a kernel arithmetic bug's wrong
 * value matches no neighbor's orbit), and verified flips are counted and
 * capped ({@link SURFACE_ESCAPE_FLIP_CAP}) — a systematic bug
 * masquerading as chaos would blow past both the cap and the stable
 * rows' fail=0 gate long before it could hide here.
 */
function escapeShadowFlipVerified(
  de: EscapeDE,
  q: Vec3,
  gpuValue: number,
  tol: number,
): boolean {
  for (let ulps = 1; ulps <= 4; ulps++) {
    for (let axis = 0; axis < 3; axis++) {
      for (const dir of [1, -1]) {
        const p: Vec3 = [q[0], q[1], q[2]];
        const base = Math.fround(p[axis]);
        const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38) * ulps;
        p[axis] = Math.fround(base + dir * step);
        if (Math.abs(estimateEscapeDistanceF32(de, p) - gpuValue) <= tol) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Verified chaotic flips tolerated per escape system before the leg
 * fails anyway (1%): isolated shadow flips are the chaos tax, dozens are
 * a bug wearing its costume. Measured on real Iris: 2/700. */
const SURFACE_ESCAPE_FLIP_CAP = 7;

function compareSurfaceEscapeAgreement(
  sys: SurfaceEscapeSystemState,
  cfg: SurfaceKernelConfig,
  gpu: Float32Array,
  compileMs: number,
  gpuMs: number,
): SurfaceAgreementRow {
  const R = sys.de.boundingRadius;
  const absErrs: number[] = [];
  let stableCount = 0;
  let maxAbsErr = 0;
  let maxRelErr = 0;
  let failures = 0;
  let chaoticFlips = 0;
  let maxGpuMinusCpu = -Infinity;
  let minGpuMinusCpu = Infinity;
  let failuresOver = 0;
  for (let i = 0; i < sys.cpu64.length; i++) {
    if (!sys.stable[i]) continue;
    stableCount++;
    const cpu = sys.cpu64[i];
    const signed = gpu[i] - cpu;
    const err = Math.abs(signed);
    const tol = surfaceEvalTol(cpu, R);
    if (
      err > tol &&
      escapeShadowFlipVerified(sys.de, sys.queries[i], gpu[i], tol)
    ) {
      // A verified shadow flip: the GPU's value IS a neighboring orbit's
      // value — excluded from the error statistics like the pre-hoc
      // unstable set, but counted separately so it stays visible.
      chaoticFlips++;
      continue;
    }
    absErrs.push(err);
    if (err > maxAbsErr) maxAbsErr = err;
    if (signed > maxGpuMinusCpu) maxGpuMinusCpu = signed;
    if (signed < minGpuMinusCpu) minGpuMinusCpu = signed;
    const rel = err / Math.max(Math.abs(cpu), 0.05 * R);
    if (rel > maxRelErr) maxRelErr = rel;
    if (err > tol) {
      failures++;
      if (signed > 0) failuresOver++;
    }
  }
  absErrs.sort((a, b) => a - b);
  const p99AbsErr =
    absErrs.length > 0
      ? absErrs[Math.min(absErrs.length - 1, Math.floor(0.99 * absErrs.length))]
      : 0;
  return {
    system: sys.name,
    core: cfg.core,
    variant: cfg.variant,
    width: cfg.width,
    stage2: cfg.stage2,
    wg: cfg.wg,
    n: sys.cpu64.length,
    maxAbsErr,
    maxRelErr,
    p99AbsErr,
    // Escape rows always gate, like affine: the forward loop has no width
    // sweep, so there is no narrower-than-production row to demote.
    gating: true,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    // Not meaningful here — surfaceQueries' jittered/uniform/exact layout
    // doesn't describe escapeQueries' uniform/boundary/cluster mix. This
    // leg's own query-mix diagnostic is `excluded` below.
    failuresByClass: { jittered: 0, uniform: 0, exact: 0 },
    excluded: sys.cpu64.length - stableCount,
    chaoticFlips,
    compileMs,
    gpuMs,
  };
}

/**
 * {@link compareSurfaceAgreement}'s affine4-leg twin (fr-dlxh M3): the
 * identical per-row error math and {@link surfaceEvalTol} bound against the
 * COMPOSED f64 oracle values, with `R` from {@link surface4ToleranceR}
 * (the lens-aware radius the query generator already scaled from). The
 * refined beam's mins absorb f32 trajectory flips exactly as the 3D M0
 * ladder's do (the fr-dlxh verdict for ladder cores) — measured p99 ~2e-7
 * across every system — so no per-flip machinery exists here. The ONE
 * exclusion is pre-hoc: rows `sys.stable` marked as parked on a
 * beam-selection discontinuity ({@link surface4QueryStable}'s doc carries
 * the measured verdict) never enter the gate, `excluded` reports how many
 * were skipped, and the caller pins that fraction ({@link
 * SURFACE_AFFINE4_EXCLUDED_CAP}) so the classifier can never quietly eat
 * the leg — the M2 escape row's shape, cheaper criterion.
 */
function compareSurface4Agreement(
  sys: Surface4SystemState,
  cfg: SurfaceKernelConfig,
  gpu: Float32Array,
): SurfaceAgreementRow {
  const R = surface4ToleranceR(sys.de);
  const absErrs: number[] = [];
  let stableCount = 0;
  let maxAbsErr = 0;
  let maxRelErr = 0;
  let failures = 0;
  let maxGpuMinusCpu = -Infinity;
  let minGpuMinusCpu = Infinity;
  let failuresOver = 0;
  for (let i = 0; i < sys.cpu.length; i++) {
    if (!sys.stable[i]) continue;
    stableCount++;
    const cpu = sys.cpu[i];
    const signed = gpu[i] - cpu;
    const err = Math.abs(signed);
    absErrs.push(err);
    if (err > maxAbsErr) maxAbsErr = err;
    if (signed > maxGpuMinusCpu) maxGpuMinusCpu = signed;
    if (signed < minGpuMinusCpu) minGpuMinusCpu = signed;
    const rel = err / Math.max(Math.abs(cpu), 0.05 * R);
    if (rel > maxRelErr) maxRelErr = rel;
    if (err > surfaceEvalTol(cpu, R)) {
      failures++;
      if (signed > 0) failuresOver++;
    }
  }
  absErrs.sort((a, b) => a - b);
  const p99AbsErr =
    absErrs.length > 0
      ? absErrs[Math.min(absErrs.length - 1, Math.floor(0.99 * absErrs.length))]
      : 0;
  return {
    system: sys.name,
    core: cfg.core,
    variant: cfg.variant,
    width: cfg.width,
    stage2: cfg.stage2,
    wg: cfg.wg,
    n: sys.cpu.length,
    maxAbsErr,
    maxRelErr,
    p99AbsErr,
    // Affine4 rows always gate, like affine and escape: the 4D ladder is
    // fixed at the oracle's beamWidth 4, so every row is like against like.
    gating: true,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    // Not meaningful here — surfaceQueries' jittered/uniform/exact layout
    // doesn't describe affine4Queries' uniform/boundary/cluster mix (the
    // escape rows' convention).
    failuresByClass: { jittered: 0, uniform: 0, exact: 0 },
    excluded: sys.cpu.length - stableCount,
  };
}

/**
 * {@link compareSurface4Agreement}'s fold4-leg twin (fr-rsp6 M4): the
 * identical per-row error math, {@link surfaceEvalTol} bound, and pre-hoc
 * oracle-continuity exclusion (`sys.cpu`/`sys.stable` already computed
 * against the PLAIN composed oracle — `estimateSurface4Composed(...,
 * false)`, `descendFold4` refine=false). The ONE difference from the
 * fixed-width affine4 ladder: fold4 has a real frontier WIDTH to sweep
 * (`width` is LIVE, surface-de-gpu.ts's module doc), so `gating` mirrors
 * the 3D fold row's own idiom ({@link compareSurfaceAgreement}) instead of
 * affine4's "always gate" — only rows at the CPU oracle's fixed
 * `SURFACE_FOLD_BEAM_WIDTH` frontier width compare like against like;
 * narrower rows are the same fr-5rvk narrow-width erosion measurement,
 * informational only.
 */
function compareSurfaceFold4Agreement(
  sys: Surface4SystemState,
  cfg: SurfaceKernelConfig,
  gpu: Float32Array,
): SurfaceAgreementRow {
  const R = surface4ToleranceR(sys.de);
  const absErrs: number[] = [];
  let stableCount = 0;
  let maxAbsErr = 0;
  let maxRelErr = 0;
  let failures = 0;
  let maxGpuMinusCpu = -Infinity;
  let minGpuMinusCpu = Infinity;
  let failuresOver = 0;
  for (let i = 0; i < sys.cpu.length; i++) {
    if (!sys.stable[i]) continue;
    stableCount++;
    const cpu = sys.cpu[i];
    const signed = gpu[i] - cpu;
    const err = Math.abs(signed);
    absErrs.push(err);
    if (err > maxAbsErr) maxAbsErr = err;
    if (signed > maxGpuMinusCpu) maxGpuMinusCpu = signed;
    if (signed < minGpuMinusCpu) minGpuMinusCpu = signed;
    const rel = err / Math.max(Math.abs(cpu), 0.05 * R);
    if (rel > maxRelErr) maxRelErr = rel;
    if (err > surfaceEvalTol(cpu, R)) {
      failures++;
      if (signed > 0) failuresOver++;
    }
  }
  absErrs.sort((a, b) => a - b);
  const p99AbsErr =
    absErrs.length > 0
      ? absErrs[Math.min(absErrs.length - 1, Math.floor(0.99 * absErrs.length))]
      : 0;
  return {
    system: sys.name,
    core: cfg.core,
    variant: cfg.variant,
    width: cfg.width,
    stage2: cfg.stage2,
    wg: cfg.wg,
    n: sys.cpu.length,
    maxAbsErr,
    maxRelErr,
    p99AbsErr,
    // Unlike affine4's fixed-width-4 ladder, fold4 keeps a real width
    // sweep — the 3D fold row's own gating rule, one dimension up.
    gating: cfg.width === SURFACE_FOLD_BEAM_WIDTH,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    // Not meaningful here — see compareSurface4Agreement's identical note.
    failuresByClass: { jittered: 0, uniform: 0, exact: 0 },
    excluded: sys.cpu.length - stableCount,
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
    // fr-55s1 stage C: the system's own core + lens, the app renderer's
    // exact derivation. mandelboxKifs keeps its byte-identical fold
    // source (explicit fold core + lens:false are the pinned off state).
    core: sys.core,
    lens: sys.de.foldFinal !== null,
    width:
      sys.core === "fold"
        ? SURFACE_FOLD_BEAM_WIDTH
        : SURFACE_AFFINE_LADDER_WIDTH,
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
      "< 1.5·eps(tGpu)): a silhouette graze resolved to a different sheet; " +
      "(c) silhouetteFlips — one-side-HIT status mismatch whose CPU closest " +
      "approach lands within the hit-t tolerance of the hitting side's t AND " +
      "within 1.5x either side of d/eps == 1: same trajectory, same point, " +
      "acceptance decided by f32-vs-f64 rounding. " +
      "Diverged trajectories and off-surface endpoints still fail.";
    const row: SurfaceUnprojectRow = {
      system: sys.name,
      width:
        sys.core === "fold"
          ? SURFACE_FOLD_BEAM_WIDTH
          : SURFACE_AFFINE_LADDER_WIDTH,
      wg: SURFACE_COMPUTE_WORKGROUP_SIZE,
      rasterWidth: width,
      rasterHeight: height,
      rays,
      statusMismatches: 0,
      boundaryFlips: 0,
      silhouetteFlips: 0,
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
    // fr-7tl3: every mismatch past the boundary rule describes itself,
    // tagged with the verdict it received — the excluded ones too, so a run
    // can confirm the silhouette rule fired on the rays it was meant to and
    // not on others. Capped: a whole-feature divergence would otherwise
    // print thousands of lines to say one thing.
    const mismatchDiagnostics: string[] = [];
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
        } else {
          // fr-7tl3: boundaryFlips cannot catch a hit-vs-miss pair — it
          // compares terminal t, but a miss runs on to the sphere exit
          // while a hit stops at the surface, so that gap is always huge.
          // Ask instead whether the CPU march's own CLOSEST APPROACH (not
          // just its terminal event) lands at the hitting side's t: same
          // trajectory, same point, disagreeing only about which side of
          // d < eps that point fell on. Measured on real Iris Xe hardware:
          // GPU MISS / CPU HIT on foldSpherefoldPair (minD/eps=9.94e-1 at
          // the CPU hit's own t) and GPU HIT / CPU MISS on
          // lensMandelboxOverAffine (minD/eps=1.02e+0, 2e-4 from the GPU
          // hit's t) — both silhouette flips, not estimator disagreement.
          const px = ray % width;
          const py = Math.floor(ray / width);
          const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
          const approach = surfaceCpuMarchApproach(
            sys.de,
            ro,
            rd,
            pose.pixelEps,
            SURFACE_MARCH_STEPS,
          );
          const hitT =
            gpuStatus === SURFACE_GPU_RAY_HIT
              ? gpuT
              : cs === SURFACE_GPU_RAY_HIT
                ? ct
                : -1;
          const silhouette =
            hitT >= 0 &&
            Math.abs(approach.tAtMin - hitT) <= tol &&
            approach.minRatio <= SURFACE_SILHOUETTE_RATIO_BAND &&
            approach.minRatio >= 1 / SURFACE_SILHOUETTE_RATIO_BAND;
          if (silhouette) row.silhouetteFlips++;
          if (mismatchDiagnostics.length < SURFACE_MISMATCH_DIAG_CAP) {
            mismatchDiagnostics.push(
              (silhouette ? "silhouette (excluded) " : "FAILS ") +
                describeSurfaceUnprojectMismatch(
                  sys.de,
                  ro,
                  rd,
                  pose.pixelEps,
                  approach,
                  {
                    ray,
                    px,
                    py,
                    gpuStatus,
                    gpuT,
                    cpuStatus: cs,
                    cpuT: ct,
                    tol,
                  },
                ),
            );
          }
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
    row.failures =
      row.statusMismatches -
      row.boundaryFlips -
      row.silhouetteFlips +
      row.hitTFailures;
    for (const diag of mismatchDiagnostics) {
      console.info(`[surface-bench] march-unproject: mismatch — ${diag}`);
    }
    console.info(
      `[surface-bench] march-unproject: compared — statusMm=${String(row.statusMismatches)} ` +
        `boundary=${String(row.boundaryFlips)} silhouette=${String(row.silhouetteFlips)} ` +
        `graze=${String(row.hitTGrazes)} ` +
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
 * and trap indices come from `surface-slots.ts`'s `surfaceSlotColors`/
 * `surfaceTrapIndices` — the same helpers `main.ts` calls — so slot keying
 * (a map's "By Transform" color; its authored `colorIndex`, else the even
 * spread) matches the app exactly. Throws on renderer-creation failure or a
 * null frame — the caller fails the section.
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
  const colors = surfaceSlotColors(sys.transforms, sys.de.maps);
  const trapIndices = surfaceTrapIndices(sys.transforms, sys.de.maps);

  activity.setState("gpu", "Surface compute frame (app path)");
  status("compute frame: creating SurfaceComputeRenderer…");
  const renderer = await SurfaceComputeRenderer.create(
    { kind: "ifs", de: sys.de },
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

/**
 * Leg B's escape twin (fr-dlxh): one end-to-end frame through the
 * PRODUCTION renderer with a `{ kind: "escape" }` target — the app path
 * for `analyzeEscapeSystem` sessions (forward-orbit core, no maps buffer,
 * one shade slot). Geometry sanity is a strided CPU march compared as HIT
 * RATES (the timing legs' `SURFACE_SANITY_HIT_RATE_TOL` idiom), NOT the
 * per-pixel fr-7tl3 status-exclusion tiers — deliberate: the march entry
 * text is shared across cores (test-pinned) and the escape DE is
 * eval-pinned over 700 stability-gated queries per system, so a rate band
 * absorbs the boundary flips a chaotic forward orbit produces without
 * duplicating that machinery for a second DE type.
 */
async function runSurfaceComputeFrameEscapeLeg(
  sys: SurfaceEscapeSystemState,
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
  const R = sys.de.boundingRadius;
  // The bailout ball is the escape session's whole visible world — the
  // same pose/unproject math as leg B, framed on R.
  const pose = buildSurfacePose({ visibleBoundingRadius: R }, width, height);
  const invProjView = surfaceInvProjView({ boundingRadius: R }, pose);

  activity.setState("gpu", "Surface compute frame (escape app path)");
  status("compute frame escape: creating SurfaceComputeRenderer…");
  const renderer = await SurfaceComputeRenderer.create(
    { kind: "escape", de: sys.de },
    [[0.8, 0.5, 0.2]],
    [0],
  );
  try {
    const canvas = surfaceLabeledCanvas(
      dom,
      "frame-escape",
      `compute frame escape — ${sys.name}`,
      width,
      height,
    );
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      acceptPixelEps: SURFACE_PIXEL_EPS,
      tracePixelEps:
        (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / height,
      // The orbit's iteration budget — scene.ts's
      // enterSurfaceComputeEscapeSession sets the same full depth.
      maxDepth: ESCAPE_TIME_ITERATIONS,
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
    status(`compute frame escape: rendering ${width}x${height}…`);
    console.info(
      `[surface-bench] compute frame escape: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
    );
    const frame = await renderer.renderFrame(spec, {
      budgetMs,
      onProgress: (pixels) => {
        drawSurfaceComputeFrame(canvas, pixels, width, height);
      },
    });
    if (!frame) {
      throw new Error(
        "renderFrame resolved null — the escape app path produced no frame",
      );
    }
    drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
    // Strided CPU sanity march: the kernel's own unproject rays
    // (surfaceUnprojectRay over the identical f32 matrix), the escape
    // marcher's exact quantities — 1.02R gate, eps = max(acceptEps·t,
    // R·hitFloor), t += d·ESCAPE_STEP_SCALE — over every 8th pixel.
    let cpuHits = 0;
    const sampled = surfaceSanityPixels(width, height);
    for (const ray of sampled) {
      const px = ray % width;
      const py = Math.floor(ray / width);
      const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
      const ro = pose.ro;
      const radius = R * 1.02;
      const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
      const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const tFar = -b + sq;
      if (tFar <= 0) continue;
      let t = Math.max(-b - sq, 0);
      for (let i = 0; i < SURFACE_MARCH_STEPS && t <= tFar; i++) {
        const eps = Math.max(SURFACE_PIXEL_EPS * t, R * SURFACE_GPU_HIT_FLOOR);
        const d = estimateEscapeDistance(sys.de, [
          ro[0] + rd[0] * t,
          ro[1] + rd[1] * t,
          ro[2] + rd[2] * t,
        ]);
        if (d < eps) {
          cpuHits++;
          break;
        }
        t += d * ESCAPE_STEP_SCALE;
      }
    }
    const sanityGpuHitRate = frame.counts.hit / (width * height);
    const sanityCpuHitRate = cpuHits / Math.max(1, sampled.length);
    console.info(
      `[surface-bench] compute frame escape: done — ${String(frame.passes)} passes, ` +
        `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)} ` +
        `(gpu rate ${sanityGpuHitRate.toFixed(3)} vs cpu sanity ${sanityCpuHitRate.toFixed(3)})` +
        `${frame.truncated ? ", TRUNCATED" : ""}`,
    );
    return {
      width: frame.width,
      height: frame.height,
      wallMs: frame.wallMs,
      gpuMs: frame.gpuMs,
      passes: frame.passes,
      truncated: frame.truncated,
      counts: frame.counts,
      sanityGpuHitRate,
      sanityCpuHitRate,
    };
  } finally {
    renderer.destroy();
  }
}

/** The ifs4 frame leg's strided CPU sanity march (fr-dlxh 4D): the
 * kernel's own unproject rays over the identical f32 matrix, the affine4
 * marcher's exact quantities — the SLICE-ADJUSTED sphere gate
 * (sliceVisR · 1.02, recomputed the packer's offset-24 way from
 * max(|w0| − h, 0)), cone eps = max(acceptEps·t, R4·hitFloor),
 * t += d·de.stepScale — with the COMPOSED f64 oracle as the estimator,
 * every 8th pixel in both axes. Returns the sampled hit rate. */
function surface4CpuSanityRate(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  invProjView: Float32Array,
  ro: Vec3,
  width: number,
  height: number,
): number {
  const R4 = de.boundingRadius;
  const visR = de.visibleBoundingRadius;
  const minW = Math.max(Math.abs(view4.w0) - view4.sliceHalfW, 0);
  const sliceVisR = Math.sqrt(Math.max(visR * visR - minW * minW, 0));
  const radius = sliceVisR * 1.02;
  let cpuHits = 0;
  const sampled = surfaceSanityPixels(width, height);
  for (const ray of sampled) {
    const px = ray % width;
    const py = Math.floor(ray / width);
    const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
    const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
    const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const tFar = -b + sq;
    if (tFar <= 0) continue;
    let t = Math.max(-b - sq, 0);
    for (let i = 0; i < SURFACE_MARCH_STEPS && t <= tFar; i++) {
      const eps = Math.max(SURFACE_PIXEL_EPS * t, R4 * SURFACE_GPU_HIT_FLOOR);
      const d = estimateSurface4Composed(de, view4, [
        ro[0] + rd[0] * t,
        ro[1] + rd[1] * t,
        ro[2] + rd[2] * t,
      ]);
      if (d < eps) {
        cpuHits++;
        break;
      }
      t += d * de.stepScale;
    }
  }
  return cpuHits / Math.max(1, sampled.length);
}

/**
 * Leg B's ifs4 twin (fr-dlxh 4D, stage B2): TWO end-to-end frames through
 * the PRODUCTION renderer with ONE `{ kind: "ifs4" }` target — the app
 * path for `analyzeSurfaceSystem4` sessions (affine4 ladder core, GpuMap4
 * maps at binding 1, the REQUIRED spec-carried `view4`) — the second
 * frame at a DIFFERENT view4 (rotated rotor, different w0), proving the
 * per-frame view repack end to end on the same renderer: `spec.view4` is
 * per-renderFrame state, exactly scene.ts's live rotor/slice contract.
 * colorSource 3 (radius) so the rotor-lifted shade arm (the `visRadius4`
 * normalizer) executes; `lut: null` binds the renderer's white LUT — the
 * arm still samples it, geometry is what the leg gates. Sanity per frame
 * is the escape twin's strided CPU rate-band march
 * ({@link surface4CpuSanityRate}); no chaotic-flip machinery — the ladder
 * core's band absorbs edge pixels (per-query agreement is M3's job).
 */
async function runSurfaceComputeFrame4Leg(
  sys: Surface4SystemState,
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
  // SurfaceDE4 carries the same radius fields the pose helpers pick
  // structurally, so the 3D pose/unproject math frames the slice's world
  // (visR = R4 here — aff4Kaleido has no final lens).
  const pose = buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  const colors = surfaceSlotColors(sys.transforms, sys.de.maps);
  const trapIndices = surfaceTrapIndices(sys.transforms, sys.de.maps);

  activity.setState("gpu", "Surface compute frame (ifs4 app path)");
  status("compute frame ifs4: creating SurfaceComputeRenderer…");
  const renderer = await SurfaceComputeRenderer.create(
    { kind: "ifs4", de: sys.de },
    colors,
    trapIndices,
  );
  try {
    const specFor = (view4: SurfaceGpu4View): SurfaceComputeFrameSpec => ({
      width,
      height,
      invProjView,
      camPos: pose.ro,
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
      colorSource: 3,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: true,
      view4,
    });
    const runOne = async (
      label: string,
      view4: SurfaceGpu4View,
    ): Promise<{
      frame: SurfaceComputeFrame;
      sanityGpuHitRate: number;
      sanityCpuHitRate: number;
    }> => {
      const canvas = surfaceLabeledCanvas(
        dom,
        label,
        `${label} — ${sys.name}`,
        width,
        height,
      );
      status(`compute frame ifs4: rendering ${width}x${height} (${label})…`);
      console.info(
        `[surface-bench] ${label}: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
      );
      const frame = await renderer.renderFrame(specFor(view4), {
        budgetMs,
        onProgress: (pixels) => {
          drawSurfaceComputeFrame(canvas, pixels, width, height);
        },
      });
      if (!frame) {
        throw new Error(
          `renderFrame resolved null — the ifs4 app path produced no frame (${label})`,
        );
      }
      drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
      const sanityGpuHitRate = frame.counts.hit / (width * height);
      const sanityCpuHitRate = surface4CpuSanityRate(
        sys.de,
        view4,
        invProjView,
        pose.ro,
        width,
        height,
      );
      console.info(
        `[surface-bench] ${label}: done — ${String(frame.passes)} passes, ` +
          `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)} ` +
          `(gpu rate ${sanityGpuHitRate.toFixed(3)} vs cpu sanity ${sanityCpuHitRate.toFixed(3)})` +
          `${frame.truncated ? ", TRUNCATED" : ""}`,
      );
      return { frame, sanityGpuHitRate, sanityCpuHitRate };
    };
    const one = await runOne("frame-ifs4", sys.view4);
    // The repack proof: the SAME renderer, a fresh spec whose view4 rotates
    // the pose rotor into a w-mixing plane and moves w0 to the other side
    // of the slice — a different hyperplane through the same frozen DE.
    const view4B: SurfaceGpu4View = {
      rotor: symmetryRotation4("yw", 0.6),
      w0: -0.15 * sys.de.boundingRadius,
      sliceHalfW: 0,
    };
    const two = await runOne("frame-ifs4-view2", view4B);
    return {
      width: one.frame.width,
      height: one.frame.height,
      wallMs: one.frame.wallMs,
      gpuMs: one.frame.gpuMs,
      passes: one.frame.passes,
      truncated: one.frame.truncated,
      counts: one.frame.counts,
      sanityGpuHitRate: one.sanityGpuHitRate,
      sanityCpuHitRate: one.sanityCpuHitRate,
      view2: {
        wallMs: two.frame.wallMs,
        gpuMs: two.frame.gpuMs,
        passes: two.frame.passes,
        truncated: two.frame.truncated,
        counts: two.frame.counts,
        sanityGpuHitRate: two.sanityGpuHitRate,
        sanityCpuHitRate: two.sanityCpuHitRate,
      },
    };
  } finally {
    renderer.destroy();
  }
}

/** Create (or reuse — same lookup-before-create idiom as
 * {@link surfaceFrameCanvas}, so re-running the section doesn't pile up
 * duplicate canvases) a labeled canvas block under the section root.
 * `data-bench-label` is the headless runner's PNG filename suffix (see
 * gpu-flame-bench.mjs's per-canvas screenshot loop) — the shade-ab leg
 * needs many of these (base/cheap/diff per pose × probe width), unlike leg
 * B's one fixed canvas. */
function surfaceLabeledCanvas(
  dom: SurfaceSectionDom,
  label: string,
  caption: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  let canvas = dom.root.querySelector<HTMLCanvasElement>(
    `canvas[data-bench-label="${label}"]`,
  );
  if (!canvas) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "canvases";
    const block = document.createElement("div");
    block.className = "canvas-block";
    canvas = document.createElement("canvas");
    canvas.dataset.benchLabel = label;
    block.appendChild(canvas);
    const span = document.createElement("span");
    span.textContent = caption;
    block.appendChild(span);
    rowDiv.appendChild(block);
    dom.root.insertBefore(rowDiv, dom.pre);
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** {@link SurfaceComputeFrame} sliced onto a shade-ab row's per-arm shape —
 * `null` (superseded/lost) zeros out with `truncated: true` so the row
 * keeps a fixed shape; {@link SurfaceShadeAbRow.suspect}/`reason` carry why
 * the numbers aren't meaningful in that case. */
function shadeAbArmResult(frame: SurfaceComputeFrame | null): ShadeAbArmResult {
  if (!frame) {
    return {
      wallMs: 0,
      gpuMs: 0,
      marchMs: 0,
      shadeMs: 0,
      passes: 0,
      truncated: true,
      counts: { hit: 0, miss: 0, exhausted: 0, active: 0 },
    };
  }
  return {
    wallMs: frame.wallMs,
    gpuMs: frame.gpuMs,
    marchMs: frame.marchMs,
    shadeMs: frame.shadeMs,
    passes: frame.passes,
    truncated: frame.truncated,
    counts: frame.counts,
  };
}

/**
 * fr-p8bc shade A/B pixel diff: RGB-only (the kernel never writes
 * translucent pixels — alpha is always 255), comparing the two arms' raw
 * RGBA8 buffers directly in the kernel's OWN row-0-is-bottom order —
 * equivalent pixel-for-pixel to comparing the flipped/presented images,
 * since both arms share that same convention. Returns the diff image in
 * that SAME order so the caller can hand it to
 * {@link drawSurfaceComputeFrame} for the identical flip the base/cheap
 * canvases got, keeping all three aligned.
 */
function computeShadeAbDiff(
  width: number,
  height: number,
  base: Uint8Array,
  cheap: Uint8Array,
): { diff: SurfaceShadeAbRow["diff"]; diffImage: Uint8Array<ArrayBuffer> } {
  const totalPixels = width * height;
  const diffImage = new Uint8Array(totalPixels * 4);
  let diffPixels = 0;
  let sumAbsDeltaDiffPixels = 0;
  let maxAbsDelta = 0;
  let over8 = 0;
  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const dr = Math.abs(base[o] - cheap[o]);
    const dg = Math.abs(base[o + 1] - cheap[o + 1]);
    const db = Math.abs(base[o + 2] - cheap[o + 2]);
    const maxChannel = Math.max(dr, dg, db);
    if (maxChannel > 0) {
      diffPixels++;
      sumAbsDeltaDiffPixels += (dr + dg + db) / 3;
    }
    if (maxChannel > maxAbsDelta) maxAbsDelta = maxChannel;
    if (maxChannel > SURFACE_SHADE_AB_DIFF_THRESHOLD) over8++;
    diffImage[o] = Math.min(255, dr * SURFACE_SHADE_AB_DIFF_THRESHOLD);
    diffImage[o + 1] = Math.min(255, dg * SURFACE_SHADE_AB_DIFF_THRESHOLD);
    diffImage[o + 2] = Math.min(255, db * SURFACE_SHADE_AB_DIFF_THRESHOLD);
    diffImage[o + 3] = 255;
  }
  return {
    diff: {
      diffPixels,
      totalPixels,
      meanAbsDeltaDiffPixels:
        diffPixels > 0 ? sumAbsDeltaDiffPixels / diffPixels : 0,
      maxAbsDelta,
      pctPixelsOver8: totalPixels > 0 ? (100 * over8) / totalPixels : 0,
    },
    diffImage,
  };
}

/**
 * Recover-from-device-loss helper for {@link runSurfaceShadeAbLeg}: reuse
 * `current` when it's still alive, otherwise destroy it (a no-op if it was
 * never created) and create a replacement. Measured on real hardware (Iris
 * Xe): the FIRST `SurfaceComputeRenderer` created right after leg B's own
 * budget-maxed 120s render deterministically hits `VK_ERROR_DEVICE_LOST` on
 * its very first submission, but a device created immediately afterward
 * works fine — so reusing a renderer that `.lost` reports true for would
 * just keep resolving null (device loss latches) rather than recovering.
 */
async function ensureRenderer(
  current: SurfaceComputeRenderer | null,
  de: SurfaceDE,
  colors: Vec3[],
  trapIndices: number[],
  shadeDeWidth: number,
): Promise<SurfaceComputeRenderer> {
  if (current && !current.lost) return current;
  current?.destroy();
  return SurfaceComputeRenderer.create(
    { kind: "ifs", de },
    colors,
    trapIndices,
    { shadeDeWidth },
  );
}

/**
 * fr-p8bc's measured-verdict leg: the shipped shade-probe width
 * (`SURFACE_FOLD_BEAM_WIDTH`, the full width-12 beam) against cheaper
 * `--surface-shade-width` candidates, on the PRODUCTION
 * `SurfaceComputeRenderer` — renderers differing ONLY in `opts.shadeDeWidth`,
 * same DE/colors/frame-spec otherwise, so any pixel difference is
 * attributable to the probe width alone. Runs at two poses (see
 * {@link SURFACE_SHADE_AB_NEAR_DIST_FACTOR}'s doc for why "near" matters).
 *
 * Renderers are reused across both poses (a `SurfaceComputeRenderer`
 * compiles two WGSL pipelines at creation, so re-creating one per row would
 * dominate the leg's own wall time over what it's trying to measure), and
 * this leg processes one arm fully (create → render every pose → destroy)
 * before creating the next: baseline first, into `baseFrames` keyed by
 * pose, then each cheap width in turn compared against that cache. At most
 * one `SurfaceComputeRenderer` — one GPUDevice — is ever alive at a time.
 *
 * Measured on real hardware (Iris Xe): the FIRST `SurfaceComputeRenderer`
 * created right after leg B's own budget-maxed 120s render reliably hits
 * `VK_ERROR_DEVICE_LOST` on its very first submission — reproduced
 * identically across repeated runs. This is NOT a concurrent-device effect
 * (fully serializing renderer lifetimes, one alive at a time, changed
 * nothing — the baseline's first render still died); a device created
 * afterward, whatever its config, works fine. So every render call
 * re-validates the current renderer's `.lost` flag ({@link ensureRenderer})
 * and transparently recreates before rendering, rather than trusting a
 * renderer that may have gone dead underneath it (device loss latches — a
 * known-lost renderer would just keep resolving null forever). This
 * recovers same-pose reruns and, more importantly, stops one pose's device
 * loss from silently poisoning the NEXT pose's or width's attempt too.
 *
 * Deliberately never section-gating: called AFTER leg B, and the caller
 * wraps the whole call so a thrown error becomes a note rather than a
 * section failure. This leg exists to MEASURE a quality/cost trade-off,
 * not to certify correctness — that is leg A's (`marchUnproject`) job.
 * `hitMismatch` is reported per row because a mismatch WOULD indicate a
 * determinism bug (the march kernel and its ray derivation are identical
 * between arms — only the shade probe width differs), but even that is
 * surfaced, never failed. A single probe-width renderer failing to compile
 * is noted and that width is dropped, rather than losing every other
 * width's measurement. `renderFrame` resolving null (device lost/superseded)
 * on either arm still produces a row, marked `suspect` — this leg reports
 * evidence, it doesn't assume the hardware will cooperate.
 */
async function runSurfaceShadeAbLeg(
  config: SurfaceSectionConfig,
  systems: SurfaceSystemState[],
  software: boolean,
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
  onRow: (rows: SurfaceShadeAbRow[]) => void,
): Promise<{ rows: SurfaceShadeAbRow[]; notes: string[] }> {
  const notes = [...config.shadeWidthNotes];
  if (config.surfaceShadeWidths.length === 0) return { rows: [], notes };
  if (software && !config.force) {
    notes.push(
      "shade-ab: skipped — software WebGPU adapter (timings would not be representative; pass surfaceForce=1 to run anyway)",
    );
    return { rows: [], notes };
  }
  const mbox = systems.find((s) => s.name === "mandelboxKifs");
  if (!mbox) {
    notes.push(
      "shade-ab: skipped — mandelboxKifs did not build or was excluded (surfaceSystems=synthetic)",
    );
    return { rows: [], notes };
  }

  // Requested widths, deduped, dropping the baseline width itself — an A/A
  // comparison against the exact width it's compared TO measures nothing.
  const widths: number[] = [];
  for (const w of config.surfaceShadeWidths) {
    if (w === SURFACE_FOLD_BEAM_WIDTH) {
      notes.push(
        `shade-ab: skipping requested width ${String(w)} — equals the baseline width SURFACE_FOLD_BEAM_WIDTH (${String(SURFACE_FOLD_BEAM_WIDTH)})`,
      );
      continue;
    }
    if (!widths.includes(w)) widths.push(w);
  }
  if (widths.length === 0) {
    notes.push(
      "shade-ab: skipped — no probe widths left after dropping the baseline width",
    );
    return { rows: [], notes };
  }

  const width = software ? SURFACE_SHADE_AB_WIDTH_SW : SURFACE_SHADE_AB_WIDTH;
  const height = software
    ? SURFACE_SHADE_AB_HEIGHT_SW
    : SURFACE_SHADE_AB_HEIGHT;
  const budgetMs = software
    ? SURFACE_SHADE_AB_BUDGET_SW_MS
    : SURFACE_SHADE_AB_BUDGET_MS;

  // Same per-slot color/trap keying as leg B (runSurfaceComputeFrameLeg) —
  // both call surface-slots.ts's surfaceSlotColors/surfaceTrapIndices over
  // the SAME de.maps, so every arm stays byte-identical apart from
  // shadeDeWidth.
  const colors = surfaceSlotColors(mbox.transforms, mbox.de.maps);
  const trapIndices = surfaceTrapIndices(mbox.transforms, mbox.de.maps);

  const poses: { name: "standard" | "near"; distFactor: number }[] = [
    { name: "standard", distFactor: SURFACE_POSE_DIST_FACTOR },
    { name: "near", distFactor: SURFACE_SHADE_AB_NEAR_DIST_FACTOR },
  ];
  const specForPose = (poseDef: {
    distFactor: number;
  }): SurfaceComputeFrameSpec => {
    const pose = buildSurfacePose(mbox.de, width, height, poseDef.distFactor);
    // Identical frame spec for both arms at a given pose — production
    // dither on: the march kernel is byte-identical in both arms and the
    // hash dither is per-pixel deterministic, so both arms' hit sets align
    // (a fair diff needs that), and it matches what the app ships.
    return {
      width,
      height,
      invProjView: surfaceInvProjView(mbox.de, pose),
      camPos: pose.ro,
      acceptPixelEps: SURFACE_PIXEL_EPS,
      tracePixelEps:
        (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / height,
      maxDepth: mbox.de.maxDepth,
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
  };

  activity.setState("gpu", "Surface shade A/B (fr-p8bc)");
  const rows: SurfaceShadeAbRow[] = [];

  // Phase 1: the baseline arm — reused across poses when it stays alive,
  // but re-validated (see ensureRenderer's doc) before EVERY render rather
  // than trusted for the whole phase, so one pose's device loss can't
  // silently poison the other's. Cached per pose for phase 2 below.
  const baseFrames = new Map<"standard" | "near", SurfaceComputeFrame | null>();
  let baselineRenderer: SurfaceComputeRenderer | null = null;
  try {
    for (const poseDef of poses) {
      status(`shade-ab: creating baseline renderer…`);
      baselineRenderer = await ensureRenderer(
        baselineRenderer,
        mbox.de,
        colors,
        trapIndices,
        SURFACE_FOLD_BEAM_WIDTH,
      );
      status(`shade-ab: ${poseDef.name} baseline render…`);
      console.info(
        `[surface-bench] shade-ab ${poseDef.name}: baseline (w${String(SURFACE_FOLD_BEAM_WIDTH)}) rendering ${String(width)}x${String(height)}…`,
      );
      const frame = await baselineRenderer.renderFrame(specForPose(poseDef), {
        budgetMs,
      });
      console.info(
        `[surface-bench] shade-ab ${poseDef.name}: baseline ` +
          (frame
            ? `done — ${String(frame.passes)} passes, march=${frame.marchMs.toFixed(0)}ms shade=${frame.shadeMs.toFixed(0)}ms${frame.truncated ? " TRUNCATED" : ""}`
            : "resolved null"),
      );
      baseFrames.set(poseDef.name, frame);
    }
  } catch (e) {
    notes.push(`shade-ab: baseline renderer failed — ${describeError(e)}`);
    return { rows, notes };
  } finally {
    baselineRenderer?.destroy();
  }

  // Phase 2: one cheap-probe-width renderer at a time, same reuse-but-
  // re-validate discipline as phase 1 — ensureRenderer recreates on a
  // device lost mid-width, rather than losing the width's other pose too.
  for (const w of widths) {
    let renderer: SurfaceComputeRenderer | null = null;
    try {
      for (const poseDef of poses) {
        status(`shade-ab: creating width ${String(w)} renderer…`);
        renderer = await ensureRenderer(
          renderer,
          mbox.de,
          colors,
          trapIndices,
          w,
        );
        status(`shade-ab: ${poseDef.name} w${String(w)} render…`);
        console.info(
          `[surface-bench] shade-ab ${poseDef.name}: w${String(w)} rendering…`,
        );
        const cheapFrame = await renderer.renderFrame(specForPose(poseDef), {
          budgetMs,
        });
        console.info(
          `[surface-bench] shade-ab ${poseDef.name}: w${String(w)} ` +
            (cheapFrame
              ? `done — ${String(cheapFrame.passes)} passes, march=${cheapFrame.marchMs.toFixed(0)}ms shade=${cheapFrame.shadeMs.toFixed(0)}ms${cheapFrame.truncated ? " TRUNCATED" : ""}`
              : "resolved null"),
        );
        const baseFrame = baseFrames.get(poseDef.name) ?? null;

        const baseCanvas = surfaceLabeledCanvas(
          dom,
          `shade-ab-${poseDef.name}-w${String(w)}-base`,
          `shade-ab ${poseDef.name} w${String(w)}: baseline (w${String(SURFACE_FOLD_BEAM_WIDTH)})`,
          width,
          height,
        );
        const cheapCanvas = surfaceLabeledCanvas(
          dom,
          `shade-ab-${poseDef.name}-w${String(w)}-cheap`,
          `shade-ab ${poseDef.name} w${String(w)}: cheap`,
          width,
          height,
        );
        const diffCanvas = surfaceLabeledCanvas(
          dom,
          `shade-ab-${poseDef.name}-w${String(w)}-diff`,
          `shade-ab ${poseDef.name} w${String(w)}: diff (×${String(SURFACE_SHADE_AB_DIFF_THRESHOLD)})`,
          width,
          height,
        );
        if (baseFrame) {
          drawSurfaceComputeFrame(baseCanvas, baseFrame.pixels, width, height);
        }
        if (cheapFrame) {
          drawSurfaceComputeFrame(
            cheapCanvas,
            cheapFrame.pixels,
            width,
            height,
          );
        }

        let diff: SurfaceShadeAbRow["diff"] = {
          diffPixels: 0,
          totalPixels: width * height,
          meanAbsDeltaDiffPixels: 0,
          maxAbsDelta: 0,
          pctPixelsOver8: 0,
        };
        let hitMismatch = false;
        let suspect = false;
        let reason: string | undefined;
        if (!baseFrame || !cheapFrame) {
          suspect = true;
          reason = `${!baseFrame ? "baseline" : "cheap"} frame resolved null (superseded/lost)`;
        } else {
          hitMismatch =
            baseFrame.counts.hit !== cheapFrame.counts.hit ||
            baseFrame.counts.miss !== cheapFrame.counts.miss ||
            baseFrame.counts.exhausted !== cheapFrame.counts.exhausted ||
            baseFrame.counts.active !== cheapFrame.counts.active;
          if (baseFrame.truncated || cheapFrame.truncated) {
            suspect = true;
            reason =
              baseFrame.truncated && cheapFrame.truncated
                ? `both arms truncated at the ${String(budgetMs)}ms budget`
                : `${baseFrame.truncated ? "baseline" : "cheap"} truncated at the ${String(budgetMs)}ms budget`;
          }
          const computed = computeShadeAbDiff(
            width,
            height,
            baseFrame.pixels,
            cheapFrame.pixels,
          );
          diff = computed.diff;
          drawSurfaceComputeFrame(
            diffCanvas,
            computed.diffImage,
            width,
            height,
          );
        }

        const row: SurfaceShadeAbRow = {
          pose: poseDef.name,
          probeWidth: w,
          raster: { width, height },
          baseline: shadeAbArmResult(baseFrame),
          cheap: shadeAbArmResult(cheapFrame),
          diff,
          hitMismatch,
        };
        if (suspect) {
          row.suspect = true;
          row.reason = reason;
        }
        rows.push(row);
        onRow(rows);
      }
    } catch (e) {
      notes.push(
        `shade-ab: width ${String(w)} renderer failed — ${describeError(e)}`,
      );
    } finally {
      renderer?.destroy();
    }
  }
  return { rows, notes };
}

/** fr-b72d opt-in sweep leg: builds one kaleidoscope order's affine4
 * system + frozen view, exactly the way {@link runSurfaceDeSection}'s own
 * `affine4SystemDefs` loop builds `aff4Kaleido` — the SAME base maps
 * (`surfaceAff4Kaleido()`), the same `plane: "xz", twist: 1` double
 * rotation, and identity-rotor / `w0 = 0.2 · boundingRadius` /
 * zero-thickness view recipe — parametrized over `order` in place of the
 * fixed 3. The eligibility gate is a THROW, not a note-and-skip, for the
 * same reason `affine4SystemDefs`' loop throws: this is a fixed fixture
 * family, so an ineligible order is a bench bug, not a runtime condition
 * to degrade past. `effectiveSymmetryOrder`'s `MAX_TRANSFORMS` clamp (2
 * base maps → order up to 12 fits) covers every order this leg asks for. */
function buildAff4SweepSystem(order: number): {
  de: SurfaceDE4;
  view4: SurfaceGpu4View;
} {
  const transforms = surfaceAff4Kaleido();
  const symmetry: SymmetryParams = { order, plane: "xz", twist: 1 };
  const eligibility = analyzeSurfaceSystem4(transforms, null);
  if (eligibility.status === "ineligible") {
    throw new Error(
      `aff4 sweep fixture order ${String(order)} is ineligible: ` +
        eligibility.reasons.join("; "),
    );
  }
  const de = buildSurfaceDE4(transforms, null, symmetry);
  const view4: SurfaceGpu4View = {
    rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w0: 0.2 * de.boundingRadius,
    sliceHalfW: 0,
  };
  return { de, view4 };
}

/**
 * fr-b72d: the opt-in per-kaleidoscope-order affine4 eval-kernel timing
 * sweep (`config.aff4Sweep`, `--surface-aff4-sweep=1`) — answers two
 * questions bug fr-b72d left open. The affine4 COMPUTE kernel measured
 * ~1.7x FASTER than the fragment-GLSL tracer at kaleidoscope order 1 but
 * ~35x SLOWER at order 6 (real Iris Xe); orders 2-5 were never measured,
 * and it was unknown whether that slowdown is the eval kernel's own
 * superlinear cost in symmetry order or an artifact of the app's host
 * march loop layered on top of it. (1) This leg times the BARE eval
 * kernel — no march, no host loop, no shading — at every order in {@link
 * SURFACE_AFF4_SWEEP_ORDERS} on one large batch, isolating the kernel's
 * own per-query cost curve from everything `surface-compute.ts` adds on
 * top. (2) It repeats the identical sweep with `slabExt: false` —
 * fr-d0nn's register-pressure hypothesis, that the fr-wa6o slab's extra
 * live `ext` vec4f registers are what makes order 6 pathological — to see
 * whether dropping them changes the curve's SHAPE, not just its offset.
 *
 * ONE pipeline pair serves every order (surface-de-gpu.ts's `slabExt`
 * doc: "the kernel text does not depend on symmetry order; symOrder is a
 * params value"), compiled once before the order loop. Per order the
 * system is rebuilt fresh ({@link buildAff4SweepSystem}) — `boundingRadius`
 * (and therefore `w0`, the query cloud's scale, and the packed params)
 * legitimately shifts with order, since the bounding probe runs the
 * kaleidoscope-swept chaos game. `affine4Queries`' standard 700-query mix
 * is TILED — repeated wholesale, not resampled — up to an occupancy-
 * saturating batch ({@link SURFACE_AFF4_SWEEP_BATCH}, or the software-
 * adapter-only {@link SURFACE_AFF4_SWEEP_BATCH_SW}): repetition preserves
 * the mix's jittered/near-boundary/exact divergence pattern WITHIN every
 * 700-query tile, which is what one SIMD group actually threads through —
 * a fresh random draw per slot would iron out exactly the branch
 * divergence a `usPerQuery` measurement is supposed to capture.
 *
 * Both variants dispatch against IDENTICAL buffers (params/maps/input are
 * variant-independent — only the pipeline differs), so the slab and
 * no-slab runs are as close to an A/B as WebGPU allows. Each variant's
 * warmup dispatch (untimed) doubles as its agreement-gate value — the
 * kernel is a pure function of its buffers, so a second untimed readback
 * would only re-measure numbers the warmup already produced ({@link
 * runSurfaceEvalDispatch}, reused rather than reinventing dispatch
 * plumbing). The {@link SURFACE_AFF4_SWEEP_REPS} TIMED dispatches that
 * follow carry no readback in their own submission — the march timing
 * config's idiom (`runSurfaceMarchConfig`): `performance.now()` spans
 * submit → `onSubmittedWorkDone` of the compute pass ALONE, so a
 * copy-to-staging cost never contaminates a fast order's measurement.
 *
 * GATING: {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}'s doc — at `sliceHalfW: 0`
 * the two variants are mathematically bit-identical, so any mismatch past
 * FMA/contraction noise is a real divergence between the slab and
 * no-slab code paths, and fails the section exactly like the M3 leg's own
 * agreement gate. Skips (silent when `!config.aff4Sweep`, noted on a
 * software adapter without `surfaceForce=1`) never fail anything — the
 * section stays exactly as gate-worthy as it was before this leg existed.
 * Progressive: `onUpdate` fires once per completed order, so a mid-sweep
 * error (caught by the caller) still leaves every prior order's rows
 * visible in `results.aff4Sweep` rather than losing them.
 */
async function runSurfaceAff4SweepLeg(
  config: SurfaceSectionConfig,
  device: GPUDevice,
  pipelineLayout: GPUPipelineLayout,
  bindGroupLayout: GPUBindGroupLayout,
  software: boolean,
  status: (text: string) => void,
  activity: ActivityBadge,
  onUpdate: (partial: SurfaceAff4SweepResult) => void,
): Promise<{
  result?: SurfaceAff4SweepResult;
  notes: string[];
  failed: boolean;
}> {
  const notes: string[] = [];
  if (!config.aff4Sweep) return { notes, failed: false };
  if (software && !config.force) {
    notes.push(
      "aff4 sweep: skipped — software WebGPU adapter (timings would not be representative; pass surfaceForce=1 to run anyway)",
    );
    return { notes, failed: false };
  }

  const wg = surfaceWgFor(config, "private");
  const width = SURFACE_AFFINE_LADDER_WIDTH;

  activity.setState("gpu", "Surface affine4 sweep (fr-b72d)");
  status("aff4 sweep: compiling kernels…");
  const { pipeline: slabPipeline, compileMs: slabCompileMs } =
    await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine4",
        width,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        // slabExt absent = true — today's shipped kernel.
      }),
      "evalQueries",
      "surface-de aff4-sweep slab",
    );
  const { pipeline: noslabPipeline, compileMs: noslabCompileMs } =
    await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine4",
        width,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        slabExt: false,
      }),
      "evalQueries",
      "surface-de aff4-sweep noslab",
    );
  const compileMs = { slab: slabCompileMs, noslab: noslabCompileMs };
  notes.push(
    `aff4 sweep: compiled slab=${slabCompileMs.toFixed(0)}ms noslab=${noslabCompileMs.toFixed(0)}ms`,
  );

  const batchTarget = software
    ? SURFACE_AFF4_SWEEP_BATCH_SW
    : SURFACE_AFF4_SWEEP_BATCH;
  if (software) {
    notes.push(
      `aff4 sweep: software adapter — batch reduced to >= ${String(SURFACE_AFF4_SWEEP_BATCH_SW)} queries (real-driver runs use ${String(SURFACE_AFF4_SWEEP_BATCH)})`,
    );
  }

  const rows: SurfaceAff4SweepRow[] = [];
  const agreement: SurfaceAff4SweepAgreement[] = [];
  let failed = false;
  const snapshot = (): SurfaceAff4SweepResult => ({
    rows: [...rows],
    agreement: [...agreement],
    compileMs,
  });

  for (const order of SURFACE_AFF4_SWEEP_ORDERS) {
    status(`aff4 sweep: order ${String(order)} — building system…`);
    const { de, view4 } = buildAff4SweepSystem(order);

    // Tile affine4Queries' 700-query mix up to the batch target — see this
    // function's doc for why tiling (not resampling) is what an
    // occupancy/divergence measurement wants.
    const base = affine4Queries(de, view4, 900 + order);
    const tileFactor = Math.max(1, Math.ceil(batchTarget / base.length));
    const queries: Vec3[] = [];
    for (let t = 0; t < tileFactor; t++) queries.push(...base);
    const n = queries.length;

    const paramsData = packSurface4GpuParams(de, view4, {
      itemCount: n,
      cutoff: 0,
    });
    // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
    const mapsData = new Float32Array(packSurfaceGpuMaps4(de));
    const inputData = new Float32Array(n * 4);
    queries.forEach((q, i) => {
      inputData[i * 4] = q[0];
      inputData[i * 4 + 1] = q[1];
      inputData[i * 4 + 2] = q[2];
    });
    const params = await createSurfaceBuffer(
      device,
      `aff4-sweep params order${String(order)}`,
      paramsData.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(params, 0, paramsData);
    const maps = await createSurfaceBuffer(
      device,
      `aff4-sweep maps order${String(order)}`,
      mapsData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(maps, 0, mapsData);
    const input = await createSurfaceBuffer(
      device,
      `aff4-sweep queries order${String(order)}`,
      inputData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(input, 0, inputData);
    const output = await createSurfaceBuffer(
      device,
      `aff4-sweep results order${String(order)}`,
      n * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const staging = await createSurfaceBuffer(
      device,
      `aff4-sweep staging order${String(order)}`,
      n * 4,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    const bindGroup = device.createBindGroup({
      label: `aff4-sweep bind group order${String(order)}`,
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 2, resource: { buffer: input } },
        { binding: 3, resource: { buffer: output } },
      ],
    });

    try {
      const runVariant = async (
        variant: "slab" | "noslab",
        pipeline: GPUComputePipeline,
      ): Promise<Float32Array> => {
        status(`aff4 sweep: order ${String(order)} (${variant}) — warmup…`);
        activity.setState(
          "gpu",
          `Surface affine4 sweep — order ${String(order)} (${variant})`,
        );
        // Untimed warmup — its return value is ALSO this variant's
        // agreement-gate value; see this function's doc for why a second
        // readback would be redundant.
        const gpu = await runSurfaceEvalDispatch(
          device,
          pipeline,
          { queries, buffers: { output, staging, bindGroup } },
          wg,
        );
        const timedMs: number[] = [];
        for (let rep = 0; rep < SURFACE_AFF4_SWEEP_REPS; rep++) {
          status(
            `aff4 sweep: order ${String(order)} (${variant}) — timed ${String(rep + 1)}/${String(SURFACE_AFF4_SWEEP_REPS)}…`,
          );
          const t0 = performance.now();
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(n / wg));
          pass.end();
          device.queue.submit([encoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          const ms = performance.now() - t0;
          timedMs.push(ms);
          if (ms > SURFACE_AFF4_SWEEP_REP_CAP_MS) break;
        }
        const minMs = Math.min(...timedMs);
        const meanMs = timedMs.reduce((a, b) => a + b, 0) / timedMs.length;
        const usPerQuery = (minMs * 1000) / n;
        rows.push({
          order,
          variant,
          n,
          reps: timedMs.length,
          minMs,
          meanMs,
          usPerQuery,
        });
        notes.push(
          `aff4 sweep order ${String(order)} ${variant}: n=${String(n)} reps=${String(timedMs.length)} ` +
            `min=${minMs.toFixed(3)}ms mean=${meanMs.toFixed(3)}ms us/query=${usPerQuery.toFixed(3)}`,
        );
        return gpu;
      };

      const gpuSlab = await runVariant("slab", slabPipeline);
      const gpuNoslab = await runVariant("noslab", noslabPipeline);

      let mismatches = 0;
      let maxAbs = 0;
      for (let i = 0; i < n; i++) {
        if (gpuSlab[i] !== gpuNoslab[i]) {
          mismatches++;
          maxAbs = Math.max(maxAbs, Math.abs(gpuSlab[i] - gpuNoslab[i]));
        }
      }
      const tol = SURFACE_AFF4_SWEEP_TOL_FACTOR * de.boundingRadius;
      const withinTolerance = maxAbs <= tol;
      agreement.push({ order, n, mismatches, maxAbs, withinTolerance });
      if (mismatches > 0) {
        if (withinTolerance) {
          notes.push(
            `aff4 sweep order ${String(order)}: ${String(mismatches)} sub-tolerance mismatches ` +
              `(maxAbs ${maxAbs.toExponential(2)}) — fma/contraction noise`,
          );
        } else {
          failed = true;
          notes.push(
            `aff4 sweep order ${String(order)}: ${String(mismatches)} mismatches, ` +
              `maxAbs ${maxAbs.toExponential(2)} exceeds tolerance ${tol.toExponential(2)} — ` +
              "slab/no-slab DISAGREE, failing the leg",
          );
        }
      }
    } finally {
      params.destroy();
      maps.destroy();
      input.destroy();
      output.destroy();
      staging.destroy();
    }
    onUpdate(snapshot());
  }

  return { result: snapshot(), notes, failed };
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
  const systemDefs: {
    name: string;
    transforms: Transform[];
    finalTransform?: Transform;
    symmetry?: SymmetryParams;
  }[] = [];
  if (config.systems !== "synthetic") {
    systemDefs.push({ name: "mandelboxKifs", transforms: mandelboxKifs() });
  }
  systemDefs.push(
    { name: "foldSpherefoldPair", transforms: surfaceFoldSpherefoldPair() },
    {
      name: "foldBoxfoldNegPlusAffine",
      transforms: surfaceFoldBoxfoldNegPlusAffine(),
    },
    // fr-55s1 M0 — the AFFINE core's systems. Fold-free base maps, so the
    // routing below hands them the refined ladder and its own oracle.
    { name: "affineTetra", transforms: surfaceAffineTetra() },
    {
      name: "affineTwistFinal",
      transforms: surfaceAffineTwist(),
      finalTransform: surfaceAffineTwistFinal(),
      symmetry: { order: 3, plane: "xz" },
    },
    // fr-55s1 stage B (M1) — the fold FINAL lens systems. `buildSurfaceDE`
    // turns each fold-carrying final into `de.foldFinal`; the CPU calls
    // below route through `descendLens` on their own, and the M1 leg
    // compiles the kernel with `lens: true` around each system's core.
    {
      name: "lensBoxfoldOverAffine",
      transforms: surfaceAffineTetra(),
      finalTransform: surfaceLensBoxfoldFinal(),
    },
    {
      name: "lensMandelboxOverAffine",
      transforms: surfaceAffineTetra(),
      finalTransform: surfaceLensMandelboxFinal(),
    },
    {
      name: "lensOverFold",
      transforms: surfaceFoldBoxfoldPair(),
      finalTransform: surfaceLensSpherefoldFinal(),
    },
  );
  const systems: SurfaceSystemState[] = [];
  for (const def of systemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    try {
      const finalTransform = def.finalTransform ?? null;
      const symmetry = def.symmetry ?? SURFACE_NO_SYMMETRY;
      const de = buildSurfaceDE(def.transforms, finalTransform, symmetry);
      // fr-55s1: the DE picks BOTH the kernel core and the CPU oracle, by
      // the same `deHasFolds` test `estimateDistance*` route on. Fold base
      // maps march the wide frontier, pinned against PLAIN
      // `estimateDistance` (refine=false — the estimator that kernel
      // mirrors term for term); fold-free ones march the width-4 refined
      // ladder, pinned against `estimateDistanceRefined`, which is what
      // the affine GLSL marches. Both at cutoff 0.
      const core = deHasFolds(de) ? "fold" : "affine";
      // Lens systems size the uniform-box class from the LENSED visible
      // ball — the set the DE actually describes (M1b's mandelbox lens
      // GROWS the attractor: visR 2.12 vs base R 1.26, so a base-R box
      // would leave the outer sheets unsampled). Pre-lens systems keep
      // `boundingRadius`, freezing their query streams bit-for-bit.
      const queries = surfaceQueries(
        def.transforms,
        de.foldFinal ? de.visibleBoundingRadius : de.boundingRadius,
        finalTransform,
        symmetry,
      );
      const cpu = queries.map((q) =>
        core === "fold"
          ? estimateDistance(de, q, 0)
          : estimateDistanceRefined(de, q, 0),
      );
      systems.push({
        name: def.name,
        core,
        de,
        transforms: def.transforms,
        queries,
        cpu,
      });
    } catch (e) {
      results.notes.push(`${def.name}: skipped — ${describeError(e)}`);
    }
    render();
  }

  // ----- Escape-time systems (fr-dlxh): a SEPARATE gate + CPU oracle -----
  // `buildSurfaceDE` refuses these shapes by design (single non-contracting
  // pure-fold map — `analyzeEscapeSystem` is its deliberate complement), so
  // they never enter `systemDefs`/`systems` above and never touch
  // `deHasFolds`/fold/affine routing. Four systems: both fold arms gated
  // solo (boxfold, spherefold), both together (mandelbox), and an off-axis
  // rotated/scaled matrix with a negative fold weight.
  const escapeSystemDefs: {
    name: string;
    transforms: Transform[];
    seed: number;
  }[] = [
    {
      name: "escMandelbox",
      seed: 401,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
      ],
    },
    {
      name: "escBoxfold",
      seed: 402,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 2 }],
        },
      ],
    },
    {
      name: "escSpherefold",
      seed: 403,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "spherefold", weight: 2 }],
        },
      ],
    },
    {
      name: "escMandelboxRot",
      seed: 404,
      transforms: [
        {
          id: 0,
          position: [0.2, -0.3, 0.35],
          rotation: [0.3, 0.2, 0.5],
          scale: [1.1, 0.9, 1.2],
          variations: [{ type: "mandelbox", weight: -2.2 }],
        },
      ],
    },
  ];
  const escapeSystems: SurfaceEscapeSystemState[] = [];
  for (const def of escapeSystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface escape CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    try {
      const eligibility = analyzeEscapeSystem(def.transforms);
      if (eligibility.status === "ineligible") {
        results.notes.push(
          `${def.name}: skipped — ${eligibility.reasons.join("; ")}`,
        );
      } else {
        const de = buildEscapeDE(def.transforms);
        const queries = escapeQueries(de, def.seed);
        const cpu64 = queries.map((q) => estimateEscapeDistance(de, q));
        const cpu32 = queries.map((q) => estimateEscapeDistanceF32(de, q));
        const R = de.boundingRadius;
        // The f32-stability gate (compareSurfaceEscapeAgreement's doc):
        // only queries the ENSEMBLE classifier (escapeQueryStable — the
        // fround twin at the query plus its six one-ULP neighbors, all
        // agreeing with the f64 oracle) enter the GPU comparison below.
        const stable = cpu64.map((c64, i) =>
          escapeQueryStable(de, queries[i], c64, surfaceEvalTol(c64, R)),
        );
        escapeSystems.push({
          name: def.name,
          de,
          queries,
          cpu64,
          cpu32,
          stable,
        });
      }
    } catch (e) {
      results.notes.push(`${def.name}: skipped — ${describeError(e)}`);
    }
    render();
  }

  // ----- Affine4 (4D) systems (fr-dlxh M3): a THIRD separate gate -----
  // `buildSurfaceDE` has no 4D shape at all — these systems live behind
  // `analyzeSurfaceSystem4`/`buildSurfaceDE4` and the kernel's view lift,
  // so like the escape leg they carry their own defs, query generator,
  // comparator and (M3 below) leg. Each def freezes its own view (rotor +
  // w0 + sliceHalfW), built AFTER the DE so w0/h can scale from the probed
  // radius; together the four cover the pure DE at the identity view, the
  // fr-u91x double-rotation sector sweep at a nonzero w0, the 4D final
  // lens under a w-mixing pose rotor, and the fr-wa6o slab query (every
  // ext register live). `symmetryRotation4` mints the pose rotors: any
  // proper rotation works, and that constructor is already convention-safe
  // (PLANE_SIGN) and in the import set.
  const affine4SystemDefs: {
    name: string;
    seed: number;
    transforms: Transform[];
    finalTransform?: Transform;
    symmetry?: SymmetryParams;
    view4: (de: SurfaceDE4) => SurfaceGpu4View;
  }[] = [
    {
      name: "aff4Tetra",
      seed: 501,
      transforms: surfaceAff4Tetra(),
      view4: () => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "aff4Kaleido",
      seed: 502,
      transforms: surfaceAff4Kaleido(),
      symmetry: { order: 3, plane: "xz", twist: 1 },
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.2 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "aff4Final",
      seed: 503,
      transforms: surfaceAff4FinalBase(),
      finalTransform: surfaceAff4Final(),
      view4: () => ({
        rotor: symmetryRotation4("xw", 0.7),
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "aff4Slab",
      seed: 504,
      transforms: surfaceAff4Tetra(),
      view4: (de) => ({
        rotor: symmetryRotation4("yw", 0.55),
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0.1 * de.boundingRadius,
      }),
    },
  ];
  const affine4Systems: Surface4SystemState[] = [];
  for (const def of affine4SystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface affine4 CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    // Def-time eligibility gate — a THROW, deliberately NOT the fold/escape
    // loops' note-and-skip: these are fixed fixtures, so an ineligible one
    // is a bench bug, and a leg quietly running on fewer systems would keep
    // passing while pinning less. Same reasoning for the absent try/catch
    // around the build/oracle calls below — any throw here surfaces as a
    // fatal `__BENCH_ERROR__`, never a degraded green run.
    const eligibility = analyzeSurfaceSystem4(
      def.transforms,
      def.finalTransform ?? null,
    );
    if (eligibility.status === "ineligible") {
      throw new Error(
        `affine4 bench fixture ${def.name} is ineligible: ` +
          eligibility.reasons.join("; "),
      );
    }
    const de = buildSurfaceDE4(
      def.transforms,
      def.finalTransform ?? null,
      def.symmetry ?? SURFACE_NO_SYMMETRY,
    );
    const view4 = def.view4(de);
    const queries = affine4Queries(de, view4, def.seed);
    const cpu = queries.map((q) => estimateSurface4Composed(de, view4, q));
    // The oracle-continuity gate (surface4QueryStable's doc): only queries
    // whose f64 oracle is flat across the ±1-ULP neighbor grid enter the
    // GPU comparison below — the M2 loop's stability idiom, one estimator
    // class over.
    const R = surface4ToleranceR(de);
    const stable = cpu.map((c, i) =>
      surface4QueryStable(de, view4, queries[i], c, surfaceEvalTol(c, R)),
    );
    affine4Systems.push({
      name: def.name,
      de,
      view4,
      transforms: def.transforms,
      queries,
      cpu,
      stable,
    });
    render();
  }

  // fr-rsp6 M4: the FOLD4 core's own fixed fixture family — the same
  // "def-time eligibility gate throws" idiom as affine4SystemDefs above,
  // for the same reason (fixed fixtures; an ineligible one is a bench bug).
  // Four systems, each `surfaceFold4Boxfold`/`surfaceFold4Mandelbox`
  // (`surface-de-4d.test.ts`'s fr-rsp6 fixtures verbatim, so bench and CPU
  // tests pin the identical systems) under a different view/symmetry: the
  // pure DE at a nonzero w0 (fold4Boxfold), the widest fold class at the
  // same view (fold4Mandelbox, 243 branches per map), the fr-u91x
  // kaleidoscope sweep through fold branches (fold4Kaleido), and the
  // fr-wa6o slab query threaded through them (fold4Slab, every ext
  // register live). `null` finalTransform always — fold4 FINAL lenses are
  // fr-rsp6 phase 2B, out of this cut (surface-de-gpu.ts's module doc).
  const fold4SystemDefs: {
    name: string;
    seed: number;
    transforms: Transform[];
    symmetry?: SymmetryParams;
    view4: (de: SurfaceDE4) => SurfaceGpu4View;
  }[] = [
    {
      name: "fold4Boxfold",
      seed: 521,
      transforms: surfaceFold4Boxfold(),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.2 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "fold4Mandelbox",
      seed: 522,
      transforms: surfaceFold4Mandelbox(),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.2 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "fold4Kaleido",
      seed: 523,
      transforms: surfaceFold4Boxfold(),
      symmetry: { order: 3, plane: "zw", twist: 1 },
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "fold4Slab",
      seed: 524,
      transforms: surfaceFold4Boxfold(),
      view4: (de) => ({
        rotor: symmetryRotation4("yw", 0.55),
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0.1 * de.boundingRadius,
      }),
    },
  ];
  const fold4Systems: Surface4SystemState[] = [];
  for (const def of fold4SystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface fold4 CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    // Same def-time-throw idiom as affine4SystemDefs above, plus a
    // fold-shape assertion: a fixture that regressed to no fold maps would
    // otherwise silently pass through estimateDistance4's plain-affine
    // path and pin nothing about descendFold4.
    const eligibility = analyzeSurfaceSystem4(def.transforms, null);
    if (eligibility.status === "ineligible") {
      throw new Error(
        `fold4 bench fixture ${def.name} is ineligible: ` +
          eligibility.reasons.join("; "),
      );
    }
    const de = buildSurfaceDE4(
      def.transforms,
      null,
      def.symmetry ?? SURFACE_NO_SYMMETRY,
    );
    if (!deHasFolds4(de)) {
      throw new Error(`fold4 bench fixture ${def.name} has no fold maps`);
    }
    const view4 = def.view4(de);
    // refined=false throughout: fold4 mirrors descendFold4's refine=FALSE
    // path, so both the query mix's boundary bisection and the CPU oracle
    // values below use the PLAIN estimateDistance4
    // (estimateSurface4Composed's doc).
    const queries = affine4Queries(de, view4, def.seed, false);
    const cpu = queries.map((q) =>
      estimateSurface4Composed(de, view4, q, false),
    );
    const R = surface4ToleranceR(de);
    const stable = cpu.map((c, i) =>
      surface4QueryStable(
        de,
        view4,
        queries[i],
        c,
        surfaceEvalTol(c, R),
        false,
      ),
    );
    fold4Systems.push({
      name: def.name,
      de,
      view4,
      transforms: def.transforms,
      queries,
      cpu,
      stable,
    });
    render();
  }

  // Lens systems are their own leg: `lens` is a per-SYSTEM kernel option
  // (the wrapper is generated source), while the fold/affine legs share
  // one pipeline per CONFIG — a lens system run through those pipelines
  // would march the bare base attractor and disagree with its own oracle.
  const foldSystems = systems.filter(
    (s) => s.core === "fold" && s.de.foldFinal === null,
  );
  const affineSystems = systems.filter(
    (s) => s.core === "affine" && s.de.foldFinal === null,
  );
  const lensSystems = systems.filter((s) => s.de.foldFinal !== null);
  if (systems.length === 0) {
    results.reason = "no eligible systems (see notes)";
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
        core: "fold",
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
    core: "fold",
    variant: stage2OffVariant,
    width: stage2OffWidth,
    stage2: false,
    wg: surfaceWgFor(config, stage2OffVariant),
  });
  // The affine core's single agreement config (fr-55s1 M0): its ladder is
  // FIXED width 4 and the generator ignores `sharedFrontier`/`bnbStage2`
  // there, so a variant/width sweep would compile the identical source
  // four times over. One config, and every row it produces gates.
  const affineEvalConfig: SurfaceKernelConfig = {
    core: "affine",
    variant: "private",
    width: SURFACE_AFFINE_LADDER_WIDTH,
    stage2: false,
    wg: surfaceWgFor(config, "private"),
  };

  const timingConfigs: SurfaceKernelConfig[] = [];
  if (config.timing) {
    for (const variant of config.variants) {
      for (const width of config.timingWidths) {
        timingConfigs.push({
          core: "fold",
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
        core: "fold",
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
  // fr-dlxh: set when the escape eval leg's f32-stability gate excludes too
  // large a fraction of a system's 700 queries (SURFACE_ESCAPE_EXCLUDED_CAP)
  // — separate from `anyAgreementFail` (computed at verdict time from
  // `results.agreement`) because an over-wide exclusion is a red flag even
  // when the surviving `failures` count itself is 0.
  let escapeGateFail = false;
  // fr-dlxh M3: the affine4 leg's analog — set when the oracle-continuity
  // gate excludes more than SURFACE_AFFINE4_EXCLUDED_CAP of a system's
  // queries, for exactly the reason above.
  let affine4GateFail = false;
  // fr-rsp6 M4: the fold4 leg's analog of affine4GateFail, per-system cap
  // (fold4ExcludedCap).
  let fold4GateFail = false;
  // fr-rsp6 M4: the fold4 leg's slabExt A/B on fold4Boxfold — set when the
  // slabExt:true/false kernels disagree beyond SURFACE_FOLD4_SLABEXT_TOL_FACTOR
  // at sliceHalfW 0, where surface-de-gpu.ts's slabExt doc says they must
  // be mathematically bit-identical (runSurfaceAff4SweepLeg's own gate,
  // one estimator class over).
  let fold4SlabExtFailed = false;

  const configLabel = (cfg: SurfaceKernelConfig): string =>
    cfg.core === "affine"
      ? `affine-ladder w${cfg.width} wg${cfg.wg}`
      : cfg.core === "affine4"
        ? `affine4-ladder w${cfg.width} wg${cfg.wg}`
        : cfg.core === "escape"
          ? `escape-forward wg${cfg.wg}`
          : `${cfg.variant} w${cfg.width} s2=${cfg.stage2 ? "on" : "off"} wg${cfg.wg}`;
  const workgroupBytesFor = (cfg: SurfaceKernelConfig): number =>
    cfg.variant === "shared"
      ? surfaceGpuWorkgroupBytes({
          core: cfg.core,
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
      for (const sys of foldSystems) {
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

    // ----- M0 (fr-55s1): the AFFINE core's agreement leg — GATING -----
    // Fold-free systems compile the width-4 refined ladder and pin against
    // `estimateDistanceRefined` (their `cpu` values above already are it),
    // the same eval protocol and tolerance formula as the fold rows one
    // estimator over. No width sweep and no cross-checks: the ladder has
    // one width, and `sharedFrontier`/`bnbStage2` generate identical
    // source there, so there is nothing to compare against itself.
    if (affineSystems.length > 0) {
      const label = configLabel(affineEvalConfig);
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      let affinePipeline: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine",
          width: affineEvalConfig.width,
          workgroupSize: affineEvalConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: affinePipeline } = await buildSurfacePipeline(
          device,
          pipelineLayout,
          code,
          "evalQueries",
          `surface-de eval ${label}`,
        ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
      }
      if (affinePipeline !== null) {
        const pipeline = affinePipeline;
        for (const sys of affineSystems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceEvalBuffers(device, bindGroupLayout, sys);
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            affineEvalConfig.wg,
          );
          results.agreement.push(
            compareSurfaceAgreement(sys, affineEvalConfig, gpu),
          );
          render();
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      render();
    }

    // ----- M1 (fr-55s1 stage B): the fold-lens agreement leg — GATING -----
    // One pipeline PER SYSTEM: `lens` wraps that system's own core
    // (lensOverFold marches the width-12 fold frontier inside the sweep,
    // the affine-based pair the width-4 ladder), and every row compares
    // like against like — the `cpu` values above already routed through
    // `descendLens`. Private frontier, stage 2 off: the shipped config.
    // All lens rows GATE (affine by rule, fold at the oracle's width).
    for (const sys of lensSystems) {
      const cfg: SurfaceKernelConfig = {
        core: sys.core,
        variant: "private",
        width:
          sys.core === "fold"
            ? SURFACE_FOLD_BEAM_WIDTH
            : SURFACE_AFFINE_LADDER_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = `lens ${configLabel(cfg)}`;
      status(`agreement: compiling ${label} (${sys.name})…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: sys.core,
          lens: true,
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        const { pipeline } = await buildSurfacePipeline(
          device,
          pipelineLayout,
          code,
          "evalQueries",
          `surface-de eval ${label} ${sys.name}`,
        );
        status(`agreement: ${label} × ${sys.name}…`);
        await ensureSurfaceEvalBuffers(device, bindGroupLayout, sys);
        const gpu = await runSurfaceEvalDispatch(device, pipeline, sys, cfg.wg);
        results.agreement.push(compareSurfaceAgreement(sys, cfg, gpu));
      } catch (e) {
        compileFailed = true;
        results.notes.push(
          `agreement ${label} ${sys.name}: ${describeError(e)}`,
        );
      }
      render();
      await new Promise<void>((resolve) => setTimeout(resolve));
    }

    // ----- M2 (fr-dlxh): the ESCAPE core's agreement leg — GATING -----
    // Forward escape-time systems never enter `systems` above — `buildSurfaceDE`
    // refuses their shape by design — so `escapeSystems` (built right after
    // the systemDefs CPU-oracle loop) is the only source for this leg. One
    // pipeline for all four systems: the escape core takes no width/variant/
    // stage2 sweep (inert, like the affine ladder), and it never declares
    // binding 1 (surface-de-gpu.ts module doc — its one forward map rides
    // the params uniform's variant block), so this leg gets its own bind
    // group layout and buffers helper rather than `ensureSurfaceEvalBuffers`'s
    // maps-bound one.
    if (escapeSystems.length > 0) {
      const escapeEvalConfig: SurfaceKernelConfig = {
        core: "escape",
        variant: "private",
        width: SURFACE_FOLD_BEAM_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = configLabel(escapeEvalConfig);
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      const escapeLayout = surfaceEscapeBindGroupLayout(device);
      const escapePipelineLayout = device.createPipelineLayout({
        label: "surface-de escape pipeline layout",
        bindGroupLayouts: [escapeLayout],
      });
      let escapePipeline: GPUComputePipeline | null = null;
      let escapeCompileMs = 0;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "escape",
          width: escapeEvalConfig.width,
          workgroupSize: escapeEvalConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: escapePipeline, compileMs: escapeCompileMs } =
          await buildSurfacePipeline(
            device,
            escapePipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
      }
      if (escapePipeline !== null) {
        const pipeline = escapePipeline;
        for (const sys of escapeSystems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceEscapeEvalBuffers(device, escapeLayout, sys);
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            escapeEvalConfig.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceEscapeAgreement(
            sys,
            escapeEvalConfig,
            gpu,
            escapeCompileMs,
            gpuMs,
          );
          results.agreement.push(row);
          const excluded = row.excluded ?? 0;
          if (excluded > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                `queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP}) from the ` +
                "f32-stability gate — see compareSurfaceEscapeAgreement's doc",
            );
          }
          const flips = row.chaoticFlips ?? 0;
          if (flips > SURFACE_ESCAPE_FLIP_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape agreement ${sys.name}: ${flips} verified chaotic ` +
                `flips (> ${SURFACE_ESCAPE_FLIP_CAP}) — a systematic ` +
                "disagreement is wearing chaos's costume; failing the leg",
            );
          }
          render();
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      render();
    }

    // ----- M3 (fr-dlxh): the AFFINE4 core's agreement leg — GATING -----
    // The 4D refined ladder behind the view lift — `estimateDistance4Refined`
    // (surface-de-4d.ts) as `surface-material-4d.ts` marches it — pinned
    // against the COMPOSED f64 oracle (`estimateSurface4Composed`: the same
    // lift in f64, then the estimator, which applies `de.final` itself).
    // One pipeline serves all four systems (the kernel source is
    // system-independent — per-system data rides the params/maps buffers,
    // exactly the M0/M2 shape), and it binds the SHARED 4-binding layout:
    // unlike escape, the affine4 core DOES declare binding 1
    // (`array<GpuMap4>`, packed by `packSurfaceGpuMaps4`). Every row GATES
    // (fixed width 4 = the 4D oracle's `beamWidth`; variant/stage2 inert,
    // like the affine ladder) at fail=0 over the ORACLE-CONTINUOUS rows —
    // bisection queries parked on beam-selection discontinuities are
    // excluded pre-hoc and capped (`surface4QueryStable`'s doc carries the
    // measured verdict; the M2 exclusion shape, cheaper criterion).
    if (affine4Systems.length > 0) {
      const affine4EvalConfig: SurfaceKernelConfig = {
        core: "affine4",
        variant: "private",
        // The 4D ladder's fixed width IS the 3D constant's value 4 —
        // `buildSurfaceDE4` always emits `beamWidth` 4, like `buildSurfaceDE`.
        width: SURFACE_AFFINE_LADDER_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = configLabel(affine4EvalConfig);
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      let affine4Pipeline: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine4",
          width: affine4EvalConfig.width,
          workgroupSize: affine4EvalConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: affine4Pipeline } = await buildSurfacePipeline(
          device,
          pipelineLayout,
          code,
          "evalQueries",
          `surface-de eval ${label}`,
        ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
      }
      if (affine4Pipeline !== null) {
        const pipeline = affine4Pipeline;
        for (const sys of affine4Systems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            affine4EvalConfig.wg,
          );
          const row = compareSurface4Agreement(sys, affine4EvalConfig, gpu);
          results.agreement.push(row);
          const excluded = row.excluded ?? 0;
          if (excluded > SURFACE_AFFINE4_EXCLUDED_CAP) {
            affine4GateFail = true;
            results.notes.push(
              `affine4 agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                `queries (> ${SURFACE_AFFINE4_EXCLUDED_CAP}) from the ` +
                "oracle-continuity gate — see surface4QueryStable's doc",
            );
          }
          render();
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      render();
    }

    // ----- M4 (fr-rsp6 phase 2A): the FOLD4 core's agreement leg -----
    // The fold frontier one dimension up, behind the SAME view lift as M3
    // — `descendFold4` refine=FALSE (surface-de-4d.ts) as the fold4
    // GLSL/WGSL body marches it — pinned against the COMPOSED f64 oracle
    // at `refined=false` (`estimateSurface4Composed`'s doc). TWO widths,
    // one pipeline each, both dispatched against the SAME four systems'
    // buffers (the params/maps/queries data doesn't depend on kernel
    // width — only the compiled source does): `SURFACE_FOLD_BEAM_WIDTH`
    // (12) is the CPU oracle's own fixed frontier width, so it GATES; 4 is
    // the same fr-5rvk narrow-width erosion measurement 3D's fold rows
    // already run, informational only
    // (`compareSurfaceFold4Agreement`'s `gating` rule — the 3D fold row's
    // idiom, not M3's fixed-width "always gate"). Private variant, stage2
    // off always: the fold4 frontier is function-scope private by
    // construction and the fr-kidj skips are not emitted at all
    // (surface-de-gpu.ts's module doc), so there is no variant/stage2
    // sweep to run here.
    const gpuByFold4Key = new Map<string, Float32Array>();
    if (fold4Systems.length > 0) {
      const fold4Configs: SurfaceKernelConfig[] = [
        {
          core: "fold4",
          variant: "private",
          width: SURFACE_FOLD_BEAM_WIDTH,
          stage2: false,
          wg: surfaceWgFor(config, "private"),
        },
        {
          core: "fold4",
          variant: "private",
          width: 4,
          stage2: false,
          wg: surfaceWgFor(config, "private"),
        },
      ];
      for (const cfg of fold4Configs) {
        const label = configLabel(cfg);
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        let fold4Pipeline: GPUComputePipeline | null = null;
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: "fold4",
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
          });
          ({ pipeline: fold4Pipeline } = await buildSurfacePipeline(
            device,
            pipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          ));
        } catch (e) {
          compileFailed = true;
          results.notes.push(`agreement ${label}: ${describeError(e)}`);
        }
        if (fold4Pipeline !== null) {
          const pipeline = fold4Pipeline;
          for (const sys of fold4Systems) {
            status(`agreement: ${label} × ${sys.name}…`);
            await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
            const gpu = await runSurfaceEvalDispatch(
              device,
              pipeline,
              sys,
              cfg.wg,
            );
            gpuByFold4Key.set(`${sys.name}|${String(cfg.width)}`, gpu);
            const row = compareSurfaceFold4Agreement(sys, cfg, gpu);
            results.agreement.push(row);
            // Excluded count doesn't depend on kernel width (the
            // classifier is a pure CPU-oracle question, computed once at
            // system-build time) — check the cap once, off the GATING
            // row, so a system doesn't earn two identical notes.
            if (cfg.width === SURFACE_FOLD_BEAM_WIDTH) {
              const excluded = row.excluded ?? 0;
              const cap = fold4ExcludedCap(sys.name);
              if (excluded > cap) {
                fold4GateFail = true;
                results.notes.push(
                  `fold4 agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                    `queries (> ${cap}) from the oracle-continuity gate — ` +
                    "see surface4QueryStable's doc",
                );
              }
            }
            render();
            await new Promise<void>((resolve) => setTimeout(resolve));
          }
        }
        render();
      }

      // fr-rsp6 M4's slabExt A/B (mirrors runSurfaceAff4SweepLeg's own
      // slab/no-slab comparison + note wording, one estimator class over):
      // fold4Boxfold's own sliceHalfW is 0, so surface-de-gpu.ts's
      // `slabExt` doc applies verbatim — segmentRadius4(q, 0) is length(q)
      // bit for bit, so the slabExt:false kernel (the h=0-only body, no
      // ext registers) must agree with the shipped slabExt (default/true)
      // kernel elementwise on the SAME 700-query batch already dispatched
      // above, at the production width.
      const boxfold = fold4Systems.find((s) => s.name === "fold4Boxfold");
      const gpuSlab = gpuByFold4Key.get(
        `fold4Boxfold|${String(SURFACE_FOLD_BEAM_WIDTH)}`,
      );
      if (!boxfold || !gpuSlab) {
        results.notes.push(
          "fold4 slabExt A/B: skipped — fold4Boxfold's w12 row did not run (see notes)",
        );
      } else {
        const wg = surfaceWgFor(config, "private");
        status("fold4 slabExt A/B: compiling…");
        activity.setState("gpu", "Surface DE fold4 slabExt A/B");
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: "fold4",
            width: SURFACE_FOLD_BEAM_WIDTH,
            workgroupSize: wg,
            sharedFrontier: false,
            bnbStage2: false,
            slabExt: false,
          });
          const { pipeline } = await buildSurfacePipeline(
            device,
            pipelineLayout,
            code,
            "evalQueries",
            "surface-de eval fold4 noslab",
          );
          status("fold4 slabExt A/B: fold4Boxfold…");
          await ensureSurface4EvalBuffers(device, bindGroupLayout, boxfold);
          const gpuNoslab = await runSurfaceEvalDispatch(
            device,
            pipeline,
            boxfold,
            wg,
          );
          let mismatches = 0;
          let maxAbs = 0;
          for (let i = 0; i < gpuSlab.length; i++) {
            if (gpuSlab[i] !== gpuNoslab[i]) {
              mismatches++;
              maxAbs = Math.max(maxAbs, Math.abs(gpuSlab[i] - gpuNoslab[i]));
            }
          }
          const tol =
            SURFACE_FOLD4_SLABEXT_TOL_FACTOR * boxfold.de.boundingRadius;
          const withinTolerance = maxAbs <= tol;
          results.crossChecks.push({
            kind: "slabext-on-vs-off",
            system: boxfold.name,
            width: SURFACE_FOLD_BEAM_WIDTH,
            n: gpuSlab.length,
            mismatches,
            maxDelta: maxAbs,
            note:
              mismatches === 0
                ? "exact — sliceHalfW 0 makes segmentRadius4(q, 0) length(q) bit for bit"
                : withinTolerance
                  ? "sub-tolerance mismatches (fma/contraction noise)"
                  : "MISMATCH — slabExt true/false must agree at sliceHalfW 0 (surface-de-gpu.ts's slabExt doc)",
          });
          if (!withinTolerance) {
            fold4SlabExtFailed = true;
            results.notes.push(
              `fold4 slabExt A/B ${boxfold.name}: ${String(mismatches)} mismatches, ` +
                `maxAbs ${maxAbs.toExponential(2)} exceeds tolerance ${tol.toExponential(2)} — ` +
                "slabExt true/false DISAGREE at sliceHalfW 0, failing the leg",
            );
          }
        } catch (e) {
          fold4SlabExtFailed = true;
          results.notes.push(`fold4 slabExt A/B: ${describeError(e)}`);
        }
        render();
      }
    }

    // ----- Cross-checks (fold core only — see the M0 leg above) -----
    if (
      config.variants.includes("shared") &&
      config.variants.includes("private")
    ) {
      for (const sys of foldSystems) {
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
    for (const sys of foldSystems) {
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
      // The leg compiles a FOLD march kernel, so it only ever runs on a
      // fold system (fr-55s1: the affine systems beside them march a
      // different core, whose march/shade legs are stages C's).
      const sys =
        foldSystems.find((s) => s.name === "mandelboxKifs") ?? foldSystems[0];
      if (!sys) {
        results.marchUnproject = {
          skipped: "no fold system built (see notes)",
        };
        render();
      } else {
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

      // fr-55s1 stage C: the same gate over the lens field class — the
      // affine core under the 81-branch mandelbox lens, the exact kernel
      // the app renderer compiles for fr-zx34's system shape. Same
      // truncation/failure gating as the fold leg above.
      const lensSys = lensSystems.find(
        (s) => s.name === "lensMandelboxOverAffine",
      );
      if (!lensSys) {
        results.marchUnprojectLens = {
          skipped: "lensMandelboxOverAffine did not build (see notes)",
        };
        render();
      } else {
        try {
          const row = await runSurfaceUnprojectLeg(
            device,
            lensSys,
            acquired.software,
            status,
            activity,
          );
          results.marchUnprojectLens = row;
          if (row.truncated) {
            unprojFailed = true;
            results.notes.push(
              `march-unproject lens: truncated at ${SURFACE_UNPROJ_CAP_MS}ms — ` +
                "agreement not verifiable, failing the leg",
            );
          } else if (row.failures > 0) {
            unprojFailed = true;
          }
        } catch (e) {
          unprojFailed = true;
          results.marchUnprojectLens = { skipped: describeError(e) };
          results.notes.push(`march-unproject lens: ${describeError(e)}`);
        }
        render();
      }
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

      // fr-55s1 stage C: the PRODUCTION renderer over the lens field
      // class — lensMandelboxOverAffine through the same create/frame
      // protocol (its DE derives core "affine" + lens:true and the
      // branch-scaled priors inside the renderer). Same gates.
      const lensSys = lensSystems.find(
        (s) => s.name === "lensMandelboxOverAffine",
      );
      if (!lensSys) {
        results.computeFrameLens = {
          skipped: "lensMandelboxOverAffine did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrameLeg(
            lensSys,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFrameLens = row;
          if (row.counts.hit === 0 && !acquired.software) {
            frameFailed = true;
            results.notes.push(
              "compute frame lens: zero hit rays on a real adapter — failing the leg",
            );
          }
          if (row.truncated) {
            results.notes.push(
              `compute frame lens: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
                (acquired.software
                  ? " — accepted on a software adapter"
                  : " — informational (only hit=0 or a null frame gate)"),
            );
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrameLens = { skipped: describeError(e) };
          results.notes.push(`compute frame lens: ${describeError(e)}`);
        }
      }
      render();

      // fr-dlxh: leg B over the escape class — the PRODUCTION renderer on
      // escMandelbox through `{ kind: "escape" }` (forward-orbit core, no
      // maps buffer). Same gates, plus the strided CPU sanity march's
      // hit-rate band on real hardware (see the leg's design comment).
      const escSys = escapeSystems.find((s) => s.name === "escMandelbox");
      if (!escSys) {
        results.computeFrameEscape = {
          skipped: "escMandelbox did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrameEscapeLeg(
            escSys,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFrameEscape = row;
          if (row.counts.hit === 0 && !acquired.software) {
            frameFailed = true;
            results.notes.push(
              "compute frame escape: zero hit rays on a real adapter — failing the leg",
            );
          }
          // A truncated frame's counts.hit undercounts (rays still
          // `active` haven't resolved to hit/miss/exhausted), so its rate
          // isn't comparable to the CPU sanity march's always-complete
          // sample — skip the gate while truncated, mirroring the timing
          // legs' `sanity = "skipped (truncated)"` convention
          // (SurfaceTimingRow) rather than risking a false fail from an
          // incomplete frame.
          if (row.truncated) {
            results.notes.push(
              `compute frame escape: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
                (acquired.software
                  ? " — accepted on a software adapter"
                  : " — informational (only hit=0 or a null frame gate; the rate-band check is skipped while truncated)"),
            );
          } else {
            const gap = Math.abs(
              (row.sanityGpuHitRate ?? 0) - (row.sanityCpuHitRate ?? 0),
            );
            if (gap > SURFACE_SANITY_HIT_RATE_TOL) {
              if (acquired.software) {
                results.notes.push(
                  `compute frame escape: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march — informational on a software adapter`,
                );
              } else {
                frameFailed = true;
                results.notes.push(
                  `compute frame escape: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
                );
              }
            }
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrameEscape = { skipped: describeError(e) };
          results.notes.push(`compute frame escape: ${describeError(e)}`);
        }
      }
      render();

      // fr-dlxh 4D (stage B2): leg B over the ifs4 class — TWO frames on
      // one PRODUCTION renderer (the second at a different view4: the
      // per-frame repack proof). Gates mirror the escape leg's — zero hits
      // on a real adapter, truncation skips the band, the rate band
      // otherwise — plus the completed-empty-vs-CPU-hits clause (see
      // SurfaceDeResults.computeFrame4's doc: the kaleido slice's correct
      // rates are sparse, so the band alone can't tell broken-empty from
      // correct-sparse). The runner's stdout printer predates
      // computeFrame4, so each frame's numbers also land in `notes` in the
      // frame-row voice.
      const aff4Sys = affine4Systems.find((s) => s.name === "aff4Kaleido");
      if (!aff4Sys) {
        results.computeFrame4 = {
          skipped: "aff4Kaleido did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrame4Leg(
            aff4Sys,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFrame4 = row;
          const frames = [
            {
              label: "compute frame ifs4",
              wallMs: row.wallMs,
              gpuMs: row.gpuMs,
              passes: row.passes,
              truncated: row.truncated,
              counts: row.counts,
              gpuRate: row.sanityGpuHitRate ?? 0,
              cpuRate: row.sanityCpuHitRate ?? 0,
            },
            ...(row.view2
              ? [
                  {
                    label: "compute frame ifs4 view2",
                    wallMs: row.view2.wallMs,
                    gpuMs: row.view2.gpuMs,
                    passes: row.view2.passes,
                    truncated: row.view2.truncated,
                    counts: row.view2.counts,
                    gpuRate: row.view2.sanityGpuHitRate,
                    cpuRate: row.view2.sanityCpuHitRate,
                  },
                ]
              : []),
          ];
          for (const fr of frames) {
            results.notes.push(
              `${fr.label} ${row.width}x${row.height}: wall=${fr.wallMs.toFixed(0)}ms ` +
                `gpu=${fr.gpuMs.toFixed(0)}ms passes=${String(fr.passes)} ` +
                `hit=${String(fr.counts.hit)} miss=${String(fr.counts.miss)} ` +
                `exh=${String(fr.counts.exhausted)} active=${String(fr.counts.active)} ` +
                `rate gpu=${fr.gpuRate.toFixed(3)} cpu=${fr.cpuRate.toFixed(3)}` +
                `${fr.truncated ? " TRUNCATED" : ""}`,
            );
            if (fr.counts.hit === 0 && !acquired.software) {
              frameFailed = true;
              results.notes.push(
                `${fr.label}: zero hit rays on a real adapter — failing the leg`,
              );
            }
            if (fr.truncated) {
              results.notes.push(
                `${fr.label}: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
                  (acquired.software
                    ? " — accepted on a software adapter"
                    : " — informational (only hit=0 or a null frame gate; the rate-band check is skipped while truncated)"),
              );
            } else {
              if (fr.counts.hit === 0 && fr.cpuRate > 0) {
                frameFailed = true;
                results.notes.push(
                  `${fr.label}: completed with zero hit rays while the CPU sanity march hit ` +
                    `(rate ${fr.cpuRate.toFixed(3)}) — deterministic breakage, failing the leg on any adapter`,
                );
              }
              const gap = Math.abs(fr.gpuRate - fr.cpuRate);
              if (gap > SURFACE_SANITY_HIT_RATE_TOL) {
                if (acquired.software) {
                  results.notes.push(
                    `${fr.label}: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march — informational on a software adapter`,
                  );
                } else {
                  frameFailed = true;
                  results.notes.push(
                    `${fr.label}: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
                  );
                }
              }
            }
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrame4 = { skipped: describeError(e) };
          results.notes.push(`compute frame ifs4: ${describeError(e)}`);
        }
      }
      render();
    }

    // ----- fr-b72d: opt-in per-kaleidoscope-order affine4 timing sweep --
    // Off by default (`config.aff4Sweep`, `surfaceAff4Sweep=1`) — never
    // runs in CI, and silent (no notes at all) when not requested, like
    // the shade A/B leg's own `surfaceShadeWidths` gate. GATING when it
    // does run: a slab/no-slab disagreement beyond the leg's tolerance
    // fails the section (see `runSurfaceAff4SweepLeg`'s doc) — unlike the
    // shade A/B leg below, which stays purely informational. Every row
    // and the pipelines' compileMs also land in `notes` (the computeFrame4
    // leg's dual-reporting convention), so a headless run's stdout
    // discloses them via the existing `note:` printer without a bespoke
    // stdout formatter in gpu-flame-bench.mjs.
    let aff4SweepFailed = false;
    try {
      const sweep = await runSurfaceAff4SweepLeg(
        config,
        device,
        pipelineLayout,
        bindGroupLayout,
        acquired.software,
        status,
        activity,
        (partial) => {
          results.aff4Sweep = partial;
          render();
        },
      );
      for (const n of sweep.notes) results.notes.push(n);
      if (sweep.result) results.aff4Sweep = sweep.result;
      aff4SweepFailed = sweep.failed;
    } catch (e) {
      aff4SweepFailed = true;
      results.notes.push(`aff4 sweep: ${describeError(e)}`);
    }
    render();

    // ----- Shade A/B leg (fr-p8bc): cheap shading-probe-width vs the -----
    // shipped full-width baseline. Runs AFTER leg B, purely informational —
    // never gates the verdict below (see runSurfaceShadeAbLeg's doc) — so
    // the whole call is wrapped: any thrown error becomes a note instead of
    // failing the section.
    try {
      const { rows, notes: abNotes } = await runSurfaceShadeAbLeg(
        config,
        systems,
        acquired.software,
        dom,
        status,
        activity,
        (partial) => {
          results.shadeAb = partial;
          render();
        },
      );
      for (const n of abNotes) results.notes.push(n);
      if (rows.length > 0) results.shadeAb = rows;
    } catch (e) {
      results.notes.push(`shade-ab: ${describeError(e)}`);
    }
    render();

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
      frameFailed ||
      escapeGateFail ||
      affine4GateFail ||
      fold4GateFail ||
      fold4SlabExtFailed ||
      aff4SweepFailed
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
              : frameFailed
                ? "compute-frame (app path) failure — see computeFrame/notes"
                : escapeGateFail
                  ? "escape agreement leg excluded too many queries from its f32-stability gate — see notes"
                  : affine4GateFail
                    ? "affine4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                    : fold4GateFail
                      ? "fold4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                      : fold4SlabExtFailed
                        ? "fold4 slabExt A/B: slab/no-slab kernels disagree beyond tolerance at sliceHalfW 0 — see notes"
                        : "aff4 sweep leg: slab/no-slab kernels disagree beyond tolerance — see notes";
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
    for (const sys of escapeSystems) destroySurfaceEscapeEvalBuffers(sys);
    for (const sys of affine4Systems) destroySurface4EvalBuffers(sys);
    for (const sys of fold4Systems) destroySurface4EvalBuffers(sys);
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
  // are checked, not just description/vendor. The regex is the app's ONE
  // software-tell definition (render-backend.ts, fr-tmgf).
  return (
    SOFTWARE_RENDERER_RE.test(adapter.description) ||
    SOFTWARE_RENDERER_RE.test(adapter.vendor) ||
    SOFTWARE_RENDERER_RE.test(adapter.architecture)
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
