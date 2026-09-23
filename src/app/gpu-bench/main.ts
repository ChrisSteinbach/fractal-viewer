/**
 * The standing statistical-agreement harness pinning
 * `src/fractal/flame-gpu.ts`'s WGSL kernel (driven by
 * `src/app/flame-gpu-backend.ts`) to `src/fractal/flame.ts`'s
 * `accumulateFlame` — its CPU oracle. Productized from the GPU
 * flame-accumulation spike's own page
 * (`docs/flame-gpu-accumulation-spike.md`), now driving the SHIPPED backend
 * instead of the spike's standalone engine.
 * Served at /gpu-bench/index.html by `npm run dev`; dev-only — not part of
 * the production build (see vite.config.ts — only the root index.html is a
 * build input).
 *
 * The 4D scenarios pin `src/fractal/flame-gpu-4d.ts`'s kernel
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
import { normalizeRotorPair, rotorMatrix } from "../rotor4";
import { presetCameraPose, presetRotorPair } from "../preset-view";
import { createGlassStudioBackground } from "../preset-background";
import { hexToRgb01 } from "../constants";
import { lightDirection } from "../voxel-material";
import {
  SURFACE_FULL_AO_TAPS,
  SURFACE_FULL_HIT_FLOOR,
  SURFACE_FULL_MARCH_STEPS,
  SURFACE_FULL_SHADOW_STEPS,
  SURFACE_PREVIEW_AO_TAPS,
  SURFACE_PREVIEW_HIT_FLOOR,
  SURFACE_PREVIEW_MARCH_STEPS,
  SURFACE_PREVIEW_SHADOW_STEPS,
} from "../surface-material";
import { presentationFloorSpec } from "../../fractal/presentation-floor";
import {
  SURFACE_CHAOS_ROW_3D,
  SURFACE_CHAOS_ROW_4D,
  surfaceChaosFrameAcceptance,
  surfaceChaosKernelSpec,
  surfaceChaosMarchAcceptance,
} from "./chaos";
import {
  SURFACE_SCHEDULE_ROW_3D,
  SURFACE_SCHEDULE_ROW_4D,
  surfaceScheduleFrameAcceptance,
  surfaceScheduleKernelSpec,
  surfaceScheduleMarchAcceptance,
} from "./schedule";
import { applyScenarioShard } from "./shard";
import { finiteEnvelopeEvidenceFailures } from "./surface-transport-envelope";
import {
  finiteTransportChunkFailures,
  type FiniteTransportChunkArm,
  type FiniteTransportChunkRow,
} from "./finite-transport-chunks";
import {
  FINITE_TRANSPORT_CHUNK_PATHS,
  SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS,
  TRANSPORT_PATH_BYTES,
  finiteTransportWorkBytes,
  transportWorkBytes,
} from "../../fractal/finite-transport-work";
import { buildSurfaceTilingSymmetryAbiSpecs } from "./tiling-symmetry";
import {
  rotationMatrix4,
  symmetryRotation4,
  toTransform4,
} from "../../fractal/affine4";
import {
  BALLOON_FAR_CAP_RHO,
  balloonBall,
  balloonBall4,
  buildBalloon,
  buildBalloon4,
  buildBalloonFromBall,
  estimateBalloonDistance,
  estimateBalloonDistance4,
  estimateBalloonDistanceSample,
  estimateBalloonDistance4Sample,
  invertBalloon,
} from "../../fractal/balloon-de";
import type { Balloon, BalloonDistance } from "../../fractal/balloon-de";
import { prepareChaosGame, runChaosGame } from "../../fractal/chaos-game";
import type { PreparedChaosGame } from "../../fractal/chaos-game";
import { runChaosGame4, prepareChaosGame4 } from "../../fractal/chaos-game-4d";
import type { PreparedChaosGame4 } from "../../fractal/chaos-game-4d";
import {
  UNIFORM_POINT_COLOR,
  W_SIDE_PALETTES,
  buildColorModeLUT,
  transformColors,
} from "../../fractal/color";
import type { FourDRenderColor, PositionAxisColors } from "../../fractal/color";
import {
  analyzeBulbSystem,
  buildBulbDE,
  BULB_ITERATIONS,
  BULB_STEP_SCALE,
  estimateBulbDistance,
} from "../../fractal/bulb-de";
import type { BulbDE } from "../../fractal/bulb-de";
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_LINK_SPHEREFOLD,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  estimateEscapeDistance,
} from "../../fractal/escape-de";
import { resolveShapeTrap, shapeTrapLocalSdf } from "../../fractal/shape-trap";
import type { ResolvedShapeTrap } from "../../fractal/shape-trap";
import { PEACE_SIGN_SHAPE, SHAPE_MARCH_SAFETY } from "../../fractal/shapes";
import type { EscapeDE } from "../../fractal/escape-de";
import {
  analyzeEscapeSystem4,
  buildEscapeDE4,
  estimateEscapeDistance4,
  SYM_PLANE_CODE4,
} from "../../fractal/escape-de-4d";
import type { EscapeDE4 } from "../../fractal/escape-de-4d";
import {
  accumulateFlame,
  adaptiveDownsampleFlame,
  createFlameHistogram,
  downsampleFlame,
  tonemapFlame,
  DEFAULT_GAMMA_THRESHOLD,
} from "../../fractal/flame";
import type {
  DensityEstimatorParams,
  FlameBalloonEcho,
  FlameHistogram,
  Mat4,
  TonemapParams,
} from "../../fractal/flame";
import { accumulateFlame4 } from "../../fractal/flame-4d";
import { buildPaletteLUT } from "../../fractal/palette";
import type { FlamePaletteId } from "../../fractal/palette";
import {
  barnsleyFern,
  mengerSponge,
  doubleRotation,
  fernSpongeIsolated,
  fernSpongeLeak,
  gearworks,
  hyperfern,
  hyperMengerSpongeTransforms,
  mandelboxKifs,
  pentatope,
  PRESET_SCHEDULES,
  PRESET_SPHERE_INVERSIONS,
  PRESET_SURFACE_ROOMS,
  PRESET_VIEWS,
  presetTransforms,
  sierpinskiTetrahedron,
  swirlFlame,
} from "../../fractal/presets";
import {
  composeFlameProjection4,
  composeRotorProjection4,
} from "../../fractal/project4";
import type { FourDView } from "../../fractal/project4";
import { mulberry32 } from "../../fractal/rng";
import { resolvePointTilingPlan } from "../../fractal/point-tiling";
import type { PointTilingPlan } from "../../fractal/point-tiling";
import {
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
  estimateDistanceSample,
  estimateDistanceRefinedSample,
  surfaceOriginVisibleRadius,
  SURFACE_FOLD_BEAM_WIDTH,
  SYM_PLANE_CODE,
} from "../../fractal/surface-de";
import type {
  SurfaceDE,
  SurfaceDistanceSample,
} from "../../fractal/surface-de";
import {
  condensationDistance3,
  condensationSignedDistance4,
} from "../../fractal/condensation-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  deHasFolds4,
  estimateDistance4,
  estimateDistance4Refined,
  estimateDistance4Sample,
  estimateDistance4RefinedSample,
  slabExact4,
  slabSupported4,
} from "../../fractal/surface-de-4d";
import type { SurfaceDE4 } from "../../fractal/surface-de-4d";
import { surfaceSwirlAcceptanceScale } from "../../fractal/swirl-lens";
import {
  estimateBulbDistanceTiled,
  estimateDistance4RefinedTiled,
  estimateDistance4Tiled,
  estimateDistanceRefinedTiled,
  estimateDistanceTiled,
  estimateDistanceSampleTiled,
  estimateDistanceRefinedSampleTiled,
  estimateDistance4SampleTiled,
  estimateDistance4RefinedSampleTiled,
  estimateEscapeDistance4Tiled,
  estimateEscapeDistanceTiled,
} from "../../fractal/tiling-de";
import { resolveTiling } from "../../fractal/tiling";
import type {
  ResolvedFiniteTiling,
  ResolvedLatticeTiling,
  ResolvedTiling,
} from "../../fractal/tiling";
import {
  LATTICE_PRESENTATION_RADIUS_MULT,
  intersectLatticePresentation3,
  intersectLatticePresentation4,
  latticeCameraCarrierRadius3,
  latticeCameraCarrierRadius4,
} from "../../fractal/lattice-march";
import type { LatticePresentation } from "../../fractal/lattice-march";
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_MAP4_VEC4,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_PLANE,
  SURFACE_GPU_SHADE_BYTES,
  SURFACE_GPU_TRANSPORT_COMPLETE,
  SURFACE_GPU_TRANSPORT_INVALID,
  SURFACE_GPU_TRANSPORT_PENDING,
  SURFACE_GPU_TRANSPORT_RESIDUAL,
  SURFACE_GPU_TRANSPORT_UNRESOLVED,
  SURFACE_GPU_UNIFORM_MAP_SLOTS,
  packBulbGpuParams,
  packEscape4GpuMaps,
  packEscape4GpuParams,
  packEscapeGpuMaps,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuOpticsMaps,
  packSurfaceGpuParams,
  packSurfaceGpuParamsFinite,
  packSurfaceGpuParamsFinite4,
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  surfaceGpuWorkgroupBytes,
} from "../../fractal/surface-de-gpu";
import { resolveSurfaceFinish } from "../../fractal/surface-finish";
import { resolveSurfacePattern } from "../../fractal/surface-pattern";
import type {
  SurfaceGpu4View,
  SurfaceGpuGroundPlane,
  SurfaceGpuKernelOptions,
  SurfaceGpuPose,
  SurfaceGpuRunParams,
} from "../../fractal/surface-de-gpu";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_ANCHOR_ENVELOPE_REL,
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_DISTORTION_NORMAL_REL,
  DIELECTRIC_IOR,
  DIELECTRIC_INITIAL_BRANCH_THETA,
} from "../../fractal/surface-dielectric";
import {
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_IDENTITY_POSE,
  analyzeFiniteSolidGeneral,
  buildFiniteSolidConstruction,
  finiteSolidDisplayDistance,
  finiteSolidBoundingRadius,
  finiteSolidGeneralDisplayDistance,
  finiteSolidIntervals,
  finiteSolidPose,
  type FiniteSolidAnchor,
  type FiniteSolidPose,
} from "../../fractal/finite-solid";
import {
  finiteSolidDdaF32,
  finiteSolidGeneralDdaF32,
  finiteSolidGeneralBoundingRadius,
  type FiniteSolidGeneralWire,
} from "../../fractal/surface-finite-solid-gpu";
import {
  transportBoundaryQueryCPU,
  transportShadowVisibilityCPU,
  transportSolidBoundaryQueryCPU,
  transportTerminalDisplacementCPU,
  transportOpticalNormal,
  transportTraceCPU,
  type TransportQueryFn,
} from "./surface-transport-fixture";
import type {
  TransportBoundaryKind,
  TransportBoundaryResult,
  TransportFiniteBoundaryResult,
  TransportFiniteQueryFn,
  TransportFixtureSystem,
  TransportTraceStatus,
} from "./surface-transport-fixture";
import type {
  HybridSchedule,
  FourDColorMode,
  Rotation4,
  SymmetryParams,
  Transform,
  Transform4,
  Vec3,
  Vec4,
} from "../../fractal/types";
import { clamp } from "../../fractal/vec";
import {
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_TINT,
  DEFAULT_FOG_TINT_STRENGTH,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SURFACE_COLOR_SPEED,
  DEFAULT_SURFACE_ENV_LIGHT,
  SURFACE_COLOR_SOURCES,
} from "../state";
import {
  createGpuFlameBackend,
  createGpuFlameBackend4,
} from "../flame-gpu-backend";
import { FLAME_FILTER_RADIUS } from "../flame-worker-core";
import { surfaceCondensationKernelSpec } from "./condensation";
import { runSurfaceEmitterOnlyAgreement } from "./condensation-emitter-only";
import { runSphereInversionBench } from "./sphere-inversion-legs";
import {
  resolveSphereInversion,
  sphereInversionGenerationSlots,
} from "../../fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionDE,
} from "../../fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  sphereInversionContains,
  sphereInversionSignedDistance,
} from "../../fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  sphereInversionContains4,
  sphereInversionSignedDistance4,
} from "../../fractal/sphere-inversion-de-4d";
import {
  packSphereInversionGpuTables,
  SPHERE_INVERSION_GPU_SLACK,
} from "../../fractal/surface-sphere-inversion-gpu";
import {
  packSphereInversion4GpuParams,
  packSphereInversionGpuParams,
} from "../../fractal/surface-de-gpu";
import type {
  SiTimingSubject,
  SphereInversionBenchResults,
} from "./sphere-inversion-legs";
import type {
  FlameAccumBackend,
  GpuBackendRequest,
  GpuBackendRequest4,
} from "../flame-worker-core";
import { wSupport } from "../rotor4";
import {
  SURFACE_COMPUTE_INITIAL_RAY_STEP_US,
  SURFACE_COMPUTE_TRANSPORT_RECORD_BYTES,
  SURFACE_COMPUTE_TRANSPORT_POOL_SLOTS,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  SurfaceComputeRenderer,
  setSurfaceComputeSchedulePins,
  surfaceComputeJointArenaBytes,
  SURFACE_COMPUTE_JOINT_RAY_BYTES,
} from "../surface-compute";
import type {
  SurfaceComputeAnyTarget,
  SurfaceComputeFrame,
  SurfaceComputeFrameSpec,
  SurfaceComputeTarget,
} from "../surface-compute";
import { SPHERE_INVERSION_GLASS_MAX_DEPTH } from "../surface-optics-backend";
import type { SurfaceMaterialSlots } from "../../fractal/surface-material-wire";
import {
  sphereInversionShadeSlots,
  surfaceForwardSlot,
  surfaceSlotColors,
  surfaceSlotMaterials,
  surfaceTrapIndices,
} from "../surface-slots";

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
  /** Total-variation distance between the NORMALIZED CPU/GPU downsampled hit
   * fields. Unlike tone-mapped MAE this measures density directly, before
   * log compression and color can hide a localized mass redistribution. */
  densityTv: number;
  /** Optional scenario-owned density bar. Absent for the historic scenarios,
   * whose image noise floors were calibrated before this metric existed; the
   * overlapping-emitter controlled pair sets it explicitly. */
  densityTvThreshold?: number;
  /** `maxHits` of the ACCUMULATION (not display) histograms. */
  maxHitsCpu: number;
  maxHitsGpu: number;
  /** The MAE bar `pass` was judged against — `AGREEMENT_MAE_THRESHOLD`
   * unless the scenario overrides it (see `ScenarioDef3D.maeThreshold`);
   * recorded so results.json shows the ruler, not just the verdict. */
  maeThreshold: number;
  /** `maeRGB < maeThreshold && every |biasRGB| <
   * AGREEMENT_BIAS_THRESHOLD`, plus `densityTv < densityTvThreshold` when the
   * scenario owns that optional bar — the agreement CHECK, not just a report;
   * see `computeAgreement` for how this rolls up into the top-level verdict. */
  pass: boolean;
}

/**
 * The adaptive density-estimate agreement leg's metrics — the GPU
 * `adaptiveDisplay` gather against `adaptiveDownsampleFlame` fed the exact
 * SAME resident histogram and params (see `runAdaptiveDisplayCheck`'s doc).
 * An EXACTNESS check modulo f32 rounding like {@link
 * DisplayDownsampleMetrics}, but over a GATHER whose footprint is thousands
 * of taps wide rather than a short fixed kernel, so its tolerance is looser
 * and MEASURED (see the constants below).
 */
interface AdaptiveDisplayMetrics {
  /** Largest |gpu - cpu| observed over every `hits` bucket. */
  maxAbsHitsError: number;
  /** Largest |gpu - cpu| observed over every `sumRGB` channel. */
  maxAbsColorError: number;
  /** Largest per-bucket hits error relative to `max(|cpu|, floor)`. */
  maxRelHitsError: number;
  /** Largest per-channel color error relative to `max(|cpu|, floor)`. */
  maxRelColorError: number;
  /** |gpu.maxHits - cpu.maxHits| / cpu.maxHits (or |gpu.maxHits| at 0). */
  maxHitsRelError: number;
  /** |gpu.hitMass - cpu.hitMass| / cpu.hitMass (or |gpu.hitMass| at 0). */
  massRelError: number;
  /** Summed wall ms of the CPU oracle over this arm's param sets. */
  cpuMs: number;
  /** Summed wall ms of `adaptiveDisplay` (readback + convert included). */
  gpuMs: number;
  /** Bands the GPU pass reported progress for (summed; always >= 1). */
  bands: number;
  /** Every error within its measured tolerance AND progress reaching its
   * total exactly. */
  pass: boolean;
}

/**
 * The display-downsample agreement leg's metrics — comparing the GPU
 * `snapshotDisplay` kernel's output against `downsampleFlame` fed the exact
 * SAME resident histogram (see `compareDisplayDownsample`'s doc). An
 * EXACTNESS check modulo f32 rounding, not a statistical one like
 * {@link ComparisonMetrics} — hence the much tighter tolerances `pass`
 * above applies.
 */
interface DisplayDownsampleMetrics {
  /** Largest |gpu - cpu| observed over every `hits` bucket. */
  maxAbsHitsError: number;
  /** Largest |gpu - cpu| observed over every `sumRGB` channel. */
  maxAbsColorError: number;
  /** |gpu.maxHits - cpu.maxHits| / cpu.maxHits (or |gpu.maxHits| when
   * cpu.maxHits is exactly 0). */
  maxHitsRelError: number;
  /** |gpu.hitMass - cpu.hitMass| / cpu.hitMass (or |gpu.hitMass| when
   * cpu.hitMass is exactly 0). Nearly free as an extra leg: both sides
   * derive their tone-map anchor from the same arrays (the mass is the sum
   * of the converted/downsampled `hits` — see `FlameHistogram.hitMass`), so
   * mass agreement is the tone-map agreement's PRECONDITION, and the old
   * dispatch-rounding worry (GPU workgroup-order accumulation vs a single
   * CPU running sum) is gone — the mass is recomputed host-side from the
   * readback arrays on both engines, identically. */
  massRelError: number;
  /** Every hits/sumRGB bucket within `max(1e-6, 1e-4 * max(|cpu|, 1))`, AND
   * `maxHitsRelError <= 1e-4` AND `massRelError <= 1e-4`. */
  pass: boolean;
}

/**
 * The GPU display-downsample's acceptance-evidence measurement: how much
 * cheaper a progressive redisplay tick is with the new resident-buffer
 * downsample (`snapshotDisplay`, readback + convert already included) than
 * with the old full-histogram-readback path (`snapshot` + CPU
 * `downsampleFlame`) — see `measureRedisplayCost`'s doc.
 */
interface RedisplayCostMetrics {
  /** Mean ms of `snapshot()` (readback + convert already included) + CPU
   * `downsampleFlame`, over several reps. */
  oldMs: number;
  /** Mean ms of `snapshotDisplay()` (readback + convert already included),
   * over the same number of reps. */
  newMs: number;
  /** `newMs / oldMs` — the new path's cost as a fraction of the old path's;
   * moving the downsample onto the GPU is only worth it if this lands well
   * under 1. */
  ratio: number;
}

interface ScenarioResultRecord {
  name: string;
  cpu: TimedResult;
  gpu: TimedGpuResult | SkippedResult;
  comparison: ComparisonMetrics | SkippedResult;
  /** The display-downsample agreement leg — see
   * `DisplayDownsampleMetrics`'s doc. Skipped under the exact same condition
   * as `comparison` (no GPU backend at all this run). */
  displayDownsample: DisplayDownsampleMetrics | SkippedResult;
  /** See `RedisplayCostMetrics`'s doc — this scenario's measured
   * redisplay-cost ratio, the GPU downsample's acceptance evidence. */
  redisplayCost: RedisplayCostMetrics | SkippedResult;
}

interface BenchResults {
  backendSmoke?: { pass: boolean; scenarios: string[]; wallMs: number };
  userAgent: string;
  timestamp: string;
  adapter: BenchAdapterInfo | null;
  scenarios: ScenarioResultRecord[];
  /** A standalone ss=1 (no supersample) display-downsample agreement
   * check — every `scenarios` entry runs at the same ss=2 accumulation (see
   * `ACCUM_WIDTH`/`ACCUM_HEIGHT`), so this is the only leg exercising
   * `downsampleFlame`'s (and the GPU kernel's) scale-1 pass-through path —
   * see `runSs1DisplayDownsampleCheck`'s doc.
   */
  ss1DisplayDownsample: DisplayDownsampleMetrics | SkippedResult;
  /** The standalone adaptive density-estimate agreement check — one arm per
   * dimension (`runAdaptiveDisplayCheck`'s doc). "skipped" until a full
   * sweep runs; a single arm can be skipped independently (e.g. a 4D
   * backend failure's `describeError`), which the agreement rollup treats
   * as "not certified" rather than "passed". */
  adaptiveDisplay: {
    d3: AdaptiveDisplayMetrics | SkippedResult;
    d4: AdaptiveDisplayMetrics | SkippedResult;
  };
  /** "fail" iff any scenario's `comparison.pass`/`displayDownsample.pass`, or
   * the standalone `ss1DisplayDownsample.pass`, or either adaptive-display
   * arm, is `false`; "pass" only once every one of those has actually run
   * and all passed — including vacuously "skipped" before any scenario has
   * run, or when every GPU leg was skipped (no WebGPU in this browser: see
   * `computeAgreement`'s doc for why that is deliberately NOT a failure). */
  agreement: "pass" | "fail" | "skipped";
  /** The surface-DE WGSL kernel section (`runSurfaceDeSection`) —
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
    /** Runner-visible name of the scenario/standalone leg currently active. */
    __BENCH_ACTIVE__?: string | null;
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
  /** Optional production balloon payload. One scenario carries it so the
   * equal-N CPU/GPU image agreement gate covers the weighted second splat,
   * tint, and f32 inversion floor instead of only compiling that branch. */
  balloonEcho?: FlameBalloonEcho;
  /** Independent echo gradient. Present on the balloon scenario so the
   * agreement gate also pins source-radius lookup before tint/weight. */
  balloonPaletteId?: Exclude<FlamePaletteId, "legacy">;
  /**
   * Optional scheduled-hybrid post-word block (`types.ts`'s
   * `HybridSchedule`): B's affine maps + depth, fed identically to the CPU
   * oracle's `prepareChaosGame` and the GPU packer, so the agreement gate
   * pins the kernel's plot-time schedule stage — its per-level draw, the
   * post-word -> lens order, and the appended B slots.
   */
  schedule?: HybridSchedule;
  /** Optional plot-time image plan, shared by the CPU oracle and production
   * backend. Finite images compose with symmetry and Balloon. */
  pointTilingPlan?: PointTilingPlan;
  /**
   * Per-scenario override of `AGREEMENT_MAE_THRESHOLD`. The equal-N MAE
   * between two INDEPENDENT samplings of the same attractor never reaches 0
   * — it has a Monte-Carlo noise floor that is a property of the SCENARIO
   * (how much of the frame is sparse, few-hits-per-bucket haze, where one
   * hit of shot noise is a large tone-mapped delta), not of the kernels.
   * The compact-filament presets floor around ~0.3 (measured in the GPU
   * flame-accumulation spike), which is what the default threshold's 1.0
   * was calibrated against; a diffuse scenario with a higher measured floor
   * documents it and overrides here rather than loosening the bar for
   * everyone.
   */
  maeThreshold?: number;
  /** Optional normalized-hit-field total-variation bar. See
   * {@link ComparisonMetrics.densityTv}: intended for a scenario whose defect
   * is a local density redistribution that the tone-map can compress away. */
  densityTvThreshold?: number;
}

/**
 * A 4D scenario: a 3D-authored preset lifted per-map through
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
  /** Kaleidoscope symmetry (the 4D kaleidoscope lit this path) — spelled
   * out per scenario exactly like {@link ScenarioDef3D.symmetry}, so an
   * order-1 leg says so rather than defaulting silently. */
  symmetry: SymmetryParams;
  rotation: Rotation4;
  paletteId: FlamePaletteId;
  colorMode: FourDColorMode;
  /** Shared Height/Radius/Position contrast exponent. */
  colorGamma?: number;
  /** Position mode's custom XYZ axis colors. */
  positionAxisColors?: PositionAxisColors;
  /** The "radius" color mode's ramp palette — the `fourD` start block's
   * `rampPalette`, minus the custom-payload arm the bench doesn't author.
   * Omitted = `"legacy"` (the built-in warm→cool ramp); only the radius
   * mode reads it. */
  rampPalette?: FlamePaletteId;
  sliceOn: boolean;
  sliceCenter: number;
  sliceWidth: number;
  sliceRelativeColor: boolean;
  /** Add the production echo around the explorer cloud's exact 4D enclosing
   * ball after rotor projection. The ball itself is derived in prepare4D,
   * where the cloud and its centre/radius are available. */
  balloonEcho?: Omit<FlameBalloonEcho, "balloon"> & {
    radiusMultiple: number;
  };
  /** Independent echo gradient; same contract as the 3D field. */
  balloonPaletteId?: Exclude<FlamePaletteId, "legacy">;
  /** See {@link ScenarioDef3D.schedule} — same block, one dimension up:
   * the flat 3D form both the 4D prepare and the 4D packer lift through
   * `toTransform4`. */
  schedule?: HybridSchedule;
  /** True raw-xyzw point images before the frozen bench tumble/slice. */
  pointTilingPlan?: PointTilingPlan;
  /** Certified origin ball for finite Balloon agreement. This also pins the
   * production tiled rotor pivot and signed-w amplitude independently of the
   * sampled explorer cloud used by historical scenarios. */
  pointTilingOriginRadius?: number;
  /** See {@link ScenarioDef3D.maeThreshold} — same scenario-owned noise
   * floor override, one dimension up. */
  maeThreshold?: number;
  /** See {@link ScenarioDef3D.densityTvThreshold}. */
  densityTvThreshold?: number;
}

type ScenarioDef = ScenarioDef3D | ScenarioDef4D;

const SIERPINSKI_CAMERA: Pick<ScenarioDef3D, "cameraPos" | "lookAt"> = {
  cameraPos: [2.5, 1.8, 2.5],
  lookAt: [0, 0.4, 0],
};

/** The preset re-centers Barnsley's coordinates (FERN_SCALE 0.3 around
 * FERN_CENTER — see presets.ts), so the fern spans roughly ±0.75 x ±1.5
 * around the origin; a straight-on close camera frames it fully. Shared by
 * the two fern scenarios (`fern` and `xform-color`), which differ
 * only in their color authoring — the same framing keeps them visually
 * comparable in the bench's own screenshots. */
const FERN_CAMERA: Pick<ScenarioDef3D, "cameraPos" | "lookAt"> = {
  cameraPos: [0, 0, 4.2],
  lookAt: [0, 0, 0],
};

function benchPointTilingPlan(
  dimension: 3 | 4,
  kind: "finite" | "lattice",
  opts: { cellScale?: number; empty?: boolean } = {},
): PointTilingPlan {
  // Every active agreement leg carries a packed analytic clip. The ordinary
  // fixture uses a deliberately generous ball so the clip branch is live
  // without changing the carrier under test; the empty leg moves that same
  // ball away from the whole attractor.
  const clip = {
    parts: [
      {
        primitive: { kind: "sphere" as const, radius: opts.empty ? 0.25 : 4 },
        combine: "union" as const,
        ...(opts.empty ? { pose: { offset: [100, 100, 100] as Vec3 } } : {}),
      },
    ],
  };
  const resolved =
    kind === "finite"
      ? resolveTiling({ group: dimension === 3 ? "a3" : "f4", clip })
      : resolveTiling(
          { kind: "lattice", cellScale: opts.cellScale ?? 1, clip },
          2,
        );
  const plan = resolvePointTilingPlan(resolved, dimension);
  if (!plan) throw new Error("GPU bench point-tiling plan did not resolve");
  return plan;
}

/** Two contractive 4D maps whose whole attractor sits strictly inside the
 * frozen F4 chamber. That makes the maximal-order bench leg concentrated
 * rather than waiting roughly 1/1152 attempts for an unrelated preset to
 * wander into canonical content. The two fixed points differ in every axis,
 * including w, so the replicated images still exercise the true F4 action. */
function f4ChamberDust(): Transform[] {
  const scale = 0.16;
  const fixedPoints: Vec4[] = [
    [0.085, 0.16, 0.395, 0.89],
    [0.1, 0.175, 0.41, 0.905],
  ];
  return fixedPoints.map((point, id) => ({
    id,
    position: [
      (1 - scale) * point[0],
      (1 - scale) * point[1],
      (1 - scale) * point[2],
    ],
    rotation: [0, 0, 0],
    scale: [scale, scale, scale],
    w: { position: (1 - scale) * point[3], scale },
    colorIndex: id,
  }));
}

/** The widest legal point-family composition: an emitter table (including a
 * catalog mesh), non-trivial xaos rows, a scheduled affine post-word, a final
 * lens, an analytic clip and finite image selection. Separate scenarios pin
 * the finite Balloon and kaleidoscope compositions. */
function tiledMultiSystem(): Transform[] {
  const chaosRows = [
    [1, 0.25, 0.05],
    [0.1, 1, 0.2],
    [0.3, 0.15, 1],
  ];
  return emitterMenagerie().map((transform, index) => ({
    ...transform,
    chaos: chaosRows[index],
  }));
}

const TILED_MULTI_SYSTEM_FINAL: Transform = {
  id: 90,
  position: [0.05, -0.04, 0.02],
  rotation: [0.08, -0.05, 0.12],
  scale: [0.92, 0.88, 0.9],
};

const TILED_MULTI_SYSTEM_SCHEDULE: HybridSchedule = {
  transforms: [
    {
      id: 91,
      position: [-0.12, 0.02, 0],
      rotation: [0, 0, 0.1],
      scale: [0.84, 0.8, 0.82],
    },
    {
      id: 92,
      position: [0.14, -0.03, 0.02],
      rotation: [0, 0, -0.08],
      scale: [0.8, 0.86, 0.83],
    },
  ],
  depth: 2,
};

/** A fixed w-mixing tumble shared by the 4D scenarios — three plane angles
 * chosen to genuinely rotate w into view (nonzero xw/yw/zw), so the
 * projected cloud, the signed-w signal, and therefore the wRamp/slice legs
 * all actually depend on the 4D machinery rather than degenerating to a
 * w-dropped 3D render. */
const BENCH_TUMBLE: Rotation4 = { xy: 0.35, xw: 0.65, yw: 0.4, zw: 0.55 };

/** The overlapping-emitter pair's direct density gate. Reduced 5M-iteration,
 * 480x270-display CPU controls read 0.0094-0.0097 in both dimensions; an
 * intentionally UNCORRECTED part mixture reads 0.078-0.080. The real equal-N
 * leg has ten times as many samples, so 0.03 keeps generous shot-noise margin
 * while still refusing the old unconditional sampler by more than 2.5x.
 * The corrected 50.3M equal-N SwiftShader run measured 0.005883 in 3D and
 * 0.005872 in 4D (2026-08-26), both comfortably below the control-derived
 * bar. */
const EMITTER_OVERLAP_DENSITY_TV_THRESHOLD = 0.03;

/**
 * The "variation zoo" — three contractive maps that between them
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
 * A gentle final-transform lens (small rotation, mild sinusoidal
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

/** The zoo lifted to 4D — the same three maps with w-mixing blocks
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

/** The measured five-family flam3 fidelity batch. Each map keeps a linear
 * contraction beside the new warp so the equal-N image comparison measures
 * formulas and packing rather than an escape-dominated cloud. Bipolar and
 * PDJ use non-classic parameters; the rings map has a nonzero pre-affine x
 * translation because flam3 var21 reads that transform coefficient. */
function exactFlam3Batch(): Transform[] {
  return [
    {
      id: 0,
      position: [0.38, 0.12, 0.16],
      rotation: [0.12, -0.08, 0.2],
      scale: [0.38, 0.34, 0.36],
      weight: 1.2,
      variations: [
        { type: "linear", weight: 0.55 },
        { type: "bipolar", weight: 0.16, bipolarShift: 0.37 },
        { type: "diamond", weight: 0.22 },
      ],
    },
    {
      id: 1,
      position: [-0.34, 0.28, -0.14],
      rotation: [-0.18, 0.11, -0.16],
      scale: [0.35, 0.39, 0.33],
      weight: 0.9,
      variations: [
        { type: "linear", weight: 0.5 },
        { type: "ex", weight: 0.18 },
        {
          type: "pdj",
          weight: 0.2,
          pdjA: 1.3,
          pdjB: -0.7,
          pdjC: 2.1,
          pdjD: -1.6,
        },
      ],
    },
    {
      id: 2,
      position: [0.27, -0.32, 0.2],
      rotation: [0.14, 0.2, -0.1],
      scale: [0.32, 0.36, 0.35],
      weight: 1.5,
      variations: [
        { type: "linear", weight: 0.58 },
        { type: "rings", weight: 0.28 },
      ],
    },
  ];
}

/** {@link exactFlam3Batch} one dimension up. Every map authors a distinct
 * w block and the frozen tumble also mixes w, so this is a genuine 4D
 * agreement leg rather than a w=0 replay of the 3D one. */
function exactFlam3Batch4(): Transform[] {
  const [t0, t1, t2] = exactFlam3Batch();
  return [
    { ...t0, w: { position: 0.18, scale: 0.72, rotation: { xw: 0.34 } } },
    { ...t1, w: { position: -0.22, scale: 0.64, rotation: { yw: -0.28 } } },
    { ...t2, w: { position: 0.12, scale: 0.58, rotation: { zw: 0.31 } } },
  ];
}

/**
 * The "fold zoo" — three contractive maps, each pairing one of the
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

/** The fold zoo lifted to 4D — the same three maps with w-mixing
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
 * {@link foldZoo}'s geometry with AUTHORED fold lengths — the
 * `fold-zoo` scenario's controlled pair, differing in the fold's radii and
 * nothing else (the same idiom `xformColorFern` plays against `fern`).
 * Both flame kernels reach the fold through `composeVariations`, which has
 * read these lengths since the authored-lengths CPU half landed, so without
 * a non-classic scenario the GPU arm could keep the classic constants and
 * agree with its oracle on every fixture here — while the app rendered one
 * object on a machine with a WebGPU adapter and another on a machine
 * without.
 *
 * One fold per map, each parameterized DIFFERENTLY, because the flame wire
 * is a per-TYPE lane (`foldRadii: array<vec4f, 3>`, indexed by variation
 * type minus 12): the boxfold map carries the wall alone, the spherefold
 * map the sphere pair alone, and the mandelbox map all three. A kernel
 * that indexed the wrong lane reads an untouched one — zeros, not the
 * classic set — and a kernel that read slot 0's lane for every slot gets
 * three maps' worth of one map's lengths. The `linear` blend partner on
 * each map is left exactly as `foldZoo` authored it: it takes no radii and
 * exists to keep the attractor bounded.
 */
function foldZooParameterized(): Transform[] {
  const radii = [
    { boxLimit: 0.75 },
    { minRadius: 0.375, fixedRadius: 0.8 },
    { minRadius: 0.25, fixedRadius: 0.6, boxLimit: 1.5 },
  ];
  return foldZoo().map((t, i) => ({
    ...t,
    variations: (t.variations ?? []).map((v) =>
      v.type === "linear" ? v : { ...v, ...radii[i] },
    ),
  }));
}

/** The parameterized fold zoo lifted to 4D, with `foldZoo4`'s own
 * w-mixing blocks verbatim — so the 4D kernel's per-type fold lanes are
 * read over genuinely 4D orbits (the full 4D radius/box, not a w = 0
 * slice), the same relationship `foldZoo4` has to `foldZoo`. */
function foldZooParameterized4(): Transform[] {
  const [t0, t1, t2] = foldZooParameterized();
  return [
    { ...t0, w: { rotation: { xw: 0.4 } } },
    { ...t1, w: { position: 0.25, rotation: { yw: 0.3 } } },
    { ...t2, w: { scale: 0.55 } },
  ];
}

/**
 * The authored flam3 color pairs, one per Barnsley map, in
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
 * the `xform-color` scenario's system. The geometry is the stock
 * preset, deliberately: keeping it identical to the `fern` scenario's makes
 * the two entries a controlled pair, differing in the color authoring and
 * nothing else. */
function xformColorFern(): Transform[] {
  return barnsleyFern().map((t, i) => ({ ...t, ...XFORM_COLOR_PAIRS[i] }));
}

/**
 * The shape-emitter menagerie: two simple contractions (id 0/1, plain
 * affine, no variations) plus one multi-part emitter transform (id 2) whose
 * `ShapeSpec` carries the FIVE primitives {@link gearworks}'s GEAR_SHAPE
 * -only fixture never reaches — sphere, box, torus, capsule, and the
 * catalog star-prism mesh. The original five islands remain separated, but a
 * SECOND radius-0.25 sphere at x=0.65 overlaps the original x=0.55 sphere
 * strongly. Their centre distance is 0.10: the analytic lens occupies 70.4%
 * of either sphere and 54.32% of their union. Because the duplicate is part
 * 1, the CPU sampler rejects 70.4% of its proposals through min-index
 * acceptance. It owns 14.46% of this six-part spec's measure, making 10.18%
 * of emitter proposals (6.11% of all map picks) genuine overlap rejections —
 * material enough that the density-TV gate refuses an unconditional device
 * sampler while the other four primitive islands retain their original
 * coverage. The emitter transform's own weight
 * (3, against the two unit-weight contractions) keeps most plotted points a
 * recent emitter stamp, so a wrong sampler or a wrong part-pick weight
 * restructures the frame rather than hiding in a rarely-visited corner of it
 * — `emitter-gearworks`'s own reasoning, one primitive count wider.
 */
function emitterMenagerie(): Transform[] {
  return [
    {
      id: 0,
      position: [0.55, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      // Ignored by the 3D preparation; makes this SAME controlled system's
      // 4D lift contract and rotate w instead of degenerating to a flat cloud.
      w: { position: 0.12, scale: 0.55, rotation: { xw: 0.25 } },
    },
    {
      id: 1,
      position: [-0.55, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.12, scale: 0.5, rotation: { yw: -0.3 } },
    },
    {
      id: 2,
      position: [0, 0, 0],
      rotation: [0.3, 0.4, 0.15],
      scale: [0.6, 0.6, 0.6],
      weight: 3,
      w: { position: 0.05, scale: 0.6, rotation: { zw: 0.4 } },
      emitter: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.25 },
            combine: "union",
            pose: { offset: [0.55, 0, 0] },
          },
          {
            // Same primitive measure as part 0, shifted by only 0.10: the
            // analytic overlap witness documented above.
            primitive: { kind: "sphere", radius: 0.25 },
            combine: "union",
            pose: { offset: [0.65, 0, 0] },
          },
          {
            primitive: { kind: "box", half: [0.2, 0.15, 0.1] },
            combine: "union",
            pose: { offset: [-0.55, 0, 0] },
          },
          {
            primitive: { kind: "torus", major: 0.35, minor: 0.1 },
            combine: "union",
            pose: { offset: [0, 0.55, 0], rotate: [Math.PI / 2, 0, 0] },
          },
          {
            primitive: {
              kind: "capsule",
              a: [0, -0.15, 0],
              b: [0, 0.15, 0],
              radius: 0.12,
            },
            combine: "union",
            pose: { offset: [0, -0.55, 0], rotate: [0, 0, Math.PI / 6] },
          },
          {
            primitive: { kind: "mesh", meshId: "star-prism-v1" },
            combine: "union",
            // The catalog asset's radius is ~1.04; this scale keeps its
            // +z island disjoint from all five solid parts while leaving
            // enough area-weighted picks to make kind 5 statistically live.
            pose: {
              offset: [0, 0, 0.55],
              rotate: [0.2, 0.35, 0.1],
              scale: 0.18,
            },
          },
        ],
      },
    },
  ];
}

function finiteTilingBalloon3DBall(): Balloon {
  const transforms = sierpinskiTetrahedron();
  const symmetry: SymmetryParams = { order: 3, plane: "xy" };
  const de = buildSurfaceDE(transforms, null, symmetry);
  return buildBalloonFromBall(
    { center: [0, 0, 0], radius: surfaceOriginVisibleRadius(de) },
    0.55,
  );
}

const SCENARIOS: ScenarioDef[] = [
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "sierpinski",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-finite-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "spectrum",
    pointTilingPlan: benchPointTilingPlan(3, "finite"),
    // Pins chamber membership, credit banking, finite matrix images and
    // source-owned structural color through the active binding-8 kernel.
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-symmetry-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 3, plane: "xy" },
    paletteId: "spectrum",
    pointTilingPlan: benchPointTilingPlan(3, "finite"),
    // The ordinary orbit includes cyclic symmetry before canonical
    // membership. Moving symmetry after tiling changes the rendered set.
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-balloon-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 3, plane: "xy" },
    paletteId: "spectrum",
    pointTilingPlan: benchPointTilingPlan(3, "finite"),
    balloonEcho: {
      balloon: finiteTilingBalloon3DBall(),
      tint: [0.15, 0.75, 0.3],
      tintStrength: 0.35,
      weight: 1,
    },
    balloonPaletteId: "aurora",
    // Four full-budget CPU seeds give six noise pairs: MAE 1.78856–1.79456,
    // density TV 0.01913–0.01927. Both bars exceed twice that noise floor;
    // the shared signed-bias bar stays 0.3. Same-camera missing-echo and
    // missing-tiling controls measure MAE 12.19080 / 8.65134 and density TV
    // 0.13180 / 0.18016, so both features remain independently detectable.
    // Reproduce: flame-tiling-symmetry-noise.verify.mjs
    // --scenario=tiling-balloon-3d --seeds=4.
    maeThreshold: 4.0,
    densityTvThreshold: 0.04,
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-lattice-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "aurora",
    pointTilingPlan: benchPointTilingPlan(3, "lattice"),
    // Minimum cell scale: analytic x/z images, quantized proposal CDF and
    // 8R->10R coverage in the production kernel.
    // Measured Iris equal-N noise floor is 0.940 MAE: the wide repeated
    // carrier leaves many low-density colored pixels. Two is a little over
    // twice that floor while retaining a useful divergence bar.
    maeThreshold: 2,
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-lattice-max-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "aurora",
    pointTilingPlan: benchPointTilingPlan(3, "lattice", { cellScale: 4 }),
    // The opposite authored scale boundary from the minimum-scale leg. The
    // same active kernel reads a smaller packed cell/CDF table and a wider h.
    maeThreshold: 2,
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "tiling-empty-3d",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "spectrum",
    pointTilingPlan: benchPointTilingPlan(3, "finite", { empty: true }),
    // A valid, packed analytic clip excludes the entire source. Both engines
    // must complete with a genuinely empty accumulation and never deposit the
    // untiled attractor as a fallback.
  },
  {
    kind: "3d",
    name: "tiling-multisystem-3d",
    transforms: tiledMultiSystem(),
    finalTransform: TILED_MULTI_SYSTEM_FINAL,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "spectrum",
    schedule: TILED_MULTI_SYSTEM_SCHEDULE,
    cameraPos: [0, 0, 5],
    lookAt: [0, 0, 0],
    pointTilingPlan: benchPointTilingPlan(3, "finite"),
    // The maximum legal composition keeps binding 7's real emitter prefix
    // live while its appended tiling plan follows xaos, schedule and lens.
    maeThreshold: 2,
  },
  {
    ...FERN_CAMERA,
    kind: "3d",
    name: "fern",
    transforms: barnsleyFern(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "ember",
    // The controlled balloon leg for the 3D kernel. R = 0.9 rho keeps both
    // source and echo substantially on-screen under the source-fit camera.
    balloonEcho: {
      balloon: { center: [0, 0, 0], rho: 1.8, R: 1.62 },
      tint: [0.15, 0.7, 1],
      tintStrength: 0.4,
      weight: 1,
    },
    balloonPaletteId: "aurora",
  },
  {
    ...FERN_CAMERA,
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
    // Uniquely pins: the per-transform colorIndex/colorSpeed pair
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
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "kaleido",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 5, plane: "xz" },
    paletteId: "aurora",
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
    // Measured equal-N noise floor (control experiment): the CPU
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
    // Uniquely pins: all 12 VariationTypes in the 3D WGSL kernel
    // (see variationZoo's doc), the 3D kernel's WEIGHTED transform pick
    // (sierpinski/fern/swirl/kaleido above are all uniform-weight systems),
    // and the 3D final-transform lens slot — none of which any other 3D
    // scenario here exercises.
  },
  {
    kind: "3d",
    name: "exact-flam3-batch",
    transforms: exactFlam3Batch(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "spectrum",
    cameraPos: [0.95, 0.57, 1.1],
    lookAt: [0, 0, 0.08],
    // Authoritative Iris agreement measured density TV 0.000787. The image
    // is compact, so density — normalized independently of framing — is the
    // direct formula-divergence ruler; 0.02 leaves >25x noise margin while a
    // wrong map affecting one of three selected slots redistributes real mass.
    densityTvThreshold: 0.02,
    // Uniquely pins all five appended variation cases, both shared parameter
    // packs, split old/extra lane lookup, and rings' live rowX.w coefficient.
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
    // Measured equal-N noise floor: CPU-vs-GPU maeRGB on SwiftShader is
    // 1.469, stable bit-for-bit across repeated runs (integer atomic
    // accumulation has no run-to-run float-order variance). 3.0 = roughly 2x
    // that measured value, per the standing threshold procedure.
    maeThreshold: 3.0,
    // Uniquely pins: the three Mandelbox fold variations
    // (boxfold/spherefold/mandelbox) in the 3D WGSL kernel — see foldZoo's
    // doc — which no other 3D scenario here exercises.
  },
  {
    kind: "3d",
    name: "fold-zoo-parameterized",
    transforms: foldZooParameterized(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
    // Frames this attractor's mass (probed at 400k points: x ∈ [-0.96,
    // 1.07], y ∈ [-1.78, 1.27], z ∈ [-0.67, 1.41] at the 1%-99%
    // percentiles). Its own camera, not fold-zoo's: authored lengths make
    // a DIFFERENT object, which is the whole point of the pair — the same
    // affine parts land a more compact, differently-centered cloud.
    cameraPos: [3.8, 1.9, 4.4],
    lookAt: [0.05, -0.25, 0.35],
    // Measured equal-N noise floor: 1.411, by the CONTROL-EXPERIMENT
    // procedure (the CPU oracle against ITSELF at two seeds, 0xc0ffee vs
    // 0xbadcafe, 50.3M iterations each through this exact
    // camera/downsample/tonemap pipeline) rather than the fold zoo's
    // CPU-vs-GPU reading — a fixture can be authored without an adapter,
    // and the two measure the same quantity for an agreeing kernel. The
    // procedure is calibrated on the sibling: the same control run on
    // `fold-zoo` reads 1.455 against the 1.469 its own comment records
    // CPU-vs-GPU. 3.0 = ~2x the floor, the same bar (and the same
    // doubling procedure) fold-zoo carries.
    maeThreshold: 3.0,
    // Uniquely pins: the fold family's AUTHORED lengths in the
    // 3D WGSL kernel — its per-type `foldRadii` lanes, packed and indexed
    // — see foldZooParameterized's doc. Every other fold scenario here
    // leaves all three absent, so between them they only ever exercise
    // the classic 0.5/1/1 the kernel could equally have kept hard-coded.
  },
  {
    kind: "3d",
    name: "schedule-sponge",
    transforms: barnsleyFern(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "moss",
    // The scheduled-hybrid post-word: the sponge-of-ferns composition —
    // every plotted fern point bent through 2 random sponge maps, one
    // cell weighted so the kernel's WEIGHTED schedule search (not just the
    // uniform fast path) is what agreement pins. Depth 2 keeps 400 ferns
    // at 1/9 scale — small enough to exercise the k-loop, large enough
    // that a wrong pick/order restructures the whole frame.
    schedule: {
      transforms: mengerSponge().map((t, i) =>
        i === 0 ? { ...t, weight: 3 } : t,
      ),
      depth: 2,
    },
    // The composed arrangement spans the sponge's own [-0.75, 0.75] box
    // (each fern copy ~0.17 tall at depth 2) — a straight-on camera at
    // z 3 frames it fully.
    cameraPos: [0, 0, 3],
    lookAt: [0, 0, 0],
    // Measured equal-N reading: CPU-vs-GPU maeRGB on SwiftShader is 0.334
    // (integer atomics, stable per seed). 2x that (0.67) is below the
    // default 1.0 floor, so the threshold stays at the default-equivalent
    // 1.0 rather than tightening below it — fold-zoo-4d's own convention,
    // spelled out for the same reason.
    maeThreshold: 1.0,
    // Uniquely pins: the 3D kernel's plot-time schedule stage — the
    // appended B slots, the per-level rand01 draw, the weighted lower-bound
    // search over B's own cumulative lane, and the post-word running
    // BEFORE the lens adopt (no other scenario carries a schedule).
  },
  {
    kind: "3d",
    name: "chi-isolated",
    transforms: fernSpongeIsolated(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "ember",
    // The xaos reachability preset itself (presets.ts): Barnsley's fern
    // and the Menger sponge conjugated apart into ONE 24-map system whose
    // BLOCK-DIAGONAL chi rows keep them two separate objects — a kernel
    // that ignored the rows would apply every map to everything (sponges
    // budding on fronds) and fail this gate wholesale. The weighted maps
    // (fern 1/85/7/7, sponge 5s) put the chi row draw over a genuinely
    // weighted expanded table, and every chi entry is 0 or 1, both
    // f32-exact — this leg is immune even to table narrowing at the
    // probability level (chi-leak carries the inexact entries).
    //
    // The camera is slightly OFF-AXIS on purpose: the sponge's
    // axis-aligned faces concentrate mass on exact planes, and a
    // straight-on camera maps those onto bucket boundaries, where f64 and
    // f32 convergence tails land in DIFFERENT pixels (the knife-edge
    // false-divergence this item's fixture probe measured: L1 0.35
    // boundary-straddling vs 0.009 mid-bucket); the tilt keeps plane mass
    // off pixel edges. Probed at 400k points: NDC x in [-0.43, 0.53],
    // y in [-0.46, 0.67], 100.0% in frame.
    cameraPos: [0.5, 0.4, 4.8],
    lookAt: [0, 0, 0],
    // Measured equal-N noise floor: 0.057 (the CPU oracle against ITSELF
    // at two seeds, 0xc0ffee vs 0xbadcafe, 50.3M iterations each through
    // this exact camera/downsample/tonemap pipeline — fold-zoo-param's
    // control procedure). 2x that is far below the default 1.0, so the
    // threshold stays at the default-equivalent 1.0 (schedule-sponge's
    // convention).
    maeThreshold: 1.0,
    // Uniquely pins (with chi-leak): the 3D kernel's graph-directed
    // selection — the chaosRows storage table (packChaosRowsTable's
    // transferred totals + cumulative rows), pickSlot's prevBase row draw,
    // and the per-chain selection state riding aux.z. One honest scope
    // note: the equal-N budget gives each of the backend's 65,536 chains
    // only 768 plotted points, so the kernel's 4096-point sub-orbit
    // RE-FUSE never fires inside this agreement leg (the CPU's fires
    // ~12k times; the entry-pick and per-block distributions coincide, so
    // the images still agree) — the re-fuse path runs live in the TIMED
    // leg, whose per-chain counts pass 4096, but its cadence is pinned by
    // unit tests and the CPU oracle, not by this MAE gate.
  },
  {
    kind: "3d",
    name: "chi-leak",
    transforms: fernSpongeLeak(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
    // chi-isolated's sibling with 0.01 in every off-block entry: ~1% of
    // picks cross systems, so the frame carries the leak's transition
    // dust — the image region most sensitive to the row VALUES (a wrong
    // lookup changes P(switch) and restructures the dust wholesale).
    // Legacy palette on purpose: the isolated leg colors through the
    // structural LUT walk, this one through the per-BASE-map palette
    // fold, so between them chi composes with both color paths. The 0.01
    // entries are NOT f32-exact; the packed table's narrowing perturbs
    // each pick probability by ~1e-9 relative — orders of magnitude below
    // this scenario's own shot-noise floor, which is why the equal-N gate
    // needs no f32-exact authoring here (the bit-agreement question lives
    // in the packing unit tests, which pin the narrowed values exactly).
    cameraPos: [0.5, 0.4, 4.8],
    lookAt: [0, 0, 0],
    // Measured equal-N noise floor: 0.562 (the same two-seed CPU control
    // procedure as chi-isolated) — the leak dust is exactly the sparse
    // few-hits-per-bucket haze AGREEMENT_MAE_THRESHOLD's doc names as
    // what raises a scenario's floor. 1.2 = ~2x the floor, fold-zoo-
    // param's doubling convention.
    maeThreshold: 1.2,
  },
  {
    ...SIERPINSKI_CAMERA,
    kind: "3d",
    name: "emitter-gearworks",
    transforms: gearworks(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
    // The shape-emitter (condensation) reachability preset itself
    // (presets.ts): four Sierpinski-tetrahedron corners plus a fifth
    // transform whose slot is a GEAR_SHAPE emitter (weight 1.4 against the
    // four unit corners), so this leg's picked slots hit applySlot's
    // emitter branch on every engine — the derived-stream draw, the
    // slot's OWN affine posing the sample, the gear kind's device
    // triangle-fan-CDF sampler (emitterDrawGear) against the CPU's
    // annulus-rejection one. Legacy palette: gearworks authors per-transform
    // colorIndex pairs (cog vs. structure hue), which only the legacy
    // per-BASE-map palette path reads.
    // Emitters are not chaotic forward orbits (no per-step feedback through
    // a nonlinear map) — plain equal-N agreement holds without the escape
    // legs' classifier machinery, chi-isolated's own reasoning one selection
    // layer over. Measured control floor: the CPU oracle against ITSELF at
    // two seeds (0xc0ffee vs 0xbadcafe) through this exact camera/downsample/
    // tonemap pipeline, at a REDUCED 5M iterations each (a throwaway
    // standalone script, not this file, since the equal-N harness below
    // needs a live backend) — mae 0.461. A smaller N is A NOISIER, so
    // CONSERVATIVELY OVER-ESTIMATED floor relative to this scenario's real
    // 50.3M-iteration equal-N run (shot noise falls with more samples), so
    // 2x it (0.92) is still a safe upper bound at the real scale, and it
    // sits below the default 1.0 — the threshold stays at the
    // default-equivalent 1.0 rather than tightening below it
    // (schedule-sponge's own convention for the identical case).
    maeThreshold: 1.0,
    // Uniquely pins: applySlot's whole emitter branch in BOTH kernels —
    // the derived mulberry32-restated stream (emitterNext), every
    // constant-draw primitive sampler that branch can reach through a
    // shipped preset (here: the gear's host-triangulated triangle-fan
    // CDF), the multi-part pick's degenerate partCount<=1 fast path, and
    // the shared emitterGearTable binding's real-buffer (not aliased) path.
  },
  {
    kind: "3d",
    name: "emitter-menagerie",
    transforms: emitterMenagerie(),
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    paletteId: "legacy",
    // emitter-gearworks's sibling: its single GEAR_SHAPE part never reaches
    // the sphere/box/torus/capsule/mesh device samplers, nor the multi-part
    // pick's weighted search (a partCount<=1 slot skips it outright). This
    // leg's emitter is one ShapeSpec holding all five kinds plus the strongly
    // overlapping second sphere — see emitterMenagerie's doc.
    // Probed via a 200k-point bounds pass (chaos-game's own `bounds`; this
    // system has no escape tail — every emitter sample is exactly bounded —
    // so a plain min/max is as tight a frame as a percentile one would be):
    // The extra sphere extends the old x maximum by only 0.06 after the
    // emitter transform, so the existing camera still frames every island.
    cameraPos: [2.15, 1.55, 2.2],
    lookAt: [0, 0, 0.05],
    // The reduced overlap probe's corrected CPU control reads image MAE 0.024
    // and its deliberately uncorrected mixture only 0.059: BOTH clear 1.0.
    // Keep the default image ruler for the primitive/color branches, and let
    // the direct density statistic below own overlap correctness.
    maeThreshold: 1.0,
    // Image MAE is intentionally NOT the overlap ruler: in the reduced
    // uncorrected control it reads only 0.059 and would clear the global 1.0
    // bar. Normalized hit-field TV reads 0.080 against a 0.0097 two-seed floor.
    densityTvThreshold: EMITTER_OVERLAP_DENSITY_TV_THRESHOLD,
    // Uniquely pins: applySlot's emitter branch over the sphere, box, torus,
    // capsule and mesh device samplers (including emitterDrawMesh's catalog
    // area CDF + 3D triangle record) —
    // none of which emitter-gearworks' single gear part reaches — and the
    // multi-part pick's weighted binary search and bounded min-index overlap
    // acceptance over a partCount > 1 slot (emitterSampleSlot).
  },
  // The 4D legs: between them, all four FourDRenderColor kinds and
  // both slice states; hyperfern/doubleRotation both carry non-1 weights,
  // exercising the 4D kernel's weighted binary-search pick (mirroring the 3D
  // zoo's weighted-pick coverage above). The variation-zoo-4d leg below
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
    // The 4D agreement leg: prepare4D derives the ball from this exact cloud
    // and supplies separate rotor/camera projections, pinning project-then-
    // invert rather than an accidental 4D inversion or composed projection.
    balloonEcho: {
      radiusMultiple: 0.9,
      tint: [1, 0.2, 0.55],
      tintStrength: 0.4,
      weight: 1,
    },
    balloonPaletteId: "spectrum",
  },
  {
    kind: "4d",
    name: "tiling-finite-4d",
    system: f4ChamberDust,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "radius",
    rampPalette: "dusk",
    sliceOn: true,
    sliceCenter: 0.2,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    pointTilingPlan: benchPointTilingPlan(4, "finite"),
    // F4 matrices genuinely mix w before the tumble. Radius stays owned by
    // the canonical source while the soft-slice weight follows each image.
  },
  {
    kind: "4d",
    name: "tiling-balloon-4d",
    system: f4ChamberDust,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange",
    sliceOn: true,
    sliceCenter: 0.2,
    sliceWidth: 0.35,
    sliceRelativeColor: true,
    pointTilingPlan: benchPointTilingPlan(4, "finite"),
    pointTilingOriginRadius: surfaceOriginVisibleRadius(
      buildSurfaceDE4(f4ChamberDust()),
    ),
    balloonEcho: {
      radiusMultiple: 0.55,
      tint: [0.2, 0.65, 0.9],
      tintStrength: 0.4,
      weight: 1,
    },
    balloonPaletteId: "dusk",
  },
  {
    kind: "4d",
    name: "tiling-lattice-4d",
    system: hyperfern,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange",
    sliceOn: true,
    sliceCenter: -0.15,
    sliceWidth: 0.3,
    sliceRelativeColor: true,
    pointTilingPlan: benchPointTilingPlan(4, "lattice"),
    // Minimum-scale x/z/w repetition before projection; wRamp and slice are
    // recomputed from every raw image rather than copied from the source.
    // Measured Iris equal-N MAE is 2.790 with essentially zero signed bias
    // and density TV 0.047: image-owned wRamp intentionally gives independent
    // samplings high per-hit color variance. Five keeps the established
    // roughly-2x noise-floor procedure without weakening other scenarios.
    maeThreshold: 5,
  },
  {
    kind: "4d",
    name: "tiling-symmetry-4d",
    system: pentatope,
    finalTransform: null,
    symmetry: { order: 3, plane: "xw", twist: 1 },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "uniform",
    sliceOn: true,
    sliceCenter: 0.2,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    pointTilingPlan: benchPointTilingPlan(4, "lattice", { cellScale: 1.5 }),
    // Double rotation inside the source orbit, then raw lattice images,
    // then the settled rotor/slice. Uniform colour isolates image density.
    // The exact two-seed CPU control measures MAE 2.131 / density TV
    // 0.05288; removing symmetry at the SAME camera measures 12.849 /
    // 0.31071. Both bars exceed twice the measured sampling noise while
    // rejecting that missing-geometry control. The global bias bar stays.
    // Reproduce: scripts/flame-tiling-symmetry-noise.verify.mjs.
    maeThreshold: 4.5,
    densityTvThreshold: 0.12,
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
    // The slice-relative recolor rides this leg too: the remap is the
    // identity arithmetic with non-neutral (shift, invScale), so this pins
    // both kernels' wRamp path AND the remap in one scenario.
    sliceRelativeColor: true,
  },
  {
    kind: "4d",
    name: "emitter-menagerie-4d",
    system: emitterMenagerie,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "transform",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // The 3D menagerie lifted as a controlled pair: its w overrides make the
    // orbit genuinely 4D (the reduced explorer probe spans w [-0.245, 0.503])
    // while every fresh local shape sample still enters at w=0 before its
    // slot's 4D affine. Keeps transform-color and mesh-table coverage from the
    // former hyperfern-transform row, and adds the same strong sphere overlap
    // to the 4D kernel without growing the 50.3M-iteration scenario roster.
    // The reduced uncorrected control reads density TV 0.078 versus a 0.0094
    // two-seed floor; image MAE is only 0.061 and therefore cannot be its gate.
    densityTvThreshold: EMITTER_OVERLAP_DENSITY_TV_THRESHOLD,
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
    // Non-legacy: the app's 4D radius LUT can now be palette-driven, and
    // the LUT crosses to the kernel as data — so the pinned scenario rides
    // a gradient-built LUT, proving the packing passes it through rather
    // than only ever agreeing on the built-in ramp's bytes.
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
    // Uniquely pins: every variations4 formula in the 4D WGSL
    // kernel, run over genuinely 4D orbits via variationZoo4's w-mixing
    // blocks (see its doc), and the 4D kernel's final-transform lens slot —
    // neither exercised by the four 4D scenarios above.
  },
  {
    kind: "4d",
    name: "exact-flam3-batch-4d",
    system: exactFlam3Batch4,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "spectrum",
    colorMode: "wBlueOrange",
    sliceOn: true,
    sliceCenter: 0.05,
    sliceWidth: 0.45,
    sliceRelativeColor: true,
    // Iris agreement measured 0.001196 density TV with the live soft slice;
    // share the 3D leg's direct 0.02 redistribution bar.
    densityTvThreshold: 0.02,
    // The 3D leg's five cases over genuinely w-mixing orbits, including
    // Slot4's appended lanes and rings' live trans.x coefficient.
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
    // Measured equal-N noise floor: CPU-vs-GPU maeRGB on SwiftShader is
    // 0.225, stable bit-for-bit across repeated runs (see fold-zoo's own
    // comment for why). 2x that (0.45) is below the default 1.0 floor, so
    // maeThreshold stays at the default-equivalent 1.0 rather than tightening
    // below it.
    maeThreshold: 1.0,
    // Uniquely pins: the three Mandelbox fold variations in the 4D
    // WGSL kernel, run over genuinely 4D orbits via foldZoo4's w-mixing
    // blocks (see its doc) — the full 4D radius/box fold, not a w = 0 slice.
  },
  {
    kind: "4d",
    name: "fold-zoo-parameterized-4d",
    system: foldZooParameterized4,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // fold-zoo-4d's config verbatim (same tumble, palette, color mode, no
    // slice), so this is that scenario's controlled pair one dimension up
    // — the fold's authored lengths are the only difference between them.
    // Measured equal-N noise floor: 0.066 by the same control-experiment
    // procedure `fold-zoo-parameterized` documents above, and calibrated
    // the same way — the control run on `fold-zoo-4d` itself reads 0.225,
    // the very number its comment records CPU-vs-GPU. 2x that (0.13) is
    // far below the 1.0 default, so the threshold stays at the
    // default-equivalent 1.0 rather than tightening below it (fold-zoo-4d's
    // own reasoning, and it spells the value out for the same reason).
    maeThreshold: 1.0,
    // Uniquely pins: the fold family's AUTHORED lengths in the
    // 4D WGSL kernel — Slot4's per-type `foldRadii` lanes over genuinely
    // 4D orbits, where the fold reads the full 4D radius/box.
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
    // Uniquely pins: the 4D kernel's symmetry expansion — Slot4's
    // four post-rotation rows and `hasPost`, the copy-major slot order and
    // its inherited weights/color pair, and Params4's `baseTransformCount`
    // fold. Every other 4D scenario here is order 1, where all of that is
    // zero-filled and inert.
  },
  {
    kind: "4d",
    name: "schedule-4d",
    system: hyperfern,
    finalTransform: null,
    symmetry: { order: 1, plane: "xz" },
    rotation: BENCH_TUMBLE,
    paletteId: "ember",
    colorMode: "wBlueOrange",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // The schedule-sponge leg one dimension up: a genuinely 4D orbit
    // (hyperfern's w-mixing frond) bent through a flat two-map B — packed
    // through toTransform4 exactly as prepareSchedule4 lifts the CPU
    // oracle's. Uniform B weights on purpose: the 3D leg pins the WEIGHTED
    // schedule search, this one the uniform fast path, so between them
    // both branches of each kernel's textually-shared pick are exercised.
    schedule: {
      transforms: [
        {
          id: 0,
          position: [-0.6, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
        {
          id: 1,
          position: [0.6, 0.3, 0],
          rotation: [0, 0, 0.5],
          scale: [0.5, 0.5, 0.5],
        },
      ],
      depth: 2,
    },
    // Measured equal-N reading: CPU-vs-GPU maeRGB on SwiftShader is 0.0034
    // — the composition concentrates mass into few bright cells, so the
    // per-pixel mean is tiny. 2x that is far below the default 1.0 floor,
    // so the threshold stays at the default-equivalent 1.0 (fold-zoo-4d's
    // convention).
    maeThreshold: 1.0,
    // Uniquely pins: the 4D kernel's plot-time schedule stage — the
    // lifted B slots after the lens slot, the per-level draw, and the
    // post-word bending the 4D plotted point before rotor projection.
  },
  {
    kind: "4d",
    name: "chi-kaleido-4d",
    system: () =>
      hyperfern().map((t, i): Transform => ({
        // Block-structured chi over the hyperfern's four maps — {stem,
        // frond} | {left leaflet, right leaflet} — with a 1% leak: the
        // fernSpongeLeak construction reduced onto a genuinely 4D
        // system (the frond map's yw curl carries the orbit out of
        // w = 0, so the chi selection state provably rides a real 4D
        // orbit; probed cloud w extent [-0.27, 0.63]).
        ...t,
        chaos: [0, 1, 2, 3].map((j) => (j < 2 === i < 2 ? 1 : 0.01)),
      })),
    finalTransform: null,
    // Order 3: the ONE chi leg whose expanded slot list is wider than its
    // base list (12 slots over 4 base rows), so the kernel's row indexing
    // (rowBase = baseTransformCount + row * transformCount) and the
    // copy-inherits-its-base's-chi-column rule are both live — the two 3D
    // chi legs are order 1, where transformCount == baseTransformCount
    // and conflating the two counts would cancel out invisibly.
    symmetry: { order: 3, plane: "xy" },
    rotation: BENCH_TUMBLE,
    paletteId: "aurora", // non-legacy => structural LUT coloring.
    colorMode: "wBlueOrange", // ignored under a non-legacy palette.
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // Measured equal-N noise floor: 0.183 (the two-seed CPU-vs-itself
    // control, 50.3M iterations each through prepare4D's own derived
    // camera/view — chi-isolated's procedure one dimension up). 2x that
    // is well below the default 1.0, so the threshold stays at the
    // default-equivalent 1.0.
    maeThreshold: 1.0,
    // Uniquely pins: the 4D kernel's chi lane — pickSlot's row draw over
    // packGpuSystem4's transferred table (flame-gpu.ts's shared
    // packChaosRowsTable), the selection state in the 4D chain's aux.w
    // (its one free lane), and chi COMPOSED with the kaleidoscope
    // expansion, which no other chi leg exercises.
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

const BACKEND_SMOKE =
  new URLSearchParams(window.location.search).get("backendSmoke") === "1";
const DISPLAY_WIDTH = BACKEND_SMOKE ? 32 : 960;
const DISPLAY_HEIGHT = BACKEND_SMOKE ? 24 : 540;
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

/** Agreement thresholds: below these, CPU/GPU output is accepted as
 * the same statistical render (Monte-Carlo shot noise, not divergence) — see
 * `docs/flame-gpu-accumulation-spike.md`'s measured figures, which sit
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
  width = ACCUM_WIDTH,
  height = ACCUM_HEIGHT,
  displayWidth = DISPLAY_WIDTH,
  displayHeight = DISPLAY_HEIGHT,
): GpuBackendRequest {
  const echoColorLUT =
    def.balloonEcho && def.balloonPaletteId
      ? (buildPaletteLUT(def.balloonPaletteId) ?? undefined)
      : undefined;
  return {
    transforms: def.transforms,
    finalTransform: def.finalTransform,
    order: def.symmetry.order,
    plane: def.symmetry.plane,
    palette: def.paletteId,
    schedule: def.schedule ?? null,
    projection,
    width,
    height,
    seed: SEED,
    displayWidth,
    displayHeight,
    progressiveFilterRadius: FLAME_FILTER_RADIUS,
    echo: def.balloonEcho,
    echoColorLUT,
    pointTilingPlan: def.pointTilingPlan,
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
 * A scenario's two engines: the CPU oracle's chunk function and
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
 * on the oracle side, `createGpuFlameBackend` on the production side. The
 * raster defaults to the bench's own; the standalone adaptive check passes
 * a small one. */
function prepare3D(
  def: ScenarioDef3D,
  width = ACCUM_WIDTH,
  height = ACCUM_HEIGHT,
  displayWidth = DISPLAY_WIDTH,
  displayHeight = DISPLAY_HEIGHT,
): ScenarioEngines {
  const prepared: PreparedChaosGame = prepareChaosGame(
    def.transforms,
    def.finalTransform,
    def.symmetry,
    def.schedule ?? null,
  );
  const palette: Vec3[] = transformColors(
    def.transforms.length,
    def.transforms.map((t) => t.colorIndex),
  );
  const lut = buildPaletteLUT(def.paletteId) ?? undefined;
  const echoColorLUT =
    def.balloonEcho && def.balloonPaletteId
      ? (buildPaletteLUT(def.balloonPaletteId) ?? undefined)
      : undefined;
  const projection = buildProjection(width, height, def.cameraPos, def.lookAt);
  return {
    cpuChunk: (n, histogram, rng) =>
      accumulateFlame(
        prepared,
        projection,
        width,
        height,
        n,
        rng,
        palette,
        histogram,
        lut,
        def.balloonEcho,
        echoColorLUT,
        def.pointTilingPlan,
      ),
    createBackend: () =>
      createGpuFlameBackend(
        toGpuBackendRequest(
          def,
          projection,
          width,
          height,
          displayWidth,
          displayHeight,
        ),
      ),
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
function prepare4D(
  def: ScenarioDef4D,
  width = ACCUM_WIDTH,
  height = ACCUM_HEIGHT,
  displayWidth = DISPLAY_WIDTH,
  displayHeight = DISPLAY_HEIGHT,
): ScenarioEngines {
  const transforms4 = def.system().map(toTransform4);
  const final4 =
    def.finalTransform === null ? null : toTransform4(def.finalTransform);
  const prepared4: PreparedChaosGame4 = prepareChaosGame4(
    transforms4,
    final4,
    def.symmetry,
    def.schedule ?? null,
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
    undefined,
    // The view derives from the composed cloud, exactly as the app's own
    // explorer cloud carries the schedule.
    def.schedule ?? null,
  );
  const rotor = rotationMatrix4(def.rotation);
  const b = cloud.bounds;
  const halfExtents: Vec4 = [
    (b.maxX - b.minX) / 2,
    (b.maxY - b.minY) / 2,
    (b.maxZ - b.minZ) / 2,
    (b.maxW - b.minW) / 2,
  ];
  const invWAmp =
    1 /
    Math.max(def.pointTilingOriginRadius ?? wSupport(rotor, halfExtents), 1e-6);
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

  const color = buildBenchFourDColor(def, transforms4, {
    center,
    halfExtents,
    radiusMin,
    radiusMax,
  });

  // Auto-framing camera (see this function's doc): a fixed offset direction,
  // distance proportional to the cloud's own bounding radius.
  const dir = new THREE.Vector3(0.8, 0.55, 1.0).normalize();
  const viewCenter: Vec4 =
    def.pointTilingOriginRadius === undefined ? center : [0, 0, 0, 0];
  const dist = Math.max(
    3 * (def.pointTilingOriginRadius ?? cloud.radius),
    1e-3,
  );
  const cameraPos: [number, number, number] = [
    viewCenter[0] + dir.x * dist,
    viewCenter[1] + dir.y * dist,
    viewCenter[2] + dir.z * dist,
  ];
  const camera = buildProjection(width, height, cameraPos, [
    viewCenter[0],
    viewCenter[1],
    viewCenter[2],
  ]);
  const rotorProjection = composeRotorProjection4(rotor, viewCenter);
  const projection = composeFlameProjection4(camera, rotorProjection);
  const balloonEcho: FlameBalloonEcho | undefined = def.balloonEcho
    ? {
        balloon:
          def.pointTilingOriginRadius === undefined
            ? {
                center: [center[0], center[1], center[2]],
                rho: cloud.radius * 1.02,
                R: cloud.radius * def.balloonEcho.radiusMultiple,
              }
            : buildBalloonFromBall(
                { center: [0, 0, 0], radius: def.pointTilingOriginRadius },
                def.balloonEcho.radiusMultiple,
              ),
        tint: def.balloonEcho.tint,
        tintStrength: def.balloonEcho.tintStrength,
        weight: def.balloonEcho.weight,
      }
    : undefined;
  const echoColorLUT =
    balloonEcho && def.balloonPaletteId
      ? (buildPaletteLUT(def.balloonPaletteId) ?? undefined)
      : undefined;

  return {
    cpuChunk: (n, histogram, rng) =>
      accumulateFlame4(
        prepared4,
        projection,
        view,
        width,
        height,
        n,
        rng,
        color,
        histogram,
        balloonEcho,
        balloonEcho ? rotorProjection : undefined,
        balloonEcho ? camera : undefined,
        echoColorLUT,
        def.pointTilingPlan,
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
        width,
        height,
        seed: SEED,
        displayWidth,
        displayHeight,
        progressiveFilterRadius: FLAME_FILTER_RADIUS,
        echo: balloonEcho,
        echoColorLUT,
        rotorProjection: balloonEcho ? rotorProjection : undefined,
        cameraProjection: balloonEcho ? camera : undefined,
        schedule: def.schedule ?? null,
        pointTilingPlan: def.pointTilingPlan,
      } satisfies GpuBackendRequest4),
  };
}

/**
 * The session's `buildFourDColor` dispatch (flame-worker-core.ts), restated
 * over a {@link ScenarioDef4D}: a non-`"legacy"` palette wins (structural),
 * `"legacy"` dispatches on the explorer color mode — same precedence, same
 * LUT/palette constructors, so the bench renders the exact color pipeline
 * the app would for that palette/mode combination.
 *
 * Takes the BASE 4D transforms (not just a count) so the `"transform"` case
 * can thread each map's authored `colorIndex` through to
 * {@link transformColors}, exactly like the worker's own `buildFourDColor`
 * reuses its stored `baseTransforms4`.
 */
function buildBenchFourDColor(
  def: ScenarioDef4D,
  transforms4: Transform4[],
  cloudStats: {
    center: Vec4;
    halfExtents: Vec4;
    radiusMin: number;
    radiusMax: number;
  },
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
      return {
        kind: "transform",
        palette: transformColors(
          transforms4.length,
          transforms4.map((t) => t.colorIndex),
        ),
      };
    case "height":
      return {
        kind: "height",
        lut: buildColorModeLUT(
          "height",
          def.colorGamma ?? 1,
          def.rampPalette ?? "legacy",
        ),
        minY: cloudStats.center[1] - cloudStats.halfExtents[1],
        maxY: cloudStats.center[1] + cloudStats.halfExtents[1],
      };
    case "radius":
      return {
        kind: "radius",
        lut: buildColorModeLUT(
          "radius",
          def.colorGamma ?? 1,
          def.rampPalette ?? "legacy",
        ),
        center: cloudStats.center,
        minD: cloudStats.radiusMin,
        maxD: cloudStats.radiusMax,
      };
    case "position":
      return {
        kind: "position",
        min: [
          cloudStats.center[0] - cloudStats.halfExtents[0],
          cloudStats.center[1] - cloudStats.halfExtents[1],
          cloudStats.center[2] - cloudStats.halfExtents[2],
        ],
        max: [
          cloudStats.center[0] + cloudStats.halfExtents[0],
          cloudStats.center[1] + cloudStats.halfExtents[1],
          cloudStats.center[2] + cloudStats.halfExtents[2],
        ],
        colorGamma: def.colorGamma ?? 1,
        axisColors: def.positionAxisColors,
      };
    case "uniform":
      return { kind: "uniform", color: UNIFORM_POINT_COLOR };
  }
}

/** Build whichever dimension's engines a scenario calls for. */
function buildEngines(def: ScenarioDef): ScenarioEngines {
  return def.kind === "3d" ? prepare3D(def) : prepare4D(def);
}

/** Production warmup, accumulation, staging readback and both downsample
 * passes, through each emitted program (3D/4D, plain/tiled). This is a
 * separate liveness gate; the agreement roster and its budgets stay intact. */
async function runBackendSmoke(): Promise<
  NonNullable<BenchResults["backendSmoke"]>
> {
  const start = performance.now();
  const scenarios: string[] = [];
  for (const kind of ["3d", "4d"] as const) {
    for (const tiled of [false, true]) {
      const def = SCENARIOS.find(
        (s) => s.kind === kind && Boolean(s.pointTilingPlan) === tiled,
      );
      if (!def)
        throw new Error(
          `Missing backend smoke program: ${kind}, tiled=${String(tiled)}`,
        );
      window.__BENCH_ACTIVE__ = `backend-smoke: ${def.name}`;
      const backend = await buildEngines(def).createBackend();
      try {
        if (backend.kind !== "gpu" || !backend.snapshotDisplay)
          throw new Error("GPU backend/downsample unavailable");
        if ((await backend.accumulate(1)) < 1)
          throw new Error("GPU retired no iterations");
        const full = await backend.snapshot();
        if (!(full.hitMass > 0))
          throw new Error(`Empty GPU readback: ${def.name}`);
        const display = await backend.snapshotDisplay(
          createFlameHistogram(DISPLAY_WIDTH, DISPLAY_HEIGHT),
        );
        const expected = downsampleFlame(
          full,
          DISPLAY_WIDTH,
          DISPLAY_HEIGHT,
          FLAME_FILTER_RADIUS,
        );
        if (!compareDisplayDownsample(display, expected).pass)
          throw new Error(`GPU smoke downsample disagreement: ${def.name}`);
        scenarios.push(def.name);
        console.log(`[gpu-bench] backend smoke passed: ${def.name}`);
      } finally {
        backend.destroy();
      }
    }
  }
  window.__BENCH_ACTIVE__ = null;
  return { pass: true, scenarios, wallMs: performance.now() - start };
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
   * The SAME backend's own `snapshotDisplay()` output, taken right
   * after `histogram` (no further `accumulate()` calls in between — both
   * read the identical resident buffer). `undefined` only if this backend
   * has no `snapshotDisplay` (shouldn't happen for a production GPU backend
   * — `createGpuFlameBackend` always builds one — but this function stays
   * honest about the interface's optionality rather than asserting it).
   */
  gpuDisplayDownsample?: FlameHistogram;
  /** See {@link measureRedisplayCost}'s doc; `undefined` under the
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
 * Also captures the display-downsample agreement leg's GPU side and
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

/** Total-variation distance between two normalized hit fields. The inputs are
 * the CPU-downsampled equal-N histograms, not the tone-mapped images: log
 * density and RGB averaging are valuable display operations but can compress
 * exactly the localized mass redistribution an overlap sampler gate must see.
 * Returning 1 when either field has no positive mass makes an accidentally
 * empty overlap fixture fail closed. */
function hitDensityTotalVariation(
  cpu: FlameHistogram,
  gpu: FlameHistogram,
): number {
  let cpuTotal = 0;
  let gpuTotal = 0;
  for (let i = 0; i < cpu.hits.length; i++) {
    cpuTotal += cpu.hits[i];
    gpuTotal += gpu.hits[i];
  }
  if (!(cpuTotal > 0) || !(gpuTotal > 0)) return 1;

  let l1 = 0;
  for (let i = 0; i < cpu.hits.length; i++) {
    l1 += Math.abs(cpu.hits[i] / cpuTotal - gpu.hits[i] / gpuTotal);
  }
  return l1 / 2;
}

/** Whether this scenario's raw diff metrics clear the agreement thresholds —
 * the one place `maeThreshold`/`AGREEMENT_BIAS_THRESHOLD` are actually
 * applied. `maeThreshold` is the scenario's own bar (its `maeThreshold`
 * override, or `AGREEMENT_MAE_THRESHOLD`); bias has no scenario-dependent
 * noise floor (shot noise cancels in a SIGNED mean), so its threshold stays
 * global. Density TV is likewise scenario-owned and optional: only the
 * overlap controlled pair has a measured reason to gate on it. */
function passesAgreement(
  maeRGB: number,
  biasRGB: [number, number, number],
  maeThreshold: number,
  densityTv: number,
  densityTvThreshold: number | undefined,
): boolean {
  return (
    maeRGB < maeThreshold &&
    biasRGB.every((b) => Math.abs(b) < AGREEMENT_BIAS_THRESHOLD) &&
    (densityTvThreshold === undefined || densityTv < densityTvThreshold)
  );
}

/** Per-bucket tolerance for the display-downsample exactness check —
 * `max(1e-6, 1e-4 * max(|cpu|, 1))`. */
function displayDownsampleTolerance(cpuValue: number): number {
  return Math.max(1e-6, 1e-4 * Math.max(Math.abs(cpuValue), 1));
}

/**
 * The display-downsample agreement leg: compares the GPU
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
  // Same shape and bound as the maxHits leg. Both masses are host-side sums
  // over the SAME arrays' worth of buckets (see the field's doc), so this is
  // the tone-map anchor's own precondition, not an independent accumulator
  // comparison.
  const massRelError =
    cpu.hitMass !== 0
      ? Math.abs(gpu.hitMass - cpu.hitMass) / cpu.hitMass
      : Math.abs(gpu.hitMass);
  return {
    maxAbsHitsError,
    maxAbsColorError,
    maxHitsRelError,
    massRelError,
    pass: withinTolerance && maxHitsRelError <= 1e-4 && massRelError <= 1e-4,
  };
}

/** Per-bucket floor for the adaptive leg's relative errors: below this
 * magnitude a bucket's own denominator is noise-level, so the leg gates on
 * the ABSOLUTE error there instead. */
const ADAPTIVE_REL_FLOOR = 1;

/**
 * Per-bucket adaptive-gather tolerance — looser than the display leg's
 * `max(1e-6, 1e-4 * max(|cpu|, 1))` because the adaptive gather sums
 * THOUSANDS of f32 taps per cell (radius 11 x supersample 2 is a 133x133
 * source footprint) where the display filter sums a handful, and its
 * normalization is the separable product rather than the CPU's flat-order
 * memo. MEASURED over both arms and both param sets on i7-1165G7 / Iris Xe
 * (real driver: worst relative hits error 4.9e-6, worst relative color error
 * 5.3e-6, maxHits 6.6e-7, hitMass 5.9e-8; SwiftShader agrees to the same
 * order, within ~1.5x on each), so 1e-4 is ~20x the measured worst case
 * while still far below anything a class-boundary or clip mismatch would
 * produce (those move a cell by a percent). The absolute floor of 1e-2
 * covers buckets whose own value is below {@link ADAPTIVE_REL_FLOOR}: a
 * bucket at the floor with a full-footprint sum is still hundreds of taps,
 * so one f32 ULP of the summed magnitude sits far under it.
 */
function adaptiveDisplayTolerance(cpuValue: number): number {
  return Math.max(
    1e-2,
    1e-4 * Math.max(Math.abs(cpuValue), ADAPTIVE_REL_FLOOR),
  );
}

/**
 * The adaptive-density-estimate agreement leg: compares the GPU
 * `adaptiveDisplay` gather's output against `adaptiveDownsampleFlame` fed
 * the exact SAME resident histogram and params (both sides consume the same
 * `backend.snapshot()` readback — the GPU side re-reads its own resident
 * buffer, which that snapshot converted). Exact modulo the disclosed
 * f32-vs-f64 tolerances above — NOT a statistical comparison.
 */
function compareAdaptiveDisplay(
  gpu: FlameHistogram,
  cpu: FlameHistogram,
): Omit<AdaptiveDisplayMetrics, "cpuMs" | "gpuMs" | "bands"> {
  let maxAbsHitsError = 0;
  let maxRelHitsError = 0;
  let withinTolerance = true;
  for (let i = 0; i < cpu.hits.length; i++) {
    const err = Math.abs(gpu.hits[i] - cpu.hits[i]);
    if (err > maxAbsHitsError) maxAbsHitsError = err;
    const rel = err / Math.max(Math.abs(cpu.hits[i]), ADAPTIVE_REL_FLOOR);
    if (rel > maxRelHitsError) maxRelHitsError = rel;
    if (err > adaptiveDisplayTolerance(cpu.hits[i])) withinTolerance = false;
  }
  let maxAbsColorError = 0;
  let maxRelColorError = 0;
  for (let i = 0; i < cpu.sumRGB.length; i++) {
    const err = Math.abs(gpu.sumRGB[i] - cpu.sumRGB[i]);
    if (err > maxAbsColorError) maxAbsColorError = err;
    const rel = err / Math.max(Math.abs(cpu.sumRGB[i]), ADAPTIVE_REL_FLOOR);
    if (rel > maxRelColorError) maxRelColorError = rel;
    if (err > adaptiveDisplayTolerance(cpu.sumRGB[i])) {
      withinTolerance = false;
    }
  }
  const maxHitsRelError =
    cpu.maxHits !== 0
      ? Math.abs(gpu.maxHits - cpu.maxHits) / cpu.maxHits
      : Math.abs(gpu.maxHits);
  const massRelError =
    cpu.hitMass !== 0
      ? Math.abs(gpu.hitMass - cpu.hitMass) / cpu.hitMass
      : Math.abs(gpu.hitMass);
  return {
    maxAbsHitsError,
    maxAbsColorError,
    maxRelHitsError,
    maxRelColorError,
    maxHitsRelError,
    massRelError,
    pass: withinTolerance && maxHitsRelError <= 1e-4 && massRelError <= 1e-4,
  };
}

/** Reps averaged by {@link measureRedisplayCost} — enough to smooth out a
 * stray GC pause or driver hiccup without materially lengthening the bench. */
const REDISPLAY_COST_REPS = 5;

/**
 * The GPU display-downsample's acceptance-evidence measurement: how much
 * cheaper a progressive redisplay tick is with the new resident-buffer
 * downsample (`snapshotDisplay` — GPU dispatch + readback + convert already
 * included) than with the OLD full-histogram-readback path (`snapshot` —
 * readback + convert already included — followed by a CPU `downsampleFlame`
 * pass). Both are timed against the SAME already-accumulated `backend` (no
 * further `accumulate()` calls in between, or between the two loops below),
 * so neither side's timing is skewed by doing more or less actual
 * accumulation
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
 * `ss1DisplayDownsample` check and the two adaptive-display arms, up into one
 * verdict:
 *
 * - `"fail"`: at least one of those actually RAN and did not clear its
 *   thresholds — the kernel and its CPU oracle disagree.
 * - `"pass"`: at least one scenario's `comparison` ran, at least one
 *   scenario's `displayDownsample` ran, `ss1DisplayDownsample` ran, AND both
 *   adaptive arms ran — and every one of those that ran passed.
 * - `"skipped"`: nothing to fail, but not everything above ran either (no
 *   WebGPU in this browser, every GPU run failed, or the full sweep — every
 *   scenario plus the standalone checks — hasn't finished yet). Deliberately
 *   its own state rather than a vacuous "pass": an agreement check that
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
  adaptive: BenchResults["adaptiveDisplay"],
): "pass" | "fail" | "skipped" {
  const ranImage = scenarios.filter((s) => "pass" in s.comparison);
  const ranDisplay = scenarios.filter((s) => "pass" in s.displayDownsample);
  const ss1Ran = "pass" in ss1;
  const adaptiveArms = [adaptive.d3, adaptive.d4];
  const adaptiveRan = adaptiveArms.every((arm) => "pass" in arm);
  const anyImageFail = ranImage.some(
    (s) => "pass" in s.comparison && !s.comparison.pass,
  );
  const anyDisplayFail = ranDisplay.some(
    (s) => "pass" in s.displayDownsample && !s.displayDownsample.pass,
  );
  const ss1Fail = ss1Ran && !ss1.pass;
  const adaptiveFail = adaptiveArms.some((arm) => "pass" in arm && !arm.pass);
  if (anyImageFail || anyDisplayFail || ss1Fail || adaptiveFail) {
    return "fail";
  }
  return ranImage.length > 0 && ranDisplay.length > 0 && ss1Ran && adaptiveRan
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
  // derivation, production backend factory — lives behind the engines; the
  // whole pipeline below is shared by the 3D and 4D kernels.
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
      // This IS the CPU oracle side of the display-downsample
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
      const densityTv = hitDensityTotalVariation(cpuDisplay, gpuDisplay);
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
        densityTv,
        densityTvThreshold: def.densityTvThreshold,
        maxHitsCpu: cpuHist.maxHits,
        maxHitsGpu: gpuEqualN.histogram.maxHits,
        maeThreshold,
        pass: passesAgreement(
          diff.maeRGB,
          diff.biasRGB,
          maeThreshold,
          densityTv,
          def.densityTvThreshold,
        ),
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
// Standalone ss=1 display-downsample check
// ---------------------------------------------------------------------------

/** Small enough to accumulate and read back quickly — this check only needs
 * to exercise the ss=1 (scale-1, no-supersample) codepath, not produce a
 * representative-quality image. */
const SS1_WIDTH = 240;
const SS1_HEIGHT = 135;
const SS1_ITERATIONS = 4_000_000;

/**
 * The ss=1 (no supersample) display-downsample agreement check,
 * standalone from the per-scenario legs above: every `SCENARIOS` entry runs
 * at the same fixed ss=2 accumulation (`ACCUM_WIDTH`/`ACCUM_HEIGHT`, both
 * `DISPLAY_WIDTH`/`HEIGHT * SUPERSAMPLE`), so none of them ever exercises
 * `downsampleFlame`'s (and the mirrored GPU kernel's) scale-1 pass-through
 * path — phase pinned to 0, sigma pinned to its `MIN_FILTER_SIGMA` floor
 * (see flame.ts's `downsampleFlame` doc). Reworking every `ScenarioDef` to
 * carry its own supersample factor just for this would be a much bigger
 * change than this check warrants, so this runs one small, cheap,
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
// Standalone adaptive density-estimate agreement check
// ---------------------------------------------------------------------------

/** The check's raster: 192x108 display is small enough that the CPU ORACLE
 * (`adaptiveDownsampleFlame`) runs in tens of milliseconds per arm — at the
 * bench's own 960x540 the oracle itself would become the sweep's longest
 * phase — while still spanning several radius classes. Accumulation is 2x,
 * so the phase-corrected even-supersample kernels are exercised. */
const ADAPT_DISPLAY_WIDTH = 192;
const ADAPT_DISPLAY_HEIGHT = 108;
const ADAPT_ACCUM_SCALE = 2;
const ADAPT_ITERATIONS = 8_000_000;

/** The app's default params and the imported-genome classic — both inside
 * the panel's slider ranges, so the leg certifies what the UI can author:
 * the default (6/0.4/0) leaves well-sampled cells pin-sharp while empty
 * ones take the widest radius, and the imported classic (11/0.6/2) keeps a
 * nonzero minimum floor and narrows much faster with count. */
const ADAPT_PARAM_SETS: DensityEstimatorParams[] = [
  { estimatorRadius: 6, estimatorMinimumRadius: 0, estimatorCurve: 0.4 },
  { estimatorRadius: 11, estimatorMinimumRadius: 2, estimatorCurve: 0.6 },
];

/**
 * One dimension's adaptive-display agreement arm: prepare the same engines
 * a full scenario run uses (first of each kind), at the small raster above,
 * accumulate a fixed budget, then compare `adaptiveDisplay` against
 * `adaptiveDownsampleFlame` for each param set — same histogram, same
 * params, both engines fed the identical snapshot readback.
 *
 * The GPU side consumes the resident emulated-u64 histogram; the CPU side
 * consumes `backend.snapshot()`'s conversion of that same buffer, so this
 * compares GATHER arithmetic only, exactly like the display-downsample leg
 * compares `snapshotDisplay` against `downsampleFlame`. Progress is also
 * checked: the band callback must be called at least once and must reach
 * the pass's total exactly.
 */
async function runAdaptiveDisplayArm(
  kind: "3d" | "4d",
): Promise<AdaptiveDisplayMetrics | SkippedResult> {
  const def = SCENARIOS.find(
    (s): s is ScenarioDef3D | ScenarioDef4D => s.kind === kind,
  );
  if (!def) {
    return { skipped: `no ${kind} scenario to build the adaptive check from` };
  }
  const width = ADAPT_DISPLAY_WIDTH * ADAPT_ACCUM_SCALE;
  const height = ADAPT_DISPLAY_HEIGHT * ADAPT_ACCUM_SCALE;
  const engines =
    def.kind === "3d"
      ? prepare3D(def, width, height, ADAPT_DISPLAY_WIDTH, ADAPT_DISPLAY_HEIGHT)
      : prepare4D(
          def,
          width,
          height,
          ADAPT_DISPLAY_WIDTH,
          ADAPT_DISPLAY_HEIGHT,
        );
  let backend: FlameAccumBackend;
  try {
    backend = await engines.createBackend();
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    if (!backend.adaptiveDisplay) {
      return { skipped: "backend has no adaptiveDisplay" };
    }
    const adaptiveDisplay = backend.adaptiveDisplay.bind(backend);
    const retired = await backend.accumulate(ADAPT_ITERATIONS);
    if (retired < ADAPT_ITERATIONS) {
      throw new Error(
        `[gpu-bench] adaptive check: backend.accumulate(${ADAPT_ITERATIONS}) ` +
          `retired only ${retired} iterations`,
      );
    }
    const full = await backend.snapshot();

    let worst: AdaptiveDisplayMetrics | null = null;
    for (const params of ADAPT_PARAM_SETS) {
      const out = createFlameHistogram(
        ADAPT_DISPLAY_WIDTH,
        ADAPT_DISPLAY_HEIGHT,
      );
      let bands = 0;
      let finalDone = -1;
      let finalTotal = -1;
      const cpuStart = performance.now();
      const expected = adaptiveDownsampleFlame(
        full,
        ADAPT_DISPLAY_WIDTH,
        ADAPT_DISPLAY_HEIGHT,
        params,
      );
      const cpuMs = performance.now() - cpuStart;
      const gpuStart = performance.now();
      const gpu = await adaptiveDisplay(full, params, out, (done, total) => {
        bands++;
        finalDone = done;
        finalTotal = total;
        return true;
      });
      const gpuMs = performance.now() - gpuStart;
      const comparison = compareAdaptiveDisplay(gpu, expected);
      const metrics: AdaptiveDisplayMetrics = {
        ...comparison,
        cpuMs,
        gpuMs,
        bands,
        pass:
          comparison.pass &&
          bands >= 1 &&
          finalDone === finalTotal &&
          finalTotal > 0,
      };
      if (
        worst === null ||
        (worst.pass && !metrics.pass) ||
        (worst.pass === metrics.pass &&
          (metrics.maxRelHitsError > worst.maxRelHitsError ||
            (metrics.maxRelHitsError === worst.maxRelHitsError &&
              metrics.maxRelColorError > worst.maxRelColorError)))
      ) {
        worst = metrics;
      }
    }
    return worst ?? { skipped: "no adaptive param sets ran" };
  } finally {
    backend.destroy();
  }
}

/** Both dimensions' arms — the result shape `BenchResults` carries. */
async function runAdaptiveDisplayCheck(): Promise<{
  d3: AdaptiveDisplayMetrics | SkippedResult;
  d4: AdaptiveDisplayMetrics | SkippedResult;
}> {
  return {
    d3: await runAdaptiveDisplayArm("3d"),
    d4: await runAdaptiveDisplayArm("4d"),
  };
}

// ---------------------------------------------------------------------------
// Surface-DE WGSL kernel section
// ---------------------------------------------------------------------------
//
// Pins `src/fractal/surface-de-gpu.ts`'s fold-DE compute kernel against
// `estimateDistance` (surface-de.ts, refine=false — the exact estimator the
// kernel mirrors) on real query points, then times the march kernel on
// mandelboxKifs — the brief §3.7 measurement. The section also pins the
// kernel's SECOND descent core: a fold-free system compiles
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
  /** Shade probe-width A/B leg widths (`--surface-shade-width`, e.g.
   * "1,4"), default empty — the leg skips (silently) when this is empty. */
  surfaceShadeWidths: number[];
  /** Invalid `surfaceShadeWidth` tokens dropped while parsing
   * `surfaceShadeWidths` above (non-numeric or < 1) — unlike the other list
   * params' silent `parseSurfaceIntList` filter, this one is user-facing
   * enough (hand-typed while chasing the probe-width verdict) that a typo is
   * reported rather than silently doing nothing. Merged into the section's
   * `notes` by `runSurfaceShadeAbLeg`'s caller, since `parseSurfaceConfig`
   * runs before the section's `results` object exists. */
  shadeWidthNotes: string[];
  /** The 4D kernel-cost opt-in leg (`--surface-aff4-sweep=1`):
   * per-kaleidoscope-order affine4/fold4 eval-kernel timing across five
   * arms (slab vs no-slab, the slab's register-pressure probe; uniform vs
   * storage maps, the maps-load probe; affine4 vs fold4, the
   * fold-4D-at-high-order curve). Default false — the leg is silent and
   * never runs in CI; see `runSurfaceAff4SweepLeg`'s doc. */
  aff4Sweep: boolean;
  /** Ground-plane opt-in leg (`--surface-plane-frame=1`): one production
   * frame through a `groundPlane: true` kernel, checked against a strided
   * CPU sanity march in hit- AND plane-RATE terms. Default false — the leg is
   * silent and never runs in CI, the `aff4Sweep` gate's shape; see
   * `runSurfaceComputeFramePlaneLeg`'s doc for why it is opt-in (it is a
   * SECOND end-to-end frame on top of the five leg B already renders). */
  planeFrame: boolean;
  /** Device-sanity canary opt-in (`--surface-canary-trip=N`,
   * `surfaceCanaryTrip=N`): synthetically corrupt the Nth device-sanity
   * canary check (1-based) so the whole "device-unreliable" path — trip,
   * verdict, node printer, exit code — can be exercised end-to-end without
   * a real device upset. The trip detail is prefixed `SYNTHETIC` so a
   * rehearsal can never be mistaken for a real one. 0 (the default) =
   * off. */
  canaryTrip: number;
  /** Opt-in (`--surface-sphere-inversion-only=1`,
   * `surfaceSphereInversionOnly=1`): run ONLY the sphere-inversion legs
   * (`sphere-inversion-legs.ts`) after the canary arms — the iteration and
   * cost-sweep path. Its verdict is "fail" or "skipped", never "pass": a run
   * that skipped every other leg certifies nothing about the section. */
  sphereInversionOnly: boolean;
  /** With {@link sphereInversionOnly} (`--surface-si-glass-envelope=1`,
   * `surfaceSiGlassEnvelope=1`): the curved-glass starters' renderer
   * envelope and depth curve, real adapters only. MEASURED, NOT GATED — a
   * line it misses is the envelope's finding, recorded as MISS. */
  siGlassEnvelope: boolean;
  /** `--surface-si-exact-normal=1`: the glass envelope's renderers take the
   * exact Möbius normal arm (`?surfacesinormal=exact`'s pin), the look A/B's
   * cost half. */
  siExactNormal: boolean;
  /** `--surface-si-joint-off=1`: the glass envelope's renderers keep one
   * transport pool per supersample (`?surfacesijoint=0`'s pin), the joint
   * pool's schedule A/B. */
  siJointOff: boolean;
}

interface SurfaceKernelConfig {
  /** Which descent body the kernel carries.
   * "fold" is the frontier this section was built around; "affine" is the
   * fixed width-4 refined ladder, where `variant`/`stage2` are inert (the
   * generator ignores them) and `width` is always the ladder's own 4;
   * "escape" is the forward escape-time loop, where `variant`/`stage2` are
   * likewise inert and `width` is carried only for a readable label (the
   * generator ignores it too); "bulb" is that loop's sibling
   * one formula over — the forward triplex-power orbit — with the same
   * inert options for the same reason; "affine4" is that ladder ONE
   * DIMENSION UP behind the view lift — same inert options as "affine",
   * same fixed width 4 (`buildSurfaceDE4`'s `beamWidth`); "fold4" is the
   * fold frontier ONE DIMENSION UP behind the same view lift —
   * `variant` is always "private" (the frontier is function-scope private
   * by construction, module doc) and `width` is LIVE like "fold"'s, so
   * unlike "affine4" it keeps a real width sweep and its own
   * production/informational split. "escape4" is the escape loop ONE
   * DIMENSION UP behind the same view lift the 4D descent cores
   * take — a FORWARD core and a 4D one at once — so it inherits escape's
   * inert `variant`/`stage2`/`width` exactly (the generator ignores all
   * three) and affine4's fixed-width, always-gating row rule. */
  core: "fold" | "affine" | "escape" | "bulb" | "affine4" | "fold4" | "escape4";
  variant: SurfaceVariant;
  width: number;
  stage2: boolean;
  wg: number;
}

interface SurfaceAgreementRow {
  system: string;
  core: "fold" | "affine" | "escape" | "bulb" | "affine4" | "fold4" | "escape4";
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
   * narrower (the beam-width sweep rewrote the source to change it) — so
   * only rows at exactly that width compare like against like. Narrower
   * kernel widths are still run as an INFORMATIONAL measurement of the
   * narrow-width erosion (a real, expected estimator difference, not
   * kernel disagreement). AFFINE-core rows always gate:
   * their ladder is fixed at {@link SURFACE_AFFINE_LADDER_WIDTH}, which
   * IS the oracle's production `beamWidth`, so there is no width sweep
   * and every row is like against like. Escape and affine4 rows gate the
   * same way — neither has a width to sweep — and so do ESCAPE4 rows,
   * for the escape row's reason rather than the affine one's: a forward
   * orbit has no frontier at all. FOLD4 rows gate like "fold"'s, not
   * affine4's: the fold frontier's production width is the same fixed
   * `SURFACE_FOLD_BEAM_WIDTH` constant, one dimension up, so only rows at
   * that width compare like against like — narrower rows are the same
   * narrow-width erosion measurement, informational only. The M5 LENS
   * leg's rows gate exactly like whichever core the lens wraps — a
   * `core: "affine4"` lens row always gates, a `core: "fold4"` one only at
   * `SURFACE_FOLD_BEAM_WIDTH` — since {@link compareSurface4Agreement}/
   * {@link compareSurfaceFold4Agreement} read `cfg.core`/`cfg.width` alone
   * and never look at whether a lens rides along. */
  gating: boolean;
  /** Queries whose error exceeded
   * `max(2e-4·R, 2e-3·max(|cpu|, 0.05·R))` — any nonzero count on a
   * GATING row fails the section verdict; on non-gating rows it counts
   * the expected width-erosion excursions. */
  failures: number;
  /** Appended swirl Balloon rows: strict echo winners in the CPU query mix.
   * Both terms must win somewhere, so a compiled but inert union cannot pass. */
  shellQueries?: number;
  /** Error-distribution report (diagnosis, not gating): the most positive
   * and most negative `gpu − cpu`. At a width NARROWER than the oracle's
   * both signs are pure width effects, per the descendFold doc: silent
   * in-sphere floor-0 drops lose the true ancestor chain and OVERSHOOT (gpu
   * > cpu — the pure-fold branch sweep measured exactly this on-attractor),
   * while drop-folded escaped certificates freeze shallow and
   * UNDER-estimate
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
  /** The escape, affine4, fold4, M5 lens4, bulb and escape4 legs:
   * queries a pre-hoc stability gate excluded before computing `failures`
   * — `n - stableCount`. The THREE FORWARD legs' gate is the f32-vs-f64
   * orbit ensemble (`compareSurfaceForwardAgreement`'s doc); the
   * affine4, fold4 AND lens4 legs' is the SAME oracle-continuity classifier
   * ({@link surface4QueryStable} — bisection queries parked on
   * beam-selection discontinuities), evaluated against whichever composed
   * oracle that system's `refined` flag selects (fold4 and lens4-over-fold
   * PLAIN `estimateDistance4`; affine4 and lens4-over-affine
   * `estimateDistance4Refined`) — the lens argmin adds its OWN
   * discontinuity set on top, so a lens4 row's exclusion count typically
   * runs higher than its non-lensed counterpart, per
   * {@link SURFACE_LENS4_EXCLUDED_CAP}'s doc. `undefined` on every 3D
   * fold/affine/lens row (nothing is ever excluded there). */
  excluded?: number;
  /** The FORWARD-orbit legs only (escape, bulb, escape4):
   * stable-classified failures POST-HOC verified as shadow flips (the GPU's
   * value matched a 1..4-ULP neighbor orbit's fround value —
   * {@link forwardShadowFlipVerified}); excluded from `failures` but
   * capped ({@link SURFACE_ESCAPE_FLIP_CAP} /
   * {@link SURFACE_BULB_FLIP_CAP} — the escape4 leg reuses the escape
   * one, since it runs the same orbit one dimension up). */
  chaoticFlips?: number;
  /** The FORWARD-orbit legs only: the shared core pipeline's compile time
   * (identical across every row of a leg — one pipeline serves all its
   * systems, like the M0 affine leg's). */
  compileMs?: number;
  /** The FORWARD-orbit legs only: this system's own GPU dispatch wall
   * time. */
  gpuMs?: number;
}

interface SurfaceCrossCheckRow {
  /** "shared-vs-private": identical (width, stage2) must be EXACTLY equal
   * (same arithmetic, different frontier storage) — mismatches fail the
   * verdict. "stage2-on-vs-off": informational only — the branch-and-bound
   * stage-2 skips are value no-ops in exact arithmetic, but f32 rounding
   * may flip marginal frontier insertions, so deltas are reported, never
   * gated. "slabext-on-vs-off": the fold4 leg's `slabExt` A/B on
   * `fold4Boxfold` (`sliceHalfW` 0) — `segmentRadius4(q, 0)` is `length(q)`
   * bit for bit there (surface-de-gpu.ts's `slabExt` doc), so this is
   * TOLERANCE-gated like the opt-in aff4 sweep leg's own slab/no-slab
   * check ({@link SURFACE_AFF4_SWEEP_TOL_FACTOR}), not `shared-vs-private`'s
   * exact-equality rule — mismatches past tolerance fail the verdict
   * through the section's own `fold4SlabExtFailed` flag, not the generic
   * any-mismatch cross-check gate. "cover-on-vs-noslab": the M5b cover
   * leg's analog on its own `sliceHalfW` 0 rows — the cover wrapper's
   * `params.sliceHalfW <= 0.0` branch IS the point body, so the covered
   * kernel and the `slabExt: false` kernel must agree within the same
   * tolerance; mismatches past it fail through `cover4IdentityFailed`. */
  kind:
    | "shared-vs-private"
    | "stage2-on-vs-off"
    | "slabext-on-vs-off"
    | "cover-on-vs-noslab";
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
 * Leg A — the march-unproject agreement gate: the app path's ray
 * derivation (`rays:"unproject"`, dirs from ShadeParams.invProjView, the
 * exact kernel config `SurfaceComputeRenderer` compiles) marched to
 * completion and compared per ray against a CPU emulator that derives rays
 * by the SAME f32 unproject arithmetic and then runs `surfaceCpuMarch`'s
 * loop on the plain-`estimateDistance` oracle. GATING: any `failures` (or a
 * truncated march, which verifies nothing) fails the section.
 */
interface SurfaceUnprojectRow {
  system: string;
  /** Strict scalar/probe attribution at CPU hit endpoints. Present only on
   * finite Balloon rows; both source and shell must actually be visible. */
  finiteBalloonHits?: { source: number; shell: number };
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
  /** Max |gpuT − cpuT| over rays where BOTH sides hit — corridor matches
   * included, so a nonzero match count can legitimately show a large max. */
  maxAbsT: number;
  /** Rays where both sides hit but their sampled terminal t differs, while
   * the strict CPU oracle confirms some on-ray `d < eps` point inside the
   * existing t tolerance. This directly compares output geometry rather
   * than requiring a discontinuous DE's marcher to sample the same sheet. */
  hitTCorridorMatches: number;
  /** Smaller of the hard-seven and three-percent caps for corridor matches. */
  hitTCorridorCap: number;
  /** Rays on which both CPU and GPU report HIT. */
  bothHits: number;
  /** Both-hit rays whose |gpuT − cpuT| exceeded the eval gate's tolerance
   * formula applied to the hit distance —
   * `max(2e-4·R, 2e-3·max(|cpuT|, 0.05·R))` — AND whose GPU endpoint the
   * oracle could NOT confirm on-surface: real disagreement. */
  hitTFailures: number;
  /** Unexcluded status/depth failures plus any corridor matches over their
   * prevalence cap; any nonzero fails the section. */
  failures: number;
  /** Per-ray evidence persisted in JSON as well as logged. Failure and
   * informational diagnostics have separate caps so exclusions cannot hide
   * the first real failure. */
  diagnostics: string[];
  gpuHits: number;
  cpuHits: number;
  compileMs: number;
  gpuMs: number;
  passes: number;
  truncated: boolean;
}

/**
 * Leg B — one end-to-end frame through the PRODUCTION
 * `SurfaceComputeRenderer` (march slices + shade batches, the app's exact
 * host loop), presented onto a canvas the headless runner screenshots.
 * Informational, except: zero hit rays on a REAL adapter, or a null
 * `renderFrame`, fail the section (see the verdict computation).
 */
interface SurfaceComputeFrameRow {
  width: number;
  height: number;
  /** The production renderer's OWN adapter disclosure. Its create() call
   * acquires independently from the Surface section's standalone device. */
  adapterLabel?: string;
  software?: boolean;
  wallMs: number;
  gpuMs: number;
  passes: number;
  truncated: boolean;
  counts: { hit: number; miss: number; exhausted: number; active: number };
  /** Escape frame leg only: whole-frame GPU hit rate vs a
   * strided CPU sanity march's rate — the timing legs' rate-band idiom in
   * place of a per-pixel comparison (see the leg's design comment). */
  sanityGpuHitRate?: number;
  sanityCpuHitRate?: number;
  /** Same-pixel stride comparison used by the mesh-atlas leg. */
  sanitySamples?: number;
  sanityHitMismatches?: number;
  sanityMismatchRate?: number;
  /** ifs4 frame leg only (the fold4 invocation gets one too, same leg
   * function): a SECOND frame rendered by the SAME renderer at a different
   * `view4` (rotated rotor, different w0) — the per-frame view-repack proof
   * (`spec.view4` is per-renderFrame state,
   * exactly scene.ts's live rotor/slice contract). Same numbers as the
   * primary frame's, gated by the call site under the same rules. */
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

/**
 * Leg B's GROUND-PLANE row — one end-to-end frame through a
 * `groundPlane: true` kernel, whose whole point is the fifth ray status.
 * Its own row type rather than a widened {@link SurfaceComputeFrameRow}
 * because `counts.plane` is the measurement here (every other frame leg's
 * plane tally is structurally 0), and because the leg reports TWO rates
 * against the CPU sanity march instead of one.
 */
interface SurfacePlaneFrameRow {
  system: string;
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
  /** The floor the kernel was packed with, in world units — scene.ts's
   * `surfaceGroundPlaneSpec` numbers for this system's session ball, echoed
   * so a row is readable without re-deriving them. */
  plane: { y: number; fadeStart: number; fadeEnd: number; ballRadius: number };
  /** Whole-frame GPU hit rate vs the strided CPU sanity march's, the
   * {@link runSurfaceComputeFrameEscapeLeg} band idiom. */
  sanityGpuHitRate: number;
  sanityCpuHitRate: number;
  /** The same comparison for the PLANE status: GPU `counts.plane` over the
   * raster vs the CPU march's own plane classification over its stride
   * sample. Gated by the same band — see the leg's doc. */
  sanityGpuPlaneRate: number;
  sanityCpuPlaneRate: number;
  /** Rays the CPU sanity march sampled (stride
   * {@link SURFACE_SANITY_STRIDE} in both axes) — the denominator behind
   * both `sanityCpu*` rates, and the band's own noise scale. */
  sanitySamples: number;
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
 * The shade probe-width A/B leg — one row per (pose, probe width): the
 * PRODUCTION `SurfaceComputeRenderer` at shipped-parity (`shadeDeWidth =
 * SURFACE_FOLD_BEAM_WIDTH`, "baseline") against a cheap-shade-probe-width
 * renderer ("cheap"), same DE/frame-spec/raster otherwise. Purely
 * informational (see `runSurfaceShadeAbLeg`'s doc) — this is where the
 * probe-width verdict was measured, not a section gate.
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
 * The 4D kernel-cost opt-in sweep leg — one (order, core, variant, maps)
 * timing row. `usPerQuery` is derived from `minMs` (the
 * least-noise-contaminated estimate of the kernel's own cost), not
 * `meanMs`. `reps` is normally {@link SURFACE_AFF4_SWEEP_REPS}, but reads
 * lower when a timed dispatch
 * blew past {@link SURFACE_AFF4_SWEEP_REP_CAP_MS} and the loop stopped
 * early — `minMs`/`meanMs` still cover exactly the reps that ran. `core`
 * and `maps` are the two probe axes this row can vary over independently
 * of `variant`: `core` picks which descent body (`affine4`'s fixed-width
 * refined ladder or `fold4`'s fold frontier) generated it, and `maps`
 * picks which address space its per-map data was bound from
 * (`surface-de-gpu.ts`'s `mapsUniform` option doc) — `variant` stays
 * `"slab"` only for `core: "affine4"` (fold4 runs noslab-only in this
 * leg; see `runSurfaceAff4SweepLeg`'s doc). `n` is this row's OWN adaptive
 * batch size (the leg's doc's pilot → batch derivation), not a fixed
 * constant — it varies by (order, core) but is identical across every arm
 * of the same (order, core) pair, keeping A/B comparisons apples-to-apples.
 */
interface SurfaceAff4SweepRow {
  order: number;
  core: "affine4" | "fold4";
  variant: "slab" | "noslab";
  maps: "storage" | "uniform";
  n: number;
  reps: number;
  minMs: number;
  meanMs: number;
  usPerQuery: number;
}

/**
 * The 4D kernel-cost opt-in sweep leg — one order's exact-equality check
 * between two kernel variants that are expected to agree bit for bit (see
 * {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}'s doc for why). `pair` names which
 * two arms are being compared: `"slab-vs-noslab"` is the original affine4
 * register-pressure A/B; `"affine4-uniform-vs-storage"` and
 * `"fold4-uniform-vs-storage"` are the maps-load probe, one per core, each
 * comparing that core's noslab-uniform arm against its own noslab-storage
 * arm. `withinTolerance` false means the leg fails the
 * section — see `runSurfaceAff4SweepLeg`'s doc.
 */
interface SurfaceAff4SweepAgreement {
  order: number;
  pair:
    | "slab-vs-noslab"
    | "affine4-uniform-vs-storage"
    | "fold4-uniform-vs-storage";
  n: number;
  mismatches: number;
  maxAbs: number;
  withinTolerance: boolean;
}

/**
 * The 4D kernel-cost opt-in sweep leg's structured result
 * (`config.aff4Sweep`, `surfaceAff4Sweep=1`) — see
 * `runSurfaceAff4SweepLeg`'s doc for what it measures. Every row/agreement
 * entry is duplicated as a human-readable line in `results.notes` (the
 * `computeFrame4` leg's dual-reporting convention), so a headless run's
 * stdout discloses it via the existing `note:` printer without a bespoke
 * stdout formatter.
 */
interface SurfaceAff4SweepResult {
  rows: SurfaceAff4SweepRow[];
  agreement: SurfaceAff4SweepAgreement[];
  /** The leg's five pipelines each compile once and serve every order (the
   * kernel text is order-independent — symmetry order is a params value,
   * not a codegen option), keyed
   * `"affine4-slab" | "affine4-noslab" | "affine4-noslab-uniform" |
   * "fold4-noslab" | "fold4-noslab-uniform"`. */
  compileMs: Record<string, number>;
}

/** The device-sanity tripwire's result — see
 * {@link createSurfaceCanary}'s doc for the mechanism and the incident it
 * exists for. Present whenever the canary armed (absent = canary disabled,
 * with the reason in `notes`). */
interface SurfaceDeviceSanityResult {
  /** Clean boundary checks completed (one per leg banner below, plus the
   * final one right before the verdict rollup). */
  checks: number;
  /** Canary query count — the number of f32 values bit-compared per check. */
  n: number;
  /** Set when the tripwire fired: the boundary label of the leg the device
   * upset was detected AFTER (rows from that leg and later are suspect;
   * earlier legs re-verified the canary clean). */
  trippedAt?: string;
  /** Human-readable trip detail (drift counts, device.lost reason, …) —
   * duplicated into `notes` so headless stdout discloses it. */
  detail?: string;
}

/** One transport agreement leg's row (`runSurfaceTransportAgreementLegs`):
 * the emitted optics body's boundary query and replay trace pinned per
 * kernel core against `surface-transport-fixture.ts`'s CPU twin over the
 * deterministic probe set. A mismatch THROWS (the leg fails closed), so a
 * row only ever lands with both agreement flags true — they record what
 * was compared, not a tolerance outcome. */
/** One transport agreement row as the run's notes print it. */
function surfaceTransportAgreementNote(
  row: SurfaceTransportAgreementRow,
): string {
  return (
    `transport agreement ${row.core} × ${row.system} [${row.backend}, ${row.opticsSoundness}]: queries=${String(row.queries)} ` +
    `boundaryAgree=${String(row.boundaryAgree)} traceAgree=${String(row.traceAgree)} ` +
    `maxRadianceDelta=${row.maxRadianceDelta.toExponential(2)} ` +
    `maxResidualDelta=${row.maxResidualDelta.toExponential(2)} ` +
    `maxNormalDelta=${row.maxNormalDelta.toExponential(2)} ` +
    (row.maxShadowDelta !== undefined
      ? `maxShadowDelta=${row.maxShadowDelta.toExponential(2)} `
      : "") +
    (row.maxDisplacementDelta !== undefined
      ? `maxDisplacementDelta=${row.maxDisplacementDelta.toExponential(2)} `
      : "") +
    `compileMs=${String(Math.round(row.compileMs))}`
  );
}

interface SurfaceTransportAgreementRow {
  core:
    | SurfaceKernelConfig["core"]
    | "finite"
    | "finite4"
    | "sphereInv"
    | "sphereInv4";
  /** The DE the leg drove (the section's own fixture system name). */
  system: string;
  /** The boundary backend the leg pinned ({@link SurfaceTransportLegSpec}). */
  backend: SurfaceTransportLegBackend;
  /** Whether the row's agreement certifies OPTICAL soundness. The
   * estimator rows on IFS fixtures are `"vacuous-inside"`: every inside
   * path refuses on BOTH sides identically (the renderer envelope's
   * structural finding), so the rows' agreement certifies arithmetic,
   * not optical soundness — the renderer-envelope leg's wording. The
   * closed-solid rows are `"resolving"`: their inside paths traverse the
   * signed union field, so the agreement certifies the thing glass
   * needs. The finite-solid rows are `"resolving"` in the same sense:
   * their inside paths walk the exact DDA over the finite cell grid,
   * with the full anchor contract carried in and out. */
  opticsSoundness: "vacuous-inside" | "resolving";
  compileMs: number;
  /** Total control queries dispatched: one trace + two boundary probes
   * per hit ray (padded to the workgroup multiple for dispatch). */
  queries: number;
  boundaryAgree: boolean;
  traceAgree: boolean;
  /** Max per-channel |gpu − cpu| over the trace probes' radiance. */
  maxRadianceDelta: number;
  /** Max |gpu − cpu| over the trace probes' residual. */
  maxResidualDelta: number;
  /** Max per-channel |gpu − cpu| over the boundary probes' optical
   * normals (f32 taps at a fractal surface — the loosest of the three). */
  maxNormalDelta: number;
  /** Closed-solid rows only: max per-channel |gpu − cpu| over the shadow
   * probes' straight visibility (the corridor fix), which includes the
   * analytic control's delta (the twin's tolerance is the tighter of
   * the two pins). */
  maxShadowDelta?: number;
  /** Closed-solid rows only: max per-channel |gpu − cpu| over the
   * terminal-displacement probes (the smoothed normal and the virtual
   * parallel slab's lateral offset, the accepted bounded distortion
   * model). */
  maxDisplacementDelta?: number;
  /** Forward and finite cores: probes excluded by the pre-hoc ULP
   * ensemble — disclosed, never absorbed, capped. */
  flipsExcluded?: number;
  /** Finite rows must compare at least one stable resolved trace. */
  stableTraceProbes?: number;
  resolvedTraceProbes?: number;
}

interface SurfaceDeResults {
  /** Exact finite camera-boundary status/depth versus independent f64
   * occupied-cell interval unions, through the real marchRays entry. */
  finitePrimaryAgreement?: SurfaceFinitePrimaryRow[];
  /** The sphere-inversion cores' legs (`sphere-inversion-legs.ts`):
   * compile matrix, eval agreement, march agreement, production frames and
   * eval timing. Any gate failure fails the section. */
  sphereInversion?: SphereInversionBenchResults;
  /** `"device-unreliable"` means the device-sanity canary tripped mid-run:
   * numeric rows in this result are NOT evidence of a kernel defect —
   * rerun on a quiet machine. The node driver refuses to exit
   * green on it (exit 2, the "refusing to report success" convention). */
  verdict: "pass" | "fail" | "skipped" | "device-unreliable";
  reason?: string;
  adapter: BenchAdapterInfo | null;
  limits: Record<string, number>;
  agreement: SurfaceAgreementRow[];
  crossChecks: SurfaceCrossCheckRow[];
  timing: SurfaceTimingRow[];
  /** Leg A (gating) — absent until the leg runs; SkippedResult when
   * it could not run (the error is also in notes, and the verdict fails). */
  marchUnproject?: SurfaceUnprojectRow | SkippedResult;
  /** Stage C: leg A over the post-bearing lens field class
   * (lensBoxfoldPostOverAffine) — a posted affine core under a posted
   * boxfold lens, marched by the app's exact ray derivation. Gates like
   * {@link marchUnproject}. */
  marchUnprojectLens?: SurfaceUnprojectRow | SkippedResult;
  /** balloonMarch: leg A over the balloon inverted-union — one fold
   * system's kernel with `balloon: true` at the rest regime
   * (R = 1.6, the state that persists — the balloon spike's regimes),
   * marched by the app's exact ray derivation through the balloon march
   * entry (no visible-sphere gate, `t = 0` start, the oracle's far cap)
   * against the CPU emulator's balloon arm (the union DE over the same
   * core-routed estimator). Gates like {@link marchUnproject}, the
   * silhouette-flip exclusion machinery included. */
  marchUnprojectBalloon?: SurfaceUnprojectRow | SkippedResult;
  /** Leg A over the condensation field class: Gearworks through the affine
   * descent with its code-generated gear SDF, packed emitter record and
   * all-depth band. Same per-ray CPU/GPU gate as {@link marchUnproject};
   * appended as a new leg so the older fold/lens/balloon baselines do not
   * change fixtures or ordering. */
  marchUnprojectCondensation?: SurfaceUnprojectRow | SkippedResult;
  /** The shipped Sponge of Ferns scheduled hybrid through the app's
   * unproject march path. In addition to ordinary per-ray agreement this
   * row must complete real work and produce a mixed hit/background raster;
   * compilation-only and empty/full frames fail as vacuous. */
  marchUnprojectSchedule?: SurfaceUnprojectRow | SkippedResult;
  /** The shipped isolated Fern | Sponge xaos graph through the app's
   * unproject march path. Requires a dispatched, completed, agreeing mixed
   * hit/background result; its source is compiled with an explicit chaos
   * spec so the classic all-paths kernel cannot satisfy this row. */
  marchUnprojectChaos?: SurfaceUnprojectRow | SkippedResult;
  /** Every swirl base core, in both dimensions, with and without Balloon.
   * Uses the established per-ray agreement thresholds and step budget. */
  marchUnprojectSwirl?: SurfaceUnprojectRow[];
  /** Browser-qualified finite A3/A4 geometry through the same numerical
   * ray gate, with strict source/shell witnesses on the actual hit rays. */
  marchUnprojectFiniteBalloon?: SurfaceUnprojectRow[];
  /** Posted swirl + Balloon + pattern through the production marcher and
   * shade/probe pipeline, one frame per dimensional/base-core combination. */
  computeFrameSwirl?: (SurfaceComputeFrameRow & { system: string })[];
  computeFrameFiniteBalloon?: (SurfaceComputeFrameRow & { system: string })[];
  /** Leg B (informational + canvas artifact) — absent until run;
   * SkippedResult when mandelboxKifs was excluded or the renderer broke. */
  computeFrame?: SurfaceComputeFrameRow | SkippedResult;
  /** Production SurfaceComputeRenderer over the shipped scheduled hybrid.
   * Gates activation/useful geometry on every adapter; a real-GPU frame
   * must also complete with HIT and MISS and no EXHAUSTED/ACTIVE rays. */
  computeFrameSchedule?: SurfaceComputeFrameRow | SkippedResult;
  /** Production SurfaceComputeRenderer over the isolated Fern | Sponge
   * graph. Every adapter must dispatch and find geometry; real hardware
   * must finish with a clean HIT/MISS terminal mix. */
  computeFrameChaos?: SurfaceComputeFrameRow | SkippedResult;
  /** Stage C: leg B over the lens field class — the PRODUCTION
   * SurfaceComputeRenderer on lensBoxfoldPostOverAffine (posted affine
   * core + posted boxfold lens, branch-scaled priors). Gates like
   * {@link computeFrame} (zero hits on real hardware fails). */
  computeFrameLens?: SurfaceComputeFrameRow | SkippedResult;
  /** Tier-3 mesh condensation through the PRODUCTION renderer: Star Foundry
   * makes binding 11's R32F atlas live in both march and shade kernels, then
   * a strided CPU Surface march gates the completed frame's same-pixel hit
   * mask. Kept separate from the direct M8 eval leg because that older 0..3
   * bind-group fixture intentionally has no texture binding. */
  computeFrameMesh?: SurfaceComputeFrameRow | SkippedResult;
  /** Leg B over the escape class — the PRODUCTION renderer on
   * escMandelbox through `{ kind: "escape" }` (forward-orbit core, no
   * maps buffer, unscaled priors). Gates like {@link computeFrame}, plus
   * the strided CPU sanity march's hit-rate band on real hardware. */
  computeFrameEscape?: SurfaceComputeFrameRow | SkippedResult;
  /** {@link computeFrameEscape} over a CROSS-FAMILY chain
   * (`escChainBulb` — mandelbox -> triplex power). Same leg, same gates,
   * one thing the M2 eval leg above cannot reach: the HIT-INFO body's
   * power branch and its `log(log r / log R) / log d` escape count, which
   * the value body has no counterpart for. It also renders the claim the
   * cross-family power links actually make — that a document holding a
   * Mandelbox and a Mandelbulb reaches the production renderer through the
   * existing `{ kind: "escape" }` target — end to end.
   *
   * NOT a substitute for the eval row, and it is worth being explicit
   * about that: the fear going in was that a power link's `8·r⁷` noise
   * growth would blow past the eval leg's exclusion/flip caps and force
   * the rows onto this rate band instead. Measured, it did not (see the
   * cross-family fixture block's numbers), so both gates cover them.
   *
   * MEASURED: real Iris, 256x144 in 247ms wall / 202ms GPU, 41 passes, 0
   * exhausted, 8205 hits — GPU rate 0.223 against the CPU sanity march's
   * 0.226; SwiftShader, 96x54 in 132ms, 28 passes, 1155 hits, 0.223
   * against 0.202. The two adapters agree on the rate to three decimals,
   * and the row carries one result beyond agreement: at the harness pose
   * this cross-family chain draws 0.223 of its rays against the FOLD
   * sibling `escMandelbox`'s 0.153, i.e. a mandelbox-plus-Mandelbulb
   * chain is DENSER than the mandelbox alone — one more measurement
   * against the stiffness prediction that a power link renders a chain
   * marginal or empty (escape-de.ts's POWER LINKS ARE STIFF paragraph,
   * whose own ball-fill and ray-hit tables refute it from the CPU side).
   * NOTE the same stdout caveat as {@link computeFrame4}: the runner's
   * printer predates this field, so the row also lands in `notes`. */
  computeFrameEscapeXfam?: SurfaceComputeFrameRow | SkippedResult;
  /** Stage B2: leg B over the ifs4 class — the PRODUCTION
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
  /** {@link computeFrame4}'s fold4 twin — the SAME leg
   * body ({@link runSurfaceComputeFrame4Leg}) on `fold4Boxfold` instead of
   * `aff4Kaleido`. An `ifs4` target whose DE carries fold maps routes
   * `SurfaceComputeRenderer.create` to `core: "fold4"` on its own
   * (`deHasFolds4`, surface-compute.ts) — nothing in the leg is
   * aff4Kaleido-specific — so this pins the SAME production loop (4-pipeline
   * compile, fold-fan prior scaling, march slices, shade batches, per-frame
   * view4 repack) through the fold4 core the way {@link computeFrame4} pins
   * it through affine4's. The CPU sanity march switches to the matching
   * plain estimator (`surface4CpuSanityRate`'s `refined = false` here).
   * Same gates as {@link computeFrame4}, verbatim — zero hits on real
   * hardware, the rate band on untruncated frames, and the
   * completed-empty-vs-CPU-hits clause. Same dual notes/results.json
   * reporting. */
  computeFrame4Fold?: SurfaceComputeFrameRow | SkippedResult;
  /** Ground-plane opt-in leg (`config.planeFrame`, `surfacePlaneFrame=1`)
   * — leg B over a `groundPlane: true` kernel, the ONE composition no other
   * leg reaches (the plane kernels are otherwise pinned by source/packer
   * tests and in-browser verification alone). `SkippedResult` when
   * requested but the fixture did not build or the renderer broke; ABSENT
   * when the flag is off (the `shadeAb`/`aff4Sweep` opt-in convention —
   * silent, no note). Gates like {@link computeFrameEscape}: zero hits on a
   * real adapter, and on an untruncated frame BOTH rate bands against the
   * strided CPU sanity march (hit and plane). Same dual notes/results.json
   * reporting as {@link computeFrame4} — the headless runner's stdout
   * printer does not know this field. */
  computeFramePlane?: SurfacePlaneFrameRow | SkippedResult;
  /** Shade probe-width A/B leg (informational + canvas artifacts) — absent
   * when `surfaceShadeWidths` is empty (the default, silent) or every
   * requested width was skipped (see `runSurfaceShadeAbLeg`'s doc); never
   * affects {@link SurfaceDeResults.verdict}. */
  shadeAb?: SurfaceShadeAbRow[];
  /** The 4D kernel-cost opt-in leg (`config.aff4Sweep`,
   * `surfaceAff4Sweep=1`) — `surfaceShadeWidths`' "absent when not
   * requested" convention, not {@link computeFrame4}'s always-attempted
   * `SkippedResult` shape: absent
   * when off (the default, silent), when skipped on a software adapter
   * without `surfaceForce=1` (noted), or before the first order's kernels
   * ever compiled; otherwise holds whatever orders completed even if a
   * later order threw (progressive — see `runSurfaceAff4SweepLeg`'s doc).
   * Gates {@link SurfaceDeResults.verdict} on a slab/no-slab disagreement
   * beyond {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}, or on an unhandled
   * error mid-sweep (also noted either way). */
  aff4Sweep?: SurfaceAff4SweepResult;
  /** Device-sanity tripwire state — absent only when the canary
   * could not arm (setup failure, disclosed in notes). */
  deviceSanity?: SurfaceDeviceSanityResult;
  /** The optical-transport agreement legs (`runSurfaceTransportAgreementLegs`):
   * one row per kernel core whose fixture system built, each pinning the
   * emitted optics body (`mode: "shade"` + `optics: true`) against
   * `surface-transport-fixture.ts`'s CPU twin — the boundary query on
   * unanchored/anchored probes, the replay trace on the primary-hit
   * rays. Fail-closed: a mismatch throws, the gate flag turns the
   * verdict to fail. Absent when no fixture system was available (noted).
   * NOTE: the runner's stdout printer predates this field, so each row
   * also lands in `notes` (the computeFrame4 dual-reporting convention). */
  transportAgreement?: SurfaceTransportAgreementRow[];
  /** The optical-transport RENDERER envelope (`runSurfaceTransportEnvelopeLeg`):
   * one row per dimension — an optics-authored fixture document driven
   * through the production `SurfaceComputeRenderer` at the delegated
   * preview/settle rasters, gated on the decided envelope's lines (real
   * adapters only; software adapters skip with a note). Failures surface
   * through `surfaceTransportEnvelopeRowFailures` and gate the verdict. */
  transportEnvelope?: SurfaceTransportEnvelopeRow[];
  /** `--surface-si-glass-envelope=1`: the curved-glass starters' rows and
   * depth curve (measured, not gated). */
  glassEnvelope?: {
    rows: SurfaceTransportEnvelopeRow[];
    lines: { core: string; system: string; misses: string[] }[];
    depthCurve: SurfaceGlassDepthPoint[];
  };
  /** Raw per-AA finite continuation equivalence, including intentional
   * processed-limit refusals. Runs on both hardware and software adapters. */
  finiteTransportChunks?: FiniteTransportChunkRow[];
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
 * ray-by-ray before it stops printing. Sized for the handful of
 * silhouette rays a healthy leg produces, not for a broken kernel. */
const SURFACE_MISMATCH_DIAG_CAP = 8;
/** How far the CPU march's closest approach may sit from the acceptance
 * threshold — as a factor either side of `d / eps == 1` — and still count
 * as a silhouette flip rather than a real disagreement. The 1.5 band
 * discriminates sharply: the two measured flips read 0.994 and 1.02, while
 * a solid hit the other side never approached, or a genuinely empty ray,
 * reads orders of magnitude away. */
const SURFACE_SILHOUETTE_RATIO_BAND = 1.5;
/** Direct local-output matches never get enough prevalence to hide a
 * systematic divergence. */
const SURFACE_HIT_T_CORRIDOR_CAP_FRACTION = 0.03;
const SURFACE_HIT_T_CORRIDOR_HARD_CAP = 7;

/** poseRays pose (scripts/fold-cost-split.harness.ts): off-axis orbit
 * angles deliberately not aligned to any coordinate plane or mandelboxKifs's
 * T_d symmetry, distance as a multiple of the visible bounding radius. */
const SURFACE_POSE_THETA = 0.9;
const SURFACE_POSE_PHI = 1.2;
const SURFACE_POSE_DIST_FACTOR = 2.4;
const SURFACE_POSE_FOV_DEG = 60;

/** Cone-eps slope `2·tan(fov/2) / 720` — 720 is the beam-width sweep's
 * viewport HEIGHT (scripts/fold-width-sweep.mjs), deliberately DECOUPLED
 * from the bench raster exactly like erosion-repro.harness.ts's
 * APP_PIXEL_EPS: the raster only decides how many rays we trace, not how
 * fine the hit test is. */
const SURFACE_PIXEL_EPS =
  (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / 720;

/** Adaptive stepsThisPass: start at 1, double while the last pass came in
 * under the target, capped — every submission stays bounded (the
 * kernel-confirmed i915 preemption-hang lesson, host-side). */
const SURFACE_PASS_TARGET_MS = 250;
const SURFACE_MAX_STEPS_PER_PASS = 32;

/** The affine core's ladder width: fixed at the CPU oracle's
 * production `SurfaceDE.beamWidth`, which `buildSurfaceDE` always sets to
 * 4 and `surface-material.ts`'s affine arm hardcodes. Unlike the fold
 * frontier there is no width to sweep — so every affine agreement row is
 * a GATING row. */
const SURFACE_AFFINE_LADDER_WIDTH = 4;

/** How many of the escape eval leg's 700 queries per system the
 * f32-stability gate (`compareSurfaceForwardAgreement`'s doc) may exclude
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

/** {@link SURFACE_ESCAPE_EXCLUDED_CAP} for the bulb eval leg,
 * at the same structural 20% of 700. The classifier is the escape leg's
 * unchanged ({@link forwardQueryStable}) and so is the reason for a cap
 * — it must not be allowed to eat the leg — but the orbit it brackets is
 * harsher: a power-8 map multiplies a perturbation by `8r⁷` per step, and
 * bulb-de.ts measured two f64 implementations of the SAME map disagreeing
 * about membership on 0.22% of the marching ball. 20% of a
 * boundary-weighted mix (200 of the 700 queries are bisected ONTO the
 * boundary) leaves 560 queries gating. */
const SURFACE_BULB_EXCLUDED_CAP = 140;

/** {@link SURFACE_ESCAPE_FLIP_CAP} for the bulb leg — same
 * 1%-of-700 reasoning, same meaning (isolated post-hoc shadow flips are
 * the chaos tax; dozens are a bug wearing its costume). */
const SURFACE_BULB_FLIP_CAP = 7;

/** How many of the affine4 leg's 700 queries per system the
 * oracle-continuity gate ({@link surface4QueryStable}) may exclude before
 * the leg stops trusting its own `failures` count and fails the section —
 * 3%. Structural, like the escape cap: far above the measured census
 * (5/2800 total, worst system 3/700 — see the classifier's doc) but tight
 * enough that growth means something changed: a beam ladder whose
 * discontinuity set fattens from "bisection-parked knife edges" to a
 * measurable fraction of a uniform-ball mix is masking real kernel
 * disagreement behind "edge-parked", not absorbing expected f32 noise. */
const SURFACE_AFFINE4_EXCLUDED_CAP = 21;

/** The starting point for how many of the fold4 eval leg's 700 queries per
 * system the oracle-continuity gate ({@link surface4QueryStable},
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

/** The M5 LENS agreement leg's own exclusion cap — the
 * same 3% starting point as {@link SURFACE_AFFINE4_EXCLUDED_CAP} /
 * {@link SURFACE_FOLD4_EXCLUDED_CAP}, one selection-discontinuity source
 * further over: the lens wrapper's own branch-argmin (`descendLens4`) adds
 * a SECOND discontinuity set on top of whichever beam it wraps (the
 * affine4 ladder's or fold4 frontier's own), so a denser exclusion census
 * than M3/M4's is plausible on its own — not proof of a kernel bug — but
 * every widening past this starting point stays disclosed the same way:
 * an entry in {@link SURFACE_LENS4_EXCLUDED_CAP_OVERRIDES}, never a
 * silently raised floor. Shared by every lens4 row regardless of which
 * core it wraps (`compareSurface4Agreement` and
 * `compareSurfaceFold4Agreement` both feed `sys.stable`/`excluded` from
 * the SAME {@link surface4QueryStable} classifier). */
const SURFACE_LENS4_EXCLUDED_CAP = 21;

/** Per-system overrides for {@link SURFACE_LENS4_EXCLUDED_CAP} — same
 * `ceil(measured * 1.5) / 700` widening rule as {@link
 * SURFACE_FOLD4_EXCLUDED_CAP_OVERRIDES}, filled in only after a real
 * SwiftShader run measured that system's exclusion census past the 3%
 * starting point. Empty until measurement says otherwise. */
const SURFACE_LENS4_EXCLUDED_CAP_OVERRIDES: Record<string, number> = {};

/** {@link SURFACE_LENS4_EXCLUDED_CAP}'s per-system lookup, overrides first. */
function lens4ExcludedCap(system: string): number {
  return (
    SURFACE_LENS4_EXCLUDED_CAP_OVERRIDES[system] ?? SURFACE_LENS4_EXCLUDED_CAP
  );
}

/** The M5b COVER agreement leg's own exclusion cap — the same 3% starting
 * point as the other 4D caps, one query class further over: every cover
 * query evaluates {@link SLAB_COVER_PIECES} point descents and returns
 * their min, so the f32/f64 divergence the classifier tests for sits on a
 * min over 16 chaotic samples rather than one trajectory. That can only
 * ever DENSIFY an exclusion census, never widen what the row proves — but
 * a system whose measured census clears this gets an entry in
 * {@link SURFACE_COVER4_EXCLUDED_CAP_OVERRIDES}, with the measured number,
 * exactly like the fold4/lens4 caps' own rule. */
const SURFACE_COVER4_EXCLUDED_CAP = 21;

/** Per-system overrides for {@link SURFACE_COVER4_EXCLUDED_CAP} — same
 * `ceil(measured * 1.5) / 700` widening rule, filled in only after a real
 * SwiftShader run measured that system's exclusion census past the 3%
 * starting point. Empty until measurement says otherwise. */
const SURFACE_COVER4_EXCLUDED_CAP_OVERRIDES: Record<string, number> = {};

/** {@link SURFACE_COVER4_EXCLUDED_CAP}'s per-system lookup, overrides first. */
function cover4ExcludedCap(system: string): number {
  return (
    SURFACE_COVER4_EXCLUDED_CAP_OVERRIDES[system] ?? SURFACE_COVER4_EXCLUDED_CAP
  );
}

/** The fold4 leg's slabExt A/B gate on `fold4Boxfold` (`sliceHalfW` 0): the
 * same noise/real boundary as {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}, scaled
 * by the system's own `boundingRadius` like every other surface eval
 * tolerance in this file — see `runSurfaceDeSection`'s fold4 slabExt block
 * for why `sliceHalfW: 0` makes the two kernel variants mathematically
 * bit-identical. */
const SURFACE_FOLD4_SLABEXT_TOL_FACTOR = 1e-5;

/** The 4D kernel-cost opt-in sweep leg (`runSurfaceAff4SweepLeg`): the
 * kaleidoscope orders it times the affine4 eval kernel at. 1 and 6 are the
 * two measured endpoints (compute 1.7x faster than fragment GLSL at order
 * 1, ~35x SLOWER at order 6, real Iris Xe); 2/3/4 fill in the unmeasured
 * middle. */
const SURFACE_AFF4_SWEEP_ORDERS = [1, 2, 3, 4, 6];
/** The sweep leg: the CEILING an adaptively-sized batch is clamped to on
 * a real adapter — tiled up from {@link affine4Queries}' 700-query mix
 * (see the leg's doc for why tiling, not resampling). Every (order, core)
 * pair sizes its OWN batch toward {@link SURFACE_AFF4_SWEEP_TARGET_MS} from
 * a measured pilot (the leg's doc's pilot → batch derivation); this cap
 * only bounds how large that adaptive size may grow, so a cheap
 * configuration (low order, affine4) reaches it while an expensive one
 * (order 6, fold4) sizes far below it. */
const SURFACE_AFF4_SWEEP_BATCH = 65536;
/** The sweep leg: the adaptive batch's ceiling under
 * `acquired.software` (SwiftShader CI/dev boxes) instead of {@link
 * SURFACE_AFF4_SWEEP_BATCH} — 5 orders × 2 cores × up to 5 arms × (1 pilot
 * + 1 warmup + 5 timed) dispatches at the real-adapter ceiling would be
 * unbearably slow on a software rasterizer, and the leg's software-adapter
 * job is only to prove it dispatches and agrees, never to produce a
 * meaningful timing curve. */
const SURFACE_AFF4_SWEEP_BATCH_SW = 8192;
/** The sweep leg's adaptive batch sizing: the pilot dispatch's size, in
 * whole tiles of {@link affine4Queries}' 700-query mix (2 tiles = 1400
 * queries) — see the leg's doc for why a fixed 65536-query batch is unsafe
 * at order 6 under `core: "fold4"` (multi-ten-second single submission,
 * i915-watchdog territory) and how the pilot's measured cost derives a
 * per-(order, core) batch instead. Also this leg's floor on every derived
 * batch — see {@link SURFACE_AFF4_SWEEP_TARGET_MS}'s doc — so a
 * pathologically slow pilot still leaves a comparable-sized batch to time
 * rather than degenerating toward zero. */
const SURFACE_AFF4_SWEEP_PILOT_TILES = 2;
/** The sweep leg's adaptive batch sizing: the wall-clock budget each
 * (order, core)'s derived batch targets per TIMED dispatch, extrapolated
 * from the pilot's measured µs/query and rounded to a whole number of
 * 700-query tiles, then clamped to
 * [{@link SURFACE_AFF4_SWEEP_PILOT_TILES}' 1400 queries, the adapter's
 * batch ceiling]. Comfortably under {@link SURFACE_AFF4_SWEEP_REP_CAP_MS}
 * so a correctly-sized batch's timed reps essentially never trip the
 * hang-risk cutoff — that cutoff stays purely as a safety net against the
 * pilot's estimate being wrong (e.g. an arm genuinely costlier than the
 * noslab-storage pipeline the pilot measures). */
const SURFACE_AFF4_SWEEP_TARGET_MS = 1500;
/** The sweep leg: timed dispatches per arm, after one untimed warmup
 * dispatch (which also supplies the agreement-gate value — see the leg's
 * doc). */
const SURFACE_AFF4_SWEEP_REPS = 5;
/** The sweep leg: a single timed dispatch beyond this is a hang risk,
 * not a measurement worth waiting out — the rep loop stops after it and
 * reports however many reps actually completed. */
const SURFACE_AFF4_SWEEP_REP_CAP_MS = 10_000;
/** The sweep leg's exact-equality agreement gates (slab-vs-noslab, and
 * since the maps-load probe, uniform-vs-storage per core): every pair this
 * leg compares is mathematically bit-identical by construction — slab vs
 * noslab because at `sliceHalfW: 0`, `segmentRadius4(q, 0)` is `length(q)`
 * bit for bit (surface-de-gpu.ts's `slabExt` doc), and uniform vs storage
 * because `maps[j]` is address-space-agnostic in WGSL, so the SAME
 * generated body reads identical values from either binding
 * (surface-de-gpu.ts's `mapsUniform` doc) — so any elementwise mismatch is
 * either FMA/contraction noise (small, informational) or a real divergence
 * between the two code paths (gating). This is the noise/real boundary,
 * scaled by the system's own `boundingRadius` like every other surface
 * eval tolerance in this file. */
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

/** Leg A raster — an agreement gate, not a timing, so small keeps
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
 * unbounded-submission class the i915 preemption hang bans. So the leg's
 * own host loop slices the ACTIVE LIST too (surface-compute.ts's
 * marchChunkFor idea, floor sized for software costs), from a deliberately
 * pessimistic initial per-ray·step cost on software adapters that the
 * measured EMA
 * immediately corrects; step growth waits on MEASURED sub-target passes,
 * never assumed ones. */
const SURFACE_UNPROJ_MIN_CHUNK = 64;
const SURFACE_UNPROJ_INITIAL_RAY_STEP_US_SW = 1000;

/** Leg B raster/budget: full-tier knobs at 256x144 on a real
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

/** scene.ts's `GROUND_PLANE_*` floor geometry, duplicated like
 * this file's other cross-module mirrors ({@link SURFACE_NO_SYMMETRY},
 * {@link SURFACE_MARCH_STEPS}) — they are module-private there, and the
 * plane frame leg's whole point is to feed the kernel the numbers the APP
 * feeds it. Applied to the session ball exactly as `surfaceGroundPlaneSpec`
 * applies them: floor at `center.y − radius·DROP`, radial fade band in
 * multiples of the radius from the ball's xz center. */
const SURFACE_PLANE_DROP = 1.02;
const SURFACE_PLANE_FADE_START = 4;
const SURFACE_PLANE_FADE_END = 10;
const SURFACE_PLANE_ALBEDO: Vec3 = [0.62, 0.62, 0.62];

/** Shade probe-width A/B leg raster — leg A's 96x54 on BOTH adapter kinds,
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

/** Shade probe-width A/B leg's "near" pose distance factor, vs. the standard
 * bench pose's `SURFACE_POSE_DIST_FACTOR` (2.4, far-field — mostly
 * background/miss rays). Closer in means hits dominate the raster: the
 * shading-BOUND regime the standard pose lacks and the one a shading
 * probe's width actually needs to be measured in. */
const SURFACE_SHADE_AB_NEAR_DIST_FACTOR = 1.4;

/** Shade probe-width A/B diff: doubles as the amplified-diff canvas's
 * per-channel multiplier (`min(255, |Δ| × 8)`, so an 8-level channel delta
 * already saturates to visible) and the `pctPixelsOver8` report threshold
 * — the field's own name is this constant's value, so the two never drift
 * apart. */
const SURFACE_SHADE_AB_DIFF_THRESHOLD = 8;

/** One small rigid post-affine shared by the surface agreement fixtures in
 * both dimensions. Its quarter-turn is not self-inverse and its translation
 * is nonzero, so the WGSL rows exercise matrix orientation, inverse descent,
 * and forward escape application without changing contraction or stiffness.
 * Every coefficient is exactly representable in f32: this gate is about the
 * post stage, not decimal-literal drift compounded by a chaotic orbit.
 * The 4D builders lift it with an identity w row/column, which exercises the
 * real document-to-GpuMap4 path rather than a hand-built kernel record. */
const SURFACE_BENCH_POST: NonNullable<Transform["post"]> = {
  m: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  t: [0.03125, -0.015625, 0.0078125],
};

/** Add the post to one existing fixed fixture without adding another system
 * (and therefore another 700-query agreement row) to the already-long gate. */
function withSurfaceBenchPost(transforms: Transform[], index = 0): Transform[] {
  return transforms.map((transform, j) =>
    j === index ? { ...transform, post: SURFACE_BENCH_POST } : transform,
  );
}

/** Both maps pure `spherefold` — the hardest void-false-hit profile in the
 * pure-fold set. Mirrors scripts/harness-profiles.ts — keep in sync
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

/** The ONE fold-core system here whose folds carry AUTHORED
 * lengths. Every other fold fixture in this file leaves
 * `minRadius`/`fixedRadius`/`boxLimit` absent, i.e. at the classic
 * 0.5/1/1 the branch algebra used to bake in as literals — so the whole
 * surface section would still pass with the new wire packed into the wrong
 * lane, dropped on the way to the kernel, or read back as those frozen
 * constants. The authored-lengths unit tests pin the PACKERS; this row is
 * what pins the kernel that consumes them.
 *
 * Two maps, non-classic in DIFFERENT ways, so one row separates several
 * failure modes at once. Map 0 is a mandelbox carrying all three lengths
 * (and a wall below 1, so the box preimages `±2·wall − u` move as well as
 * the sphere shell). Map 1 is a spherefold at HALF the classic lengths:
 * its magnification `fR²/mR²` is therefore exactly the classic 4, so a
 * wire that carried only that ratio — the one number both eligibility
 * gates read — would still render the wrong object here, while map 0's
 * 1.78 keeps the ratio itself genuinely per-map. Map 1's `boxLimit: 2` is
 * a length a spherefold never reads; it rides along so a lane whose
 * (mR, fR, wall) order slipped reads 2 where 0.5 belongs and diverges
 * loudly rather than subtly.
 *
 * Eligible, `deHasFolds` true, R 0.7405 — a plain fold-core system that
 * routes through the M0 leg exactly like its neighbours. */
function surfaceFoldParameterizedPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0.2, -0.1],
      rotation: [0.4, 0.1, 0.2],
      scale: [0.45, 0.45, 0.45],
      variations: [
        {
          type: "mandelbox",
          weight: 1,
          minRadius: 0.375,
          fixedRadius: 0.5,
          boxLimit: 0.75,
        },
      ],
    },
    {
      id: 1,
      position: [-0.3, -0.4, 0.25],
      rotation: [0, 0.6, 0.3],
      scale: [0.2, 0.2, 0.2],
      variations: [
        {
          type: "spherefold",
          weight: 0.9,
          minRadius: 0.25,
          fixedRadius: 0.5,
          boxLimit: 2,
        },
      ],
    },
  ];
}

/** M0 (a): the sierpinski-shaped 4-map affine base
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

/** M0 (b): the affine core's RICH case — three rotated maps whose
 * per-axis scales differ, run under a kaleidoscope (order 3, `systemDefs`)
 * and an affine FINAL lens, so one row exercises the kaleidoscope sector
 * sweep, the packed final-lens prologue/epilogue and the value-exact
 * sphere-floor exit at once (that exit is live exactly on ANISOTROPIC maps,
 * whose
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
    post: SURFACE_BENCH_POST,
  };
}

/** Stage B (M1a): the LENS_HASH archetype's FINAL —
 * scripts/surface-fold.verify.mjs:52's pure-fold lens affine/fold fields
 * verbatim (boxfold weight 0.55 over a rotated, offset, shrunk affine part),
 * plus {@link SURFACE_BENCH_POST} to keep the final post stage live. Sits over
 * {@link surfaceAffineTetra}, so the M1 row pins the lens wrapper around
 * the SAME affine core M0's affineTetra row pins bare. */
function surfaceLensBoxfoldFinal(): Transform {
  return {
    id: 90,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
    post: SURFACE_BENCH_POST,
  };
}

/** One-to-one nonlinear lens: nonzero translation, unequal affine scales,
 * signed variation weight and a post stage exercise the exact inverse order.
 * The small pre-swirl radius stays inside the visually qualified range in
 * both dimensions; the output weight restores a useful visible extent. */
function surfaceLensSwirlFinal(fourD = false): Transform {
  return {
    id: 98,
    position: [0.02, -0.01, 0.03],
    rotation: [0.15, -0.2, 0.25],
    scale: [0.35, 0.357, 0.343],
    variations: [{ type: "swirl", weight: fourD ? -2.25 : 2.25 }],
    post: SURFACE_BENCH_POST,
    ...(fourD
      ? { w: { position: 0.02, rotation: { xw: 0.3, yw: -0.15 } } }
      : {}),
  };
}

/** The production Balloon frame's explicitly milder swirl. The near-cap
 * final remains in every eval/plain-march row and in Balloon march agreement;
 * its slower certified stride can exhaust the fixed frame budget. Scaling
 * the pre-variation affine and translation together, then compensating the
 * output weight, reduces the twist while retaining the same framing scale. */
function surfaceLensSwirlBalloonFinal(): Transform {
  const final = surfaceLensSwirlFinal();
  const strength = 0.4;
  return {
    ...final,
    position: final.position.map((value) => value * strength) as Vec3,
    scale: final.scale.map((value) => value * strength) as Vec3,
    variations: [{ type: "swirl", weight: 2.25 / strength }],
  };
}

/** Stage B (M1b): a mandelbox FINAL at weight 1 — the truncated-preview
 * regression's field class (4-map affine base under a mandelbox lens) and
 * the sweep's 81-branch worst case, so the agreement row covers the
 * spherefold shell guard, the `b += 26` box-expansion skip and the per-s
 * box re-triple in one system. */
function surfaceLensMandelboxFinal(): Transform {
  return {
    id: 91,
    position: [0.1, 0.05, -0.1],
    rotation: [0.15, -0.2, 0.25],
    scale: [0.85, 0.85, 0.85],
    variations: [{ type: "mandelbox", weight: 1 }],
  };
}

/** Stage B (M1c)'s BASE: the pure-fold branch sweep's two-map boxfold pair
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

/** Stage B (M1c): a spherefold FINAL over the boxfold pair — the
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

/** The authored-lengths LENS arm: a mandelbox final carrying all three
 * authored lengths, over {@link surfaceAffineTetra} — the same base M1a/M1b
 * wrap, so a disagreement here isolates the lens's own radii wire and
 * nothing else. The lens is a SECOND site that reads them: `descendLens`
 * carries its own `SurfaceFoldRadii` beside (never inside) the maps array,
 * and the GLSL/WGSL mirrors give it its own uniform/params slot — so a
 * kernel that wired the base maps correctly and left the lens block at the
 * frozen constants, or filled it from map 0, would agree on every other row
 * in this file.
 *
 * `minRadius` is deliberately AT the classic 0.5 while `fixedRadius` is
 * not: this row therefore fails when `fixedRadius` alone fails to arrive,
 * which a fixture that moved both lengths together could pass off as the
 * other one. The wall (0.6) is below 1, so the box half of the mandelbox
 * moves too. Eligible; the lens GROWS the attractor (R 1.2634, visR
 * 1.9734), so the query box sizes off the lensed ball exactly like M1b's. */
function surfaceLensParameterizedFinal(): Transform {
  return {
    id: 90,
    position: [0.1, -0.05, 0.08],
    rotation: [0.3, 0.1, -0.2],
    scale: [0.9, 0.9, 0.9],
    variations: [
      {
        type: "mandelbox",
        weight: 1.2,
        minRadius: 0.5,
        fixedRadius: 0.8,
        boxLimit: 0.6,
      },
    ],
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

/** M3 (a): the affine4 core's pure-DE baseline — four contracting,
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

/** M3 (b): the 4D sector-sweep case — two 4D maps under a
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

/** M3 (c)'s BASE: three contracting maps with live w blocks — the
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

/** M3 (c): a 4D affine FINAL lens with a live w block (w offset +
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
    post: SURFACE_BENCH_POST,
  };
}

/** M4's boxfold base: `surface-de-4d.test.ts`'s `pureBoxfoldPair4`
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

/** M4's mandelbox base: `surface-de-4d.test.ts`'s
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

/** M5b's RECURSIVE spherefold pair — `scripts/slab-adaptive.harness.ts`'s
 * own "SPHERE MAPS" fixture verbatim (the panel whose adaptive IoU the
 * cover's 16 pieces read 0.837 on), so the bench and the sheet that chose
 * {@link SLAB_COVER_PIECES} pin the identical system. Two spherefold maps
 * with live w blocks: every fold branch this fixture can take includes the
 * mid INVERSION, which is exactly the family `slabExact4` refuses and the
 * bounded midpoint cover exists for. */
function surfaceCover4SpherefoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.12, 0.12, 0.12],
      w: { rotation: { xw: 0.45 } },
      variations: [{ type: "spherefold", weight: 0.9 }],
    },
    {
      id: 1,
      position: [-0.25, -0.2, 0.2],
      rotation: [0, 0.5, 0.1],
      scale: [0.11, 0.11, 0.11],
      w: { rotation: { yw: 0.4 } },
      variations: [{ type: "spherefold", weight: 1.1 }],
    },
  ];
}

/** The authored lengths one dimension up: {@link
 * surfaceFoldParameterizedPair}'s two maps (same affine parts, same
 * authored lengths) given live w blocks, so the fold4 core reads the fold's
 * radii at ALL THREE of its own branch
 * sites — including the FOURTH box axis, whose `pw0/pw1/pw2` preimages and
 * `4·wall²` visible-radius bound are the one genuinely new place a wall
 * that arrived as the frozen 1 would show up. `surface-de-4d.ts` SHARES
 * `SurfaceFoldRadii`/`surfaceFoldRadii` with 3D rather than redefining it,
 * and this row is what would catch that sharing coming apart: a 3D system
 * and its 4D lift resolving an absent field differently is exactly how the
 * two dimensions start rendering different objects.
 *
 * `Transform[]` with a `w` extension, not `Transform4[]` — the fold4
 * family's own convention (see {@link surfaceFold4Boxfold}). Eligible,
 * `deHasFolds4` true, R 0.8265. */
function surfaceFold4Parameterized(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      w: { position: 0.2, rotation: { xw: 0.3 } },
      variations: [
        {
          type: "mandelbox",
          weight: 1,
          minRadius: 0.375,
          fixedRadius: 0.5,
          boxLimit: 0.75,
        },
      ],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.2, 0.2, 0.2],
      w: { position: -0.1, rotation: { yw: 0.25 } },
      variations: [
        {
          type: "spherefold",
          weight: 0.9,
          minRadius: 0.25,
          fixedRadius: 0.5,
          boxLimit: 2,
        },
      ],
    },
  ];
}

/** The 4D lens leg's boxfold LENS final — `surface-de-4d.test.ts`'s
 * `boxfoldFinal4` verbatim (same numbers, same live w block): bench and
 * CPU tests pin the identical lens, the same discipline
 * `surfaceFold4Boxfold`'s `pureBoxfoldPair4` copy above already follows.
 * Reused over BOTH an affine base (`lens4BoxPostOverAffine`, and re-viewed
 * through `aff4Slab`'s own slab as `lens4Slab`) and a fold base
 * (`lens4BoxOverFold`, "the same boxfold final" over `fold4Boxfold`'s own
 * pair) rather than forking a second fixture per base — one lens, three
 * views/bases, mirroring how `fold4Kaleido`/`fold4Slab` reuse
 * `surfaceFold4Boxfold` above. */
function surfaceLens4BoxfoldFinal(): Transform {
  return {
    id: 199,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    w: { position: 0.1, rotation: { yw: 0.2 } },
    variations: [{ type: "boxfold", weight: 0.55 }],
    post: SURFACE_BENCH_POST,
  };
}

/** The 4D lens leg's mandelbox LENS final over the affine (`pentatope`)
 * base — `lens4MandelboxOverAffine`, the 243-branch lens fan and this
 * leg's widest per-query branch count. A FRESH weight (~1.1, an
 * EXPANDING lens) rather than `surface-de-4d.test.ts`'s own
 * `mandelboxFinal4` (weight 0.6, shrinking): mirrors 3D's own M1b
 * decision (`surfaceLensMandelboxFinal`, weight 1 vs `surface-de.test.ts`'s
 * own mandelbox-lens fixture) to retune the CPU test's fixture for this
 * leg's field-class/worst-case role rather than reuse it verbatim — a
 * growing lens is also the shape that most exercises the
 * `surface4ToleranceR` fix above (its `visibleBoundingRadius` clears its
 * `boundingRadius` by a wide margin). It carries the shared post so every
 * member of the one-pipeline lens4 family has the same compile-gated params
 * tail; 3D's separate boxfold row is the march-stable posted control. */
function surfaceLens4MandelboxFinal(): Transform {
  return {
    id: 198,
    position: [0.1, 0.05, -0.1],
    rotation: [0.15, -0.2, 0.25],
    scale: [0.85, 0.85, 0.85],
    w: { position: -0.08, rotation: { yw: -0.2 } },
    variations: [{ type: "mandelbox", weight: 1.1 }],
    post: SURFACE_BENCH_POST,
  };
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
 * a software adapter), `surfaceShadeWidth` (shade probe-width A/B leg
 * widths, e.g. "1,4"; default empty — leg skipped), `surfaceAff4Sweep`
 * (opt-in per-order affine4 timing sweep, "1" = on; default off — see
 * `runSurfaceAff4SweepLeg`'s doc), `surfacePlaneFrame` (opt-in
 * ground-plane frame leg, "1" = on; default off — see
 * `runSurfaceComputeFramePlaneLeg`'s doc), `surfaceCanaryTrip` (opt-in
 * synthetic device-sanity trip at the Nth check; default 0 = off),
 * `surfaceSphereInversionOnly` ("1" runs only the sphere-inversion legs). */
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
  const canaryTripParsed = Number.parseInt(
    params.get("surfaceCanaryTrip") ?? "",
    10,
  );
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
    planeFrame: params.get("surfacePlaneFrame") === "1",
    sphereInversionOnly: params.get("surfaceSphereInversionOnly") === "1",
    siGlassEnvelope: params.get("surfaceSiGlassEnvelope") === "1",
    siExactNormal: params.get("surfaceSiExactNormal") === "1",
    siJointOff: params.get("surfaceSiJointOff") === "1",
    canaryTrip:
      Number.isInteger(canaryTripParsed) && canaryTripParsed >= 1
        ? canaryTripParsed
        : 0,
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
 * kaleidoscope: the on-attractor class only means anything if it
 * samples the set the DE actually describes. Both default to the
 * fold systems' existing arguments, so their query sets are unchanged.
 */
function surfaceQueries(
  transforms: Transform[],
  radius: number,
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = SURFACE_NO_SYMMETRY,
  schedule?: HybridSchedule,
): Vec3[] {
  const cloud = runChaosGame(
    transforms,
    SURFACE_CLOUD_POINTS,
    mulberry32(101),
    finalTransform,
    symmetry,
    undefined,
    schedule,
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
 * The escape eval leg's own query mix — `surfaceQueries`' chaos-game
 * sampling is unsound here (a single EXPANDING map has no attractor to
 * scatter a cloud onto), so this samples directly: 400 uniform cube points,
 * 200 bisected onto the `DE < 0.02` near-boundary shell (the region a
 * distance estimator most needs to be right in), and 100 clustered on the
 * ORIGIN — deep "inside" for the Mandelbrot form these maps now iterate,
 * whose bounded orbits are exactly the critical orbit's neighbourhood
 * (the cluster sat on the map's fixed offset `t` while that was the Julia
 * constant). 700 total, every component `Math.fround`ed — see
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
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
    ]);
  }
  return out;
}

/**
 * The bulb eval leg's query mix — {@link escapeQueries}' recipe
 * RE-BRACKETED, not reused. Every constant there is written for a
 * radius-4 marching ball (`ESCAPE_TIME_RADIUS` doubles as the escape
 * mode's bounding radius); the Mandelbulb's marching ball is
 * `BulbDE.boundingRadius` — around 0.9-1.35, per system — so the fixed
 * 1.2 seed cube would have covered the WHOLE object and the fixed
 * `DE < 0.02` shell would have been a band 1.7% of the ball wide instead
 * of escape's 0.5%. Each bracket below is therefore expressed as a
 * multiple of `R`, chosen to reproduce escape's own PROPORTIONS:
 *   - 400 uniform cube points out to `1.2 R` (escape's `1.2 * R`, verbatim);
 *   - 200 bisected onto the `DE < 0.005 R` near-boundary shell (escape's
 *     0.02 IS `0.005 * 4`) — the region a distance estimator most needs to
 *     be right in, and for this object the one the module doc's 0.22%
 *     membership-disagreement shell lives in;
 *   - 100 clustered near the ORIGIN, which for the Mandelbrot form is deep
 *     INSIDE the set (the orbit of `y_0 = t` stays bounded) and is where
 *     the `ln|y| < 0` clamp and the `dr` floor actually fire. Scaled by
 *     `R` like the rest: escape's fixed 0.25 half-width would be a
 *     near-degenerate speck of a ball this size.
 * 700 total, every component `Math.fround`ed (the kernel only ever sees
 * f32 query points). The bisection's `a`/`b` convention is escape's own —
 * see that generator's doc.
 */
function bulbQueries(de: BulbDE, seed: number): Vec3[] {
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
    estimateBulbDistance(de, p) < 0.005 * R;
  for (let i = 0; i < 200; i++) {
    // The inside seed: a quarter-radius cube about the origin, where the
    // Mandelbulb is solid for every eligible map.
    let a: Vec3 = [
      (rng() - 0.5) * 0.5 * R,
      (rng() - 0.5) * 0.5 * R,
      (rng() - 0.5) * 0.5 * R,
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
    out.push([Math.fround(a[0]), Math.fround(a[1]), Math.fround(a[2])]);
  }
  for (let i = 0; i < 100; i++) {
    const s = rng() * 0.5 * R;
    out.push([
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
    ]);
  }
  return out;
}

/**
 * M7: the escape4 leg's COMPOSED f64 oracle — the exact function
 * the kernel computes per query, CPU-side, and the escape family's answer
 * to {@link estimateSurface4Composed} one estimator class over.
 *
 * The kernel is handed a 3D MARCHED point and lifts it in its own body
 * (`liftEscape4`: `rotorInv · vec4f(p, w0)`, where row `i` of the packed
 * `rotorInv` is `(rot[i], rot[4+i], rot[8+i], rot[12+i])` — the transpose
 * `packEscape4GpuParams` performs). So the oracle has to see the query
 * through the SAME lift, or the two sides would be answering different
 * questions about different points and the leg would measure the view
 * transform rather than the orbit. Here the lift is f64 and inside the
 * kernel it is f32; the queries are already `Math.fround`ed and
 * {@link liftEscape4F32} reproduces the f32 lift for the classifier, so
 * the eval tolerance absorbs only the quantization.
 *
 * A rotation is an ISOMETRY, so the estimate is a valid bound for the
 * lifted point whatever the rotor is (`escape-de-4d.ts`'s own argument for
 * putting the lift in the body at all) — the lift moves WHICH point is
 * asked about, never what the answer means.
 *
 * No `sliceHalfW` argument, deliberately: a forward orbit cannot thread a
 * segment, `packEscape4GpuParams` THROWS on a nonzero one, and the app
 * clamps the slice thickness to zero for these sessions — so a slab is not
 * a case this leg could pin even if it wanted to.
 */
function estimateEscape4Composed(
  de: EscapeDE4,
  view4: SurfaceGpu4View,
  q: Vec3,
  trap: ResolvedShapeTrap | null = null,
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
  return estimateEscapeDistance4(de, p, ESCAPE_TIME_ITERATIONS, trap);
}

/**
 * The escape4 eval leg's query mix — {@link escapeQueries}'
 * recipe over the SLICE the kernel marches, which is what makes it a
 * re-use rather than a fork.
 *
 * Every bracket is the 3D generator's own number and for its own reason:
 * `EscapeDE4.boundingRadius` IS `ESCAPE_TIME_RADIUS` (the bailout ball is
 * dimension-free), so the 400 uniform cube points out to `1.2 R`, the
 * `DE < 0.02` near-boundary shell and the 0.5-half-width origin cluster
 * all keep the proportions `bulbQueries` had to re-bracket for a
 * differently-sized object. What changes is only the PREDICATE: the
 * bisection asks {@link estimateEscape4Composed}, so "near the boundary"
 * means near the boundary of the object this leg's kernel actually draws
 * — the `w = w0` slice of the rotor-posed 4D set, not the 4D set itself.
 *
 * That distinction is load-bearing here in a way it never was in 3D: a
 * slice through a set of shells is a set of surfaces, and volume says
 * nothing about it (the quaternion k-component sweep measured a slice with
 * LITERALLY ZERO members in 524288 samples of its own bailout ball still
 * drawing 20.9% of its rays). The fixtures' `probeEscapeFill4` figures
 * below are quoted as sanity bounds, never as "will it render"; the number
 * that says this mix samples anything interesting is how many of the 200
 * bisections land in the shell, recorded per fixture.
 *
 * 700 total, every component `Math.fround`ed — see `surfaceQueries`' doc
 * for why (the kernel only ever sees f32 query points). The `a`/`b`
 * bisection convention is `escapeQueries`' own.
 */
function escape4Queries(
  de: EscapeDE4,
  view4: SurfaceGpu4View,
  seed: number,
): Vec3[] {
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
    estimateEscape4Composed(de, view4, p) < 0.02;
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
    // The final `a` — see `escapeQueries`' doc.
    out.push([Math.fround(a[0]), Math.fround(a[1]), Math.fround(a[2])]);
  }
  for (let i = 0; i < 100; i++) {
    const s = rng() * 0.5;
    out.push([
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
    ]);
  }
  return out;
}

/** The affine4 leg's tolerance/query radius rule: the lens GROWS or shrinks
 * the visible set, so error scales from the set the DE actually describes —
 * M0's `foldFinal ? visibleBoundingRadius : boundingRadius` analog one
 * dimension up. ONE definition, shared by the query generator and the
 * comparator so the two cannot drift. Checks BOTH lens shapes
 * (`de.final`, the plain affine lens M3's `aff4PostFinal` carries, and
 * `de.foldFinal`, the fold lens the M5 leg's lens4
 * systems carry — the two are mutually exclusive on any built DE, so this
 * is never ambiguous): `visibleBoundingRadius` already equals
 * `boundingRadius` bit-for-bit whenever NEITHER is set
 * (`buildSurfaceDE4`'s `let visibleBoundingRadius = boundingRadius`
 * default), so widening the condition here is purely additive — every
 * existing (non-lens, plain-affine-lens) row reads the identical value it
 * always did, and only a fold-lens system's tolerance/query-ball scale
 * changes, from the unlensed base radius it was wrongly reading to the
 * correct (often larger — e.g. a growing mandelbox lens) visible one. */
function surface4ToleranceR(de: SurfaceDE4): number {
  return de.final || de.foldFinal
    ? de.visibleBoundingRadius
    : de.boundingRadius;
}

/**
 * M3 (M4 reuses it for fold4): the affine4/fold4 eval legs'
 * COMPOSED f64 oracle — the exact function the kernel computes per query,
 * CPU-side. The view lift first (`q4 = Mᵀ · (q, w0)` where M is the
 * row-major pose rotor — component `i` reads M's COLUMN `i`, exactly the
 * packed rotorInv rows), then the slab half-extent seeded from M's w
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
  cutoff = 0,
): number {
  const { p, ext } = surface4ComposedQuery(view4, q);
  return refined
    ? estimateDistance4Refined(de, p, cutoff, ext)
    : estimateDistance4(de, p, ext);
}

function surface4ComposedQuery(
  view4: SurfaceGpu4View,
  q: Vec3,
): { p: Vec4; ext: Vec4 | null } {
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
  return { p, ext };
}

/**
 * M3: the affine4 leg's ORACLE-CONTINUITY classifier — the escape
 * leg's pre-hoc ensemble shape ({@link forwardQueryStable}) minus the GPU
 * modeling it doesn't need: no fround twin, no shadow orbits, just the
 * COMPOSED f64 oracle at the query's six ±1-f32-ULP axis neighbors (the
 * queries are fround'ed, so that grid is the input's own resolution; the
 * neighbor construction is forwardQueryStable's verbatim). STABLE iff all
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
 * M4 reuses this verbatim for the fold4 leg, `refined=false` so the
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
  estimateAt?: (p: Vec3) => number,
): boolean {
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const p: Vec3 = [q[0], q[1], q[2]];
      const base = Math.fround(p[axis]);
      const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38);
      p[axis] = Math.fround(base + dir * step);
      if (
        Math.abs(
          (estimateAt
            ? estimateAt(p)
            : estimateSurface4Composed(de, view4, p, refined)) - cpu,
        ) >
        tol / 2
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * M3: the affine4 eval leg's own query mix — `surfaceQueries`'
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
 * M4 reuses this verbatim for the fold4 leg (`refined=false`,
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
 * The bench's f32 twin of `estimateEscapeDistance` — every
 * intermediate `Math.fround`ed, the same duplicated-emulator discipline
 * this file's CPU march emulators already follow (`surfaceCpuMarch` et
 * al.). Comparing this against the f64 oracle in isolation, before either
 * touches the GPU, separates f32-vs-f64 ORBIT divergence (a forward
 * iteration is chaotic — a single clamp-boundary rounding flip early on can
 * send the whole trajectory somewhere else, and unlike the IFS beam
 * estimators there is no min-of-several-chains to absorb it) from actual
 * kernel arithmetic bugs. See `compareSurfaceForwardAgreement`'s doc for how
 * the gap between the two oracles is used.
 *
 * POST REGRESSION CENSUS (the first posted spherefold run): omitting the
 * forward post from this twin excluded 286/700 while the GPU had zero numeric
 * failures — 131/400 uniform, 55/200 bisection and 100/100 origin-cluster
 * queries, all rejected by the BASE twin before any one-ULP neighbor was
 * considered. Applying the authored post below returns that row to 0/700.
 * That class shape proves a stale oracle, not a chaotic spherefold field.
 */
function trapGeometryDistanceF32(
  trap: ResolvedShapeTrap,
  x: number,
  y: number,
  z: number,
  dr: number,
): number {
  const f = Math.fround;
  const localSdf = f(shapeTrapLocalSdf(trap, x, y, z));
  return f(f(f(SHAPE_MARCH_SAFETY) * localSdf) / f(f(trap.invScale) * dr));
}

function estimateEscapeDistanceF32(
  de: EscapeDE,
  p: Vec3,
  trap: ResolvedShapeTrap | null = null,
): number {
  const f = Math.fround;
  const geometryTrap = trap?.geometry ? trap : null;
  let trapDistance = Infinity;
  // The whole CHAIN, in the kernel's own f32 lanes — one
  // pre-rounded link per slot, cycled `i mod n`.
  const links = de.links.map((link) => ({
    m: link.m.map(f),
    t: link.t.map(f),
    // The escape packer transfers the FORWARD post, unlike the descent
    // cores' inverse-post lanes. Keep it inside this f32 twin too: omitting
    // it makes the stability classifier compare a different authored
    // system against the f64 oracle, then misreport the resulting drift as
    // chaotic-orbit exclusions before the GPU is ever consulted.
    postM: link.postM?.map(f) ?? null,
    postT: link.postT?.map(f) ?? null,
    w: f(link.w),
    g: f(link.derivGrowth),
    kind: link.kind,
    // This LINK's own fold lengths, pre-rounded like everything
    // else here — the squares `EscapeLink` keeps and the kernels' `fold`
    // lane carries. A twin left at the classic 0.25/1/1 does not merely
    // disagree with the oracle on parameterized systems; it makes the
    // ENSEMBLE classifier exclude them, which reads as a chaotic fixture
    // rather than as a stale copy (measured: 251 of 700 queries excluded,
    // past the 20% cap, on a chain whose kernel rows agreed to 4.4e-7).
    wall: f(link.boxLimit),
    mR2: f(link.minRadius2),
    fR2: f(link.fixedRadius2),
  }));
  const n = links.length;
  // The kaleidoscope's query-space wedge fold, ONCE before the orbit —
  // the kernels' foldQuerySector, f32 throughout (its own trig included,
  // which is where this twin and the GPU can legitimately differ by a
  // rounding on a sector boundary; the ensemble classifier absorbs it
  // exactly as it absorbs the orbit's chaos).
  const q: Vec3 = [f(p[0]), f(p[1]), f(p[2])];
  if (de.symmetryOrder > 1) {
    const code = SYM_PLANE_CODE[de.symmetryPlane];
    const a = code === 0 ? q[1] : q[0];
    const b = code === 2 ? q[1] : q[2];
    const sector = f(f(2 * Math.PI) / de.symmetryOrder);
    const turn = f(Math.round(f(Math.atan2(b, a) / sector)) * sector);
    const c = f(Math.cos(turn));
    const s = f(Math.sin(turn));
    const fa = f(f(a * c) + f(b * s));
    const fb = Math.abs(f(f(b * c) - f(a * s)));
    if (code === 0) {
      q[1] = fa;
      q[2] = fb;
    } else if (code === 1) {
      q[0] = fa;
      q[2] = fb;
    } else {
      q[0] = fa;
      q[1] = fb;
    }
  }
  let vx = q[0];
  let vy = q[1];
  let vz = q[2];
  let dr = 1;
  let r = f(Math.sqrt(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))));
  const fold = (x: number, wall: number): number =>
    f(f(2 * Math.max(-wall, Math.min(wall, x))) - x);
  // A PASS is one full cycle, so the budget is ESCAPE_TIME_ITERATIONS
  // applications OF EACH LINK (escape-de.ts's A PASS IS ONE FULL CYCLE).
  const steps = ESCAPE_TIME_ITERATIONS * n;
  for (let i = 0; i < steps && r <= de.boundingRadius; i++) {
    const link = links[i % n];
    const m = link.m;
    const t = link.t;
    let yx = f(f(f(f(m[0] * vx) + f(m[1] * vy)) + f(m[2] * vz)) + t[0]);
    let yy = f(f(f(f(m[3] * vx) + f(m[4] * vy)) + f(m[5] * vz)) + t[1]);
    let yz = f(f(f(f(m[6] * vx) + f(m[7] * vy)) + f(m[8] * vz)) + t[2]);
    let localL = 1;
    // The fold pair sits behind the kernels' own `kind < 4` guard
    // — the two NEGATIVE tests below are exhaustive by negation over
    // {1, 2, 3} alone, so a power link reaching them would run BOTH folds
    // (escape-de.ts's EscapeLinkKind doc names that hazard).
    if (link.kind < 4) {
      if (link.kind !== 2) {
        yx = fold(yx, link.wall);
        yy = fold(yy, link.wall);
        yz = fold(yz, link.wall);
      }
      if (link.kind !== 1) {
        const r2 = f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz));
        const s = f(link.fR2 / Math.max(link.mR2, Math.min(link.fR2, r2)));
        yx = f(yx * s);
        yy = f(yy * s);
        yz = f(yz * s);
        localL = s;
      }
    } else if (link.kind === 4) {
      // The triplex 8th power, term for term against the oracle's own
      // inlined copy — which is `estimateBulbDistanceF32`'s below, since
      // escape-de.ts inlines `variations.ts`'s triplexPow8 character for
      // character the way bulb-de.ts does. Local factor `8·|y|⁷`.
      const a = f(f(yx * yx) + f(yy * yy));
      const z2 = f(yz * yz);
      const r2 = f(a + z2);
      const r4 = f(r2 * r2);
      const nz = f(
        f(
          f(
            f(
              f(f(f(f(128 * z2) * z2) * z2) * z2) -
                f(f(f(f(256 * z2) * z2) * z2) * r2),
            ) + f(f(f(160 * z2) * z2) * r4),
          ) - f(f(f(32 * z2) * r4) * r2),
        ) + f(r4 * r4),
      );
      const s = f(
        f(
          f(
            f(f(f(f(128 * z2) * z2) * z2) * yz) -
              f(f(f(f(192 * z2) * z2) * yz) * r2),
          ) + f(f(f(80 * z2) * yz) * r4),
        ) - f(f(f(8 * yz) * r4) * r2),
      );
      const rho = f(Math.sqrt(a));
      const inv = rho > 0 ? f(1 / rho) : 0;
      const u1 = f(yx * inv);
      const v1 = f(yy * inv);
      const u2 = f(f(u1 * u1) - f(v1 * v1));
      const v2 = f(f(2 * u1) * v1);
      const u4 = f(f(u2 * u2) - f(v2 * v2));
      const v4 = f(f(2 * u2) * v2);
      const u8 = f(f(u4 * u4) - f(v4 * v4));
      const v8 = f(f(2 * u4) * v4);
      yx = f(f(rho * s) * u8);
      yy = f(f(rho * s) * v8);
      yz = nz;
      localL = f(8 * f(f(f(r2 * r2) * r2) * f(Math.sqrt(r2))));
    } else {
      // The quaternion square on span{1, i, j} — local factor `2·|y|`,
      // EXACT rather than a bound (qjulia-de.ts).
      const nx = f(f(f(yx * yx) - f(yy * yy)) - f(yz * yz));
      const ny = f(f(2 * yx) * yy);
      const nz = f(f(2 * yx) * yz);
      localL = f(2 * f(Math.sqrt(f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz)))));
      yx = nx;
      yy = ny;
      yz = nz;
    }
    // P ∘ (w·V) ∘ A, then the Mandelbrot +q offset — the production
    // WGSL's `linkPostForward(L, L.p0.y * y) + q`, term for term. The
    // absent-post arm stays the old value-exact weight fold-in.
    if (link.postM !== null && link.postT !== null) {
      const pm = link.postM;
      const pt = link.postT;
      const wx = f(link.w * yx);
      const wy = f(link.w * yy);
      const wz = f(link.w * yz);
      const fx = f(f(f(f(pm[0] * wx) + f(pm[1] * wy)) + f(pm[2] * wz)) + pt[0]);
      const fy = f(f(f(f(pm[3] * wx) + f(pm[4] * wy)) + f(pm[5] * wz)) + pt[1]);
      const fz = f(f(f(f(pm[6] * wx) + f(pm[7] * wy)) + f(pm[8] * wz)) + pt[2]);
      vx = f(fx + q[0]);
      vy = f(fy + q[1]);
      vz = f(fz + q[2]);
    } else {
      vx = f(f(link.w * yx) + q[0]);
      vy = f(f(link.w * yy) + q[1]);
      vz = f(f(link.w * yz) + q[2]);
    }
    dr = f(f(f(link.g * localL) * dr) + 1);
    r = f(Math.sqrt(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))));
    if (
      geometryTrap &&
      i >= geometryTrap.geometryLevelMin &&
      i <= geometryTrap.geometryLevelMax
    ) {
      trapDistance = Math.min(
        trapDistance,
        trapGeometryDistanceF32(geometryTrap, vx, vy, vz, dr),
      );
    }
  }
  // The chain's escape law picks the form (escape-de.ts's ESTIMATE
  // FORM paragraph) — `EscapeDE.logEstimate` rides `escParams.w` on the
  // wire, so the twin must read the same flag the kernel does. A fold-only
  // chain keeps the linear quotient bit for bit.
  const escapeDistance = !de.logEstimate
    ? r / dr
    : r <= 1
      ? 0
      : f(f(f(0.5 * r) * f(Math.log(r))) / dr);
  return geometryTrap ? Math.min(escapeDistance, trapDistance) : escapeDistance;
}

/**
 * The two coordinate axes each {@link SYM_PLANE_CODE4} names —
 * `escape-de-4d.ts`'s own `PLANE_AXES`, indexed by the code that module
 * puts on the wire, so this table and the kernel's `foldQuerySector4`
 * decode read off the same list.
 *
 * It is NOT `SYM_PLANE_CODE`'s collapsed 3-value vocabulary, and that is
 * the whole point of the escape4 kaleidoscope fixture: the descents map
 * `xw`/`yw`/`zw` onto `0`/`1`/`2` (sound for them — their kaleidoscope is
 * a swept matrix), where this fold picks its two axes BY NAME and a
 * `w`-plane is exactly the case the 3D gate refuses. Measured: a twin
 * built on the collapsed table excludes 220 of `esc4ChainKaleido`'s 700
 * queries against the shipped 69, and moves NO other row.
 */
const ESCAPE4_PLANE_AXES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [0, 3],
  [1, 3],
  [2, 3],
];

/**
 * The `core: "escape4"` kernel's VIEW LIFT in f32 — the body's
 * `liftEscape4`, `vec4f(pIn, params.w0)` through the packed `rotorInv`
 * rows, where row `i` is `(rot[i], rot[4+i], rot[8+i], rot[12+i])` (the
 * one real transpose, performed by `packEscape4GpuParams`).
 *
 * It is a SEPARATE function from the twin below because the comparator's
 * ULP-neighbor walks ({@link forwardQueryStable},
 * {@link forwardShadowFlipVerified}) perturb the 3D MARCHED point, which
 * is what the kernel is handed — so the lift has to sit inside the
 * closure they call, not outside it, or the neighbourhood being explored
 * would be the wrong one.
 *
 * MEASURED, and each mutation moves exactly the fixture written for it
 * (700 queries per row, ensemble exclusions against the shipped count):
 * dropping the rotor moves `esc4ChainQsquare` 58 -> 276 and
 * `esc4ChainSliceRot` 70 -> 246 and nothing else; dropping `w0` moves
 * `esc4ChainSlice` 44 -> 511 and `esc4ChainSliceRot` 70 -> 535; and
 * adding `w0` to the lifted `w` component AFTER the rotor instead of
 * inside it — the plausible transcription slip that both single-term
 * fixtures survive — is caught by `esc4ChainSliceRot` ALONE, 70 -> 559.
 */
function liftEscape4F32(view4: SurfaceGpu4View, q: Vec3): Vec4 {
  const f = Math.fround;
  // Rounded copy rather than `.map` — `SurfaceGpu4View.rotor` is an
  // `ArrayLike<number>` (the packer only ever indexes it).
  const rot: number[] = [];
  for (let i = 0; i < 16; i++) rot.push(f(view4.rotor[i]));
  const w0 = f(view4.w0);
  const x = f(q[0]);
  const y = f(q[1]);
  const z = f(q[2]);
  const out: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    out[i] = f(
      f(f(f(rot[i] * x) + f(rot[4 + i] * y)) + f(rot[8 + i] * z)) +
        f(rot[12 + i] * w0),
    );
  }
  return out;
}

/**
 * The bench's f32 twin of `estimateEscapeDistance4` —
 * {@link estimateEscapeDistanceF32} one dimension up, term for term, with
 * every intermediate `Math.fround`ed. Its job is that twin's exactly:
 * comparing it against the f64 oracle in isolation, before either touches
 * the GPU, separates f32-vs-f64 ORBIT divergence (a forward iteration is
 * chaotic — one clamp-boundary rounding flip early on sends the whole
 * trajectory elsewhere) from actual kernel arithmetic bugs. See
 * `compareSurfaceForwardAgreement`'s doc for how the gap is used.
 *
 * A STALE TWIN DOES NOT DISAGREE — IT MAKES THE ENSEMBLE EXCLUDE
 * EVERYTHING, which reads as a chaotic fixture rather than as a stale
 * copy (the authored-lengths work measured 251 of 700 that way on the 3D
 * leg). So every branch below was mutation-tested against the fixture set,
 * and each
 * mutation moves exactly the row written for it and leaves the others at
 * their shipped count:
 *
 *   mutation                                     row that catches it
 *   omit the link's forward post                 esc4SpherefoldPost
 *                                                  0 -> 290
 *   `x² − y² − z²` for the quaternion square     esc4ChainQsquare
 *     (the 3D restriction, `w` dropped)            58 -> 203
 *   the box fold reflecting x/y/z only           ALL SIX rows
 *                                                  -> 321..407
 *   the descents' collapsed plane code           esc4ChainKaleido
 *                                                  69 -> 220
 *   the linear `r/dr` regardless of              esc4ChainQsquare
 *     `logEstimate`                                58 -> 538
 *
 * (the lift's own two mutations are on {@link liftEscape4F32}). The
 * fourth row is worth reading twice: EVERY fixture is genuinely 4D by
 * that measure, which is what "the escape-time family's 4D half" has to
 * mean before any of the rest is worth checking.
 *
 * There is no `bulb` branch and there cannot be one:
 * `analyzeEscapeSystem4` refuses a triplex power outright (it has no
 * fourth component — `escape-de-4d.ts`'s WHAT LIFTS section), so the
 * `kind < 4` guard's else-arm is the quaternion square alone.
 */
function estimateEscapeDistance4F32(
  de: EscapeDE4,
  p: Vec4,
  trap: ResolvedShapeTrap | null = null,
): number {
  const f = Math.fround;
  const geometryTrap = trap?.geometry ? trap : null;
  let trapDistance = Infinity;
  // One pre-rounded link per slot, cycled `i mod n` — the 3D twin's own
  // shape, and the same per-LINK fold lengths (the SQUARES, which are the
  // form `EscapeLink4` keeps and the `fold` lane carries).
  const links = de.links.map((link) => ({
    m: link.m.map(f),
    t: link.t.map(f),
    // Forward post rows/translation, matching packSurfaceEscape4GpuMaps.
    // This is part of the orbit the classifier must model, not metadata:
    // dropping it compares an unposted twin with the posted f64 oracle.
    postM: link.postM?.map(f) ?? null,
    postT: link.postT?.map(f) ?? null,
    w: f(link.w),
    g: f(link.derivGrowth),
    kind: link.kind,
    wall: f(link.boxLimit),
    mR2: f(link.minRadius2),
    fR2: f(link.fixedRadius2),
  }));
  const n = links.length;
  // The kaleidoscope's query-space wedge fold, ONCE before the orbit —
  // the kernel's `foldQuerySector4`, f32 throughout (its own trig
  // included, which is where this twin and the GPU can legitimately
  // differ by a rounding on a sector boundary; the ensemble classifier
  // absorbs that exactly as it absorbs the orbit's chaos). The two
  // coordinates outside the plane ride through untouched, so unlike 3D
  // this is a write to two of four lanes rather than a three-way switch.
  const q: Vec4 = [f(p[0]), f(p[1]), f(p[2]), f(p[3])];
  if (de.symmetryOrder > 1) {
    const [ia, ib] = ESCAPE4_PLANE_AXES[SYM_PLANE_CODE4[de.symmetryPlane]];
    const a = q[ia];
    const b = q[ib];
    const sector = f(f(2 * Math.PI) / de.symmetryOrder);
    const turn = f(Math.round(f(Math.atan2(b, a) / sector)) * sector);
    const c = f(Math.cos(turn));
    const s = f(Math.sin(turn));
    q[ia] = f(f(a * c) + f(b * s));
    q[ib] = Math.abs(f(f(b * c) - f(a * s)));
  }
  let vx = q[0];
  let vy = q[1];
  let vz = q[2];
  let vw = q[3];
  let dr = 1;
  let r = f(
    Math.sqrt(f(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz)) + f(vw * vw))),
  );
  const fold = (x: number, wall: number): number =>
    f(f(2 * Math.max(-wall, Math.min(wall, x))) - x);
  // A PASS is one full cycle, so the budget is ESCAPE_TIME_ITERATIONS
  // applications OF EACH LINK — dimension-free, like everything else
  // structural about this orbit (escape-de-4d.ts's THE ORBIT IS
  // DIMENSION-FREE paragraph).
  const steps = ESCAPE_TIME_ITERATIONS * n;
  for (let i = 0; i < steps && r <= de.boundingRadius; i++) {
    const link = links[i % n];
    const m = link.m;
    const t = link.t;
    let yx = f(
      f(f(f(f(m[0] * vx) + f(m[1] * vy)) + f(m[2] * vz)) + f(m[3] * vw)) + t[0],
    );
    let yy = f(
      f(f(f(f(m[4] * vx) + f(m[5] * vy)) + f(m[6] * vz)) + f(m[7] * vw)) + t[1],
    );
    let yz = f(
      f(f(f(f(m[8] * vx) + f(m[9] * vy)) + f(m[10] * vz)) + f(m[11] * vw)) +
        t[2],
    );
    let yw = f(
      f(f(f(f(m[12] * vx) + f(m[13] * vy)) + f(m[14] * vz)) + f(m[15] * vw)) +
        t[3],
    );
    let localL = 1;
    // The fold pair sits behind the kernel's own `kind < 4` guard — the
    // two NEGATIVE tests below are exhaustive by negation over {1, 2, 3}
    // alone, so the quaternion square has to be kept OUT of them rather
    // than added beside them (surface-de-gpu.ts's escape4 body cites the
    // same hazard).
    if (link.kind < 4) {
      if (link.kind !== 2) {
        // The box fold, reflecting the FOURTH axis too — `variations4.ts`
        // treats `w` exactly like a spatial axis.
        yx = fold(yx, link.wall);
        yy = fold(yy, link.wall);
        yz = fold(yz, link.wall);
        yw = fold(yw, link.wall);
      }
      if (link.kind !== 1) {
        // The sphere fold through the FULL 4-radius.
        const r2 = f(f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz)) + f(yw * yw));
        const s = f(link.fR2 / Math.max(link.mR2, Math.min(link.fR2, r2)));
        yx = f(yx * s);
        yy = f(yy * s);
        yz = f(yz * s);
        yw = f(yw * s);
        localL = s;
      }
    } else {
      // The FULL quaternion square `(x²−y²−z²−w², 2xy, 2xz, 2xw)` — the
      // 4D form is the DEFINITION and the 3D one is its `w = 0`
      // restriction. `2·|y|` stays EXACT rather than a bound in either
      // dimension: quaternion norms multiply on the whole algebra, not
      // merely on span{1, i, j}. Computed BEFORE `y` is overwritten,
      // exactly as the kernel orders it.
      localL = f(
        2 *
          f(
            Math.sqrt(
              f(f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz)) + f(yw * yw)),
            ),
          ),
      );
      const nx = f(f(f(f(yx * yx) - f(yy * yy)) - f(yz * yz)) - f(yw * yw));
      const ny = f(f(2 * yx) * yy);
      const nz = f(f(2 * yx) * yz);
      const nw = f(f(2 * yx) * yw);
      yx = nx;
      yy = ny;
      yz = nz;
      yw = nw;
    }
    // The production WGSL's `linkPostForward4(L, L.p0.y * y) + q`, with
    // the same row-major post and f32 operation boundaries. The no-post
    // arm remains the exact pre-existing weight fold-in.
    if (link.postM !== null && link.postT !== null) {
      const pm = link.postM;
      const pt = link.postT;
      const wx = f(link.w * yx);
      const wy = f(link.w * yy);
      const wz = f(link.w * yz);
      const ww = f(link.w * yw);
      const fx = f(
        f(f(f(f(pm[0] * wx) + f(pm[1] * wy)) + f(pm[2] * wz)) + f(pm[3] * ww)) +
          pt[0],
      );
      const fy = f(
        f(f(f(f(pm[4] * wx) + f(pm[5] * wy)) + f(pm[6] * wz)) + f(pm[7] * ww)) +
          pt[1],
      );
      const fz = f(
        f(
          f(f(f(pm[8] * wx) + f(pm[9] * wy)) + f(pm[10] * wz)) + f(pm[11] * ww),
        ) + pt[2],
      );
      const fw = f(
        f(
          f(f(f(pm[12] * wx) + f(pm[13] * wy)) + f(pm[14] * wz)) +
            f(pm[15] * ww),
        ) + pt[3],
      );
      vx = f(fx + q[0]);
      vy = f(fy + q[1]);
      vz = f(fz + q[2]);
      vw = f(fw + q[3]);
    } else {
      vx = f(f(link.w * yx) + q[0]);
      vy = f(f(link.w * yy) + q[1]);
      vz = f(f(link.w * yz) + q[2]);
      vw = f(f(link.w * yw) + q[3]);
    }
    dr = f(f(f(link.g * localL) * dr) + 1);
    r = f(
      Math.sqrt(f(f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz)) + f(vw * vw))),
    );
    if (
      geometryTrap &&
      i >= geometryTrap.geometryLevelMin &&
      i <= geometryTrap.geometryLevelMax
    ) {
      // The 4D CPU oracle and kernel both apply the shared 3D trap
      // vocabulary to xyz. This is the signed distance to its w-extrusion,
      // hence remains 1-Lipschitz in the full orbit space.
      trapDistance = Math.min(
        trapDistance,
        trapGeometryDistanceF32(geometryTrap, vx, vy, vz, dr),
      );
    }
  }
  // The chain's escape law picks the form — `EscapeDE4.logEstimate` rides
  // `esc4Params.x` on this core's wire (the 3D core spells the same
  // number `escParams.w`), so the twin must read the flag the kernel
  // reads. In 4D `logEstimate` is true exactly when some link is a
  // quaternion square, the family's only surviving power map.
  const escapeDistance = !de.logEstimate
    ? r / dr
    : r <= 1
      ? 0
      : f(f(f(0.5 * r) * f(Math.log(r))) / dr);
  return geometryTrap ? Math.min(escapeDistance, trapDistance) : escapeDistance;
}

/**
 * The bench's f32 twin of `estimateBulbDistance` — the SIXTH
 * and last copy of that formula (oracle, GLSL value, GLSL hit, WGSL
 * value, WGSL hit, this), written term for term against the oracle with
 * every intermediate `Math.fround`ed and every association matched
 * (JS, WGSL and GLSL all evaluate `a * b * c` left to right, so
 * `128 * z2 * z2 * z2 * z2` is one shape in all four shader/CPU copies).
 * Its job is the escape twin's: comparing it against the f64 oracle in
 * isolation, before either touches the GPU, separates f32-vs-f64 ORBIT
 * divergence from actual kernel arithmetic bugs — and a power-8 orbit
 * multiplies a perturbation by `8r⁷` per step, so it diverges harder than
 * the folds' ~8x (bulb-de.ts's closing warning measured two f64
 * implementations of the SAME map disagreeing about membership on 0.22%
 * of the ball).
 */
function estimateBulbDistanceF32(de: BulbDE, p: Vec3): number {
  const f = Math.fround;
  const m = de.m.map(f);
  const t = de.t.map(f);
  const sigma = f(de.sigmaMax);
  const bail = f(de.bailout);
  const px = f(p[0]);
  const py = f(p[1]);
  const pz = f(p[2]);
  // y_0 = M p + t.
  const cx = f(f(f(f(m[0] * px) + f(m[1] * py)) + f(m[2] * pz)) + t[0]);
  const cy = f(f(f(f(m[3] * px) + f(m[4] * py)) + f(m[5] * pz)) + t[1]);
  const cz = f(f(f(f(m[6] * px) + f(m[7] * py)) + f(m[8] * pz)) + t[2]);
  let yx = cx;
  let yy = cy;
  let yz = cz;
  let dr = sigma;
  let r2 = f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz));
  let r = f(Math.sqrt(r2));
  for (let i = 0; i < BULB_ITERATIONS && r <= bail; i++) {
    // 8 * (r2*r2*r2*r) * sigma * dr + sigma.
    const r7 = f(f(f(r2 * r2) * r2) * r);
    dr = f(f(f(f(8 * r7) * sigma) * dr) + sigma);
    // triplexPow8, inlined exactly as the oracle inlines it.
    const a = f(f(yx * yx) + f(yy * yy));
    const z2 = f(yz * yz);
    const r4 = f(r2 * r2);
    const vz = f(
      f(
        f(
          f(
            f(f(f(f(128 * z2) * z2) * z2) * z2) -
              f(f(f(f(256 * z2) * z2) * z2) * r2),
          ) + f(f(f(160 * z2) * z2) * r4),
        ) - f(f(f(32 * z2) * r4) * r2),
      ) + f(r4 * r4),
    );
    const s = f(
      f(
        f(
          f(f(f(f(128 * z2) * z2) * z2) * yz) -
            f(f(f(f(192 * z2) * z2) * yz) * r2),
        ) + f(f(f(80 * z2) * yz) * r4),
      ) - f(f(f(8 * yz) * r4) * r2),
    );
    const rho = f(Math.sqrt(a));
    const inv = rho > 0 ? f(1 / rho) : 0;
    const u1 = f(yx * inv);
    const v1 = f(yy * inv);
    const u2 = f(f(u1 * u1) - f(v1 * v1));
    const v2 = f(f(2 * u1) * v1);
    const u4 = f(f(u2 * u2) - f(v2 * v2));
    const v4 = f(f(2 * u2) * v2);
    const u8 = f(f(u4 * u4) - f(v4 * v4));
    const v8 = f(f(2 * u4) * v4);
    const vx = f(f(rho * s) * u8);
    const vy = f(f(rho * s) * v8);
    yx = f(f(f(f(m[0] * vx) + f(m[1] * vy)) + f(m[2] * vz)) + cx);
    yy = f(f(f(f(m[3] * vx) + f(m[4] * vy)) + f(m[5] * vz)) + cy);
    yz = f(f(f(f(m[6] * vx) + f(m[7] * vy)) + f(m[8] * vz)) + cz);
    r2 = f(f(f(yx * yx) + f(yy * yy)) + f(yz * yz));
    r = f(Math.sqrt(r2));
  }
  // The ln|y| clamp below 1 — a converging orbit reaches it, and a
  // negative estimate would march the tracer backwards.
  return r <= 1 ? 0 : f(f(f(0.5 * r) * f(Math.log(r))) / dr);
}

/**
 * The ENSEMBLE half of the FORWARD-orbit stability classifier
 * (generalized from the escape leg's own by taking the f32
 * evaluator as an argument — the mechanism is formula-agnostic, so the
 * bulb leg reuses this one rather than growing a fourth copy of the
 * ULP-neighbor walk; every word below was measured on the escape orbit
 * and applies unchanged to the power orbit, whose noise growth is `8r⁷`
 * per step rather than the folds' ~8x). The
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
function forwardQueryStable(
  evalF32: (p: Vec3) => number,
  q: Vec3,
  cpu64: number,
  tol: number,
): boolean {
  if (Math.abs(evalF32(q) - cpu64) > tol / 2) {
    return false;
  }
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const p: Vec3 = [q[0], q[1], q[2]];
      const base = Math.fround(p[axis]);
      const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38);
      p[axis] = Math.fround(base + dir * step);
      if (Math.abs(evalF32(p) - cpu64) > tol / 2) {
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

function surfaceCameraDepth(
  pose: Pick<SurfaceGpuPose, "ro" | "fwd">,
  center: Vec3 = [0, 0, 0],
): number {
  return (
    (center[0] - pose.ro[0]) * pose.fwd[0] +
    (center[1] - pose.ro[1]) * pose.fwd[1] +
    (center[2] - pose.ro[2]) * pose.fwd[2]
  );
}

/** `poseRays`'s camera math (scripts/fold-cost-split.harness.ts) verbatim —
 * target origin, orbit angles (0.9, 1.2), distance
 * `distFactor` × visibleBoundingRadius (default `SURFACE_POSE_DIST_FACTOR`
 * 2.4 — every existing caller), vertical fov 60° — packed into the kernel's
 * {@link SurfaceGpuPose}. `distFactor` is the shade probe-width A/B leg's
 * hook for its closer "near" pose
 * ({@link SURFACE_SHADE_AB_NEAR_DIST_FACTOR}). The optional authored camera
 * pins the finite Balloon frames to the production-browser fixtures while
 * retaining this gate's established raster and acceptance epsilon. */
function buildSurfacePose(
  // Structural pick, not the whole DE: the escape frame leg frames its
  // bailout ball through the same pose math.
  de: Pick<SurfaceDE, "visibleBoundingRadius">,
  rasterWidth: number,
  rasterHeight: number,
  distFactor: number = SURFACE_POSE_DIST_FACTOR,
  camera?: { radius: number; theta: number; phi: number; fov: number },
): SurfaceGpuPose {
  const target: Vec3 = [0, 0, 0];
  const radius = camera?.radius ?? distFactor * de.visibleBoundingRadius;
  const theta = camera?.theta ?? SURFACE_POSE_THETA;
  const phi = camera?.phi ?? SURFACE_POSE_PHI;
  const ro: Vec3 = [
    target[0] + radius * Math.sin(phi) * Math.sin(theta),
    target[1] + radius * Math.cos(phi),
    target[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
  const fwd = surfaceNormalize([
    target[0] - ro[0],
    target[1] - ro[1],
    target[2] - ro[2],
  ]);
  const right = surfaceNormalize(surfaceCross(fwd, [0, 1, 0]));
  const up = surfaceCross(right, fwd);
  const fov = ((camera?.fov ?? SURFACE_POSE_FOV_DEG) * Math.PI) / 180;
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
/** The estimator a system's kernel marches — the freeze loop's
 * routing, verbatim: fold base maps the plain descent, fold-free ones the
 * refined ladder; both route a `foldFinal` through `descendLens`
 * internally, so the march emulators stay one call either way. */
function surfaceMarchEstimate(
  de: SurfaceDE | SurfaceDE4,
  p: Vec3,
  eps: number,
  view4: SurfaceGpu4View | null = null,
  tiling: ResolvedFiniteTiling | null = null,
): number {
  if (tiling) {
    if (view4) {
      const de4 = de as SurfaceDE4;
      const query = surface4ComposedQuery(view4, p);
      return deHasFolds4(de4)
        ? estimateDistance4Tiled(tiling, de4, query.p, query.ext)
        : estimateDistance4RefinedTiled(tiling, de4, query.p, eps, query.ext);
    }
    const de3 = de as SurfaceDE;
    return deHasFolds(de3)
      ? estimateDistanceTiled(tiling, de3, p, eps)
      : estimateDistanceRefinedTiled(tiling, de3, p, eps);
  }
  if (view4) {
    const de4 = de as SurfaceDE4;
    return estimateSurface4Composed(de4, view4, p, !deHasFolds4(de4), eps);
  }
  const de3 = de as SurfaceDE;
  return deHasFolds(de3)
    ? estimateDistance(de3, p, eps)
    : estimateDistanceRefined(de3, p, eps);
}

/** Paired CPU oracle for the production march, with the same view lift,
 * core choice and cutoff as scalar acceptance evals. */
function surfaceMarchSample(
  de: SurfaceDE | SurfaceDE4,
  p: Vec3,
  eps: number,
  view4: SurfaceGpu4View | null = null,
  tiling: ResolvedFiniteTiling | null = null,
): SurfaceDistanceSample {
  if (tiling) {
    if (view4) {
      const de4 = de as SurfaceDE4;
      const query = surface4ComposedQuery(view4, p);
      return deHasFolds4(de4)
        ? estimateDistance4SampleTiled(tiling, de4, query.p, query.ext)
        : estimateDistance4RefinedSampleTiled(
            tiling,
            de4,
            query.p,
            eps,
            query.ext,
          );
    }
    const de3 = de as SurfaceDE;
    return deHasFolds(de3)
      ? estimateDistanceSampleTiled(tiling, de3, p, eps)
      : estimateDistanceRefinedSampleTiled(tiling, de3, p, eps);
  }
  if (view4) {
    const de4 = de as SurfaceDE4;
    const query = surface4ComposedQuery(view4, p);
    return deHasFolds4(de4)
      ? estimateDistance4Sample(de4, query.p, query.ext)
      : estimateDistance4RefinedSample(de4, query.p, eps, query.ext);
  }
  const de3 = de as SurfaceDE;
  return deHasFolds(de3)
    ? estimateDistanceSample(de3, p, eps)
    : estimateDistanceRefinedSample(de3, p, eps);
}

/** The march emulators' balloon arm: the oracle ball in
 * `buildBalloon`'s convention plus the march far cap — present exactly
 * when a leg marches a `balloon: true` kernel. */
interface SurfaceCpuBalloon {
  b: Balloon;
  far: number;
  tiling?: ResolvedFiniteTiling;
}

/** {@link surfaceMarchEstimate} under the balloon union:
 * `estimateBalloonDistance` composed over the SAME core-routed estimator
 * — the exact function the balloon kernels mirror (the wrapper over the
 * public descent, `balloon-de.ts`'s oracle link). */
function surfaceBalloonMarchDistance(
  de: SurfaceDE | SurfaceDE4,
  balloon: SurfaceCpuBalloon,
  p: Vec3,
  eps: number,
  view4: SurfaceGpu4View | null = null,
): BalloonDistance {
  if (view4) {
    return estimateBalloonDistance4(
      (d, q, cutoff = 0) =>
        surfaceMarchEstimate(
          d,
          [q[0], q[1], q[2]],
          cutoff,
          view4,
          balloon.tiling,
        ),
      de as SurfaceDE4,
      balloon.b,
      p,
      view4.w0,
      eps,
    );
  }
  return estimateBalloonDistance(
    (d, q, cutoff = 0) =>
      surfaceMarchEstimate(d, q, cutoff, null, balloon.tiling),
    de as SurfaceDE,
    balloon.b,
    p,
    eps,
  );
}

function surfaceBalloonMarchEstimate(
  de: SurfaceDE | SurfaceDE4,
  balloon: SurfaceCpuBalloon,
  p: Vec3,
  eps: number,
  view4: SurfaceGpu4View | null = null,
): number {
  return surfaceBalloonMarchDistance(de, balloon, p, eps, view4).d;
}

function surfaceBalloonMarchSample(
  de: SurfaceDE | SurfaceDE4,
  balloon: SurfaceCpuBalloon,
  p: Vec3,
  eps: number,
  view4: SurfaceGpu4View | null = null,
): SurfaceDistanceSample {
  if (view4) {
    return estimateBalloonDistance4Sample(
      (d, q, cutoff = 0) =>
        surfaceMarchSample(
          d,
          [q[0], q[1], q[2]],
          cutoff,
          view4,
          balloon.tiling,
        ),
      de as SurfaceDE4,
      balloon.b,
      p,
      view4.w0,
      eps,
    );
  }
  return estimateBalloonDistanceSample(
    (d, q, cutoff = 0) =>
      surfaceMarchSample(d, q, cutoff, null, balloon.tiling),
    de as SurfaceDE,
    balloon.b,
    p,
    eps,
  );
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
    const eps =
      surfaceSwirlAcceptanceScale(de) *
      Math.max(pixelEps * t, de.boundingRadius * SURFACE_GPU_HIT_FLOOR);
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

/** Legal interval of the production march gate on one ray. */
function surfaceCpuMarchInterval(
  de: SurfaceDE | SurfaceDE4,
  ro: Vec3,
  rd: Vec3,
  balloon: SurfaceCpuBalloon | null,
  view4: SurfaceGpu4View | null = null,
): { tEnter: number; tFar: number } | null {
  if (balloon) {
    const c = balloon.b.center;
    return {
      tEnter: 0,
      tFar: Math.hypot(ro[0] - c[0], ro[1] - c[1], ro[2] - c[2]) + balloon.far,
    };
  }
  const minW = view4 ? Math.max(Math.abs(view4.w0) - view4.sliceHalfW, 0) : 0;
  const visR = de.visibleBoundingRadius;
  const radius =
    (view4 ? Math.sqrt(Math.max(visR * visR - minW * minW, 0)) : visR) * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return null;
  return { tEnter: Math.max(-b - sq, 0), tFar };
}

/**
 * {@link surfaceCpuMarch} with the terminal CONTRACT surfaced — status +
 * final `t`, mirroring marchRays' persisted-state semantics exactly (one
 * continuous f64 loop ≡ the kernel's pass-bounded loop resumed on
 * `(t, steps)`; the check order — sphere exit, then budget, then eval — is
 * the kernel's). Ray derivation is the caller's; the loop itself stays
 * surfaceCpuMarch's: f64 accumulation, {@link surfaceMarchEstimate} (the
 * system's own core estimator), the same
 * eps/hit-floor/stepScale. Pre-gate misses report `t = −1`, matching the
 * kernel's untouched `st.x` initialization.
 */
function surfaceCpuMarchState(
  de: SurfaceDE | SurfaceDE4,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
  balloon: SurfaceCpuBalloon | null = null,
  view4: SurfaceGpu4View | null = null,
): { status: number; t: number } {
  const interval = surfaceCpuMarchInterval(de, ro, rd, balloon, view4);
  if (!interval) return { status: SURFACE_GPU_RAY_MISS, t: -1 };
  let t = interval.tEnter;
  const { tFar } = interval;
  let steps = 0;
  for (;;) {
    if (t > tFar) return { status: SURFACE_GPU_RAY_MISS, t };
    if (steps >= maxSteps) return { status: SURFACE_GPU_RAY_EXHAUSTED, t };
    const eps =
      surfaceSwirlAcceptanceScale(de) *
      Math.max(pixelEps * t, de.boundingRadius * SURFACE_GPU_HIT_FLOOR);
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const { d, stride } = balloon
      ? surfaceBalloonMarchSample(de, balloon, p, eps, view4)
      : surfaceMarchSample(de, p, eps, view4);
    steps++;
    if (d < eps) return { status: SURFACE_GPU_RAY_HIT, t };
    t += (balloon ? stride : d) * de.stepScale;
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
 * This is what the silhouetteFlips exclusion GATES on, not merely
 * what a row prints: a terminal `t` says where a march stopped, and for a
 * hit-vs-miss pair those places are unrelated by construction, but the
 * closest approach says where it came NEAREST — the one place both sides
 * can be compared. `tAtMin` is therefore the evidence that two marches
 * tracked the same trajectory, and `minRatio` the evidence that the
 * acceptance test itself was the marginal quantity.
 */
function surfaceCpuMarchApproach(
  de: SurfaceDE | SurfaceDE4,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
  balloon: SurfaceCpuBalloon | null = null,
  view4: SurfaceGpu4View | null = null,
): { minRatio: number; tAtMin: number } {
  const interval = surfaceCpuMarchInterval(de, ro, rd, balloon, view4);
  if (!interval) return { minRatio: Infinity, tAtMin: -1 };
  let t = interval.tEnter;
  const { tFar } = interval;
  let minRatio = Infinity;
  let tAtMin = -1;
  for (let steps = 0; steps < maxSteps && t <= tFar; steps++) {
    const eps =
      surfaceSwirlAcceptanceScale(de) *
      Math.max(pixelEps * t, de.boundingRadius * SURFACE_GPU_HIT_FLOOR);
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const { d, stride } = balloon
      ? surfaceBalloonMarchSample(de, balloon, p, eps, view4)
      : surfaceMarchSample(de, p, eps, view4);
    const ratio = d / eps;
    if (ratio < minRatio) {
      minRatio = ratio;
      tAtMin = t;
    }
    if (d < eps) break;
    t += (balloon ? stride : d) * de.stepScale;
  }
  return { minRatio, tAtMin };
}

/**
 * Pointwise CPU-oracle search inside an already-authorized hit-distance
 * corridor, clamped to the legal production march interval. This directly
 * tests output geometry: one of 65 evenly spaced points must satisfy the
 * ordinary strict `d < eps(t)` condition. It does not claim why two marchers
 * sampled different points, or widen either the t tolerance or hit test.
 *
 * Called only for the handful of both-hit rays already outside the t gate,
 * so the deliberately dense oracle scan is immaterial to benchmark timing.
 */
function surfaceCpuHitTCorridor(
  de: SurfaceDE | SurfaceDE4,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  center: number,
  radius: number,
  balloon: SurfaceCpuBalloon | null = null,
  view4: SurfaceGpu4View | null = null,
): { hit: boolean; minRatio: number; tAtMin: number } {
  const segments = 64;
  const interval = surfaceCpuMarchInterval(de, ro, rd, balloon, view4);
  if (!interval) return { hit: false, minRatio: Infinity, tAtMin: -1 };
  const lo = Math.max(interval.tEnter, center - radius);
  const hi = Math.min(interval.tFar, center + radius);
  if (lo > hi) return { hit: false, minRatio: Infinity, tAtMin: -1 };
  let minRatio = Infinity;
  let tAtMin = lo;
  for (let i = 0; i <= segments; i++) {
    const t = lo + ((hi - lo) * i) / segments;
    const eps =
      surfaceSwirlAcceptanceScale(de) *
      Math.max(pixelEps * t, de.boundingRadius * SURFACE_GPU_HIT_FLOOR);
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = balloon
      ? surfaceBalloonMarchEstimate(de, balloon, p, eps, view4)
      : surfaceMarchEstimate(de, p, eps, view4);
    const ratio = d / eps;
    if (ratio < minRatio) {
      minRatio = ratio;
      tAtMin = t;
    }
  }
  return { hit: minRatio < 1, minRatio, tAtMin };
}

/**
 * What a status mismatch the boundary rule did not cover prints
 * about ITSELF — whether it went on to be excluded as a silhouette flip or
 * to fail the gate (the caller tags which). The aggregate counters name a
 * count, never a ray, so the first move on a red verdict used to be
 * re-deriving the ray by hand from the leg's pose; this puts its index,
 * direction, both terminal states, and the two pieces of evidence that
 * distinguish a silhouette flip from a diverged trajectory on the record
 * instead:
 *
 * - `oracle` — the CPU oracle's distance at the HITTING side's endpoint,
 *   relative to that endpoint's own acceptance eps. The corridor test may
 *   still confirm nearby output geometry when this single point lies across
 *   a discontinuity.
 * - `approach` — the caller's already-computed {@link surfaceCpuMarchApproach}
 *   result (closest approach in eps units), supplied rather than recomputed
 *   here — the caller already needed it for the silhouetteFlips test. Just
 *   above 1 means the f64 march came within rounding of a hit.
 */
function describeSurfaceUnprojectMismatch(
  de: SurfaceDE | SurfaceDE4,
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
    gpuLastD?: number;
    cpuStatus: number;
    cpuT: number;
    tol: number;
  },
  balloon: SurfaceCpuBalloon | null = null,
  view4: SurfaceGpu4View | null = null,
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
    const eps =
      surfaceSwirlAcceptanceScale(de) *
      Math.max(pixelEps * hitT, de.boundingRadius * SURFACE_GPU_HIT_FLOOR);
    // A balloon hit's endpoint can sit on the SHELL, so the on-surface
    // question is the union's, not the fractal's alone. Route the core the
    // same way the march does: fold-free systems use the refined ladder.
    const distanceAt = (q: Vec3): number =>
      balloon
        ? surfaceBalloonMarchEstimate(de, balloon, q, eps, view4)
        : surfaceMarchEstimate(de, q, eps, view4);
    const d = distanceAt(p);
    // The kernel constructs p in f32. Report both legal host-side models of
    // that expression as diagnostic evidence: implementations may contract
    // `ro + rd * t` into an FMA, while the split form rounds the product
    // first. The f64 reconstruction above can lie on another side of a thin
    // fold boundary even when the stored ray/t agree exactly.
    const pFused = p.map((v) => Math.fround(v)) as Vec3;
    const pSplit = ro.map((v, i) =>
      Math.fround(v + Math.fround(rd[i] * hitT)),
    ) as Vec3;
    const dFused = distanceAt(pFused);
    const dSplit = distanceAt(pSplit);
    const side = info.gpuStatus === SURFACE_GPU_RAY_HIT ? "gpu" : "cpu";
    oracle =
      `${side} endpoint d/eps=${(d / eps).toExponential(2)} ` +
      `(f32 fused=${(dFused / eps).toExponential(2)} ` +
      `split=${(dSplit / eps).toExponential(2)} ` +
      `d=${d.toExponential(2)} eps=${eps.toExponential(2)})`;
  }
  const gpuTerminal =
    info.gpuStatus === SURFACE_GPU_RAY_HIT && info.gpuLastD !== undefined
      ? (() => {
          const eps = Math.fround(
            Math.fround(surfaceSwirlAcceptanceScale(de)) *
              Math.max(
                Math.fround(Math.fround(pixelEps) * Math.fround(info.gpuT)),
                Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR),
              ),
          );
          return `gpuTerminalD/eps=${(info.gpuLastD / eps).toExponential(2)} `;
        })()
      : "";
  return (
    `ray=${String(info.ray)} px=${String(info.px)},${String(info.py)} ` +
    `gpu=${surfaceRayStatusName(info.gpuStatus)}@t=${info.gpuT.toExponential(4)} ` +
    `cpu=${surfaceRayStatusName(info.cpuStatus)}@t=${info.cpuT.toExponential(4)} ` +
    `|dt|=${Math.abs(info.gpuT - info.cpuT).toExponential(2)} tol=${info.tol.toExponential(2)} ` +
    gpuTerminal +
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
 * The transport agreement legs' control entry, appended to an optics
 * shade-mode module (`surfaceDeKernelWgsl({ mode: "shade", optics: true, … })`)
 * — one dispatchable probe per control query against the kernel's OWN
 * emitted transport: mode 1 runs the leg backend's boundary query, mode 0
 * runs `transportTrace` against the fixed backdrop the CPU twin's
 * `bgLinear` mirrors (`SURFACE_TRANSPORT_CONTROL_BG`). Read through
 * `layout: "auto"`: the pipeline is created for this entry alone, so its
 * derived bind-group layout carries only the bindings the control
 * transitively uses — 0 params, 1 maps (absent on the bindingless cores:
 * bulb and the finite pair), and the two control buffers at 16/17; the
 * shade entry's texture/shadeMaps/transport tail bindings stay out of the
 * derived layout and are never created. The bounds discipline is the
 * caller's: queries are padded to a workgroup multiple so `gid.x` never
 * indexes past the array.
 */
/** The transport control entry, per boundary backend: the emitted
 * `transportNextBoundary` signature carries the caller-carried medium
 * only under the closed-solid backend (the estimator query is
 * sign-agnostic), so the mode-1 call site interpolates it; the
 * finite-solid backend's mode 1 is the DDA's own signature (the caller
 * carries the full anchor contract, and the medium claim rides `inside`).
 * The `inside` word rides the query record's last slot (offset 92 of the
 * 96-byte stride) in BOTH backends; the estimator legs pack 0 and never
 * read it. The estimator and closed-solid emissions are byte-identical to
 * their pre-finite text: only the two struct tails and the mode-1 body
 * are backend-conditional, and the finite backend's extra fields extend
 * the strides (query 128 → 192, result 64 → 96) without moving an older
 * offset. */
function surfaceTransportControlWgsl(
  backend: SurfaceTransportLegBackend,
): string {
  // The sphere-inversion glass backend rides the closed-solid query's
  // signature (the caller-carried medium) and its shadow/terminal helpers,
  // so the control's call sites are the closed-solid ones verbatim.
  const solid = surfaceTransportSignedBackend(backend);
  const finite = backend === "finiteSolid";
  return `
struct ControlQuery {
  origin: vec3f,
  dir: vec3f,
  anchorPoint: vec3f,
  eps: f32,
  ior: f32,
  radius: f32,
  absorb: vec3f,
  theta: f32,
  anchorPresent: u32,
  mode: u32,
  inside: u32,
  // Mode 2 (the closed-solid straight shadow visibility) reads the
  // corridor's ball: center, radius, and the session's visible radius
  // for the stride clamp's ceiling. The estimator legs pack zeros and
  // never reach mode 2.
  ballC: vec3f,
  ballR: f32,
  visR: f32,
  // The optical distortion's authored word (lane 1.y) — the trace probes
  // pass it through; zero on every probe that pins the straight terminal.
  // Fills the 128-byte stride's last word (offset 116); the stride does
  // not move.
  distortion: f32,${
    finite
      ? `
  // The finite-solid DDA's caller-carried anchor (the oracle's
  // FiniteSolidAnchor): the snapped intrinsic intersection point, the
  // tied-plane mask, and the tied-plane / post-incident cell indices —
  // the anchored restart consumes the anchor, never a point. The
  // intrinsic point rides all four components (the w slot the 3D/4D DDA
  // lift reads xyz from); auto-layout puts the four fields at
  // 128/144/160/176, so this backend's query stride is 192.
  finiteIntrinsic: vec4f,
  finiteMask: u32,
  finitePlanes: vec4i,
  finiteCells: vec4i,`
      : ""
  }
}
struct ControlResult {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,${
    finite
      ? `
  // The DDA's anchor out (mode 1 only): the intrinsic point, then the
  // mask + plane indices, then the cell indices — the comparison's
  // continuation-state pins. Result stride 96; the other backends'
  // results stay four lanes (stride 64).
  e: vec4f,
  f: vec4f,`
      : ""
  }
}
@group(0) @binding(16) var<storage, read> controlQueries: array<ControlQuery>;
@group(0) @binding(17) var<storage, read_write> controlResults: array<ControlResult>;
@compute @workgroup_size(64)
fn controlTransport(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let q = controlQueries[gid.x];
  var r: ControlResult;
  if (q.mode == 1u) {
${
  finite
    ? `    // The finite-solid DDA: the caller carries the full anchor contract
    // (inert until anchorPresent) and the medium claim rides inside.
    let hit = transportFiniteBoundary(q.origin, q.dir, q.anchorPresent, q.finiteIntrinsic, q.finiteMask, q.finitePlanes, q.finiteCells, q.inside);
    r.a = vec4f(f32(hit.kind), f32(hit.reason), hit.t, 0.0);
    r.b = vec4f(hit.normal, 0.0);
    r.c = hit.anchorIntrinsic;
    r.d = vec4f(f32(hit.anchorMask), f32(hit.anchorPlanes.x), f32(hit.anchorPlanes.y), f32(hit.anchorPlanes.z));
    r.e = vec4f(f32(hit.anchorPlanes.w), f32(hit.anchorCells.x), f32(hit.anchorCells.y), f32(hit.anchorCells.z));
    r.f = vec4f(f32(hit.anchorCells.w), 0.0, 0.0, 0.0);`
    : `    let hit = transportNextBoundary(q.origin, q.dir, q.anchorPresent, q.anchorPoint, ${
        solid ? "q.inside, q.eps, li" : "q.eps, li"
      });
    r.a = vec4f(f32(hit.kind), f32(hit.reason), hit.t, 0.0);
    r.b = vec4f(hit.normal, 0.0);
    r.c = vec4f(0.0);
    r.d = vec4f(0.0);`
}
  } else if (q.mode == 2u) {
${
  solid
    ? `    // The closed-solid floor corridor's straight shadow visibility (the
    // rear-scene task's corridor fix): the material rides slot 0's
    // opticsMaps lanes, which the leg packs with the same numbers the
    // trace probes' material carries.
    let vis = transportShadowVisibility(q.origin, q.dir, q.ballC, q.ballR, q.visR);
    r.a = vec4f(0.0);
    r.b = vec4f(vis, 0.0);`
    : `    // The helper is only emitted under the closed-solid backend; the
    // estimator legs never dispatch mode 2.
    r.a = vec4f(0.0);
    r.b = vec4f(0.0);`
}
    r.c = vec4f(0.0);
    r.d = vec4f(0.0);
  } else if (q.mode == 3u) {
${
  solid
    ? `    // The optical distortion's terminal displacement (the accepted
    // bounded model): the smoothed optical normal at the exit point, then
    // the virtual parallel slab's lateral offset — the SAME arithmetic the
    // trace's terminal applies, pinned directly because the constant-bg
    // trace probes cannot see an origin displacement (the twin's rear
    // scene is the fixed backdrop — disclosed, never absorbed).
    let nS = transportSmoothedNormal(q.origin, ${DIELECTRIC_DISTORTION_NORMAL_REL} * q.radius, li);
    let disp = dielectricSlabDisplacement(q.dir[0], q.dir[1], q.dir[2], nS[0], nS[1], nS[2], q.ior, q.distortion * q.radius, q.distortion * q.radius);
    r.a = vec4f(disp[0], disp[1], disp[2], disp[3]);
    r.b = vec4f(nS, 0.0);`
    : `    // The helper pair is only emitted under the closed-solid backend;
    // the estimator legs never dispatch mode 3.
    r.a = vec4f(0.0);
    r.b = vec4f(0.0);`
}
    r.c = vec4f(0.0);
    r.d = vec4f(0.0);${
      backend === "sphereInversion"
        ? `
  } else if (q.mode == 4u) {
    // The sphere-inversion field probe: the SIGNED field the query marches
    // and the exact membership bit, at q.origin — the real-driver half of
    // the interior f32 argument (the twin is sphereInversionSignedF32).
    r.a = vec4f(transportSolidField(q.origin), select(0.0, 1.0, transportSolidContains(q.origin)), 0.0, 0.0);
    r.b = vec4f(0.0);
    r.c = vec4f(0.0);
    r.d = vec4f(0.0);`
        : ""
    }
  } else {
    // The control probes anchor at the fixture's TRUE boundary, so the
    // trace's primary anchor skip is zero (the CPU twin's default).
    let traced = transportTrace(q.origin, q.dir, q.theta, q.ior, q.radius, q.absorb, vec3f(0.25, 0.35, 0.45), li, q.distortion);
    r.a = vec4f(f32(traced.status), f32(traced.failure), f32(traced.reason), traced.residual);
    r.b = vec4f(traced.radiance, 0.0);
    r.c = vec4f(0.0);
    r.d = vec4f(0.0);
  }
  controlResults[gid.x] = r;
}
`;
}

/**
 * Shader module + compute pipeline for one kernel config, under the
 * out-of-memory + validation error-scope pair (flame-gpu-backend.ts's
 * resource-creation discipline). WGSL diagnostics surface as
 * `line:col: message` VERBATIM (plus the offending source line) — the lead
 * needs them untouched to fix the kernel. `compileMs` spans module +
 * pipeline creation.
 *
 * `layout` is normally an explicit `GPUPipelineLayout` — every pipeline
 * bound against this section's one shared `bindGroupLayout` uses the same
 * object, so their bind groups interchange freely. Pass `"auto"` only when
 * a pipeline's binding TYPES diverge from that shared layout (the sweep
 * leg's `mapsUniform: true` arms need binding 1 typed `uniform` where the
 * shared layout declares `read-only-storage`, and WebGPU has no "same
 * layout, different binding type" escape hatch) — callers doing so MUST derive
 * that pipeline's bind group from its own `getBindGroupLayout(0)`, never
 * the shared `bindGroupLayout`, which would throw at bind-group creation
 * (binding-type mismatch).
 */
async function buildSurfacePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout | "auto",
  code: string,
  entryPoint:
    "evalQueries" | "marchRays" | "transportRays" | "controlTransport",
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
   * exactly as `surface-de.ts`'s own estimators route. Widened to the
   * shared `"fold" | "affine" | "escape"` vocabulary, though
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

/** The subset needed by the production IFS frame leg. Keeping this narrower
 * lets the mesh-atlas fixture avoid building an otherwise unused 700-query
 * eval table just to exercise SurfaceComputeRenderer. */
type SurfaceFrameSystem = Pick<
  SurfaceSystemState,
  "name" | "de" | "transforms"
>;

/** One FORWARD-orbit system's frozen state (escape first; made generic
 * for the bulb, which differs only in the DE type; escape4 extends it
 * below): the forward-map DE, its own dedicated query set
 * (`escapeQueries` / `bulbQueries` / `escape4Queries`, not
 * `surfaceQueries` — a single expanding map has no attractor to scatter a
 * chaos-game cloud onto), and the f64/f32 CPU-oracle pair the eval leg's
 * stability gate is built from
 * (`compareSurfaceForwardAgreement`'s doc). */
interface SurfaceForwardSystemState<TDe> {
  name: string;
  de: TDe;
  queries: Vec3[];
  /** `estimateEscapeDistance` / `estimateBulbDistance` (f64) — the CPU
   * oracle the kernel is pinned against. */
  cpu64: number[];
  /** The bench's fround twin of that oracle, evaluated at the SAME
   * points, so any gap against `cpu64` isolates f32-vs-f64 orbit
   * divergence from kernel arithmetic (see its doc). */
  cpu32: number[];
  /** Per-query stability: the seven-orbit ensemble verdict
   * ({@link forwardQueryStable}). Only stable queries enter the GPU
   * agreement gate — see `compareSurfaceForwardAgreement`. */
  stable: boolean[];
  buffers?: {
    params: GPUBuffer;
    /** The forward chain's storage list: the escape core's
     * links, one `GpuMap` each; ONE zero stride for the bulb core, whose
     * single map still rides the params variant block and which never
     * declares the binding (the layout may carry an entry a shader
     * ignores — surface-compute.ts's own idiom). */
    maps: GPUBuffer;
    input: GPUBuffer;
    output: GPUBuffer;
    staging: GPUBuffer;
    bindGroup: GPUBindGroup;
  };
}

type SurfaceEscapeSystemState = SurfaceForwardSystemState<EscapeDE>;
type SurfaceBulbSystemState = SurfaceForwardSystemState<BulbDE>;

/**
 * M7: the escape4 leg's system state — the forward state above
 * plus the frozen per-system VIEW, because this is the first forward core
 * whose kernel input is a 3D point standing for a 4D one. Everything the
 * shared forward machinery reads (`de`, `queries`, `cpu64`, `cpu32`,
 * `stable`, `buffers`) means exactly what it means for escape and bulb, so
 * {@link compareSurfaceForwardAgreement} and
 * {@link ensureSurfaceForwardEvalBuffers} take this structurally without a
 * second copy of either; `view4` is the one field only this leg's own code
 * touches (the composed oracle, the f32 lift, and the packer).
 */
interface SurfaceEscape4SystemState extends SurfaceForwardSystemState<EscapeDE4> {
  /** Rotor + `w0` + `sliceHalfW` — the packer's {@link SurfaceGpu4View}.
   * `sliceHalfW` is ALWAYS 0 here: a forward orbit cannot thread a
   * segment, and `packEscape4GpuParams` throws on a nonzero one. */
  view4: SurfaceGpu4View;
}

/** One affine4 (4D) agreement system's frozen state (M3): the built
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

/** One public inverse-descent field: 4D adds the view lift, while the march
 * protocol and per-ray comparison remain identical. */
type SurfaceMarchSystem = SurfaceSystemState | Surface4SystemState;

/** Same geometry, view, camera and normalized echo radius as
 * scripts/tiling-balloon.verify.mjs's Surface rows. In particular Pentatope
 * occupies A4's chamber, where the unrelated affine4 eval fixture at its
 * identity slice was empty under F4. The older B3/F4 scalar/stride ABI rows
 * retain the harder groups and all four inverse-descent cores. */
function surfaceFiniteBalloonFrameFixtures(): {
  sys: SurfaceMarchSystem;
  tiling: ResolvedFiniteTiling;
  balloonR: number;
  pose: SurfaceGpuPose;
}[] {
  const transforms3: Transform[] = (
    [
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, 0.5],
    ] as Vec3[]
  ).map((position, id) => ({
    id,
    position,
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
  const transforms4 = pentatope();
  const pair = normalizeRotorPair(
    [0.9847, 0.1741, 0, 0],
    [0.9847, -0.1741, 0, 0],
  )!;
  const systems: SurfaceMarchSystem[] = [
    {
      name: "finiteA3Tetra",
      core: "affine",
      de: buildSurfaceDE(transforms3, null, SURFACE_NO_SYMMETRY),
      transforms: transforms3,
      queries: [],
      cpu: [],
    },
    {
      name: "finiteA4Pentatope",
      de: buildSurfaceDE4(transforms4, null, SURFACE_NO_SYMMETRY),
      transforms: transforms4,
      view4: { rotor: rotorMatrix(pair), w0: 0, sliceHalfW: 0 },
      queries: [],
      cpu: [],
      stable: [],
    },
  ];
  return systems.map((sys) => ({
    sys,
    tiling: resolveTiling({ group: "view4" in sys ? "a4" : "a3" })!,
    balloonR: 0.5,
    pose: buildSurfacePose(
      sys.de,
      SURFACE_UNPROJ_WIDTH,
      SURFACE_UNPROJ_HEIGHT,
      SURFACE_POSE_DIST_FACTOR,
      { radius: "view4" in sys ? 3.2 : 4.7, theta: 0.71, phi: 1.1, fov: 50 },
    ),
  }));
}

function surfaceMarchCore(
  sys: SurfaceMarchSystem,
): SurfaceKernelConfig["core"] {
  return "view4" in sys
    ? deHasFolds4(sys.de)
      ? "fold4"
      : "affine4"
    : sys.core;
}

function packSurfaceMarchParams(
  sys: SurfaceMarchSystem,
  run: SurfaceGpuRunParams,
  balloon: SurfaceComputeFrameSpec["balloon"] | null = null,
  tiling: ResolvedFiniteTiling | null = null,
): ArrayBuffer {
  return "view4" in sys
    ? packSurface4GpuParams(sys.de, sys.view4, run, balloon, null, tiling)
    : packSurfaceGpuParams(sys.de, run, balloon, null, tiling);
}

function surfaceCpuBalloonFor(
  sys:
    | SurfaceFrameSystem
    | Pick<Surface4SystemState, "name" | "de" | "transforms" | "view4">,
  rMult: number,
  tiling: ResolvedFiniteTiling | null = null,
): SurfaceCpuBalloon {
  if (tiling) {
    const radius = surfaceOriginVisibleRadius(sys.de);
    return {
      b: buildBalloonFromBall({ center: [0, 0, 0], radius }, rMult),
      far: BALLOON_FAR_CAP_RHO * radius,
      tiling,
    };
  }
  return "view4" in sys
    ? {
        b: buildBalloon4(sys.de, rMult),
        far: BALLOON_FAR_CAP_RHO * balloonBall4(sys.de).radius,
      }
    : {
        b: buildBalloon(sys.de, rMult),
        far: BALLOON_FAR_CAP_RHO * balloonBall(sys.de).radius,
      };
}

/** The appended swirl union rows reuse the ordinary eval layout, query mix,
 * oracle continuity rule and comparator. Only the bound wrapper changes. */
async function runSurfaceSwirlBalloonEvalLeg(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sys: SurfaceMarchSystem,
  wg: number,
  rMult: number,
  evalStride = false,
): Promise<SurfaceAgreementRow> {
  const core = surfaceMarchCore(sys);
  const cfg: SurfaceKernelConfig = {
    core,
    variant: "private",
    stage2: false,
    wg,
    width:
      core === "fold" || core === "fold4"
        ? SURFACE_FOLD_BEAM_WIDTH
        : SURFACE_AFFINE_LADDER_WIDTH,
  };
  const code = surfaceDeKernelWgsl({
    mode: "eval",
    evalStride,
    core,
    lens: true,
    lensPost: true,
    balloon: true,
    width: cfg.width,
    workgroupSize: wg,
    sharedFrontier: false,
    bnbStage2: false,
    ...("view4" in sys ? { slabExt: false } : {}),
  });
  const { pipeline } = await buildSurfacePipeline(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    code,
    "evalQueries",
    `swirl balloon eval ${sys.name}`,
  );
  const balloon = surfaceCpuBalloonFor(sys, rMult);
  // Interleave base and inverted queries: both union terms must become
  // strict winners even when the rest echo sits outside the framed ball.
  const queries = sys.queries.map((point, index) =>
    index % 2 === 0
      ? point
      : (invertBalloon(balloon.b, point).map(Math.fround) as Vec3),
  );
  const querySys = { ...sys, queries, buffers: undefined };
  const bufs =
    "view4" in querySys
      ? await ensureSurface4EvalBuffers(device, layout, querySys)
      : await ensureSurfaceEvalBuffers(device, layout, querySys);
  const paramsData = packSurfaceMarchParams(
    sys,
    { itemCount: queries.length, cutoff: 0, footprint: 0 },
    { ...balloon.b, far: balloon.far },
  );
  const params = await createSurfaceBuffer(
    device,
    `swirl balloon params ${sys.name}`,
    paramsData.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  try {
    device.queue.writeBuffer(params, 0, paramsData);
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: bufs.maps } },
        { binding: 2, resource: { buffer: bufs.input } },
        { binding: 3, resource: { buffer: bufs.output } },
      ],
    });
    const gpu = await runSurfaceEvalDispatch(
      device,
      pipeline,
      {
        queries,
        buffers: { output: bufs.output, staging: bufs.staging, bindGroup },
      },
      wg,
    );
    const view4 = "view4" in sys ? sys.view4 : null;
    const estimateAt = (q: Vec3): number =>
      evalStride
        ? surfaceBalloonMarchSample(sys.de, balloon, q, 0, view4).stride
        : surfaceBalloonMarchEstimate(sys.de, balloon, q, 0, view4);
    const cpu = queries.map(estimateAt);
    const shellQueries = cpu.filter(
      (value, index) =>
        value < surfaceMarchEstimate(sys.de, queries[index], 0, view4),
    ).length;
    const name = `${evalStride ? "stride:" : ""}balloon(${sys.name})@R${String(rMult)}`;
    if ("view4" in sys) {
      const R = surface4ToleranceR(sys.de);
      const stable = cpu.map((value, i) =>
        surface4QueryStable(
          sys.de,
          sys.view4,
          queries[i],
          value,
          surfaceEvalTol(value, R),
          !deHasFolds4(sys.de),
          estimateAt,
        ),
      );
      const compare =
        core === "fold4"
          ? compareSurfaceFold4Agreement
          : compareSurface4Agreement;
      return {
        ...compare({ ...sys, name, queries, cpu, stable }, cfg, gpu),
        shellQueries,
      };
    }
    return {
      ...compareSurfaceAgreement({ ...sys, name, queries, cpu }, cfg, gpu),
      shellQueries,
    };
  } finally {
    params.destroy();
    if ("view4" in querySys) destroySurface4EvalBuffers(querySys);
    else destroySurfaceEvalBuffers(querySys);
  }
}

// ---------------------------------------------------------------------------
// Optical-transport agreement legs (surface-transport-fixture.ts)
// ---------------------------------------------------------------------------

/** Control-entry workgroup size — also the control entry's own
 * `@workgroup_size` and the dispatch granularity the query padding
 * rounds to, so `gid.x` never indexes past the padded array. */
const SURFACE_TRANSPORT_WG = 64;
/** One `ControlQuery`'s wire stride: three vec3f at their 16-byte
 * alignment, then eps/ior/radius at 44/48/52, absorb at its aligned 64,
 * theta/anchorPresent/mode/inside at 76/80/84/88, the mode-2 corridor's
 * ballC/ballR/visR at 96/108/112, the trace probes' distortion word at
 * 116, rounded up to the struct's 16-byte alignment. */
const SURFACE_TRANSPORT_QUERY_STRIDE_BYTES = 128;

/** The distortion trace probes' authored slab (the resolved material's
 * multiplier of the probe material's radius) — the qualified panels'
 * working value, mirrored by the twin's own displacement. */
const SURFACE_TRANSPORT_DISTORTION_PROBE = 0.08;
/** The trace probe's fixed backdrop, DISPLAY space — MUST stay equal to
 * the control WGSL's literal `vec3f(0.25, 0.35, 0.45)` byte for byte: the
 * kernel's `transportRearRadiance` linearizes it internally (pow 2.2) and
 * the CPU twin's `bgLinear` is derived from THIS definition, so the host
 * side has one place the two agree from. */
const SURFACE_TRANSPORT_CONTROL_BG: Vec3 = [0.25, 0.35, 0.45];
/** {@link SURFACE_TRANSPORT_CONTROL_BG} linearized per channel (the file's
 * 2.2 convention) — the fixture trace's `bgLinear`. */
const SURFACE_TRANSPORT_CONTROL_BG_LINEAR: Vec3 = [
  Math.pow(SURFACE_TRANSPORT_CONTROL_BG[0], 2.2),
  Math.pow(SURFACE_TRANSPORT_CONTROL_BG[1], 2.2),
  Math.pow(SURFACE_TRANSPORT_CONTROL_BG[2], 2.2),
];
/** The probe camera's ndc grid — spanning the object disc, which
 * subtends roughly ±0.6 of tangent from the canonical 2·R camera. The
 * dense second sweep covers sparse canonical poses (a 4D system's w = 0
 * slice can present a thin or empty disc from any one camera). */
const SURFACE_TRANSPORT_PROBE_NDC = [-0.6, -0.2, 0.2, 0.6];
const SURFACE_TRANSPORT_PROBE_NDC_DENSE = [
  -0.9, -0.675, -0.45, -0.225, 0, 0.225, 0.45, 0.675, 0.9,
];
/** Cap on kept hit rays (each becomes one trace + two boundary probes). */
const SURFACE_TRANSPORT_PROBE_RAYS = 8;
/** The legs' bounded per-sample path budget — both engines run the SAME
 * number, so the agreement is of the arithmetic, not of the shipped
 * production budget. The heavy fold fixture's 2048-path traces cost
 * seconds per probe even on the GPU, and one dispatch past the kernel
 * driver's job timeout loses the device (measured: two runs died exactly
 * here) — the runtime's own caps knob exists for precisely this bound. */
const SURFACE_TRANSPORT_LEG_MAX_PATHS = 128;
/** The sphere-inversion legs' chain-replay arm: at most this many of the
 * twin's own boundary queries per probe are replayed on the GPU — the leg's
 * whole path budget, so a trace that spends its cap is replayed entire. */
const SURFACE_TRANSPORT_CHAIN_REPLAY_CAP = SURFACE_TRANSPORT_LEG_MAX_PATHS;
/** The sphere-inversion legs' field arm: member points sampled per leg (each
 * also seeds a bisected pair toward the boundary). */
const SURFACE_TRANSPORT_FIELD_PROBES = 600;
/** Max excluded (chaos-flip) probes per forward leg before the leg fails:
 * the escape eval legs' own absolution-cap discipline — a fixture whose
 * every probe flips certifies nothing. */
// The existing pre-hoc ULP exclusion cap remains frozen. Anchor identity is
// always exact: a one-cell plane shift changes the crossed boundary and
// must never be excused by this cap.
const SURFACE_TRANSPORT_FLIP_CAP = 8;
/** Is this leg's core a FORWARD orbit? Forward estimators are heuristics
 * over chaotic orbits, so a probe can flip realization under one f32 ULP
 * — the escape legs' measured verdict, and the reason their agreement
 * gates in LAYERS. The descent cores are certified lower bounds and gate
 * hard. */
const SURFACE_TRANSPORT_FORWARD_CORES = new Set<string>([
  "escape",
  "bulb",
  "escape4",
]);

/** One ULP-scale perturbation of a probe point, per axis — the
 * {@link forwardQueryStable} neighbor construction verbatim. */
function surfaceTransportUlpNeighbors(p: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const q: Vec3 = [p[0], p[1], p[2]];
      const base = Math.fround(q[axis]);
      const step = Math.max(Math.abs(base) * 1.2e-7, 1e-38);
      q[axis] = Math.fround(base + dir * step);
      out.push(q);
    }
  }
  return out;
}
/** The CPU probe-selection march's step budget — a grazing ray takes many
 * shrinking steps; past it the ray simply counts as a miss (never a
 * hang). Pure probe selection: both engines trace from the SAME CPU
 * hit point, so the cap only ever trims the probe list. */
const SURFACE_TRANSPORT_HIT_MARCH_STEPS = 4096;
/** The trace status codes read off the control result's `.a.x`, mapped
 * from the fixture's own status vocabulary — the runtime's exported
 * SURFACE_GPU_TRANSPORT_* constants, never restated literals. */
const TRANSPORT_TRACE_STATUS_CODES: Record<TransportTraceStatus, number> = {
  pending: SURFACE_GPU_TRANSPORT_PENDING,
  complete: SURFACE_GPU_TRANSPORT_COMPLETE,
  residual: SURFACE_GPU_TRANSPORT_RESIDUAL,
  unresolved: SURFACE_GPU_TRANSPORT_UNRESOLVED,
  invalid: SURFACE_GPU_TRANSPORT_INVALID,
};
/** The emitted `TransportBoundary` struct's kind codes (1 boundary, 2
 * miss, 3 refused — surface-de-gpu.ts's optics-block comment), mapped
 * from the fixture's kind vocabulary. */
const TRANSPORT_BOUNDARY_KIND_CODES: Record<TransportBoundaryKind, number> = {
  boundary: 1,
  miss: 2,
  refused: 3,
};

/** One leg's resolved fixture system + the kernel options and packers it
 * drives, assembled per core before any GPU work. */
/** The transport legs' boundary backends. */
type SurfaceTransportLegBackend =
  "estimator" | "closedSolid" | "finiteSolid" | "sphereInversion";

/** The backends whose boundary query marches a SIGNED field with a
 * caller-carried medium — the closed-solid query's shape, which the
 * sphere-inversion backend rides — and so share its probe arms, shadow and
 * terminal-displacement probes. */
function surfaceTransportSignedBackend(
  backend: SurfaceTransportLegBackend,
): boolean {
  return backend === "closedSolid" || backend === "sphereInversion";
}

interface SurfaceTransportLegSpec {
  core:
    | SurfaceKernelConfig["core"]
    | "finite"
    | "finite4"
    | "sphereInv"
    | "sphereInv4";
  systemName: string;
  /** The boundary backend this leg pins: `"estimator"` (the composed
   * public estimator march — sound from OUTSIDE only, the envelope
   * finding's own state), `"closedSolid"` (the signed closed-solid
   * query, whose inside traversal resolves a refracted child) or
   * `"finiteSolid"` (the exact DDA over the finite cell construction,
   * whose full anchor contract rides the control wire both ways), or
   * `"sphereInversion"` (the curved-glass backend: the family's signed field
   * under the closed-solid query with the exact-membership crossing gate,
   * which the twin carries through the fixture's `contains`). */
  backend: SurfaceTransportLegBackend;
  options: SurfaceGpuKernelOptions;
  /** The kind's own params packer — the run params' `visibleRadius`/
   * `stepScale` come from the real DE (the packer's offsets 20/24), so the
   * control's domain gate and march scale are exactly the fixture's. */
  packParams: (itemCount: number) => ArrayBuffer;
  /** The kind's maps packer, or null for the bindingless cores (bulb and
   * the finite pair — the control's auto layout then declares no binding
   * 1 at all). */
  packMaps: (() => Float32Array) | null;
  /** The finite backend's CPU twin — the ONE closure every finite
   * consumer shares (the trace twin's 9th argument, the boundary
   * comparison's query, and the stability ensemble's wrapper). It is
   * built where the construction and pose live (the leg's own push), so
   * the runner never needs either. Absent on every other backend. */
  finiteQuery?: TransportFiniteQueryFn;
  /** The closed-solid legs' analytic control's chord: the through-lobe
   * probe's geometric path length through the fixture's emitter at
   * normal incidence — 0.7 through the separated fixture's sphere
   * (2·0.35, the probe's x/z sit on the sphere's axis), 1.0 through the
   * abutting pair's +x box (its faces span y ∈ [-0.5, 0.5]; the shared
   * plane x = 0 is not on the probe). The transport formula
   * (1-F0)²·Beer stays independent; this is the fixture's geometry,
   * authored where the geometry is. Absent on every other backend and
   * every probe shape the through-lobe condition does not select. */
  analyticChord?: number;
  /** Where the shadow probes' through-lobe ray leaves the floor, in xz —
   * the analytic control's probe (straight up) and its oblique sibling
   * start here. Default `[0.35, 0.05]`, under the separated closed-solid
   * fixture's sphere; a leg whose solid sits elsewhere names its own. */
  shadowXZ?: readonly [number, number];
  /** Extra camera rays beyond the canonical grid, each CPU-marched to its
   * own primary hit and then run through every arm like a grid probe —
   * the family-specific geometry (a pole, a tangency cusp, a graze) the
   * grid cannot aim at. A ray that finds no primary hit THROWS: an extra
   * probe exists to exercise one named case, never to vanish. */
  extraProbes?: readonly { label: string; ro: Vec3; dir: Vec3 }[];
  fixture: TransportFixtureSystem;
}

/**
 * The transport legs' deterministic probe set (no RNG — the fixture
 * vocabulary's own discipline): a canonical camera at
 * `visibleRadius·(0.9, 0.55, 1.7)` looking at the origin, a 4x4 ndc grid
 * over the object, each direction CPU-marched by the fixture system's own
 * estimator to its first primary hit (`estimate < visibleRadius·1e-3` —
 * the transport's own eps scale) or out past `3·visibleRadius`. Returns
 * the first {@link SURFACE_TRANSPORT_PROBE_RAYS} hit rays in grid order.
 */
function surfaceTransportProbes(
  fixture: TransportFixtureSystem,
  grid: readonly number[] = SURFACE_TRANSPORT_PROBE_NDC,
): { hitPos: Vec3; dir: Vec3 }[] {
  const visR = fixture.visibleRadius;
  const ro: Vec3 = [0.9 * visR, 0.55 * visR, 1.7 * visR];
  const roLen = Math.hypot(ro[0], ro[1], ro[2]);
  const fwd: Vec3 = [-ro[0] / roLen, -ro[1] / roLen, -ro[2] / roLen];
  // right = normalize(cross(fwd, worldUp)), up = cross(right, fwd) — a
  // right-handed look-at basis; fwd is never parallel to worldUp here.
  const rightLen = Math.hypot(-fwd[2], 0, fwd[0]);
  const right: Vec3 = [-fwd[2] / rightLen, 0, fwd[0] / rightLen];
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const probes: { hitPos: Vec3; dir: Vec3 }[] = [];
  for (const ny of grid) {
    for (const nx of grid) {
      if (probes.length >= SURFACE_TRANSPORT_PROBE_RAYS) return probes;
      const spread: Vec3 = [
        fwd[0] + right[0] * nx + up[0] * ny,
        fwd[1] + right[1] * nx + up[1] * ny,
        fwd[2] + right[2] * nx + up[2] * ny,
      ];
      const dLen = Math.hypot(spread[0], spread[1], spread[2]);
      const dir: Vec3 = [spread[0] / dLen, spread[1] / dLen, spread[2] / dLen];
      let t = 0;
      let hitPos: Vec3 | null = null;
      for (let step = 0; step < SURFACE_TRANSPORT_HIT_MARCH_STEPS; step++) {
        const p: Vec3 = [
          ro[0] + dir[0] * t,
          ro[1] + dir[1] * t,
          ro[2] + dir[2] * t,
        ];
        const d = fixture.estimate(p);
        if (d < visR * 1e-3) {
          hitPos = p;
          break;
        }
        t += d * fixture.stepScale;
        if (t > 3 * visR) break;
      }
      if (hitPos) probes.push({ hitPos, dir });
    }
  }
  return probes;
}

/** One named extra probe's primary hit: the grid's own march (the
 * fixture's estimator, the `visibleRadius·1e-3` hit test, the fixture's
 * step scale) from an arbitrary eye, bounded by the eye's distance plus
 * three visible radii. `null` when the ray finds nothing. */
function surfaceTransportMarchProbe(
  fixture: TransportFixtureSystem,
  ro: Vec3,
  dir: Vec3,
): { hitPos: Vec3; dir: Vec3 } | null {
  const visR = fixture.visibleRadius;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  const tMax = Math.hypot(ro[0], ro[1], ro[2]) + 3 * visR;
  let t = 0;
  for (let step = 0; step < SURFACE_TRANSPORT_HIT_MARCH_STEPS; step++) {
    const p: Vec3 = [ro[0] + d[0] * t, ro[1] + d[1] * t, ro[2] + d[2] * t];
    const e = fixture.estimate(p);
    if (e < visR * 1e-3) return { hitPos: p, dir: d };
    t += Math.max(e, 0) * fixture.stepScale;
    if (t > tMax) return null;
  }
  return null;
}

/** Is a TRACE probe chaos-stable at f32 scale? The CPU twin re-traces the
 * probe from its origin and from six ULP neighbors: stable iff all seven
 * agree on status, residual (5e-3) and radiance (3e-3). Forward and finite
 * legs consult this — a stable probe hard-gates, an unstable one is
 * excluded and counted (the escape legs' pre-hoc ensemble shape). The
 * finite backend's twin (the leg's own closure) replaces the estimator
 * query in EVERY trace of the ensemble when present; the neighbor
 * construction and the agreement test are unchanged, and absent (every
 * estimator/closed-solid leg) the twin is the estimator query, text
 * unchanged. */
function surfaceTransportTraceProbeStable(
  fixture: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  caps: { maxProcessedPaths: number; maxInterfaces: number },
  finiteQuery?: TransportFiniteQueryFn,
): boolean {
  const material = {
    ior: DIELECTRIC_IOR,
    absorption: DIELECTRIC_ABSORPTION,
    radius: fixture.visibleRadius,
  };
  const base = transportTraceCPU(
    fixture,
    origin,
    dir,
    DIELECTRIC_INITIAL_BRANCH_THETA,
    material,
    SURFACE_TRANSPORT_CONTROL_BG_LINEAR,
    caps,
    undefined,
    finiteQuery,
  );
  const agrees = (r: ReturnType<typeof transportTraceCPU>): boolean =>
    r.status === base.status &&
    Math.abs(r.residual - base.residual) <= 5e-3 &&
    r.radiance.every((c, i) => Math.abs(c - base.radiance[i]) <= 3e-3);
  for (const q of surfaceTransportUlpNeighbors(origin)) {
    if (
      !agrees(
        transportTraceCPU(
          fixture,
          q,
          dir,
          DIELECTRIC_INITIAL_BRANCH_THETA,
          material,
          SURFACE_TRANSPORT_CONTROL_BG_LINEAR,
          caps,
          undefined,
          finiteQuery,
        ),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Is a BOUNDARY probe chaos-stable at f32 scale? Same ensemble, on the
 * twin boundary query: kind, reason, t (1e-3 of the radius) and normal
 * (3e-2) must agree across the origin's ULP neighbors. The finite
 * backend's twin is WRAPPED to the ensemble's own shape — the ensemble
 * perturbs only the origin, so the wrapper takes (origin, dir) and
 * closes over the query record's anchor and medium claim; an anchored
 * finite query ignores its origin on both engines, so the ensemble is
 * trivially stable for it, which is the honest answer. Absent (every
 * estimator/closed-solid leg) the twin is the estimator query, text
 * unchanged. */
function surfaceTransportBoundaryProbeStable(
  fixture: TransportFixtureSystem,
  origin: Vec3,
  dir: Vec3,
  anchorPresent: boolean,
  anchorPoint: Vec3,
  eps: number,
  finiteQuery?: (origin: Vec3, dir: Vec3) => TransportFiniteBoundaryResult,
): boolean {
  const twin = (o: Vec3): TransportBoundaryResult =>
    finiteQuery
      ? finiteQuery(o, dir)
      : transportBoundaryQueryCPU(
          fixture,
          o,
          dir,
          anchorPresent,
          anchorPoint,
          eps,
        );
  const base = twin(origin);
  const agrees = (r: TransportBoundaryResult): boolean =>
    r.kind === base.kind &&
    r.reason === base.reason &&
    Math.abs(r.t - base.t) <= 1e-3 * fixture.visibleRadius &&
    r.normal.every((c, i) => Math.abs(c - base.normal[i]) <= 3e-2);
  for (const q of surfaceTransportUlpNeighbors(origin)) {
    if (!agrees(twin(q))) {
      return false;
    }
  }
  return true;
}

/** A sparse canonical pose's fallback probe: a SEEDED UNIFORM SAMPLE of
 * the visible ball (mulberry32, fixed seed — deterministic run to run),
 * keeping the first points the estimator puts on the surface — the
 * escape-family instrument rule (a seeded sample, never a grid: a grid
 * aliases against a fold's walls, and a sparse w = 0 slice's surface
 * fragments are exactly the kind of target a camera grid misses). Each
 * kept surface point carries one direction from a small fixed set, so
 * the traces exercise different approaches. */
function surfaceTransportProbesSeeded(
  fixture: TransportFixtureSystem,
): { hitPos: Vec3; dir: Vec3 }[] {
  const visR = fixture.visibleRadius;
  const rng = mulberry32(0x5e1d70);
  const directions: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
    [-0.5773502691896258, 0.5773502691896258, -0.5773502691896258],
    [0.7071067811865476, 0, -0.7071067811865476],
  ];
  // Keep the sample's SMALLEST-DE points: a razor-thin w = 0 slice may
  // put no sampled point inside the epsHit threshold at all, and the
  // nearest-to-surface ones still pin the arithmetic (both engines run
  // the same origin — the trace treats it as the entry boundary either
  // way). The caller discloses when the threshold was not met.
  const candidates: { p: Vec3; d: number }[] = [];
  const samples = 40000;
  for (let i = 0; i < samples; i++) {
    // Uniform in the ball: rejection on the unit cube.
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    if (x * x + y * y + z * z > 0.81) continue;
    const p: Vec3 = [x * visR * 0.9, y * visR * 0.9, z * visR * 0.9];
    candidates.push({ p, d: fixture.estimate(p) });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.slice(0, SURFACE_TRANSPORT_PROBE_RAYS).map((c, i) => ({
    hitPos: c.p,
    dir: directions[i % directions.length],
  }));
}

/** The seeded probe's on-surface threshold, exported for the leg's
 * disclosure: how many kept origins actually sat within the transport's
 * own crossing scale of the surface. */
function surfaceTransportProbeOnSurface(
  fixture: TransportFixtureSystem,
  probes: { hitPos: Vec3 }[],
): number {
  const epsHit = fixture.visibleRadius * 1e-3;
  return probes.filter((p) => fixture.estimate(p.hitPos) < epsHit).length;
}

/**
 * The surface transport agreement legs — one per kernel core, each pinning
 * the emitted optics body (`surfaceDeKernelWgsl({ mode: "shade", optics:
 * true })`) against `surface-transport-fixture.ts`'s CPU twin, per core:
 *
 *   fold    mandelboxKifs (the fold-protocol leg's system)
 *   affine  affineTetra (the M0 affine leg's system)
 *   escape  the M2 leg's first escape system
 *   bulb    the M6 leg's first bulb system
 *   affine4 the M3 leg's aff4Tetra SurfaceDE4
 *   fold4   the M4 leg's fold4Boxfold SurfaceDE4
 *   escape4 the M7 leg's first escape4 system
 *   finite  finiteMenger3 (the study's level-2 Menger construction)
 *   finite4 finiteMenger4 (its hyper-Menger lift, identity pose)
 *
 * Each leg compiles the optics shade module plus
 * {@link SURFACE_TRANSPORT_CONTROL_WGSL} under `layout: "auto"` (the bind
 * group derives from the control entry's own transitively-used bindings —
 * 0 params, 1 maps unless the bindingless bulb or finite core, 16/17),
 * packs the kind's OWN params/maps wire exactly as the eval legs do (the
 * run params' `visibleRadius`/`stepScale` come from the real DE, so the
 * control's domain gate matches the fixture's), and compares a
 * deterministic probe set: one replay-trace probe per CPU-marched primary
 * hit, plus two boundary queries per hit ray (unanchored from just past
 * the hit along the reverse ray; anchored AT the hit, which must clear
 * its own anchor). The finite legs' boundary set is the DDA's own shape —
 * one unanchored INSIDE query from the hit along the camera ray, then,
 * when the twin hands back an anchor, TWO anchored restarts from it (the
 * post-exit medium along the same direction; the reversed direction with
 * the inside claim, flipping the masked axis's side selection) — so the
 * per-probe count is recorded beside the queries and the comparison walk
 * follows it.
 *
 * The 4D legs pack the IDENTITY-rotor canonical pose (`w0` 0, no slab) —
 * the packer's slice-adjusted `visibleRadius` equals the full
 * `visibleBoundingRadius` there, and the kernel's prologue lift is the
 * identity the CPU adapter applies by evaluating the 4D estimator at
 * frozen `w = 0`. The estimator each adapter composes is the one the
 * CORE marches (fold/fold4 the plain frontier descents at their fixed
 * SURFACE_FOLD_BEAM_WIDTH scratch, affine/affine4 the refined ladders,
 * escape/bulb/escape4 their forward orbits).
 *
 * Fail closed: any mismatch — status, kind, reason, tolerance — THROWS
 * with the core, probe index and both sides' values; the caller's catch
 * turns it into the leg's gate flag. A core whose fixture system did not
 * build skips with a note instead (the mandelboxKifs exclusion's own
 * convention), and a probe camera that finds no primary hit throws —
 * an agreement leg never certifies vacuously.
 */
async function runSurfaceTransportAgreementLegs(
  device: GPUDevice,
  systems: {
    descent: SurfaceSystemState[];
    escape: SurfaceEscapeSystemState[];
    bulb: SurfaceBulbSystemState[];
    affine4: Surface4SystemState[];
    fold4: Surface4SystemState[];
    escape4: SurfaceEscape4SystemState[];
  },
  status: (text: string) => void,
  activity: ActivityBadge,
  /** Live notes, wired straight into the result's notes so a leg that
   * THROWS (or loses the device mid-dispatch) leaves its progress trail
   * in the record — the failure reports survive the throw. */
  onNote: (text: string) => void = () => {},
  /** Run only this backend's legs (the sphere-inversion-only iteration
   * path); the other legs' build-or-skip notes are dropped with them. */
  only?: SurfaceTransportLegBackend,
): Promise<{
  rows: SurfaceTransportAgreementRow[];
  notes: string[];
}> {
  const notes: string[] = [];
  const note = (text: string): void => {
    notes.push(text);
    onNote(text);
  };
  const legs: SurfaceTransportLegSpec[] = [];
  // The canonical identity pose every 4D leg packs and evaluates through
  // (surface-transport-fixture.ts's frozen pose).
  const canonicalView4: SurfaceGpu4View = {
    rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w0: 0,
    sliceHalfW: 0,
  };

  const pushDescentLeg = (name: string, core: "fold" | "affine"): void => {
    const sys = systems.descent.find((s) => s.name === name);
    if (!sys) {
      notes.push(
        `transport ${core}: skipped — ${name} did not build or was excluded ` +
          "(surfaceSystems=synthetic)",
      );
      return;
    }
    const de = sys.de;
    legs.push({
      core,
      systemName: sys.name,
      backend: "estimator",
      options: {
        mode: "shade",
        core,
        width:
          core === "fold"
            ? SURFACE_FOLD_BEAM_WIDTH
            : SURFACE_AFFINE_LADDER_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) => packSurfaceGpuParams(de, { itemCount: n, cutoff: 0 }),
      packMaps: () => new Float32Array(packSurfaceGpuMaps(de)),
      fixture: {
        // The DE's own routing split (the section's): fold base maps march
        // the plain frontier descent the fold kernel mirrors; fold-free
        // ones the refined width-4 ladder.
        estimate: (p) =>
          core === "fold"
            ? estimateDistance(de, p, 0)
            : estimateDistanceRefined(de, p, 0),
        stepScale: de.stepScale,
        visibleRadius: de.visibleBoundingRadius,
      },
    });
  };

  const pushSurface4Leg = (name: string, core: "affine4" | "fold4"): void => {
    const list = core === "affine4" ? systems.affine4 : systems.fold4;
    const sys = list.find((s) => s.name === name);
    if (!sys) {
      notes.push(
        `transport ${core}: skipped — ${name} did not build (see notes)`,
      );
      return;
    }
    const de = sys.de;
    legs.push({
      core,
      systemName: sys.name,
      backend: "estimator",
      options: {
        mode: "shade",
        core,
        width:
          core === "fold4"
            ? SURFACE_FOLD_BEAM_WIDTH
            : SURFACE_AFFINE_LADDER_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) =>
        packSurface4GpuParams(de, canonicalView4, { itemCount: n, cutoff: 0 }),
      packMaps: () => new Float32Array(packSurfaceGpuMaps4(de)),
      fixture: {
        // The core picks the estimator the body marches — affine4 the
        // refined ladder (M3's oracle), fold4 the plain frontier at
        // refine=false (M4's) — evaluated at the canonical pose's frozen
        // w = 0 under the identity lift.
        estimate: (p) =>
          core === "affine4"
            ? estimateDistance4Refined(de, [p[0], p[1], p[2], 0], 0)
            : estimateDistance4(de, [p[0], p[1], p[2], 0]),
        stepScale: de.stepScale,
        visibleRadius: de.visibleBoundingRadius,
      },
    });
  };

  // CHEAPEST FIRST (bisect order): the forward cores' simple orbits, then
  // the 4D ladders, the fold frontier last — if a leg kills the device the
  // ordering says which core's transitive machinery did it.
  pushDescentLeg("affineTetra", "affine");
  pushSurface4Leg("aff4Tetra", "affine4");

  // The closed-solid backend's legs (both dimensions, cheapest-first
  // bisect order): the emitter-only union the backend serves — a posed
  // sphere and a posed box, no maps, no schedule, no chaos — at the
  // canonical identity pose both dimensions (the existing 4D transport
  // legs' convention; the posed-lift agreement is their record and the
  // envelope leg's). The fixture's `estimate` is the SIGNED closed-solid
  // union field — the same SAFETY-scaled certified bound the kernel's
  // transportSolidField evaluates — mirrored, not restated. The ABUTTING
  // variant is the one arrangement the separated primitives cannot reach:
  // two half-unit boxes at x = ∓0.5 sharing the plane x = 0, whose
  // min-union field reads exactly zero ON that interior plane — the CPU
  // twin's measured verdict (condensation-abutting.test.ts) is radiance
  // parity with the spanning control, and this leg pins the KERNEL to the
  // same behavior on the real driver.
  const pushClosedSolidLeg = (
    fourD: boolean,
    variant: "separated" | "abutting" = "separated",
  ): void => {
    const transforms: Transform[] =
      variant === "abutting"
        ? [
            {
              id: 0,
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              emitter: {
                parts: ([-0.5, 0.5] as const).map((x) => ({
                  primitive: { kind: "box", half: [0.5, 0.5, 0.5] } as const,
                  combine: "union" as const,
                  pose: { offset: [x, 0, 0] as Vec3 },
                })),
              },
            },
          ]
        : [
            {
              id: 0,
              position: [0.35, -0.1, 0.05],
              rotation: [0.15, -0.2, 0.1],
              scale: [0.35, 0.35, 0.35],
              emitter: {
                parts: [
                  {
                    primitive: { kind: "sphere", radius: 1 },
                    combine: "union",
                  },
                ],
              },
            },
            {
              id: 1,
              position: [-0.4, 0.25, -0.05],
              rotation: [-0.1, 0.12, -0.2],
              scale: [0.3, 0.3, 0.3],
              emitter: {
                parts: [
                  {
                    primitive: { kind: "box", half: [0.7, 0.5, 0.8] },
                    combine: "union",
                  },
                ],
              },
            },
          ];
    const de3 = fourD
      ? null
      : buildSurfaceDE(transforms, null, { order: 1, plane: "xy" }, {});
    const de4 = fourD
      ? buildSurfaceDE4(transforms, null, { order: 1, plane: "xy" }, {})
      : null;
    const de = fourD ? de4 : de3;
    if (!de || de.maps.length !== 0 || !de.condensation) {
      throw new Error(
        `transport closed-solid: the ${fourD ? "4D" : "3D"} ${variant} fixture did not ` +
          "build its emitter-only union",
      );
    }
    legs.push({
      core: fourD ? "affine4" : "affine",
      systemName: fourD
        ? variant === "abutting"
          ? "closedSolidAbutting4"
          : "emitterOnlyUnion4"
        : variant === "abutting"
          ? "closedSolidAbutting3"
          : "emitterOnlyUnion3",
      backend: "closedSolid",
      analyticChord: variant === "abutting" ? 1.0 : 0.7,
      options: {
        mode: "shade",
        core: fourD ? "affine4" : "affine",
        width: SURFACE_AFFINE_LADDER_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        opticsBackend: "closedSolid",
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
        condensation: surfaceCondensationKernelSpec(de),
      },
      packParams: (n) =>
        de4
          ? packSurface4GpuParams(de4, canonicalView4, {
              itemCount: n,
              cutoff: 0,
            })
          : packSurfaceGpuParams(de3!, { itemCount: n, cutoff: 0 }),
      packMaps: () =>
        new Float32Array(
          de4 ? packSurfaceGpuMaps4(de4) : packSurfaceGpuMaps(de3!),
        ),
      fixture: {
        estimate: (p) =>
          SHAPE_MARCH_SAFETY *
          (de4
            ? condensationSignedDistance4(
                de4.condensation!,
                p[0],
                p[1],
                p[2],
                0,
              )
            : condensationDistance3(de3!.condensation!, p[0], p[1], p[2])),
        stepScale: de.stepScale,
        visibleRadius: de.visibleBoundingRadius,
      },
    });
  };
  pushClosedSolidLeg(false);
  pushClosedSolidLeg(true);
  pushClosedSolidLeg(false, "abutting");
  pushClosedSolidLeg(true, "abutting");

  // The sphere-inversion GLASS backend's legs (both dimensions): the
  // family's signed field under the closed-solid query, with the exact
  // membership gate the twin carries through the fixture's `contains`. Two
  // constructions per dimension. The ORBIT is the look gate's own subject —
  // a near-kissing arrangement (radius fraction 0.99) at depth 3, where the
  // look is clean glass and the bound still dips into the band at every
  // tangency — with three named rays the canonical grid cannot aim at: one
  // straight down a generator's axis onto its POLE (the fold's refused
  // centre; the creep must end in a refusal, never a silent background
  // hit), one through the near-CUSP where two generators almost touch
  // (the bound reaches ~0 with no membership; the unanchored arm marches
  // back through it), and one seed-tangent WINDOW ray between the
  // generators (a graze along the seed's silhouette in 3D). The ANALYTIC
  // control is the depth-0 construction whose orbit IS the seed ball
  // (generators reach in to 0.3, the seed is 0.28), so the through-origin
  // shadow probe pays exactly (1-F0)²·Beer over the 0.56 chord —
  // independent of the kernel and the twin. 4D uses cross8 (its w = 0
  // slice is oct6's picture) at the canonical identity pose, reading the
  // 4D field at frozen w = 0 exactly as the kernel's lift does there.
  const pushSphereInversionGlassLeg = (
    fourD: boolean,
    variant: "orbit" | "analytic",
  ): void => {
    const authored: SphereInversionAuthored =
      variant === "analytic"
        ? {
            arrangement: fourD ? "cross8" : "oct6",
            seed: { kind: "ball", size: 0.28 },
            depth: 0,
          }
        : {
            arrangement: fourD ? "cross8" : "oct6",
            radiusFraction: 0.99,
            seed: { kind: "ball", size: fourD ? 0.42 : 0.28 },
            depth: 3,
          };
    const resolution = resolveSphereInversion(authored);
    if (!resolution.ok) {
      throw new Error(
        `transport sphere-inversion: ${resolution.reasons.join("; ")}`,
      );
    }
    const construction = resolution.construction;
    const de = fourD
      ? buildSphereInversionDE4(construction)
      : buildSphereInversionDE(construction);
    const gpu = packSphereInversionGpuTables(de);
    const window = Math.sqrt(1 / 3);
    const tangent = fourD ? 0.4195 : 0.2795;
    legs.push({
      core: fourD ? "sphereInv4" : "sphereInv",
      systemName: `sphereInversionGlass${variant === "analytic" ? "Ball" : "Orbit"}${fourD ? "4" : "3"}`,
      backend: "sphereInversion",
      ...(variant === "analytic"
        ? { analyticChord: 0.56, shadowXZ: [0, 0] as const }
        : {
            shadowXZ: [0, 0] as const,
            extraProbes: [
              {
                label: "pole (down a generator's axis)",
                ro: [1, 0, 2.5],
                dir: [0, 0, -1],
              },
              {
                label: "near-cusp (between two generators)",
                ro: [3 * window, 3 * window, 3 * window],
                dir: [0.5 - 3 * window, 0.5 - 3 * window, -3 * window],
              },
              {
                label: "seed-tangent window ray",
                ro: [
                  3 * window + tangent * Math.SQRT1_2,
                  3 * window - tangent * Math.SQRT1_2,
                  3 * window,
                ],
                dir: [-window, -window, -window],
              },
            ],
          }),
      options: {
        mode: "shade",
        core: fourD ? "sphereInv4" : "sphereInv",
        width: 4,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        opticsBackend: "sphereInversion",
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) =>
        fourD
          ? packSphereInversion4GpuParams(gpu, canonicalView4, {
              itemCount: n,
              cutoff: 0,
            })
          : packSphereInversionGpuParams(gpu, { itemCount: n, cutoff: 0 }),
      packMaps: () => gpu.data,
      fixture: {
        estimate: (p) =>
          fourD
            ? sphereInversionSignedDistance4(de, [p[0], p[1], p[2], 0])
            : sphereInversionSignedDistance(de, p),
        contains: (p) =>
          fourD
            ? sphereInversionContains4(de, [p[0], p[1], p[2], 0])
            : sphereInversionContains(de, p),
        stepScale: 1,
        visibleRadius: de.boundingRadius,
      },
    });
  };
  pushSphereInversionGlassLeg(false, "analytic");
  pushSphereInversionGlassLeg(true, "analytic");
  pushSphereInversionGlassLeg(false, "orbit");
  pushSphereInversionGlassLeg(true, "orbit");

  // The finite-solid backend's legs (both dimensions, the same bisect
  // slot): the study's finite cell decomposition — the level-2 Menger
  // construction in 3D and its hyper-Menger lift in 4D — at the canonical
  // identity pose both dimensions. In 4D that convention (the identity
  // rotor, w0 0, no slab) is EXACTLY `FINITE_SOLID_IDENTITY_POSE` (the
  // rows are the identity and the slice is 0), so one CPU pose serves
  // both: the packer's shared 4D tail carries the same rotor rows + w0
  // the pose states. The fixture's `estimate` is the certified hybrid
  // display DE (`finiteSolidDisplayDistance` over the construction — the
  // same field the kernel's `finiteDisplayDE` mirrors), so the probe
  // camera marches the DE the kernel marches, and the boundary/trace twin
  // is the DDA adapter (`transportFiniteBoundaryQueryCPU`) through the
  // leg's one closure. The visible radius is the construction's
  // origin-centred bound — the root box's circumscribed sphere, which is
  // ALSO the packer's bounding/visible pair (the whole construction is
  // visible), so the control's domain gate reads the same number.
  const pushFiniteSolidLeg = (fourD: boolean): void => {
    const construction = buildFiniteSolidConstruction(
      fourD ? "hyperMenger" : "menger",
      fourD ? 4 : 3,
      2,
    );
    const pose = FINITE_SOLID_IDENTITY_POSE;
    const level = 2;
    const boundingRadius = fourD
      ? FINITE_SOLID_HALF_EXTENT * 2
      : FINITE_SOLID_HALF_EXTENT * Math.sqrt(3);
    legs.push({
      core: fourD ? "finite4" : "finite",
      systemName: fourD ? "finiteMenger4" : "finiteMenger3",
      backend: "finiteSolid",
      options: {
        mode: "shade",
        core: fourD ? "finite4" : "finite",
        width: 4,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        opticsBackend: "finiteSolid",
        finiteSolid: { level },
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) =>
        fourD
          ? packSurfaceGpuParamsFinite4(
              canonicalView4,
              { itemCount: n, cutoff: 0 },
              level,
              boundingRadius,
            )
          : packSurfaceGpuParamsFinite(
              { itemCount: n, cutoff: 0 },
              level,
              boundingRadius,
            ),
      // The finite cores are bindingless like the bulb — no maps buffer,
      // and the control's derived layout declares no binding 1.
      packMaps: null,
      // The f32 twin (finiteSolidDdaF32), not the f64 adapter: the DDA is
      // a DISCRETE walk whose cell sequence is decided by exact tie tests,
      // which an f64 twin does not bracket — the kernel's f32 crossing
      // times can order two near-equal axes differently. The twin
      // re-executes the WGSL with every result rounded to f32 over the
      // same inputs, so the walks agree bit-for-bit up to driver FMA
      // contraction (the sphere-inversion f32 twin's discipline one
      // family over). The f64 oracle stays the soundness record, pinned
      // by finite-solid's own harness.
      finiteQuery: (origin, dir, anchor, inside) => {
        const r = finiteSolidDdaF32(
          fourD ? 4 : 3,
          level,
          FINITE_SOLID_HALF_EXTENT,
          // The identity rows for BOTH dimensions: 3D IS the identity pose
          // (the WGSL 3D rowsFn emits the identity), and `null` made the
          // twin's rowXyz return zero rows — every 3D event refused
          // degenerate-normal and the leg absolved itself vacuous through
          // the decision-flip class.
          fourD
            ? [
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
              ]
            : [
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
              ],
          0,
          origin,
          dir,
          anchor,
          inside,
        );
        return {
          kind: r.kind === 1 ? "boundary" : r.kind === 2 ? "miss" : "refused",
          reason: r.reason,
          t: r.t,
          normal: r.normal,
          anchor: r.anchor,
        };
      },
      fixture: {
        estimate: (p) => finiteSolidDisplayDistance(construction, pose, p),
        stepScale: 1,
        visibleRadius: boundingRadius,
      },
    });
  };
  pushFiniteSolidLeg(false);
  pushFiniteSolidLeg(true);

  // The general word-tree legs (the document's OWN maps as the cell tree —
  // the general-construction work's GPU half, both dimensions). Each leg's
  // construction comes from `analyzeFiniteSolidGeneral` over a REAL document
  // (the owner's Sierpinski tetrahedron; the shipped Menger maps as the
  // cross-construction witness; the hyper-Menger maps one dimension up), so
  // the leg pins the kernel against the SAME realization the CPU chain
  // pins: the general twin mirrors the WGSL walk term for term, the f64
  // oracle stays the soundness record, and the shipped-grid cross-check
  // lives in the CPU tests (the word tree with the grid's own maps
  // reproduces the grid's union). The construction bakes into the source,
  // so the params wire and packers are the shipped finite ones verbatim;
  // the marching ball is the root box's farthest corner — the fixture's
  // domain gate reads the same number the packer carries.
  const pushFiniteGeneralLeg = (
    fourD: boolean,
    transforms: Transform[],
    level: number,
    systemName: string,
  ): void => {
    const analysis = analyzeFiniteSolidGeneral(
      transforms,
      null,
      { order: 1, plane: "xz" },
      level,
      fourD ? 4 : 3,
    );
    if (analysis.status !== "eligible" || !analysis.construction) {
      throw new Error(
        `transport ${systemName}: the general admission refused its own fixture: ${analysis.reasons.join("; ")}`,
      );
    }
    const construction = analysis.construction;
    const wire: FiniteSolidGeneralWire = {
      mapScale: construction.mapScale,
      mapOffset: construction.mapOffset,
      rootMin: construction.rootMin,
      rootMax: construction.rootMax,
    };
    const pose = FINITE_SOLID_IDENTITY_POSE;
    const boundingRadius = finiteSolidGeneralBoundingRadius(construction);
    legs.push({
      core: fourD ? "finite4" : "finite",
      systemName,
      backend: "finiteSolid",
      options: {
        mode: "shade",
        core: fourD ? "finite4" : "finite",
        width: 4,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        opticsBackend: "finiteSolid",
        finiteSolid: { level, general: wire },
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) =>
        fourD
          ? packSurfaceGpuParamsFinite4(
              canonicalView4,
              { itemCount: n, cutoff: 0 },
              level,
              boundingRadius,
            )
          : packSurfaceGpuParamsFinite(
              { itemCount: n, cutoff: 0 },
              level,
              boundingRadius,
            ),
      packMaps: null,
      finiteQuery: (origin, dir, anchor, inside) => {
        const r = finiteSolidGeneralDdaF32(
          fourD ? 4 : 3,
          level,
          wire,
          // The identity rows for BOTH dimensions (the shipped finite
          // leg's comment carries: 3D IS the identity pose — the WGSL 3D
          // rowsFn emits the identity — and `null` made the twin's rowXyz
          // return zero rows, refusing every event degenerate-normal).
          [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
          0,
          origin,
          dir,
          anchor,
          inside,
        );
        return {
          kind: r.kind === 1 ? "boundary" : r.kind === 2 ? "miss" : "refused",
          reason: r.reason,
          t: r.t,
          normal: r.normal,
          anchor: r.anchor,
        };
      },
      fixture: {
        estimate: (p) =>
          finiteSolidGeneralDisplayDistance(construction, pose, p),
        stepScale: 1,
        visibleRadius: boundingRadius,
      },
    });
  };
  pushFiniteGeneralLeg(
    false,
    sierpinskiTetrahedron(),
    2,
    "finiteGeneralSierpinski3",
  );
  pushFiniteGeneralLeg(false, mengerSponge(), 1, "finiteGeneralMenger3");
  pushFiniteGeneralLeg(
    true,
    hyperMengerSpongeTransforms(),
    1,
    "finiteGeneralHyperMenger4",
  );

  const escapeSys = systems.escape[0];
  if (escapeSys) {
    const de = escapeSys.de;
    legs.push({
      core: "escape",
      systemName: escapeSys.name,
      backend: "estimator",
      options: {
        mode: "shade",
        core: "escape",
        width: SURFACE_FOLD_BEAM_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) => packEscapeGpuParams(de, { itemCount: n, cutoff: 0 }),
      packMaps: () => new Float32Array(packEscapeGpuMaps(de)),
      fixture: {
        estimate: (p) => estimateEscapeDistance(de, p),
        stepScale: ESCAPE_STEP_SCALE,
        // The bailout ball packs as BOTH the bounding and the visible
        // sphere (packEscapeGpuParams's offsets 12/24) — the fixture's
        // domain gate must read the same number.
        visibleRadius: de.boundingRadius,
      },
    });
  } else {
    notes.push(
      "transport escape: skipped — no escape system built (see notes)",
    );
  }

  const bulbSys = systems.bulb[0];
  if (bulbSys) {
    const de = bulbSys.de;
    legs.push({
      core: "bulb",
      systemName: bulbSys.name,
      backend: "estimator",
      options: {
        mode: "shade",
        core: "bulb",
        width: SURFACE_FOLD_BEAM_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      // The bulb core declares no maps binding — its single map rides the
      // params variant block (the M6 leg's own wire).
      packParams: (n) => packBulbGpuParams(de, { itemCount: n, cutoff: 0 }),
      packMaps: null,
      fixture: {
        estimate: (p) => estimateBulbDistance(de, p),
        stepScale: BULB_STEP_SCALE,
        visibleRadius: de.boundingRadius,
      },
    });
  } else {
    notes.push("transport bulb: skipped — no bulb system built (see notes)");
  }

  pushSurface4Leg("fold4Boxfold", "fold4");
  // The fold core's leg is a MEASURED SKIP on this hardware, not a
  // gap quietly left open: a fold transport invocation exceeds the
  // kernel driver's GPU-job timeout at EVERY budget that exercises the
  // work-list (dmesg `ring gfx_0.0.0 timeout`, chrome killed, every
  // attempt — the width-12 frontier's dynamic indexing spills to scratch
  // inside the transport's deep call nesting, the module doc's own
  // frontier-spill precedent, and the spilled per-eval cost puts any
  // full trace past ~10 s). The other six cores pin the shared
  // arithmetic; the fold core's agreement waits on the spill fix or a
  // per-invocation time bound, and production routing refuses the core
  // on the same evidence.
  notes.push(
    "transport fold: skipped — measured device-loss on this driver " +
      "(GPU-job timeout; the frontier spill inside the transport's " +
      "nesting), disclosed and refused in routing rather than " +
      "certified vacuously",
  );

  const escape4Sys = systems.escape4[0];
  if (escape4Sys) {
    const de = escape4Sys.de;
    legs.push({
      core: "escape4",
      systemName: escape4Sys.name,
      backend: "estimator",
      options: {
        mode: "shade",
        core: "escape4",
        width: SURFACE_FOLD_BEAM_WIDTH,
        workgroupSize: SURFACE_TRANSPORT_WG,
        sharedFrontier: false,
        bnbStage2: false,
        optics: true,
        transportMaxPaths: SURFACE_TRANSPORT_LEG_MAX_PATHS,
      },
      packParams: (n) =>
        packEscape4GpuParams(de, canonicalView4, { itemCount: n, cutoff: 0 }),
      packMaps: () => new Float32Array(packEscape4GpuMaps(de)),
      fixture: {
        estimate: (p) => estimateEscapeDistance4(de, [p[0], p[1], p[2], 0]),
        stepScale: ESCAPE_STEP_SCALE,
        // esc4ChainWRot's own view IS the canonical identity pose; at
        // w0 0 the packer's slice-adjusted marching ball is the full
        // bounding radius (packEscape4GpuParams's offset-24 line).
        visibleRadius: de.boundingRadius,
      },
    });
  } else {
    notes.push(
      "transport escape4: skipped — no escape4 system built (see notes)",
    );
  }

  if (only !== undefined) {
    const kept = legs.filter((leg) => leg.backend === only);
    legs.length = 0;
    legs.push(...kept);
    notes.length = 0;
  }
  const rows: SurfaceTransportAgreementRow[] = [];
  for (const leg of legs) {
    note(`transport: leg ${leg.core} (${leg.systemName}) begin`);
    status(`transport agreement: compiling ${leg.core} × ${leg.systemName}…`);
    activity.setState("gpu", `Surface transport agreement — ${leg.core}`);
    const { pipeline, compileMs } = await buildSurfacePipeline(
      device,
      "auto",
      `${surfaceDeKernelWgsl(leg.options)}\n${surfaceTransportControlWgsl(leg.backend)}`,
      "controlTransport",
      `surface-de transport ${leg.core}`,
    );
    const visR = leg.fixture.visibleRadius;
    let probes = surfaceTransportProbes(leg.fixture);

    if (probes.length === 0) {
      // Sparse canonical pose (a 4D slice can present no disc at all from
      // this camera): one denser sweep, then the seeded ball sample, then
      // SKIP with a note — an agreement leg never certifies vacuously,
      // and a system that presents no surface has nothing to certify.
      probes = surfaceTransportProbes(
        leg.fixture,
        SURFACE_TRANSPORT_PROBE_NDC_DENSE,
      );
    }
    if (probes.length === 0) {
      probes = surfaceTransportProbesSeeded(leg.fixture);
      const onSurface = surfaceTransportProbeOnSurface(leg.fixture, probes);
      notes.push(
        `transport ${leg.core} (${leg.systemName}): the seeded ball ` +
          `sample keeps the ${String(SURFACE_TRANSPORT_PROBE_RAYS)} ` +
          `nearest-to-surface points (${String(onSurface)} of them within ` +
          "the 1e-3 threshold) — a razor-thin canonical slice; both " +
          "engines run the same origins, so the arithmetic agreement " +
          "is unchanged",
      );
    }
    // The leg's named extra probes (the family-specific geometry the grid
    // cannot aim at), appended after the grid so the grid's indices keep
    // their meaning in every failure message.
    for (const extra of leg.extraProbes ?? []) {
      const hit = surfaceTransportMarchProbe(leg.fixture, extra.ro, extra.dir);
      if (!hit) {
        throw new Error(
          `transport ${leg.core} (${leg.systemName}): extra probe "${extra.label}" found no primary hit`,
        );
      }
      notes.push(
        `transport ${leg.core} (${leg.systemName}): extra probe ${String(probes.length)} = ${extra.label}`,
      );
      probes = [...probes, hit];
    }
    // The control wire's strides are per-backend: the finite legs' query
    // record carries the DDA's caller-carried anchor past the shared
    // 128-byte stride (a vec4f intrinsic point at 128, a u32 tied-plane
    // mask at 144, and two vec4i index pairs at 160/176 — stride 192),
    // and its boundary result carries the anchor OUT across six vec4f
    // lanes (stride 96) where the estimator/closed-solid results are four
    // (stride 64). resultsBuf/staging keep riding the QUERY buffer's byte
    // length (192 ≥ 96), so the copy size is one expression for every
    // backend and the extra slack is the same harmless overhang the
    // 64-byte results already rode under a 128-byte stride; the dispatch
    // count and the comparison indexing take the per-leg pair.
    const finite = leg.backend === "finiteSolid";
    if (finite) {
      // THE INPUT CONTRACT: the twin consumes exactly what the kernel
      // consumes. The control wire packs the probes as f32, and the DDA
      // is discrete — its ray-side cell classification flips when a hit
      // sits within the f32 rounding of a grid plane (a display hit
      // converges TO a plane, so this is the common case, not the
      // edge case). Quantizing the probe origins, directions and every
      // carried anchor point to f32 puts both engines on the same
      // numbers; the frozen f32 pose rows are the same lesson one
      // module over (finite-solid.ts's harness gotcha).
      probes = probes.map((probe) => ({
        hitPos: probe.hitPos.map(Math.fround) as Vec3,
        dir: probe.dir.map(Math.fround) as Vec3,
      }));
    }
    const queryStride = finite ? 192 : SURFACE_TRANSPORT_QUERY_STRIDE_BYTES;
    const resultStride = finite ? 96 : 64;
    const resultFloats = resultStride / 4;
    // The finite backend's twin (the leg's one closure) — absent on every
    // other backend, which is exactly what the twin consumers want.
    const finiteQuery = leg.finiteQuery;
    // The control wire, TWO dispatches per leg so a fault names its half:
    // first the boundary queries (mode 1) — unanchored then anchored per
    // probe — read back and compared, THEN the trace queries (mode 0).
    // Both padded with zero-estimator lanes (mode 1, origin far outside
    // the domain sphere — the boundary query's own tFar check misses them
    // on the first loop test) so the padded dispatch reads no lane past
    // the array.
    type ControlQueryRec = {
      origin: Vec3;
      dir: Vec3;
      anchorPoint: Vec3;
      eps: number;
      ior: number;
      radius: number;
      absorb: Vec3;
      theta: number;
      anchorPresent: number;
      mode: number;
      /** The caller-carried medium riding the query record's last slot.
       * Read only by the closed-solid backend's query; the estimator
       * legs pack 0 and never read it. */
      inside: number;
      /** Mode 2's corridor ball: center, radius and the session's
       * visible radius (the stride clamp's ceiling). The estimator legs
       * pack zeros and never reach mode 2. */
      ballC: Vec3;
      ballR: number;
      visR: number;
      /** The trace probes' authored distortion word (lane 1.y); zero on
       * every probe that pins the straight terminal. */
      distortion: number;
      /** The finite backend's caller-carried anchor (the oracle's
       * `FiniteSolidAnchor`): the snapped intrinsic intersection point
       * (ALL FOUR components — the vec4 wire carries the w slot even
       * where the 3D/4D DDA lift reads xyz), the tied-plane mask, and
       * the tied-plane / post-incident cell indices. Packed past the
       * shared stride at 128/144/160/176 on the finite legs only; every
       * finite record carries all four fields (inert sentinels on an
       * unanchored query — mask 0, indices −1), so a missing field is a
       * host bug the packer throws on rather than silently re-zeroing
       * an anchor. */
      finiteIntrinsic?: Vec4;
      finiteMask?: number;
      finitePlanes?: [number, number, number, number];
      finiteCells?: [number, number, number, number];
    };
    /** The record's finite anchor fields back into the oracle's
     * `FiniteSolidAnchor` — the twin's anchored-restart input. The
     * records carry the twin's OWN f64 anchor (the anchored probes pack
     * what the unanchored twin handed back), so this reconstruction is
     * exact on the CPU side; the GPU's f32 rounding of the same anchor
     * is what the comparison's reconstruction envelope is for. */
    const finiteAnchorOf = (q: ControlQueryRec): FiniteSolidAnchor | null => {
      if (q.anchorPresent !== 1) return null;
      if (
        !q.finiteIntrinsic ||
        q.finiteMask === undefined ||
        !q.finitePlanes ||
        !q.finiteCells
      ) {
        throw new Error(
          `transport ${leg.core} (${leg.systemName}): an anchored query ` +
            "record is missing its finite anchor fields (host bug)",
        );
      }
      return {
        intrinsicPoint: [
          Math.fround(q.finiteIntrinsic[0]),
          Math.fround(q.finiteIntrinsic[1]),
          Math.fround(q.finiteIntrinsic[2]),
          Math.fround(q.finiteIntrinsic[3]),
        ] as Vec4,
        planeMask: q.finiteMask,
        planeIndices: q.finitePlanes,
        cellIndices: q.finiteCells,
      };
    };
    const boundaryQueries: ControlQueryRec[] = [];
    const traceQueries: ControlQueryRec[] = [];
    // Per-probe boundary-query counts, parallel to `probes`: the
    // estimator/closed-solid legs always push two (the comparison walks
    // pairs), the finite legs push ONE unanchored query plus — when the
    // twin hands back an anchor — TWO anchored restarts. The comparison
    // walk reads the count and the per-probe base instead of assuming a
    // pair, so the three backends share one loop.
    const boundaryCounts: number[] = [];
    for (const probe of probes) {
      const boundaryStart = boundaryQueries.length;
      if (finite) {
        // The finite legs' DDA probes. (a) is the UNANCHORED inside
        // query from the display hit along the camera ray — the finite
        // fields ride inert (mask 0, planes/cells −1): the kernel
        // dispatches on anchorPresent, and a null anchor is the DDA's
        // world-origin call. The twin's answer for (a) decides the
        // anchored pair: a boundary hands back the DDA's full anchor
        // (the crossed face's intrinsic point, tied-plane mask, plane
        // and post-incident cell indices), and the two anchored probes
        // restart FROM it — (b) the post-exit medium along the same
        // direction (the anchored restart's outward march, whose honest
        // outcome is usually the grid miss) and (c) the REVERSED
        // direction with the inside claim (the masked axis's side
        // selection flips with the direction — the anchor contract's
        // direction term). An anchored query's origin is INERT on both
        // engines (the query is rebuilt from the anchor), so it packs
        // the physical hit for readability.
        boundaryQueries.push({
          origin: [probe.hitPos[0], probe.hitPos[1], probe.hitPos[2]],
          dir: [probe.dir[0], probe.dir[1], probe.dir[2]],
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 1,
          inside: 1,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
          finiteIntrinsic: [0, 0, 0, 0],
          finiteMask: 0,
          finitePlanes: [-1, -1, -1, -1],
          finiteCells: [-1, -1, -1, -1],
        });
        const first = finiteQuery!(
          [probe.hitPos[0], probe.hitPos[1], probe.hitPos[2]],
          [probe.dir[0], probe.dir[1], probe.dir[2]],
          null,
          true,
        );
        if (first.kind === "boundary" && first.anchor) {
          const anchor = first.anchor;
          const anchorFields = {
            finiteIntrinsic: [...anchor.intrinsicPoint] as Vec4,
            finiteMask: anchor.planeMask,
            finitePlanes: [
              anchor.planeIndices[0],
              anchor.planeIndices[1],
              anchor.planeIndices[2],
              anchor.planeIndices[3],
            ] as [number, number, number, number],
            finiteCells: [
              anchor.cellIndices[0],
              anchor.cellIndices[1],
              anchor.cellIndices[2],
              anchor.cellIndices[3],
            ] as [number, number, number, number],
          };
          boundaryQueries.push({
            origin: [probe.hitPos[0], probe.hitPos[1], probe.hitPos[2]],
            dir: [probe.dir[0], probe.dir[1], probe.dir[2]],
            anchorPoint: [0, 0, 0],
            eps: DIELECTRIC_CROSSING_EPS_REL * visR,
            ior: DIELECTRIC_IOR,
            radius: visR,
            absorb: DIELECTRIC_ABSORPTION,
            theta: DIELECTRIC_INITIAL_BRANCH_THETA,
            anchorPresent: 1,
            mode: 1,
            inside: 0,
            ballC: [0, 0, 0],
            ballR: visR,
            visR,
            distortion: 0,
            ...anchorFields,
          });
          boundaryQueries.push({
            origin: [probe.hitPos[0], probe.hitPos[1], probe.hitPos[2]],
            dir: [-probe.dir[0], -probe.dir[1], -probe.dir[2]],
            anchorPoint: [0, 0, 0],
            eps: DIELECTRIC_CROSSING_EPS_REL * visR,
            ior: DIELECTRIC_IOR,
            radius: visR,
            absorb: DIELECTRIC_ABSORPTION,
            theta: DIELECTRIC_INITIAL_BRANCH_THETA,
            anchorPresent: 1,
            mode: 1,
            inside: 1,
            ballC: [0, 0, 0],
            ballR: visR,
            visR,
            distortion: 0,
            ...anchorFields,
          });
        }
      } else if (surfaceTransportSignedBackend(leg.backend)) {
        // The closed-solid legs' arms pin the INSIDE traversal (the
        // backend's whole point) beside the outside one: the anchored
        // arm restarts AT the hit heading INTO the solid with the
        // refracted child's medium — the estimator legs' anchored arm
        // marches the REVERSE ray with no medium at all — and the
        // unanchored arm starts just past the hit along the reverse ray
        // with the reflected child's medium. The trace probe (below)
        // resolves end to end under the signed query in both arms.
        boundaryQueries.push({
          origin: probe.hitPos,
          dir: [probe.dir[0], probe.dir[1], probe.dir[2]],
          anchorPoint: probe.hitPos,
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 1,
          mode: 1,
          inside: 1,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
        boundaryQueries.push({
          origin: [
            probe.hitPos[0] + probe.dir[0] * visR * 0.01,
            probe.hitPos[1] + probe.dir[1] * visR * 0.01,
            probe.hitPos[2] + probe.dir[2] * visR * 0.01,
          ],
          dir: [-probe.dir[0], -probe.dir[1], -probe.dir[2]],
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 1,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
        if (leg.backend === "sphereInversion") {
          // THE CHAIN-REPLAY ARM: the twin's OWN boundary-query chain while
          // it traces this probe, replayed on the GPU query by query. A
          // trace chains dozens of queries, so a trace-level disagreement
          // names nothing; the first chain query whose answers differ
          // names the divergence exactly. Capped per probe so a long
          // trace cannot swamp the dispatch.
          const chain: ControlQueryRec[] = [];
          transportTraceCPU(
            leg.fixture,
            probe.hitPos,
            probe.dir,
            DIELECTRIC_INITIAL_BRANCH_THETA,
            {
              ior: DIELECTRIC_IOR,
              absorption: DIELECTRIC_ABSORPTION,
              radius: visR,
            },
            SURFACE_TRANSPORT_CONTROL_BG_LINEAR,
            {
              maxProcessedPaths:
                leg.options.transportMaxPaths ??
                SURFACE_TRANSPORT_LEG_MAX_PATHS,
              maxInterfaces:
                leg.options.transportMaxPaths ??
                SURFACE_TRANSPORT_LEG_MAX_PATHS,
            },
            (origin, dir, anchorPresent, anchorPoint, inside, eps) => {
              if (chain.length < SURFACE_TRANSPORT_CHAIN_REPLAY_CAP) {
                chain.push({
                  origin: [...origin] as Vec3,
                  dir: [...dir] as Vec3,
                  anchorPoint: [...anchorPoint] as Vec3,
                  eps,
                  ior: DIELECTRIC_IOR,
                  radius: visR,
                  absorb: DIELECTRIC_ABSORPTION,
                  theta: DIELECTRIC_INITIAL_BRANCH_THETA,
                  anchorPresent: anchorPresent ? 1 : 0,
                  mode: 1,
                  inside: inside ? 1 : 0,
                  ballC: [0, 0, 0],
                  ballR: visR,
                  visR,
                  distortion: 0,
                });
              }
              return transportSolidBoundaryQueryCPU(
                leg.fixture,
                origin,
                dir,
                anchorPresent,
                anchorPoint,
                inside,
                eps,
              );
            },
          );
          boundaryQueries.push(...chain);
        }
      } else {
        boundaryQueries.push({
          origin: [
            probe.hitPos[0] + probe.dir[0] * visR * 0.01,
            probe.hitPos[1] + probe.dir[1] * visR * 0.01,
            probe.hitPos[2] + probe.dir[2] * visR * 0.01,
          ],
          dir: [-probe.dir[0], -probe.dir[1], -probe.dir[2]],
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 1,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
        boundaryQueries.push({
          origin: probe.hitPos,
          dir: [-probe.dir[0], -probe.dir[1], -probe.dir[2]],
          anchorPoint: probe.hitPos,
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 1,
          mode: 1,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
      }
      boundaryCounts.push(boundaryQueries.length - boundaryStart);
      traceQueries.push({
        // Finite transport, including its primary interface, starts outside.
        // The other backends retain their display-hit primary split.
        origin: finite
          ? (probe.hitPos.map((v, a) =>
              Math.fround(v - 2 * visR * probe.dir[a]),
            ) as Vec3)
          : probe.hitPos,
        dir: probe.dir,
        anchorPoint: [0, 0, 0],
        eps: 0,
        ior: DIELECTRIC_IOR,
        radius: visR,
        absorb: DIELECTRIC_ABSORPTION,
        theta: DIELECTRIC_INITIAL_BRANCH_THETA,
        anchorPresent: 0,
        mode: 0,
        inside: 0,
        ballC: [0, 0, 0],
        ballR: visR,
        visR,
        distortion: 0,
        // The finite backend's packQueries is fail-closed over the anchor
        // fields, so every record carries the inert sentinel (mode 0's
        // paths start unanchored — the DDA builds its own anchor from the
        // primary hit).
        ...(finite
          ? {
              finiteIntrinsic: [0, 0, 0, 0] as Vec4,
              finiteMask: 0,
              finitePlanes: [-1, -1, -1, -1] as [
                number,
                number,
                number,
                number,
              ],
              finiteCells: [-1, -1, -1, -1] as [number, number, number, number],
            }
          : {}),
      });
    }
    // The closed-solid legs' shadow probes (mode 2): the floor corridor's
    // straight shadow visibility through the session's optical solid —
    // the rear-scene task's corridor fix. Deterministic floor points
    // below the certified ball, light-ish directions through it, plus
    // the two gate exits (ball-behind, corridor-clearing) that must
    // return exactly 1 with zero field evals. The through-lobe probe's
    // expected value is the ANALYTIC control (checked below): one
    // crossing pair through the fixture's emitter at normal incidence —
    // (1-F0)² · Beer(chord) — the chord the leg authors from its own
    // fixture's geometry (0.7 the separated sphere, 1.0 the abutting
    // through-box).
    const shadowQueries: ControlQueryRec[] = [];
    const [shadowX, shadowZ] = leg.shadowXZ ?? [0.35, 0.05];
    if (surfaceTransportSignedBackend(leg.backend)) {
      const floorY = -1.2 * visR;
      const norm3 = (v: Vec3): Vec3 => {
        const l = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const probeShadow = (origin: Vec3, dir: Vec3): void => {
        shadowQueries.push({
          origin,
          dir,
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 2,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
      };
      probeShadow([shadowX, floorY, shadowZ], [0, 1, 0]);
      probeShadow([shadowX, floorY, shadowZ], norm3([0.4, 1, 0.2]));
      probeShadow([-0.4, floorY, -0.05], norm3([-0.5, 1, -0.3]));
      // Gate exits: ball-behind (along <= 0) and a closest approach
      // clearing 1.05 R + 0.3 * along — transmittance exactly 1.
      probeShadow([2 * visR, 0, 0], [1, 0, 0]);
      probeShadow([0, floorY, 0], norm3([1, 0.05, 0]));
    }
    // The closed-solid legs' DISTORTION trace probes: the same probe rays
    // re-traced with the authored slab live — the exit-transmitted
    // terminal's rear query displaces through the virtual parallel slab
    // (the accepted bounded model). The twin's rear scene is the fixed
    // backdrop, so the displaced ORIGIN cannot change either side's
    // radiance — what these probes pin is that the kernel's terminal
    // branch and exit flag leave the status/residual agreement intact
    // with the slab live; the displacement itself is the mode-3 probes'
    // axis, below. Zero stays on every other probe, so the
    // straight-terminal pins are unchanged.
    const terminalQueries: ControlQueryRec[] = [];
    if (surfaceTransportSignedBackend(leg.backend)) {
      for (const probe of probes) {
        traceQueries.push({
          origin: probe.hitPos,
          dir: probe.dir,
          anchorPoint: [0, 0, 0],
          eps: 0,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 0,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: SURFACE_TRANSPORT_DISTORTION_PROBE,

          ...(finite
            ? {
                finiteIntrinsic: [0, 0, 0, 0] as Vec4,
                finiteMask: 0,
                finitePlanes: [-1, -1, -1, -1] as [
                  number,
                  number,
                  number,
                  number,
                ],
                finiteCells: [-1, -1, -1, -1] as [
                  number,
                  number,
                  number,
                  number,
                ],
              }
            : {}),
        });
      }
      // The terminal-displacement probes (mode 3): the same probe rays as
      // EXIT points — the smoothed normal taps and the slab displacement
      // the trace's terminal applies, pinned against
      // transportTerminalDisplacementCPU (the ORACLE's own helpers over
      // this fixture's field), origin for origin and component for
      // component.
      for (const probe of probes) {
        terminalQueries.push({
          origin: probe.hitPos,
          dir: probe.dir,
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 3,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: SURFACE_TRANSPORT_DISTORTION_PROBE,
        });
      }
    }
    // The probes' boundary-query bases — each probe's start offset in the
    // flat list — computed once so the comparison walk indexes the list
    // through them (identical to the `pi * 2` arithmetic it replaces on
    // the two-probe backends).
    const boundaryBases: number[] = [];
    let boundaryWalk = 0;
    for (const c of boundaryCounts) {
      boundaryBases.push(boundaryWalk);
      boundaryWalk += c;
    }
    const count = boundaryQueries.length + traceQueries.length;
    // Pack one query list into its wire buffer, padding to the workgroup
    // multiple with zero-estimator lanes (mode 1, origin far outside the
    // domain sphere along +x — the boundary query's own tFar check misses
    // them on the first loop test) so the padded dispatch reads no lane
    // past the array. The stride is the per-backend pair: the finite
    // backend's anchor fields extend the shared stride to 192 and are
    // packed here (all four intrinsic components — the vec4 wire carries
    // the w slot even where the 3D/4D DDA lift reads xyz), thrown-on when
    // a finite record is missing one rather than silently re-zeroed.
    const packQueries = (list: ControlQueryRec[]): ArrayBuffer => {
      const padded =
        Math.ceil(list.length / SURFACE_TRANSPORT_WG) * SURFACE_TRANSPORT_WG;
      const data = new ArrayBuffer(padded * queryStride);
      const view = new DataView(data);
      const write = (q: ControlQueryRec, i: number): void => {
        const base = i * queryStride;
        view.setFloat32(base, q.origin[0], true);
        view.setFloat32(base + 4, q.origin[1], true);
        view.setFloat32(base + 8, q.origin[2], true);
        view.setFloat32(base + 16, q.dir[0], true);
        view.setFloat32(base + 20, q.dir[1], true);
        view.setFloat32(base + 24, q.dir[2], true);
        view.setFloat32(base + 32, q.anchorPoint[0], true);
        view.setFloat32(base + 36, q.anchorPoint[1], true);
        view.setFloat32(base + 40, q.anchorPoint[2], true);
        view.setFloat32(base + 44, q.eps, true);
        view.setFloat32(base + 48, q.ior, true);
        view.setFloat32(base + 52, q.radius, true);
        view.setFloat32(base + 64, q.absorb[0], true);
        view.setFloat32(base + 68, q.absorb[1], true);
        view.setFloat32(base + 72, q.absorb[2], true);
        view.setFloat32(base + 76, q.theta, true);
        view.setUint32(base + 80, q.anchorPresent, true);
        view.setUint32(base + 84, q.mode, true);
        view.setUint32(base + 88, q.inside, true);
        view.setFloat32(base + 96, q.ballC[0], true);
        view.setFloat32(base + 100, q.ballC[1], true);
        view.setFloat32(base + 104, q.ballC[2], true);
        view.setFloat32(base + 108, q.ballR, true);
        view.setFloat32(base + 112, q.visR, true);
        view.setFloat32(base + 116, q.distortion, true);
        if (finite) {
          // The finite backend's caller-carried anchor, past the shared
          // stride: the vec4f intrinsic point at 128 (ALL FOUR
          // components), the u32 tied-plane mask at 144, and the vec4i
          // plane/cell index pairs at their 16-byte alignments 160/176.
          if (
            !q.finiteIntrinsic ||
            q.finiteMask === undefined ||
            !q.finitePlanes ||
            !q.finiteCells
          ) {
            throw new Error(
              `transport ${leg.core} (${leg.systemName}): a finite query ` +
                "record is missing its anchor fields (host bug)",
            );
          }
          view.setFloat32(base + 128, q.finiteIntrinsic[0], true);
          view.setFloat32(base + 132, q.finiteIntrinsic[1], true);
          view.setFloat32(base + 136, q.finiteIntrinsic[2], true);
          view.setFloat32(base + 140, q.finiteIntrinsic[3], true);
          view.setUint32(base + 144, q.finiteMask, true);
          view.setInt32(base + 160, q.finitePlanes[0], true);
          view.setInt32(base + 164, q.finitePlanes[1], true);
          view.setInt32(base + 168, q.finitePlanes[2], true);
          view.setInt32(base + 172, q.finitePlanes[3], true);
          view.setInt32(base + 176, q.finiteCells[0], true);
          view.setInt32(base + 180, q.finiteCells[1], true);
          view.setInt32(base + 184, q.finiteCells[2], true);
          view.setInt32(base + 188, q.finiteCells[3], true);
        }
      };
      list.forEach(write);
      for (let i = list.length; i < padded; i++) {
        write(
          {
            origin: [visR * 10, 0, 0],
            dir: [1, 0, 0],
            anchorPoint: [0, 0, 0],
            eps: 0,
            ior: DIELECTRIC_IOR,
            radius: visR,
            absorb: DIELECTRIC_ABSORPTION,
            theta: DIELECTRIC_INITIAL_BRANCH_THETA,
            anchorPresent: 0,
            mode: 1,
            inside: 0,
            ballC: [0, 0, 0],
            ballR: 0,
            visR,
            distortion: 0,
            // The finite backend's inert sentinel anchor (mask 0,
            // indices −1): a pad lane is a mode-1 unanchored query from
            // far outside the domain sphere, so the DDA's root clip
            // misses it before any anchor field is read.
            ...(finite
              ? {
                  finiteIntrinsic: [0, 0, 0, 0] as Vec4,
                  finiteMask: 0,
                  finitePlanes: [-1, -1, -1, -1] as [
                    number,
                    number,
                    number,
                    number,
                  ],
                  finiteCells: [-1, -1, -1, -1] as [
                    number,
                    number,
                    number,
                    number,
                  ],
                }
              : {}),
          },
          i,
        );
      }
      return data;
    };

    const paramsData = leg.packParams(
      Math.max(
        boundaryQueries.length,
        traceQueries.length,
        shadowQueries.length,
        terminalQueries.length,
      ),
    );
    // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
    const mapsData = leg.packMaps?.() ?? null;
    const params = await createSurfaceBuffer(
      device,
      `surface-de transport params ${leg.core}`,
      paramsData.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(params, 0, paramsData);
    let maps: GPUBuffer | null = null;
    if (mapsData) {
      maps = await createSurfaceBuffer(
        device,
        `surface-de transport maps ${leg.core}`,
        mapsData.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
      // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
      device.queue.writeBuffer(maps, 0, new Float32Array(mapsData));
    }
    // The opticsMaps lanes (binding 13): mode 2's shadow-visibility
    // helper reads slot 0's material, so the CLOSED-SOLID legs pack the
    // one-slot wire with the same numbers the trace probes' material
    // carries. The estimator legs' control entry never reaches it — the
    // helper is only emitted under the closed-solid backend — and an
    // unused binding must stay out of the derived layout's bind group.
    const legOpticsMaps: GPUBuffer | null = surfaceTransportSignedBackend(
      leg.backend,
    )
      ? await createSurfaceBuffer(
          device,
          `surface-de transport optics maps ${leg.core}`,
          8 * 4,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        )
      : null;
    if (legOpticsMaps) {
      device.queue.writeBuffer(
        legOpticsMaps,
        0,
        new Float32Array(
          packSurfaceGpuOpticsMaps([
            {
              finish: resolveSurfaceFinish(undefined),
              pattern: resolveSurfacePattern(undefined),
              optics: {
                ior: DIELECTRIC_IOR,
                absorption: [...DIELECTRIC_ABSORPTION] as Vec3,
                radius: visR,
                distortion: 0,
              },
            },
          ]),
        ),
      );
    }
    // One dispatch per query list (boundary first, then trace) so a fault
    // names its half; layout "auto" — the bind group derives from the
    // control entry's own transitively-used bindings — never the
    // section's shared layouts. The results buffer is sized from the
    // query buffer: one ControlResult per padded query lane.
    const runControl = async (
      list: ControlQueryRec[],
    ): Promise<Float32Array> => {
      const queryData = packQueries(list);
      const queriesBuf = await createSurfaceBuffer(
        device,
        `surface-de transport queries ${leg.core}`,
        queryData.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
      device.queue.writeBuffer(queriesBuf, 0, queryData);
      const resultsBuf = await createSurfaceBuffer(
        device,
        `surface-de transport results ${leg.core}`,
        queryData.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      );
      const staging = await createSurfaceBuffer(
        device,
        `surface-de transport staging ${leg.core}`,
        queryData.byteLength,
        GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      );
      const bindGroup = device.createBindGroup({
        label: `surface-de transport bind group ${leg.core}`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          ...(maps ? [{ binding: 1, resource: { buffer: maps } }] : []),
          ...(legOpticsMaps
            ? [{ binding: 13, resource: { buffer: legOpticsMaps } }]
            : []),
          { binding: 16, resource: { buffer: queriesBuf } },
          { binding: 17, resource: { buffer: resultsBuf } },
        ],
      });
      try {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
          queryData.byteLength / SURFACE_TRANSPORT_WG / queryStride,
        );
        pass.end();
        encoder.copyBufferToBuffer(
          resultsBuf,
          0,
          staging,
          0,
          queryData.byteLength,
        );
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await staging.mapAsync(GPUMapMode.READ);
        const out = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        return out;
      } finally {
        queriesBuf.destroy();
        resultsBuf.destroy();
        staging.destroy();
      }
    };
    let boundaryOut: Float32Array;
    let traceOut: Float32Array;
    let shadowOut: Float32Array | null = null;
    let terminalOut: Float32Array | null = null;
    // The sphere-inversion legs' FIELD probes (mode 4): member points of
    // the displayed set — rejection samples in the domain ball, then pairs
    // bisected toward the boundary from both sides — where the GPU's signed
    // field is read against the f64 authority. The deterministic RNG keeps
    // the set identical run to run.
    const fieldQueries: ControlQueryRec[] = [];
    if (leg.backend === "sphereInversion" && leg.fixture.contains) {
      const contains = leg.fixture.contains;
      const rng = mulberry32(0x9ea55);
      const members: Vec3[] = [];
      const others: Vec3[] = [];
      for (
        let i = 0;
        i < 400_000 && members.length < SURFACE_TRANSPORT_FIELD_PROBES;
        i++
      ) {
        const p: Vec3 = [
          (2 * rng() - 1) * visR,
          (2 * rng() - 1) * visR,
          (2 * rng() - 1) * visR,
        ];
        if (Math.hypot(p[0], p[1], p[2]) > visR) continue;
        if (contains(p)) members.push(p);
        else if (others.length < SURFACE_TRANSPORT_FIELD_PROBES) others.push(p);
      }
      const points: Vec3[] = [...members];
      for (let i = 0; i < members.length && others.length > 0; i++) {
        let a = members[i];
        let b = others[i % others.length];
        const steps = 8 + Math.floor(rng() * 24);
        for (let k = 0; k < steps; k++) {
          const mid: Vec3 = [
            0.5 * (a[0] + b[0]),
            0.5 * (a[1] + b[1]),
            0.5 * (a[2] + b[2]),
          ];
          if (contains(mid)) a = mid;
          else b = mid;
        }
        points.push(a, b);
      }
      for (const origin of points) {
        fieldQueries.push({
          origin: origin.map(Math.fround) as Vec3,
          dir: [0, 0, 1],
          anchorPoint: [0, 0, 0],
          eps: DIELECTRIC_CROSSING_EPS_REL * visR,
          ior: DIELECTRIC_IOR,
          radius: visR,
          absorb: DIELECTRIC_ABSORPTION,
          theta: DIELECTRIC_INITIAL_BRANCH_THETA,
          anchorPresent: 0,
          mode: 4,
          inside: 0,
          ballC: [0, 0, 0],
          ballR: visR,
          visR,
          distortion: 0,
        });
      }
    }
    let fieldOut: Float32Array | null = null;
    try {
      boundaryOut = await runControl(boundaryQueries);
      note(`transport: ${leg.core} boundary dispatch ok`);
      traceOut = await runControl(traceQueries);
      note(`transport: ${leg.core} trace dispatch ok`);
      if (shadowQueries.length > 0) {
        shadowOut = await runControl(shadowQueries);
        note(`transport: ${leg.core} shadow dispatch ok`);
      }
      if (terminalQueries.length > 0) {
        terminalOut = await runControl(terminalQueries);
        note(`transport: ${leg.core} terminal dispatch ok`);
      }
      if (fieldQueries.length > 0) {
        fieldOut = await runControl(fieldQueries);
        note(`transport: ${leg.core} field dispatch ok`);
      }
    } finally {
      params.destroy();
      maps?.destroy();
      legOpticsMaps?.destroy();
    }

    let maxRadianceDelta = 0;
    let maxResidualDelta = 0;
    let maxNormalDelta = 0;
    // The forward legs' flip accounting: a probe the ULP ensemble says is
    // chaos-unstable is EXCLUDED from the hard gate and counted here —
    // the escape legs' pre-hoc ensemble with exclusions disclosed per
    // row. Past the cap the fixture certifies nothing and the leg fails.
    const legCap =
      leg.options.transportMaxPaths ?? SURFACE_TRANSPORT_LEG_MAX_PATHS;
    const legCaps = {
      maxProcessedPaths: legCap,
      maxInterfaces: legCap,
    };
    const forward = SURFACE_TRANSPORT_FORWARD_CORES.has(leg.core);
    // The finite DDA joins the forward cores in the ULP ensemble: the
    // descent estimators are CONTINUOUS (a ulp nudge moves the estimate a
    // ulp), but the DDA is DISCRETE — its ray-side cell classification
    // and its exact-tie crossings can flip across a f32 ulp of the query
    // origin, so a probe whose twin disagrees with its own ULP neighbors
    // is excluded and counted (the escape legs' pre-hoc shape), never
    // compared against a differently-realized GPU chain.
    const discreteQuery = forward || leg.backend === "finiteSolid";
    let flipped = 0;
    // A finite leg must compare real traces and resolve at least one of
    // them; excluding every probe cannot certify optical agreement.
    let stableFiniteTraces = 0;
    let resolvedFiniteTraces = 0;

    const fail = (probe: number, kind: string, detail: string): never => {
      throw new Error(
        `transport ${leg.core} (${leg.systemName}) probe ${probe} ${kind}: ${detail}`,
      );
    };
    probes.forEach((probe, pi) => {
      // The BOUNDARY probes run FIRST: a trace chains dozens of queries,
      // so a trace mismatch names nothing — the narrowest disagreement
      // (one query, the chain-replay arm's included) is reported first.
      // --- the BOUNDARY probes (mode 1), backend's own arms ---
      // The closed-solid legs' arm 0 is the ANCHORED inside traversal (the
      // refracted child); the estimator legs' arm 1 is theirs; the finite
      // legs' arms are the DDA's own order (the unanchored query first,
      // then its anchored restarts). The labels and the anchored-arm t
      // pin follow the RECORD's own anchorPresent flag — one derivation
      // for the three orderings.
      const boundaryBase = boundaryBases[pi];
      // Per-probe worst boundary deltas (the chain-replay arm's disclosure).
      let probeTDelta = 0;
      let probeNormalDelta = 0;
      for (let b = 0; b < boundaryCounts[pi]; b++) {
        const query = boundaryQueries[boundaryBase + b];
        const anchoredArm = query.anchorPresent === 1;
        const armName = anchoredArm
          ? "boundary-anchored"
          : "boundary-unanchored";
        let cpuHit: TransportBoundaryResult;
        let cpuAnchor: FiniteSolidAnchor | null = null;
        if (surfaceTransportSignedBackend(leg.backend)) {
          cpuHit = transportSolidBoundaryQueryCPU(
            leg.fixture,
            query.origin,
            query.dir,
            query.anchorPresent === 1,
            query.anchorPoint,
            query.inside === 1,
            query.eps,
          );
        } else if (leg.backend === "finiteSolid") {
          // The DDA twin consumes the record's OWN anchor (the anchored
          // probes pack what the unanchored twin handed back — f64
          // exact); the anchor out is compared below.
          const finiteHit = finiteQuery!(
            query.origin,
            query.dir,
            finiteAnchorOf(query),
            query.inside === 1,
          );
          cpuHit = finiteHit;
          cpuAnchor = finiteHit.anchor;
        } else {
          cpuHit = transportBoundaryQueryCPU(
            leg.fixture,
            query.origin,
            query.dir,
            query.anchorPresent === 1,
            query.anchorPoint,
            query.eps,
          );
        }
        const base = (boundaryBase + b) * resultFloats;
        const gpuKind = boundaryOut[base];
        const gpuT = boundaryOut[base + 2];
        const gpuNormal = [0, 1, 2].map((c) => boundaryOut[base + 4 + c]);
        // Every backend returns finite t and normal lanes, including the
        // zero-filled finite miss/refusal sentinel. A pre-hoc geometry
        // exclusion never excuses corrupt GPU output; check before it can
        // skip comparisons (NaN would otherwise pass `delta > tolerance`).
        if (
          ![gpuKind, boundaryOut[base + 1], gpuT, ...gpuNormal].every(
            Number.isFinite,
          )
        ) {
          fail(
            pi,
            armName,
            `non-finite GPU boundary result — kind ${String(gpuKind)} reason ${String(boundaryOut[base + 1])} t ${String(gpuT)} normal ${gpuNormal.map(String).join(",")}`,
          );
          continue;
        }
        const boundaryStable =
          !discreteQuery ||
          surfaceTransportBoundaryProbeStable(
            leg.fixture,
            query.origin,
            query.dir,
            query.anchorPresent === 1,
            query.anchorPoint,
            query.eps,
            finite
              ? (o: Vec3, d: Vec3) =>
                  finiteQuery!(o, d, finiteAnchorOf(query), query.inside === 1)
              : undefined,
          );
        if (!boundaryStable) flipped++;
        if (!boundaryStable) continue;
        // THE MEMBERSHIP INVARIANT (sphere-inversion legs): the field is a
        // certified BOUND whose band also fires where the bound is merely
        // loose, so a reported boundary is real only where exact
        // membership flips across the landing — the kernel's own gate,
        // re-asked here of the f64 predicate over the GPU's OWN t, so a
        // kernel that dropped the gate fails even where the twin happened
        // to agree with it.
        if (
          leg.backend === "sphereInversion" &&
          gpuKind === 1 &&
          leg.fixture.contains
        ) {
          const reach = gpuT + 2 * query.eps;
          const beyond: Vec3 = [
            query.origin[0] + query.dir[0] * reach,
            query.origin[1] + query.dir[1] * reach,
            query.origin[2] + query.dir[2] * reach,
          ];
          if (leg.fixture.contains(beyond) === (query.inside === 1)) {
            fail(
              pi,
              armName,
              `a boundary membership does not flip across — t ${String(gpuT)}, inside ${String(query.inside)}`,
            );
          }
        }
        // Both arms pin the GPU/CPU AGREEMENT (kind, reason, t, normal).
        // The camera-marched probes' unanchored arm does usually report a
        // boundary (it starts 1% of the radius past a real hit and
        // marches back through the same sheet), and the anchored arm's
        // legitimate outcome is mostly `miss` — the anchor's
        // same-boundary suppression exists precisely so it does NOT
        // re-report that boundary (measured: 11 of 12 CPU arms across
        // the 3D fixtures). The seeded 4D probes' origins are
        // nearest-to-surface samples, not camera hits, so a hard
        // expected-kind assertion would pin the fixture, not the kernel;
        // the anchored arm keeps its own t > 0 pin below (the skip-
        // baseline backends only): a kernel that dropped the anchor
        // reports kind 1 at t ≈ 2·eps where the twin reports miss, and
        // the pair fails there. The finite legs' probes have their own
        // expected shapes — (a) from the hit usually reports the first
        // interior boundary (or an honest void-mouth refusal), (b)'s
        // outward restart usually misses or crosses an internal void,
        // (c)'s re-entry usually reports the next interior wall — and
        // the agreement + anchor-out comparisons are the pins.
        if (gpuKind !== TRANSPORT_BOUNDARY_KIND_CODES[cpuHit.kind]) {
          fail(
            pi,
            armName,
            `kind — gpu ${String(gpuKind)} vs cpu "${cpuHit.kind}"`,
          );
        }

        const gpuReason = boundaryOut[base + 1];
        if (gpuReason !== cpuHit.reason) {
          fail(
            pi,
            armName,
            `reason — gpu ${String(gpuReason)} vs cpu ${String(cpuHit.reason)}`,
          );
        }
        // The anchored query must clear its own anchor — the estimator
        // and closed-solid backends' pin: their anchored march carries
        // the 2·eps skip baseline, so even their misses report
        // t ≥ 2·eps, and a kernel that dropped the anchor reports the
        // suppressed boundary at t ≈ 2·eps where the twin reports miss.
        // The finite DDA has no skip baseline — an anchored miss
        // honestly reports t 0 — so its anchored arms pin the
        // kind/reason/t/normal agreement and the anchor out below
        // instead.
        if (leg.backend !== "finiteSolid" && anchoredArm && !(gpuT > 0)) {
          fail(
            pi,
            armName,
            `t ${String(gpuT)} — the anchored query must clear its own anchor`,
          );
        }
        const tDelta = Math.abs(gpuT - cpuHit.t);
        if (gpuKind === 1) probeTDelta = Math.max(probeTDelta, tDelta);
        // The closed-solid anchored arm's t is QUANTIZED by the anchored
        // restart's same-boundary suppression: each suppression step
        // advances 2·eps, and a f32-vs-f64 field rounding near the
        // crossing band's edge moves the band exit by one step. The
        // extra 4·eps is that declared-resolution granularity — the
        // qualified fixture's own "CPU f64 and GPU f32 can order
        // near-corner crossings differently" rule — disclosed, not an
        // absorbed mismatch (the anchored arm still pins t > 0 and the
        // kind/reason/normal agreement at the base tolerances). The
        // finite anchored arm takes the same granularity for the same
        // reason one backend over: its restart reconstructs the query
        // from the anchor (masked coordinates ON their planes, unmasked
        // clamped INTO their cell), and the f32 reconstruction of an
        // exact-corner crossing can order two near-equal times
        // differently than the twin's f64.
        const tTol =
          leg.backend !== "estimator" && anchoredArm
            ? 1e-3 * visR + 4 * DIELECTRIC_CROSSING_EPS_REL * visR
            : 1e-3 * visR;
        // A sphere-inversion MISS's t is not a location: it is wherever the
        // march first stood past the domain edge, and this field reads ~1
        // there, so an f32 sample landing a hair short of the edge takes one
        // more ~1-wide stride the f64 one did not (measured: 2.87 vs 1.88 on
        // the orbit leg's chain, both misses). What a miss must pin is that
        // it happened AT OR PAST the domain exit, on both engines.
        const missPair =
          leg.backend === "sphereInversion" &&
          gpuKind === 2 &&
          cpuHit.kind === "miss";
        if (missPair) {
          const radius = visR * 1.02;
          const o = query.origin;
          const d = query.dir;
          const bq = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
          const disc =
            bq * bq -
            (o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - radius * radius);
          const tFar = disc < 0 ? 0 : -bq + Math.sqrt(disc);
          for (const [side, value] of [
            ["gpu", gpuT],
            ["cpu", cpuHit.t],
          ] as const) {
            if (!(value >= tFar - tTol)) {
              fail(
                pi,
                armName,
                `miss t — ${side} ${String(value)} short of the domain exit ${String(tFar)}`,
              );
            }
          }
        } else if (tDelta > tTol) {
          fail(
            pi,
            armName,
            `t — gpu ${String(gpuT)} vs cpu ${String(cpuHit.t)} ` +
              `(delta ${String(tDelta)} > ${String(tTol)})`,
          );
        }
        // A sphere-inversion boundary's normal is pinned as a FUNCTION: the
        // twin's taps at the GPU's own landing. Near a seam of this
        // union-of-pieces field the normal turns fast along the ray
        // (measured ~4e-3 per 1e-4 of t on the orbit leg's graze), so a
        // landing inside the t tolerance still taps a visibly different
        // normal; the landing itself stays pinned by the t check above.
        const refNormal: readonly number[] =
          leg.backend === "sphereInversion" && gpuKind === 1
            ? transportOpticalNormal(
                leg.fixture,
                [
                  query.origin[0] + query.dir[0] * gpuT,
                  query.origin[1] + query.dir[1] * gpuT,
                  query.origin[2] + query.dir[2] * gpuT,
                ],
                query.dir,
                query.eps,
              )
            : cpuHit.normal;
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(gpuNormal[c] - refNormal[c]);
          maxNormalDelta = Math.max(maxNormalDelta, delta);
          probeNormalDelta = Math.max(probeNormalDelta, delta);
          if (delta > 3e-2) {
            fail(
              pi,
              armName,
              `normal[${String(c)}] — gpu ${String(boundaryOut[base + 4 + c])} vs cpu ${String(refNormal[c])}`,
            );
          }
        }
        // The finite backend's anchor OUT — the chained queries'
        // continuation state (the oracle's FiniteSolidAnchor), packed
        // across r.c..r.f. Mask and plane/cell indices are integers:
        // exact. The intrinsic point is f32 on the GPU against the
        // twin's f64 anchor: the declared reconstruction envelope — the
        // kernel clamps unmasked coordinates INTO their cell and masked
        // ones ONTO their plane by construction — is the tolerance,
        // never a free pass. A non-boundary answer's anchor is the
        // kernel's own zero-fill (mask 0, indices −1, intrinsic 0),
        // pinned exactly so a kernel that leaks a stale anchor into a
        // miss or a refusal fails here.
        if (finite) {
          const envTol =
            DIELECTRIC_ANCHOR_ENVELOPE_REL * DIELECTRIC_CROSSING_EPS_REL * visR;
          if (cpuAnchor) {
            const gpuMask = boundaryOut[base + 12];
            if (gpuMask !== cpuAnchor.planeMask) {
              fail(
                pi,
                armName,
                `anchor mask — gpu ${String(gpuMask)} vs cpu ${String(cpuAnchor.planeMask)}`,
              );
            }
            for (let c = 0; c < 4; c++) {
              const gpuPlane = boundaryOut[base + 13 + c];
              const gpuCell = boundaryOut[base + 17 + c];
              const gpuIntrinsic = boundaryOut[base + 8 + c];
              const intrinsicDelta = Math.abs(
                gpuIntrinsic - cpuAnchor.intrinsicPoint[c],
              );
              if (gpuPlane !== cpuAnchor.planeIndices[c]) {
                fail(
                  pi,
                  armName,
                  `anchor planes[${String(c)}] — gpu ${String(gpuPlane)} vs cpu ${String(cpuAnchor.planeIndices[c])}`,
                );
              }
              if (gpuCell !== cpuAnchor.cellIndices[c]) {
                fail(
                  pi,
                  armName,
                  `anchor cells[${String(c)}] — gpu ${String(gpuCell)} vs cpu ${String(cpuAnchor.cellIndices[c])}`,
                );
              }
              if (!(intrinsicDelta <= envTol)) {
                fail(
                  pi,
                  armName,
                  `anchor intrinsic[${String(c)}] — gpu ${String(gpuIntrinsic)} vs cpu ${String(cpuAnchor.intrinsicPoint[c])} (delta ${String(intrinsicDelta)} > ${String(envTol)})`,
                );
              }
            }
          } else {
            const gpuMask = boundaryOut[base + 12];
            if (gpuMask !== 0) {
              fail(
                pi,
                armName,
                `anchor mask — gpu ${String(gpuMask)} vs expected 0`,
              );
            }
            for (let c = 0; c < 4; c++) {
              const gpuPlane = boundaryOut[base + 13 + c];
              if (gpuPlane !== -1) {
                fail(
                  pi,
                  armName,
                  `anchor planes[${String(c)}] — gpu ${String(gpuPlane)} vs expected -1`,
                );
              }
              const gpuCell = boundaryOut[base + 17 + c];
              if (gpuCell !== -1) {
                fail(
                  pi,
                  armName,
                  `anchor cells[${String(c)}] — gpu ${String(gpuCell)} vs expected -1`,
                );
              }
              const gpuIntrinsic = boundaryOut[base + 8 + c];
              if (gpuIntrinsic !== 0) {
                fail(
                  pi,
                  armName,
                  `anchor intrinsic[${String(c)}] — gpu ${String(gpuIntrinsic)} vs expected 0`,
                );
              }
            }
          }
        }
      }
      if (leg.backend === "sphereInversion") {
        note(
          `transport ${leg.core} (${leg.systemName}) probe ${String(pi)}: ` +
            `${String(boundaryCounts[pi])} boundary queries agree, worst ` +
            `boundary t delta ${probeTDelta.toExponential(2)}, worst normal ` +
            `delta ${probeNormalDelta.toExponential(2)}`,
        );
      }
      // --- the TRACE probe (mode 0): the replay trace from the hit ---
      const solidQuery: TransportQueryFn | undefined =
        surfaceTransportSignedBackend(leg.backend)
          ? (origin, dir, anchorPresent, anchorPoint, inside, eps) =>
              transportSolidBoundaryQueryCPU(
                leg.fixture,
                origin,
                dir,
                anchorPresent,
                anchorPoint,
                inside,
                eps,
              )
          : undefined;
      const cpuTrace = transportTraceCPU(
        leg.fixture,
        traceQueries[pi].origin,
        probe.dir,
        DIELECTRIC_INITIAL_BRANCH_THETA,
        {
          ior: DIELECTRIC_IOR,
          absorption: DIELECTRIC_ABSORPTION,
          radius: visR,
        },
        SURFACE_TRANSPORT_CONTROL_BG_LINEAR,
        legCaps,
        solidQuery,
        // The finite backend's twin — the 9th argument threads the DDA's
        // full anchor through the trace's paths (the fixture's own
        // rule); absent (undefined) on every other backend, which the
        // fixture treats as the estimator query exactly as before.
        finiteQuery,
      );
      const traceStable =
        !discreteQuery ||
        surfaceTransportTraceProbeStable(
          leg.fixture,
          traceQueries[pi].origin,
          probe.dir,
          legCaps,
          finiteQuery,
        );
      if (!traceStable) flipped++;
      const traceBase = pi * resultFloats;
      const gpuStatus = traceOut[traceBase];
      // Finite probes use the same status, radiance and residual agreement
      // as every other backend. The pre-hoc ULP ensemble above is the only
      // trace exclusion: terminating without INVALID is not agreement.
      const gpuRadiance = [0, 1, 2].map((c) => traceOut[traceBase + 4 + c]);
      const finiteTrace = leg.backend === "finiteSolid";
      if (
        !Number.isFinite(gpuStatus) ||
        !gpuRadiance.every(Number.isFinite) ||
        !Number.isFinite(traceOut[traceBase + 3]) ||
        gpuStatus === SURFACE_GPU_TRANSPORT_INVALID
      ) {
        fail(
          pi,
          "trace",
          `invalid/non-finite GPU result (cpu "${cpuTrace.status}")`,
        );
      }
      if (
        traceStable &&
        gpuStatus !== TRANSPORT_TRACE_STATUS_CODES[cpuTrace.status]
      ) {
        fail(
          pi,
          "trace",
          `status — gpu ${String(gpuStatus)} vs cpu "${cpuTrace.status}" ` +
            `(gpu residual ${String(traceOut[traceBase + 3])} radiance ` +
            `${gpuRadiance.map((v) => v.toFixed(4)).join(",")} lanes ` +
            `${String(traceOut[traceBase + 1])}/${String(traceOut[traceBase + 2])}; ` +
            `cpu residual ${cpuTrace.residual.toFixed(4)} radiance ` +
            `${cpuTrace.radiance.map((v) => v.toFixed(4)).join(",")} failure ` +
            `${String(cpuTrace.failure)} reason ${String(cpuTrace.reason)})`,
        );
      }
      if (finiteTrace && traceStable) {
        stableFiniteTraces++;
        if (cpuTrace.status === "complete" || cpuTrace.status === "residual") {
          resolvedFiniteTraces++;
        }
        if (
          traceOut[traceBase + 1] !== cpuTrace.failure ||
          traceOut[traceBase + 2] !== cpuTrace.reason
        ) {
          fail(
            pi,
            "trace",
            `failure/reason — gpu ${String(traceOut[traceBase + 1])}/${String(traceOut[traceBase + 2])} vs cpu ${String(cpuTrace.failure)}/${String(cpuTrace.reason)}`,
          );
        }
      }
      for (let c = 0; c < 3; c++) {
        const gpu = gpuRadiance[c];
        const cpu = cpuTrace.radiance[c];
        const delta = Math.abs(gpu - cpu);
        if (!traceStable) continue;
        maxRadianceDelta = Math.max(maxRadianceDelta, delta);
        if (!(delta <= 3e-3 || delta <= 1e-2 * Math.abs(cpu))) {
          fail(
            pi,
            "trace",
            `radiance[${String(c)}] — gpu ${String(gpu)} vs cpu ${String(cpu)}`,
          );
        }
      }
      const residualDelta = Math.abs(
        traceOut[traceBase + 3] - cpuTrace.residual,
      );
      if (traceStable) {
        maxResidualDelta = Math.max(maxResidualDelta, residualDelta);
        if (!(residualDelta <= 5e-3)) {
          fail(
            pi,
            "trace",
            `residual — gpu ${String(traceOut[traceBase + 3])} vs cpu ${String(cpuTrace.residual)}`,
          );
        }
      }
    });
    if (leg.backend === "finiteSolid") {
      if (stableFiniteTraces === 0 || resolvedFiniteTraces === 0) {
        fail(
          -1,
          "trace coverage",
          `stable=${String(stableFiniteTraces)} resolved=${String(resolvedFiniteTraces)} — a resolving leg needs a stable resolved oracle comparison`,
        );
      }
      note(
        `transport finite (${leg.systemName}): ${String(stableFiniteTraces)} stable traces compared; ${String(resolvedFiniteTraces)} resolved`,
      );
    }
    if (discreteQuery && flipped > SURFACE_TRANSPORT_FLIP_CAP) {
      throw new Error(
        `transport ${leg.core} (${leg.systemName}): ${String(flipped)} of ` +
          `${String(probes.length * 3)} probes flipped under the ULP ` +
          "ensemble — past the exclusion cap, the fixture certifies nothing",
      );
    }
    if (discreteQuery && flipped > 0) {
      notes.push(
        `transport ${leg.core}: ${String(flipped)} probe(s) excluded as ` +
          "chaos flips (the ULP ensemble; the escape legs' classifier " +
          "treatment) — disclosed, not absorbed",
      );
    }
    // --- the SHADOW probes (mode 2, closed-solid legs): the floor
    // corridor's straight shadow visibility against the f64 twin, plus
    // the analytic control (the through-lobe probe's expected
    // (1-F0)²·Beer(chord) through the fixture's emitter at normal
    // incidence — the chord is the LEG's authored fixture geometry,
    // 0.7 for the separated sphere, 1.0 for the abutting through-box)
    // and the two gate exits' exact-1 pin.
    let maxShadowDelta = 0;
    if (surfaceTransportSignedBackend(leg.backend)) {
      const material = {
        ior: DIELECTRIC_IOR,
        absorption: DIELECTRIC_ABSORPTION,
        radius: visR,
      };
      const chord = leg.analyticChord;
      const f0 = ((material.ior - 1) / (material.ior + 1)) ** 2;
      const analytic =
        chord === undefined
          ? null
          : [0, 1, 2].map(
              (c) =>
                (1 - f0) ** 2 *
                Math.exp((-DIELECTRIC_ABSORPTION[c] * chord) / visR),
            );
      shadowQueries.forEach((q, si) => {
        const cpu = transportShadowVisibilityCPU(
          leg.fixture,
          q.origin,
          q.dir,
          material,
          q.ballC,
          q.ballR,
          q.visR,
        );
        const base = si * resultFloats;
        const gpuVals = [0, 1, 2].map((c) => shadowOut![base + 4 + c]);
        for (let c = 0; c < 3; c++) {
          const gpu = gpuVals[c];
          const twinDelta = Math.abs(gpu - cpu[c]);
          maxShadowDelta = Math.max(maxShadowDelta, twinDelta);
          if (!(twinDelta <= 3e-3)) {
            fail(
              si,
              "shadow",
              `twin[${String(c)}] — gpu ${String(gpu)} vs cpu ${String(cpu[c])}`,
            );
          }
          if (
            analytic !== null &&
            q.dir[1] > 0.99 &&
            Math.abs(q.origin[0] - shadowX) < 1e-9
          ) {
            // The analytic control: one crossing pair through the
            // fixture's emitter, normal incidence, the leg's own
            // chord — the independent control the criterion asks the
            // transmitted shading to match. It is calibrated to the
            // through-lobe probe's geometry; the condition above
            // selects exactly that probe.
            const analyticDelta = Math.abs(gpu - analytic[c]);
            maxShadowDelta = Math.max(maxShadowDelta, analyticDelta);
            if (!(analyticDelta <= 6e-3)) {
              fail(
                si,
                "shadow",
                `analytic[${String(c)}] — gpu ${String(gpu)} vs expected ${String(analytic[c])}`,
              );
            }
          }
        }
        if (
          (q.dir[0] > 0.99 || (q.dir[1] > 0.04 && q.dir[1] < 0.06)) &&
          gpuVals.some((value) => Math.abs(value - 1) > 1e-6)
        ) {
          fail(
            si,
            "shadow",
            `gate exit — gpu ${String(gpuVals)} vs expected 1`,
          );
        }
      });
    }
    // --- the FIELD probes (mode 4, sphere-inversion legs): the real-driver
    // half of the interior f32 argument. Hard gates: membership agrees
    // with the f64 predicate outside the slack's band, and the GPU never
    // claims more interior clearance than f64. Disclosed: the worst
    // PRE-SLACK interior excess, `gpu clearance + slack − f64 clearance`,
    // the number the slack exists to cover (CPU emulation: <= 1.39e-7).
    if (fieldOut) {
      const band = 4 * SPHERE_INVERSION_GPU_SLACK;
      let interior = 0;
      let worstExcess = -Infinity;
      fieldQueries.forEach((q, fi) => {
        const base = fi * resultFloats;
        const gpuField = fieldOut[base];
        const gpuMember = fieldOut[base + 1] > 0.5;
        const f64 = leg.fixture.estimate(q.origin);
        const member = leg.fixture.contains!(q.origin);
        if (!Number.isFinite(gpuField)) {
          fail(fi, "field", `non-finite GPU field ${String(gpuField)}`);
        }
        if (Math.abs(f64) > band && gpuMember !== member) {
          fail(
            fi,
            "field",
            `membership — gpu ${String(gpuMember)} vs cpu ${String(member)} (f64 field ${String(f64)})`,
          );
        }
        if (gpuMember && member && f64 < 0) {
          interior++;
          const gpuClear = -gpuField;
          if (gpuClear > -f64) {
            fail(
              fi,
              "field",
              `interior clearance — gpu ${String(gpuClear)} exceeds f64 ${String(-f64)}`,
            );
          }
          if (gpuClear > 0) {
            worstExcess = Math.max(
              worstExcess,
              gpuClear + SPHERE_INVERSION_GPU_SLACK + f64,
            );
          }
        }
      });
      if (interior < 50) {
        fail(0, "field", `only ${String(interior)} interior samples read`);
      }
      note(
        `transport ${leg.core} (${leg.systemName}) field: ${String(fieldQueries.length)} ` +
          `probes, ${String(interior)} interior, worst pre-slack interior excess ` +
          `${worstExcess.toExponential(2)} (slack ${SPHERE_INVERSION_GPU_SLACK.toExponential(0)})`,
      );
    }
    // --- the TERMINAL-displacement probes (mode 3, closed-solid legs):
    // the smoothed optical normal and the virtual parallel slab's lateral
    // offset the trace's terminal applies, against the ORACLE's own
    // helpers (transportTerminalDisplacementCPU) — origin for origin,
    // normal component for component, applied flag exact. The constant-bg
    // trace probes cannot see an origin displacement, so this axis is
    // pinned here.
    let maxDisplacementDelta = 0;
    if (surfaceTransportSignedBackend(leg.backend)) {
      const material = {
        ior: DIELECTRIC_IOR,
        absorption: DIELECTRIC_ABSORPTION,
        radius: visR,
        distortion: SURFACE_TRANSPORT_DISTORTION_PROBE,
      };
      terminalQueries.forEach((q, ti) => {
        const cpu = transportTerminalDisplacementCPU(
          leg.fixture,
          q.origin,
          q.dir,
          material,
        );
        const base = ti * resultFloats;
        const gpuDelta = [0, 1, 2].map((c) => terminalOut![base + c]);
        const gpuNormal = [0, 1, 2].map((c) => terminalOut![base + 4 + c]);
        const gpuApplied = terminalOut![base + 3];
        const expectedApplied = cpu.applied ? 1 : 0;
        if (Math.abs(gpuApplied - expectedApplied) > 0.5) {
          fail(
            ti,
            "terminal",
            `applied — gpu ${String(gpuApplied)} vs cpu ${String(expectedApplied)}`,
          );
        }
        const displacedOrigin: Vec3 = cpu.applied
          ? cpu.origin
          : [q.origin[0], q.origin[1], q.origin[2]];
        for (let c = 0; c < 3; c++) {
          const cpuDelta = displacedOrigin[c] - q.origin[c];
          const delta = Math.abs(gpuDelta[c] - cpuDelta);
          maxDisplacementDelta = Math.max(maxDisplacementDelta, delta);
          if (!(delta <= 3e-3)) {
            fail(
              ti,
              "terminal",
              `delta[${String(c)}] — gpu ${String(gpuDelta[c])} vs cpu ${String(cpuDelta)}`,
            );
          }
          const normalDelta = Math.abs(gpuNormal[c] - cpu.normal[c]);
          maxDisplacementDelta = Math.max(maxDisplacementDelta, normalDelta);
          if (normalDelta > 3e-2) {
            fail(
              ti,
              "terminal",
              `normal[${String(c)}] — gpu ${String(gpuNormal[c])} vs cpu ${String(cpu.normal[c])}`,
            );
          }
        }
      });
    }
    rows.push({
      core: leg.core,
      system: leg.systemName,
      backend: leg.backend,
      // The resolving rows are the two inside-traversing backends (the
      // signed closed-solid union and the finite DDA); the estimator
      // rows stay the vacuous-inside disclosure.
      opticsSoundness:
        leg.backend === "estimator" ? "vacuous-inside" : "resolving",
      compileMs,
      queries: count,
      boundaryAgree: true,
      traceAgree: true,
      maxRadianceDelta,
      maxResidualDelta,
      maxNormalDelta,
      ...(surfaceTransportSignedBackend(leg.backend)
        ? { maxShadowDelta, maxDisplacementDelta }
        : {}),
      ...(discreteQuery ? { flipsExcluded: flipped } : {}),
      ...(leg.backend === "finiteSolid"
        ? {
            stableTraceProbes: stableFiniteTraces,
            resolvedTraceProbes: resolvedFiniteTraces,
          }
        : {}),
    });
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
  return { rows, notes };
}

// ---------------------------------------------------------------------------
interface SurfaceFinitePrimaryRow {
  core: "finite" | "finite4";
  level: number;
  rays: "pose" | "unproject";
  optics: false;
  compileMs: number;
  queries: number;
  failures: number;
  maxDepthDelta: number;
  checks: Array<{
    label: string;
    expectedStatus: number;
    gpuStatus: number;
    expectedT: number | null;
    gpuT: number;
    depthDelta: number;
    tolerance: number;
    pass: boolean;
  }>;
}

/** Pin the production primary entry independently of its DDA. The oracle
 * intersects every occupied cell with f64 slabs and unions those intervals;
 * it shares only the construction and packed pose, never the GPU traversal.
 * All status decisions are exact: no post-hoc silhouette/decision waiver.
 * Depth allows 32 f32 relative rounding units for ray unprojection, four-term
 * intrinsic dot products and plane division; it is independent of pixel eps.
 *
 * March's optics flag is intentionally false: optics is shade-only, so this
 * is the SAME camera kernel used by opaque and glass finite scenes, with no
 * optical bindings. The transport/renderer legs separately prove glass use.
 */
async function runSurfaceFinitePrimaryAgreement(
  device: GPUDevice,
): Promise<SurfaceFinitePrimaryRow[]> {
  const rows: SurfaceFinitePrimaryRow[] = [];
  const disabledFloor: SurfaceGpuGroundPlane = {
    y: -1,
    fadeStart: 0,
    fadeEnd: 0,
    ballCenter: [0, 0, 0],
    ballRadius: 1,
    albedo: [1, 1, 1],
  };
  const point = (v: Vec3): Vec3 => v.map(Math.fround) as Vec3;
  const oneRayPose = (ro: Vec3, rd: Vec3): SurfaceGpuPose => ({
    ro: point(ro),
    fwd: point(rd),
    right: [1, 0, 0],
    up: [0, 1, 0],
    tanHalf: 0,
    aspect: 1,
    rasterWidth: 1,
    rasterHeight: 1,
    pixelEps: 0.001,
  });
  for (const dim of [3, 4] as const) {
    const core = dim === 3 ? "finite" : "finite4";
    const view = PRESET_VIEWS[dim === 3 ? "glassMenger" : "glassMenger4"];
    if (!view || (dim === 4 && !view.fourD))
      throw new Error("finite primary: canonical authored view is missing");
    const view4: SurfaceGpu4View | null = view.fourD
      ? {
          rotor: rotorMatrix(presetRotorPair(view.fourD)),
          w0: view.fourD.w0,
          sliceHalfW: 0,
        }
      : null;
    const radius = finiteSolidBoundingRadius(dim);
    for (const arm of [
      { level: 2, rays: "unproject" },
      { level: 2, rays: "pose" },
      { level: 0, rays: "pose" },
    ] as const) {
      const construction = buildFiniteSolidConstruction(
        dim === 3 ? "menger" : "hyperMenger",
        dim,
        arm.level,
      );
      const pack = (
        pose: SurfaceGpuPose,
        floor: SurfaceGpuGroundPlane,
      ): ArrayBuffer => {
        const run = {
          itemCount: pose.rasterWidth * pose.rasterHeight + 1,
          stepsThisPass: 1,
          marchSteps: 160,
          pose,
        };
        return view4
          ? packSurfaceGpuParamsFinite4(view4, run, arm.level, radius, floor)
          : packSurfaceGpuParamsFinite(run, arm.level, radius, floor);
      };
      const initialParams = pack(
        oneRayPose([0, 0, 2], [0, 0, -1]),
        disabledFloor,
      );
      const packed = new DataView(initialParams);
      const oraclePose: FiniteSolidPose = view4
        ? finiteSolidPose(
            Array.from({ length: 16 }, (_, i) =>
              packed.getFloat32(208 + i * 4, true),
            ),
            packed.getFloat32(416, true),
          )
        : FINITE_SOLID_IDENTITY_POSE;
      const oracle = (ro: Vec3, rd: Vec3, floor: SurfaceGpuGroundPlane) => {
        if (!rd.every(Number.isFinite) || !(Math.hypot(...rd) > 0))
          return { status: SURFACE_GPU_RAY_EXHAUSTED, t: null };
        const intervals = finiteSolidIntervals(
          construction,
          oraclePose,
          ro,
          rd,
        );
        const first = intervals[0];
        // An occupied camera sees the EXIT. A tunnel/outside camera sees
        // the first ENTRY. These fixtures avoid exact boundary origins.
        const finiteT = first
          ? first.enter === 0
            ? first.exit
            : first.enter
          : Infinity;
        const floorY = Math.fround(floor.y);
        const fadeEnd = Math.fround(floor.fadeEnd);
        if (ro[1] > floorY && rd[1] < -1e-6) {
          const t = (floorY - ro[1]) / rd[1];
          const dx = ro[0] + rd[0] * t - Math.fround(floor.ballCenter[0]);
          const dz = ro[2] + rd[2] * t - Math.fround(floor.ballCenter[2]);
          if (dx * dx + dz * dz < fadeEnd * fadeEnd && t < finiteT)
            return { status: SURFACE_GPU_RAY_PLANE, t };
        }
        return first
          ? { status: SURFACE_GPU_RAY_HIT, t: finiteT }
          : { status: SURFACE_GPU_RAY_MISS, t: null };
      };
      type Probe = {
        label: string;
        pose: SurfaceGpuPose;
        floor: SurfaceGpuGroundPlane;
        inv?: Float32Array;
      };
      const probes: Probe[] = [];
      if (arm.rays === "unproject") {
        const pose = {
          ...oneRayPose([0, 0, 2], [0, 0, -1]),
          rasterWidth: 8,
          rasterHeight: 6,
        };
        probes.push({
          label: "camera-raster",
          pose,
          floor: disabledFloor,
          // Camera (0,0,2) toward -z, tanHalf=.5, near=1, far=2.
          // These dyadic inverse-projection entries avoid a tiny near
          // plane amplifying FMA differences in far-point cancellation.
          // The ordinary march-unproject legs already pin that wider ray
          // arithmetic envelope; this gate isolates exact primary depth.
          inv: new Float32Array([
            0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.5, -0.25, 0, 0, 0.5, 0.75,
          ]),
        });
      } else {
        const coords = [-0.625, -0.375, -0.125, 0.125, 0.375, 0.625];
        const vertical = coords
          .flatMap((x) => coords.map((z) => oneRayPose([x, 2, z], [0, -1, 0])))
          .find(
            (pose) =>
              oracle(pose.ro, pose.fwd, disabledFloor).status ===
              SURFACE_GPU_RAY_HIT,
          );
        if (!vertical)
          throw new Error(
            `finite primary ${core}: no independent vertical hit fixture`,
          );
        const hitT = oracle(vertical.ro, vertical.fwd, disabledFloor).t!;
        const floorAt = (y: number): SurfaceGpuGroundPlane => ({
          ...disabledFloor,
          y,
          fadeEnd: 10,
        });
        probes.push(
          { label: "outside-entry", pose: vertical, floor: disabledFloor },
          {
            label: "miss",
            pose: oneRayPose([2, 2, 2], [0, 0, -1]),
            floor: disabledFloor,
          },
          {
            label: "floor-nearer",
            pose: vertical,
            floor: floorAt(2 - hitT / 2),
          },
          {
            label: "floor-farther",
            pose: vertical,
            floor: floorAt(2 - hitT - 1),
          },
          {
            label: "floor-above-camera-ineligible",
            pose: vertical,
            floor: floorAt(3),
          },
          {
            label: "miss-floor-eligible",
            pose: oneRayPose([2, 2, 2], [0, -1, 0]),
            floor: floorAt(0),
          },
          {
            label: "miss-floor-outside-fade",
            pose: oneRayPose([2, 2, 2], [0, -1, 0]),
            floor: { ...floorAt(0), fadeEnd: 0.1 },
          },
          {
            label: "zero-direction-refusal",
            pose: oneRayPose([0, 0, 2], [0, 0, 0]),
            floor: floorAt(0),
          },
        );
        // The canonical posed 4D query leaves z unmixed. Hold intrinsic x
        // just outside the root while moving along z: this MUST miss, even
        // though the old distance/pixel-epsilon march could accept it.
        const qx = oraclePose.rows[0];
        if (Math.abs(qx[2]) > 1e-12 || qx[0] === 0)
          throw new Error(
            "finite primary silhouette fixture requires the canonical z-preserving pose",
          );
        const edgeX =
          (FINITE_SOLID_HALF_EXTENT + 2 ** -16 - qx[3] * oraclePose.slice) /
          qx[0];
        const silhouette = oneRayPose([edgeX, 0, 2], [0, 0, -1]);
        if (
          oracle(silhouette.ro, silhouette.fwd, disabledFloor).status !==
          SURFACE_GPU_RAY_MISS
        )
          throw new Error(
            "finite primary silhouette fixture unexpectedly intersects the solid",
          );
        probes.push({
          label: "silhouette-near-miss",
          pose: silhouette,
          floor: disabledFloor,
        });
        if (arm.level === 0) {
          const inside = oneRayPose([0, 0, 0], [0, 0, 1]);
          const first = finiteSolidIntervals(
            construction,
            oraclePose,
            inside.ro,
            inside.fwd,
          )[0];
          if (!first || first.enter !== 0 || first.exit <= 0)
            throw new Error(
              "finite primary occupied-origin fixture is not interior",
            );
          probes.push({
            label: "occupied-camera-first-exit",
            pose: inside,
            floor: disabledFloor,
          });
        }
      }
      const layout = surfaceUnprojectBindGroupLayout(device);
      const { pipeline, compileMs } = await buildSurfacePipeline(
        device,
        device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        surfaceDeKernelWgsl({
          mode: "march",
          core,
          finiteSolid: { level: arm.level },
          rays: arm.rays,
          optics: false,
          groundPlane: true,
          width: 4,
          workgroupSize: 64,
          sharedFrontier: false,
          bnbStage2: false,
        }),
        "marchRays",
        `finite primary ${core} level=${String(arm.level)} ${arm.rays}`,
      );
      const capacity = 49;
      const buffers: GPUBuffer[] = [];
      const allocate = async (label: string, size: number, usage: number) => {
        const buffer = await createSurfaceBuffer(
          device,
          `finite primary ${label}`,
          size,
          usage,
        );
        buffers.push(buffer);
        return buffer;
      };
      const row: SurfaceFinitePrimaryRow = {
        core,
        level: arm.level,
        rays: arm.rays,
        optics: false,
        compileMs,
        queries: 0,
        failures: 0,
        maxDepthDelta: 0,
        checks: [],
      };
      try {
        const params = await allocate(
          "params",
          initialParams.byteLength,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        const maps = await allocate("unused maps", 16, GPUBufferUsage.STORAGE);
        const active = await allocate(
          "active",
          capacity * 4,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        );
        const states = await allocate(
          "states",
          capacity * 16,
          GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
        );
        const staging = await allocate(
          "staging",
          capacity * 16,
          GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        );
        const shade = await allocate(
          "shade",
          SURFACE_GPU_SHADE_BYTES,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        const bindGroup = device.createBindGroup({
          layout,
          entries: [params, maps, active, states, shade].map(
            (buffer, binding) => ({ binding, resource: { buffer } }),
          ),
        });
        for (const probe of probes) {
          const count = probe.pose.rasterWidth * probe.pose.rasterHeight;
          const init = new Float32Array((count + 1) * 4);
          for (let i = 0; i < count; i++) init[i * 4] = -1;
          // Explicitly enqueue a terminal state: the primary query must
          // preserve it exactly, even though its index is beyond the raster.
          init.set([17, SURFACE_GPU_RAY_MISS, 4, 9], count * 4);
          device.queue.writeBuffer(params, 0, pack(probe.pose, probe.floor));
          device.queue.writeBuffer(
            active,
            0,
            Uint32Array.from({ length: count + 1 }, (_, i) => i),
          );
          device.queue.writeBuffer(states, 0, init);
          if (probe.inv)
            device.queue.writeBuffer(
              shade,
              0,
              packSurfaceGpuShade({
                invProjView: probe.inv,
                lightDir: [0, 1, 0],
                ambient: 0,
                bgTop: [0, 0, 0],
                bgBottom: [0, 0, 0],
                colorSpeed: 0.5,
                tracePixelEps: 0.001,
                colorSource: 0,
                shadowSteps: 0,
                aoTaps: 0,
                dither: false,
                bgOffset: [0, 0],
                bgExtent: [probe.pose.rasterWidth, probe.pose.rasterHeight],
                bgCenter: [0.5, 0.5],
                bgScale: [1, 1],
                bgShape: 0,
              }),
            );
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil((count + 1) / 64));
          pass.end();
          encoder.copyBufferToBuffer(states, 0, staging, 0, init.byteLength);
          device.queue.submit([encoder.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const output = new Float32Array(
            staging.getMappedRange().slice(0, init.byteLength),
          );
          staging.unmap();
          for (let i = 0; i <= count; i++) {
            const sentinel = i === count;
            const rd = probe.inv
              ? surfaceUnprojectRay(
                  probe.inv,
                  i % probe.pose.rasterWidth,
                  Math.floor(i / probe.pose.rasterWidth),
                  probe.pose.rasterWidth,
                  probe.pose.rasterHeight,
                )
              : probe.pose.fwd;
            const expected = sentinel
              ? { status: SURFACE_GPU_RAY_MISS, t: 17 }
              : oracle(point(probe.pose.ro), rd, probe.floor);
            const actual = Array.from(output.slice(i * 4, i * 4 + 4));
            const tolerance =
              expected.t === null
                ? 0
                : 32 * 2 ** -23 * Math.max(1, Math.abs(expected.t));
            const depthDelta =
              expected.t === null ? 0 : Math.abs(actual[0] - expected.t);
            const ok =
              actual.every(Number.isFinite) &&
              actual[1] === expected.status &&
              depthDelta <= tolerance &&
              (sentinel
                ? actual.every(
                    (value, channel) => value === init[count * 4 + channel],
                  )
                : actual[2] === 1);
            row.checks.push({
              label: `${probe.label}/${sentinel ? "terminal-state-guard" : String(i)}`,
              expectedStatus: expected.status,
              gpuStatus: actual[1],
              expectedT: expected.t,
              gpuT: actual[0],
              depthDelta,
              tolerance,
              pass: ok,
            });
            row.queries++;
            row.maxDepthDelta = Math.max(row.maxDepthDelta, depthDelta);
            if (!ok) row.failures++;
          }
        }
        if (
          arm.rays === "unproject" &&
          ![SURFACE_GPU_RAY_HIT, SURFACE_GPU_RAY_MISS].every((status) =>
            row.checks.some(
              (check) =>
                check.expectedStatus === status &&
                !check.label.endsWith("terminal-state-guard"),
            ),
          )
        )
          throw new Error(
            `finite primary ${core}: camera raster lacks hit/miss coverage`,
          );
        rows.push(row);
      } finally {
        for (const buffer of buffers) buffer.destroy();
      }
    }
  }
  return rows;
}

// Optical-transport renderer envelope (production renderer, preview/settle)
// ---------------------------------------------------------------------------

/** The envelope leg's preview wall budget — the app's preview loop's own
 * `SURFACE_COMPUTE_PREVIEW_BUDGET_MS` (main.ts), restated here because
 * main.ts cannot be imported into the bench page. The DELEGATED line the
 * row is judged on is the tighter 1.5 s
 * ({@link SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS}). */
const SURFACE_TRANSPORT_ENVELOPE_PREVIEW_BUDGET_MS = 2000;

/** The delegated feasibility lines (docs/surface-dielectric-study.md,
 * "Decided feasibility envelope") this leg gates on a real adapter:
 * preview ≤ 1.5 s in both dimensions, cancellation checkpoints ≤ 600 ms
 * (the transport lane's per-dispatch fence IS the checkpoint), retained
 * additional render state ≤ 128 MiB, and the settled 512×288 image ≤ 10 s
 * at the qualified 4-SPP convention. */
const SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS = 1500;
/** The curved-glass epic's preview line (its envelope child's own limit). */
const GLASS_ENVELOPE_PREVIEW_LINE_MS = 1000;
const SURFACE_TRANSPORT_ENVELOPE_CHECKPOINT_LINE_MS = 600;
const SURFACE_TRANSPORT_ENVELOPE_SETTLE_LINE_MS = 10_000;
const SURFACE_TRANSPORT_ENVELOPE_RETAINED_LINE_BYTES = 128 * 1024 * 1024;

/** The settle's sample count — the study's qualified settled-image
 * convention (4 SPP, the deterministic 2×2 grid), which is what the 10 s
 * settled line was measured against. The app's persisted settle default is
 * 8; the doc row records the scaling. */
const SURFACE_TRANSPORT_ENVELOPE_SETTLE_SAMPLES = 4;

/** The envelope leg's rasters: the delegated preview 256×144 (1 sample,
 * the app preview's own shape) and settle 512×288 (4 samples). */
const SURFACE_TRANSPORT_ENVELOPE_PREVIEW_WIDTH = 256;
const SURFACE_TRANSPORT_ENVELOPE_PREVIEW_HEIGHT = 144;
const SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH = 512;
const SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT = 288;

/** One envelope arm's measured frame — the production renderer's own
 * tallies plus the per-submission record the checkpoint line is judged
 * on. `maxBatchMs` is max(frame.transport.batchMs) — one dispatch's fence
 * round-trip, i.e. one cancellation checkpoint. */
interface SurfaceTransportEnvelopeSample {
  index: number;
  counts: SurfaceComputeFrame["counts"];
  transport: NonNullable<SurfaceComputeFrame["transport"]>;
  maxBatchMs: number;
}

interface SurfaceTransportEnvelopeFrame {
  width: number;
  height: number;
  wallMs: number;
  gpuMs: number;
  truncated: boolean;
  counts: SurfaceComputeFrame["counts"];
  transport: NonNullable<SurfaceComputeFrame["transport"]>;
  maxBatchMs: number;
  /** Exact per-sample evidence before runSamples returns its last census. */
  sampleEvidence: SurfaceTransportEnvelopeSample[];
}

/** One envelope arm's full record: an admitted core (affine 3D / affine4
 * 4D), an optics-authored fixture document driven through the PRODUCTION
 * `SurfaceComputeRenderer` at the delegated rasters. */
interface SurfaceTransportEnvelopeRow {
  core:
    "affine" | "affine4" | "finite" | "finite4" | "sphereInv" | "sphereInv4";
  system: string;
  /** The boundary backend the arm drove: `"estimator"` on the IFS
   * fixtures (the vacuous-optics rows), `"closedSolid"` on the
   * emitter-only union fixtures — the arms whose transport samples must
   * RESOLVE (the row-failure gate below). */
  backend: "estimator" | "closedSolid" | "finiteSolid" | "sphereInversion";
  adapterLabel: string | undefined;
  /** Actual finite preset material/room with fresh-app lighting defaults;
   * both tier specs are retained to disclose the benchmark convention. */
  finiteScene?: {
    preset: "glassMenger" | "glassMenger4" | "glassPearls" | "glassPearls4";
    previewSpec: SurfaceComputeFrameSpec;
    settleSpec: SurfaceComputeFrameSpec;
    conventions: string[];
  };
  preview: SurfaceTransportEnvelopeFrame;
  /** The preview rendered twice — production-realistic reuse (the app
   * re-previews a parked pose continuously, and the steady raster reuses
   * the frame buffers) plus the determinism discipline the envelope's
   * retained-state certification rode. `byteIdentical` is null when
   * either frame truncated (a truncation point is wall-clock, not
   * arithmetic) — the check is defined only on completed frames. */
  previewRepeat: {
    wallMs: number;
    byteIdentical: boolean | null;
    sampleEvidence: SurfaceTransportEnvelopeSample[];
  };
  settle: SurfaceTransportEnvelopeFrame & { samples: number };
  /** Mid-flight cancel through the public API — the user-visible
   * cancellation checkpoint: time from `renderer.cancel()` to the frame
   * resolving null. Retried at halved delays when the frame completed
   * before the cancel landed. */
  cancelProbe: {
    attempts: number;
    delayMs: number;
    latencyMs: number;
    cancelledToNull: boolean;
  };
  /** The transport lane's ADDITIONAL retained allocation, computed from
   * the shipped constants: 32 B/ray records + 4 B/ray status + 4 B/ray
   * staging at the settle raster, plus the create-time opticsMaps lane
   * pair (32 B/slot), plus finite-only batch continuation scratch and its
   * four-byte running-count staging. The frame buffers are reused at a steady raster
   * (`allocateFrameBuffers`' rays check), so this is the steady-state
   * retained cost, not a per-frame accrual. */
  retainedBytes: number;
  heapWatch?: { beforeBytes: number; afterBytes: number };
}

/** The envelope leg's own byte-equality (the determinism pair). */
function surfaceTransportBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Which delegated lines an envelope row fails — the gate list and the
 * note builder share this one answer. */
function surfaceTransportEnvelopeRowFailures(
  row: SurfaceTransportEnvelopeRow,
): string[] {
  const failures: string[] = [];
  if (
    row.preview.truncated ||
    row.preview.wallMs > SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS
  ) {
    failures.push(
      `preview wall ${row.preview.wallMs.toFixed(0)}ms > ${SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS}ms line` +
        (row.preview.truncated ? " (truncated)" : ""),
    );
  }
  const checkpoint = Math.max(
    row.preview.maxBatchMs,
    row.settle.maxBatchMs,
    ...row.previewRepeat.sampleEvidence.map((sample) => sample.maxBatchMs),
  );
  if (checkpoint > SURFACE_TRANSPORT_ENVELOPE_CHECKPOINT_LINE_MS) {
    failures.push(
      `max transport submission ${checkpoint.toFixed(1)}ms > ${SURFACE_TRANSPORT_ENVELOPE_CHECKPOINT_LINE_MS}ms checkpoint line`,
    );
  }
  if (
    row.settle.truncated ||
    row.settle.wallMs > SURFACE_TRANSPORT_ENVELOPE_SETTLE_LINE_MS
  ) {
    failures.push(
      `settle wall ${row.settle.wallMs.toFixed(0)}ms > ${SURFACE_TRANSPORT_ENVELOPE_SETTLE_LINE_MS}ms line` +
        (row.settle.truncated ? " (truncated)" : ""),
    );
  }
  if (
    row.cancelProbe.cancelledToNull &&
    row.cancelProbe.latencyMs > SURFACE_TRANSPORT_ENVELOPE_CHECKPOINT_LINE_MS
  ) {
    failures.push(
      `cancel latency ${row.cancelProbe.latencyMs.toFixed(1)}ms > ${SURFACE_TRANSPORT_ENVELOPE_CHECKPOINT_LINE_MS}ms checkpoint line`,
    );
  }
  if (!row.cancelProbe.cancelledToNull) {
    failures.push(
      "cancel probe never landed mid-frame (frame completed first)",
    );
  }
  if (row.previewRepeat.byteIdentical === false) {
    failures.push("preview repeat not byte-identical");
  }
  if (row.retainedBytes > SURFACE_TRANSPORT_ENVELOPE_RETAINED_LINE_BYTES) {
    failures.push(
      `retained ${(row.retainedBytes / (1024 * 1024)).toFixed(1)}MiB > 128MiB line`,
    );
  }
  if (row.backend === "closedSolid" && row.settle.transport.resolved === 0) {
    // The closed-solid backend's whole point: its transport samples
    // RESOLVE. A zero-resolution settle is the vacuous state the
    // estimator arms disclose — for these arms it is a failure, not a
    // disclosure.
    failures.push(
      "closed-solid settle resolved no transport sample (the inside traversal did not reach the lane)",
    );
  }
  if (row.backend === "finiteSolid") {
    if (row.previewRepeat.wallMs > SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS)
      failures.push(
        `preview-repeat wall ${row.previewRepeat.wallMs.toFixed(0)}ms > ${SURFACE_TRANSPORT_ENVELOPE_PREVIEW_LINE_MS}ms line`,
      );
    failures.push(
      ...finiteEnvelopeEvidenceFailures(row, {
        previewWidth: SURFACE_TRANSPORT_ENVELOPE_PREVIEW_WIDTH,
        previewHeight: SURFACE_TRANSPORT_ENVELOPE_PREVIEW_HEIGHT,
        settleWidth: SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH,
        settleHeight: SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT,
        settleSamples: SURFACE_TRANSPORT_ENVELOPE_SETTLE_SAMPLES,
      }),
    );
  }
  return failures;
}

function surfaceTransportEnvelopeNote(
  row: SurfaceTransportEnvelopeRow,
): string {
  const checkpoint = Math.max(
    row.preview.maxBatchMs,
    row.settle.maxBatchMs,
    ...row.previewRepeat.sampleEvidence.map((sample) => sample.maxBatchMs),
  );
  const sampleTotals = row.settle.sampleEvidence.reduce(
    (totals, sample) => ({
      resolved: totals.resolved + sample.transport.resolved,
      unresolved: totals.unresolved + sample.transport.unresolved,
      invalid: totals.invalid + sample.transport.invalid,
    }),
    { resolved: 0, unresolved: 0, invalid: 0 },
  );
  // The vacuous disclosure: a frame whose transport lane ran but resolved
  // NOTHING while hits existed is a timing row, not an optical
  // qualification — the boundary query's inside-traversal gap (the
  // envelope leg's structural finding, the transport doc's record).
  // A TRUNCATED preview is not evidence: its budget can expire before the
  // transport lane runs at all (the curved-glass preview did exactly that).
  const vacuous =
    !row.preview.truncated &&
    row.preview.transport.resolved === 0 &&
    row.preview.counts.hit > 0;
  return (
    `transport envelope ${row.core} × ${row.system} [${row.backend}]: ` +
    `preview ${row.preview.wallMs.toFixed(0)}ms (batch max ${row.preview.maxBatchMs.toFixed(1)}ms, ` +
    `passes ${String(row.preview.transport.passes)}, resolved ${String(row.preview.transport.resolved)} ` +
    `unresolved ${String(row.preview.transport.unresolved)} invalid ${String(row.preview.transport.invalid)}), ` +
    `repeat ${row.previewRepeat.wallMs.toFixed(0)}ms byteIdentical=${String(row.previewRepeat.byteIdentical)}, ` +
    `settle ${row.settle.wallMs.toFixed(0)}ms @${String(row.settle.samples)}spp ` +
    `(batch max ${row.settle.maxBatchMs.toFixed(1)}ms, passes ${String(row.settle.transport.passes)}, ` +
    `resolved ${String(row.settle.transport.resolved)} unresolved ${String(row.settle.transport.unresolved)} ` +
    `invalid ${String(row.settle.transport.invalid)}), ` +
    `all settle samples ${JSON.stringify(sampleTotals)}, ` +
    `cancel ${row.cancelProbe.cancelledToNull ? `${row.cancelProbe.latencyMs.toFixed(1)}ms` : "not landed"} ` +
    `after ${String(row.cancelProbe.delayMs)}ms (attempt ${String(row.cancelProbe.attempts)}), ` +
    `retained ${(row.retainedBytes / (1024 * 1024)).toFixed(1)}MiB, ` +
    `checkpoint max ${checkpoint.toFixed(1)}ms` +
    (vacuous
      ? " — VACUOUS OPTICALLY: every transport sample unresolved on hits (the estimator-march boundary query cannot traverse an interior; the closed-solid backend is the recorded path)"
      : "") +
    (row.heapWatch
      ? `, heap ${((row.heapWatch.afterBytes - row.heapWatch.beforeBytes) / (1024 * 1024)).toFixed(1)}MiB over the arm`
      : "")
  );
}

/**
 * The optical-transport RENDERER envelope leg — the open criterion the
 * kernel agreement legs could not reach: an optics-authored fixture
 * document (every transform `optics: { model: "dielectric" }`) driven
 * through the PRODUCTION `SurfaceComputeRenderer` — its own device, the
 * app's march → classify → shade-skip → transport replay-pass lane →
 * present loop — at the delegated rasters, per dimension:
 *
 *   preview 256×144, 1 sample, the app preview's own budget
 *   settle  512×288, 4 samples (the qualified convention), unbudgeted
 *
 * against the decided envelope's lines (see the constants above). Six
 * arms: the two estimator arms (one per admitted descent core —
 * `affineTetra` (affine, 3D) and `aff4Tetra` (affine4, 4D at its
 * identity-rotor canonical pose), the same fixture systems the agreement
 * legs pin) and the two CLOSED-SOLID arms (`emitterOnlyUnion3`/`4`, the
 * emitter-only union the closed-solid backend serves, driven with
 * `opticsBackend: "closedSolid"`). The estimator arms stay the standing
 * TIMING gate with their vacuous-optics disclosure; the closed-solid
 * arms must resolve. The finite pair adds the actual Glass Menger preset
 * and native posed hyper-Menger, including their canonical views and room.
 * Those arms require complete accounting for EVERY preview/settle sample;
 * their observer also catches a costly earlier sample hidden by the final
 * sample's census. The fold core's transport stays refused on its own measured
 * record (the capability matrix); the forward families are unadmitted.
 * Skipped on software adapters by the caller — the lines are real-driver
 * measurements, and SwiftShader timing certifies nothing (the agreement
 * legs already cover the kernel's reachability).
 *
 * Fail closed: a missing fixture system, a null frame, a missing transport
 * tally, or any delegated-line failure surfaces in
 * {@link surfaceTransportEnvelopeRowFailures} and gates the section.
 *
 * MEASURED FINDING (2026-09-14, the leg's first real-driver run): the
 * timing/checkpoint/retained lines are the renderer lane's to meet and it
 * meets them, but every transport SAMPLE resolves UNRESOLVED on hits —
 * the estimator-march boundary query can find a primary boundary from
 * outside and cannot traverse an interior (an unsigned IFS estimator
 * lets an inside ray escape without a crossing = inside-miss; a signed
 * SDF crawls its anchor suppression into the visit cap). The CPU twin
 * reproduces both f-codes exactly, so the agreement legs' all-refused
 * agreement was vacuous on this axis. Glass IS refraction IS an inside
 * path, so the optical model has no resolving geometry on the production
 * path until the closed-solid boundary backend (the transport contract's
 * finite-grid reference) lands. The rows stay the standing TIMING gate;
 * the note marks a vacuous arm optically.
 */
async function runSurfaceTransportEnvelopeLeg(
  descent: SurfaceSystemState[],
  affine4: Surface4SystemState[],
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
  /** A second agreement-only traversal reuses the SAME finite preset,
   * material and room recipe, without running timing envelopes. */
  chunkAgreementRows?: FiniteTransportChunkRow[],
  chunkAgreementSoftware = false,
  /** `"sphereInversion"` runs ONLY the curved-glass starters' arms (the
   * glass envelope, opt-in: its settles are minutes, and its rows are
   * measured, not gated); absent runs every other arm, unchanged. */
  only?: "sphereInversion",
  /** Sphere-inversion arms only: after the envelope, one unbudgeted
   * 256×144 1-sample frame per depth, the depth-versus-cost curve. */
  depthCurve?: SurfaceGlassDepthPoint[],
): Promise<SurfaceTransportEnvelopeRow[]> {
  const rows: SurfaceTransportEnvelopeRow[] = [];
  const arms: {
    core:
      "affine" | "affine4" | "finite" | "finite4" | "sphereInv" | "sphereInv4";
    backend: "estimator" | "closedSolid" | "finiteSolid" | "sphereInversion";
    sys: SurfaceSystemState | Surface4SystemState;
    view4: SurfaceGpu4View | null;
    camera?: ReturnType<typeof presetCameraPose> & { fov: number };
    preset?: "glassMenger" | "glassMenger4" | "glassPearls" | "glassPearls4";
    /** Sphere-inversion arms: the starter's authored block. */
    siBlock?: SphereInversionAuthored;
  }[] = [];
  if (only === "sphereInversion") {
    // The curved-glass starters, exactly as the menu loads them: the
    // authored block (Glass material included), saved view and room. The
    // IFS DE supplies only shared metadata, as for the finite arms.
    for (const preset of ["glassPearls", "glassPearls4"] as const) {
      const transforms = presetTransforms(preset);
      const view = PRESET_VIEWS[preset];
      const block = PRESET_SPHERE_INVERSIONS[preset]?.();
      if (!view || !block)
        throw new Error(`glass envelope: ${preset} lost its view or block`);
      const camera = { ...presetCameraPose(view), fov: view.camera.fov };
      if (view.fourD) {
        const view4: SurfaceGpu4View = {
          rotor: rotorMatrix(presetRotorPair(view.fourD)),
          w0: view.fourD.w0,
          sliceHalfW: 0,
        };
        arms.push({
          core: "sphereInv4",
          backend: "sphereInversion",
          preset,
          camera,
          view4,
          siBlock: block,
          sys: {
            name: preset,
            de: buildSurfaceDE4(transforms, null, { order: 1, plane: "xy" }),
            view4,
            transforms,
            queries: [],
            cpu: [],
            stable: [],
          },
        });
      } else {
        arms.push({
          core: "sphereInv",
          backend: "sphereInversion",
          preset,
          camera,
          view4: null,
          siBlock: block,
          sys: {
            name: preset,
            core: "affine",
            de: buildSurfaceDE(transforms, null, { order: 1, plane: "xy" }),
            transforms,
            queries: [],
            cpu: [],
          },
        });
      }
    }
  }
  if (!only) {
    const affine3d = descent.find((s) => s.name === "affineTetra");
    const aff4 = affine4.find((s) => s.name === "aff4Tetra");
    if (!affine3d)
      throw new Error("transport envelope: affineTetra did not build");
    if (!aff4) throw new Error("transport envelope: aff4Tetra did not build");
    arms.push({
      core: "affine",
      backend: "estimator",
      sys: affine3d,
      view4: null,
    });
    arms.push({
      core: "affine4",
      backend: "estimator",
      sys: aff4,
      view4: aff4.view4,
    });

    // The closed-solid arms (both dimensions): the emitter-only union the
    // closed-solid backend serves — the same fixture recipe the agreement
    // legs' closed-solid rows pin — at the canonical identity pose in 4D.
    // These arms' transport samples must RESOLVE (the row-failure gate
    // reads the settle's resolved count) and the vacuous note flips itself
    // off when the counts go nonzero.
    {
      const solidTransforms: Transform[] = [
        {
          id: 0,
          position: [0.35, -0.1, 0.05],
          rotation: [0.15, -0.2, 0.1],
          scale: [0.35, 0.35, 0.35],
          emitter: {
            parts: [
              { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
            ],
          },
        },
        {
          id: 1,
          position: [-0.4, 0.25, -0.05],
          rotation: [-0.1, 0.12, -0.2],
          scale: [0.3, 0.3, 0.3],
          emitter: {
            parts: [
              {
                primitive: { kind: "box", half: [0.7, 0.5, 0.8] },
                combine: "union",
              },
            ],
          },
        },
      ];
      const solid3 = buildSurfaceDE(
        solidTransforms,
        null,
        { order: 1, plane: "xy" },
        {},
      );
      const solid4 = buildSurfaceDE4(
        solidTransforms,
        null,
        { order: 1, plane: "xy" },
        {},
      );
      if (solid3.maps.length !== 0 || !solid3.condensation) {
        throw new Error(
          "transport envelope: the 3D closed-solid fixture did not build its emitter-only union",
        );
      }
      if (solid4.maps.length !== 0 || !solid4.condensation) {
        throw new Error(
          "transport envelope: the 4D closed-solid fixture did not build its emitter-only union",
        );
      }
      arms.push({
        core: "affine",
        backend: "closedSolid",
        sys: {
          name: "emitterOnlyUnion3",
          core: "affine",
          de: solid3,
          transforms: solidTransforms,
          queries: [],
          cpu: [],
        },
        view4: null,
      });
      arms.push({
        core: "affine4",
        backend: "closedSolid",
        sys: {
          name: "emitterOnlyUnion4",
          de: solid4,
          view4: {
            rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            w0: 0,
            sliceHalfW: 0,
          },
          transforms: solidTransforms,
          queries: [],
          cpu: [],
          stable: [],
        },
        view4: {
          rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          w0: 0,
          sliceHalfW: 0,
        },
      });
    }

    // The finite pair uses the actual Glass presets' construction and
    // authored canonical camera/rotor/slice. The IFS DE below supplies only
    // shared metadata; the renderer target is the exact finite core.
    for (const preset of ["glassMenger", "glassMenger4"] as const) {
      const transforms = presetTransforms(preset);
      const view = PRESET_VIEWS[preset];
      if (!view)
        throw new Error(`transport envelope: ${preset} has no authored view`);
      if (view.fourD) {
        const view4: SurfaceGpu4View = {
          rotor: rotorMatrix(presetRotorPair(view.fourD)),
          w0: view.fourD.w0,
          sliceHalfW: 0,
        };
        arms.push({
          core: "finite4",
          backend: "finiteSolid",
          preset,
          camera: { ...presetCameraPose(view), fov: view.camera.fov },
          view4,
          sys: {
            name: preset,
            de: buildSurfaceDE4(transforms, null, { order: 1, plane: "xy" }),
            view4,
            transforms,
            queries: [],
            cpu: [],
            stable: [],
          },
        });
      } else {
        arms.push({
          core: "finite",
          backend: "finiteSolid",
          preset,
          camera: { ...presetCameraPose(view), fov: view.camera.fov },
          view4: null,
          sys: {
            name: preset,
            core: "affine",
            de: buildSurfaceDE(transforms, null, { order: 1, plane: "xy" }),
            transforms,
            queries: [],
            cpu: [],
          },
        });
      }
    }
  }

  const heapNow = (): number | undefined =>
    (performance as { memory?: { usedJSHeapSize?: number } }).memory
      ?.usedJSHeapSize;

  for (const arm of arms) {
    const { core, backend, sys, view4 } = arm;
    const de = sys.de;
    const finite = backend === "finiteSolid";
    const si = backend === "sphereInversion";
    // The studio presentation (backdrop, room floor, fresh-app lighting and
    // fog) the finite glass arms price, which the curved-glass starters
    // share: both are Glass-menu presets built for the same room.
    const studioArm = finite || si;
    if (chunkAgreementRows && !finite) continue;
    const room = arm.preset ? PRESET_SURFACE_ROOMS[arm.preset] : undefined;
    if (studioArm && !room)
      throw new Error(`transport envelope ${core}: authored room is missing`);
    const siBuild = (depth?: number): SphereInversionDE => {
      const resolution = resolveSphereInversion({
        ...arm.siBlock!,
        ...(depth !== undefined ? { depth } : {}),
      });
      if (!resolution.ok)
        throw new Error(
          `glass envelope ${core}: ${resolution.reasons.join("; ")}`,
        );
      return view4
        ? buildSphereInversionDE4(resolution.construction)
        : buildSphereInversionDE(resolution.construction);
    };
    const siDe = si ? siBuild() : null;
    const finiteLight = lightDirection(
      DEFAULT_SOLID_LIGHT_AZIMUTH,
      DEFAULT_SOLID_LIGHT_ELEVATION,
    );
    const bounds = finite
      ? {
          boundingRadius: finiteSolidBoundingRadius(view4 ? 4 : 3),
          visibleBoundingRadius: finiteSolidBoundingRadius(view4 ? 4 : 3),
        }
      : siDe
        ? {
            boundingRadius: siDe.boundingRadius,
            visibleBoundingRadius: siDe.boundingRadius,
          }
        : de;
    const studio = createGlassStudioBackground().custom!;
    // The optics-authored DOCUMENT: every slotted transform dielectric —
    // the whole solid glass, the appearance's own shape and the lane's
    // worst case. The closed-solid arms author the restrained slab too
    // (the qualified panels' working value): the envelope then prices the
    // distortion's smoothed-normal taps in the production path, and its
    // rows record the displaced-terminal lane at the delegated rasters.
    // Finite arms retain the actual preset optics, including its .08 slab;
    // stripping distortion would price a cheaper material than the app.
    // Other fixture transforms are copied so shared objects stay untouched.
    const transforms = studioArm
      ? sys.transforms
      : sys.transforms.map((transform): Transform => ({
          ...transform,
          optics:
            backend === "closedSolid"
              ? {
                  model: "dielectric",
                  distortion: SURFACE_TRANSPORT_DISTORTION_PROBE,
                }
              : { model: "dielectric" },
        }));
    // The DE's SHADE slot list — the recursive maps PLUS the condensation
    // emitters at their shade indices (the app's ifsShadeSlots rule,
    // mirrored): the closed-solid arms' emitter-only de has an EMPTY maps
    // array, so the wire's slot list must come from the emitters.
    const shadeSlots = (): Array<{ baseIndex: number }> => {
      if (finite) return [surfaceForwardSlot(transforms)];
      const slots: Array<{ baseIndex: number } | undefined> = de.maps.map(
        (map) => map,
      );
      for (const emitter of de.condensation?.emitters ?? []) {
        slots[emitter.shadeIndex] ??= { baseIndex: emitter.baseIndex };
      }
      if (slots.some((slot) => slot === undefined)) {
        throw new Error(
          `transport envelope ${core}: condensation shade slots are not contiguous`,
        );
      }
      return slots as Array<{ baseIndex: number }>;
    };
    // A sphere-inversion subject has no transforms: its slots are its
    // GENERATIONS and its material rides that attribution, resolved exactly
    // as the app's session door resolves it (main.ts, the optical radius
    // the estimator's bounding radius).
    const siSlots = siDe
      ? sphereInversionShadeSlots(
          sphereInversionGenerationSlots(siDe.depth),
          arm.siBlock,
          siDe.boundingRadius,
          true,
        )
      : null;
    const materials = siSlots
      ? siSlots.materials
      : surfaceSlotMaterials(
          transforms,
          shadeSlots(),
          undefined,
          // The finite material's selected normalization is its root half
          // extent. The enclosing sphere above remains the geometric bound.
          finite ? FINITE_SOLID_HALF_EXTENT : bounds.visibleBoundingRadius,
          true,
        );
    if (!materials || !materials.optics) {
      throw new Error(
        `transport envelope ${core}: the optics-authored wire resolved ${materials === null ? "null" : "no optics"} — the fixture must compile the transport`,
      );
    }
    const colors =
      siSlots?.colors ?? surfaceSlotColors(sys.transforms, shadeSlots());
    const trapIndices =
      siSlots?.trapIndices ?? surfaceTrapIndices(sys.transforms, shadeSlots());
    const retainedBytes =
      SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH *
        SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT *
        (SURFACE_COMPUTE_TRANSPORT_RECORD_BYTES + 8) +
      materials.slots.length * 32 +
      (finite ? finiteTransportWorkBytes(4096) + 4 : 0) +
      (si
        ? transportWorkBytes(
            Math.min(
              SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH *
                SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT,
              SURFACE_COMPUTE_TRANSPORT_POOL_SLOTS,
            ),
            TRANSPORT_PATH_BYTES,
          ) +
          4 +
          // The joint pool's arenas past the settle's one-sample buffers
          // (the settle is unbudgeted, so the renderer takes it wherever
          // the size rules admit it; the device limits are generous here).
          Math.max(
            0,
            surfaceComputeJointArenaBytes(
              SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH *
                SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT,
              SURFACE_TRANSPORT_ENVELOPE_SETTLE_SAMPLES,
              {
                maxStorageBufferBindingSize: Infinity,
                maxBufferSize: Infinity,
              },
            ) -
              SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH *
                SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT *
                SURFACE_COMPUTE_JOINT_RAY_BYTES,
          )
        : 0);

    activity.setState("gpu", `Surface transport envelope — ${core}`);
    status(`transport envelope ${core}: creating SurfaceComputeRenderer…`);
    const siTarget = (target: SphereInversionDE): SurfaceComputeAnyTarget =>
      view4
        ? {
            kind: "sphereInversion4",
            de: target,
            groundPlane: room!.groundPlane,
          }
        : {
            kind: "sphereInversion",
            de: target,
            groundPlane: room!.groundPlane,
          };
    const createRenderer = (
      quota?: number,
      maxPaths?: number,
      cacheCrossings?: boolean,
    ) =>
      SurfaceComputeRenderer.create(
        finite
          ? {
              kind: view4 ? "finite4" : "finite",
              level: 2,
              groundPlane: room!.groundPlane,
            }
          : siDe
            ? siTarget(siDe)
            : view4
              ? { kind: "ifs4", de: de as SurfaceDE4 }
              : { kind: "ifs", de: de as SurfaceDE },
        colors,
        trapIndices,
        {
          materials,
          ...(backend !== "estimator" ? { opticsBackend: backend } : {}),
          ...(quota !== undefined ? { finiteTransportChunkPaths: quota } : {}),
          ...(maxPaths !== undefined ? { transportMaxPaths: maxPaths } : {}),
          ...(cacheCrossings !== undefined
            ? { finiteCacheCrossings: cacheCrossings }
            : {}),
        },
      );
    const renderer = chunkAgreementRows ? null : await createRenderer();
    try {
      const specFor = (
        width: number,
        height: number,
        tier: "preview" | "full" = "full",
        // The depth curve's per-depth wire: a construction's generation
        // slot count follows its depth, so its materials do too.
        override?: {
          materials: SurfaceMaterialSlots;
          maxDepth: number;
        },
      ): SurfaceComputeFrameSpec => {
        const finitePreview = studioArm && tier === "preview";
        const pose = buildSurfacePose(
          bounds,
          width,
          height,
          SURFACE_POSE_DIST_FACTOR,
          arm.camera,
        );
        return {
          width,
          height,
          invProjView: surfaceInvProjView(bounds, pose),
          camPos: pose.ro,
          camForward: pose.fwd,
          focusDepth: surfaceCameraDepth(
            pose,
            studioArm || view4
              ? [0, 0, 0]
              : balloonBall(de as SurfaceDE).center,
          ),
          // Fixed native 512x288 target: a preview reduces sampling, not
          // geometric acceptance. Finite primary DDA has no hit epsilon.
          acceptPixelEps: studioArm
            ? (2 * pose.tanHalf) / SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT
            : SURFACE_PIXEL_EPS,
          tracePixelEps: (2 * pose.tanHalf) / height,
          maxDepth:
            override?.maxDepth ??
            (finite ? 2 : siDe ? siDe.depth : de.maxDepth),
          marchSteps: studioArm
            ? finitePreview
              ? SURFACE_PREVIEW_MARCH_STEPS
              : SURFACE_FULL_MARCH_STEPS
            : SURFACE_MARCH_STEPS,
          shadowSteps: studioArm
            ? finitePreview
              ? SURFACE_PREVIEW_SHADOW_STEPS
              : SURFACE_FULL_SHADOW_STEPS
            : SURFACE_FRAME_SHADOW_STEPS,
          aoTaps: studioArm
            ? finitePreview
              ? SURFACE_PREVIEW_AO_TAPS
              : SURFACE_FULL_AO_TAPS
            : SURFACE_FRAME_AO_TAPS,
          hitFloor: studioArm
            ? finitePreview
              ? SURFACE_PREVIEW_HIT_FLOOR
              : SURFACE_FULL_HIT_FLOOR
            : SURFACE_GPU_HIT_FLOOR,
          lightDir: studioArm
            ? [finiteLight.x, finiteLight.y, finiteLight.z]
            : surfaceNormalize([0.5, 0.8, 0.3]),
          ambient: studioArm ? DEFAULT_SOLID_AMBIENT : 0.25,
          // Finite arms carry the preset's bright studio backdrop and
          // checker floor; existing arms retain their original backdrop.
          bgTop: studioArm ? [...studio.top] : [0, 0, 0],
          bgBottom: studioArm ? [...studio.bottom] : [0, 0, 0],
          ...(studioArm
            ? {
                groundPlane:
                  presentationFloorSpec(
                    room!.groundPlane
                      ? { center: [0, 0, 0], radius: bounds.boundingRadius }
                      : null,
                    {
                      pattern: room!.floorPattern,
                      tileScale: room!.floorTileScale,
                      emission: room!.floorEmission,
                    },
                  ) ?? undefined,
                envLight: DEFAULT_SURFACE_ENV_LIGHT,
                fogDensity: DEFAULT_FOG_DENSITY,
                fogTint: hexToRgb01(DEFAULT_FOG_TINT),
                fogTintStrength: DEFAULT_FOG_TINT_STRENGTH,
              }
            : {}),
          colorSource: studioArm
            ? SURFACE_COLOR_SOURCES.indexOf("transform")
            : view4
              ? 3
              : 0,
          colorSpeed: studioArm ? DEFAULT_SURFACE_COLOR_SPEED : 0.5,
          lut: null,
          lutVersion: 0,
          dither: true,
          ...(override
            ? { materials: override.materials }
            : materials
              ? { materials }
              : {}),
          ...(view4 ? { view4 } : {}),
        };
      };
      const previewSpec = specFor(
        SURFACE_TRANSPORT_ENVELOPE_PREVIEW_WIDTH,
        SURFACE_TRANSPORT_ENVELOPE_PREVIEW_HEIGHT,
        "preview",
      );
      const settleSpec = specFor(
        SURFACE_TRANSPORT_ENVELOPE_SETTLE_WIDTH,
        SURFACE_TRANSPORT_ENVELOPE_SETTLE_HEIGHT,
      );

      if (chunkAgreementRows) {
        if (!arm.preset || (core !== "finite" && core !== "finite4"))
          throw new Error("finite chunk agreement lost its canonical preset");
        const spec = specFor(8, 8);
        const row: FiniteTransportChunkRow = {
          core,
          preset: arm.preset as "glassMenger" | "glassMenger4",
          width: 8,
          height: 8,
          samples: 4,
          adapterLabel: undefined,
          expectedSoftware: chunkAgreementSoftware,
          controls: [],
          uncachedControls: [],
          processedLimitControls: [],
        };
        // Publish the partial row before GPU work so an interrupted or failed
        // control remains visible and cannot silently disappear from the set.
        chunkAgreementRows.push(row);
        for (const [target, quotas, maxPaths, cacheCrossings] of [
          [row.controls, [0, 1, 17, 128, 512, 1024, 2048], undefined, true],
          [row.uncachedControls, [0], undefined, false],
          [row.processedLimitControls, [0, 1], 2, true],
        ] as const) {
          for (const quota of quotas) {
            status(
              `finite chunk agreement ${core}: quota=${String(quota)} maxPaths=${String(maxPaths ?? "default")} cacheCrossings=${String(cacheCrossings)}…`,
            );
            const control = await createRenderer(
              quota,
              maxPaths,
              cacheCrossings,
            );
            try {
              row.adapterLabel ??= control.adapterLabel;
              const samples: FiniteTransportChunkArm["samples"] = [];
              const frame = await control.renderFrame(spec, {
                samples: 4,
                transportReadback: true,
                onSample: (sample, index) =>
                  samples.push({
                    index,
                    width: sample.width,
                    height: sample.height,
                    truncated: sample.truncated,
                    counts: { ...sample.counts },
                    transport: sample.transport
                      ? {
                          ...sample.transport,
                          batchMs: [...sample.transport.batchMs],
                        }
                      : undefined,
                    transportState: Array.from(sample.transportState ?? []),
                    pixels: Array.from(sample.pixels),
                  }),
              });
              if (!frame)
                throw new Error(
                  `finite chunk agreement ${core}: quota ${String(quota)} returned no frame`,
                );
              target.push({
                quota,
                maxPaths: maxPaths ?? null,
                cacheCrossings,
                adapterLabel: control.adapterLabel,
                software: control.software,
                width: frame.width,
                height: frame.height,
                truncated: frame.truncated,
                pixels: Array.from(frame.pixels),
                samples,
              });
            } finally {
              control.destroy();
            }
          }
        }
        continue;
      }
      if (!renderer) throw new Error("transport envelope renderer missing");

      const observedSamples = new WeakMap<
        SurfaceComputeFrame,
        SurfaceTransportEnvelopeSample[]
      >();
      const runFrame = async (
        label: string,
        spec: SurfaceComputeFrameSpec,
        opts: { budgetMs?: number; samples?: number },
      ): Promise<SurfaceComputeFrame> => {
        const canvas = surfaceLabeledCanvas(
          dom,
          `transport-envelope-${core}-${label}`,
          `transport envelope ${core} — ${sys.name} (${label})`,
          spec.width,
          spec.height,
        );
        status(
          `transport envelope ${core}: rendering ${label} ${String(spec.width)}x${String(spec.height)}…`,
        );
        const sampleEvidence: SurfaceTransportEnvelopeSample[] = [];
        const frame = await renderer.renderFrame(spec, {
          ...opts,
          onSample: (sample, index) => {
            if (!sample.transport)
              throw new Error(
                `transport envelope ${core}: completed sample omitted transport`,
              );
            sampleEvidence.push({
              index,
              counts: { ...sample.counts },
              transport: {
                ...sample.transport,
                batchMs: [...sample.transport.batchMs],
              },
              maxBatchMs: Math.max(0, ...sample.transport.batchMs),
            });
          },
          onProgress: (pixels) => {
            drawSurfaceComputeFrame(canvas, pixels, spec.width, spec.height);
          },
        });
        if (!frame) {
          throw new Error(
            `transport envelope ${core}: ${label} resolved null — the production path produced no frame`,
          );
        }
        drawSurfaceComputeFrame(canvas, frame.pixels, spec.width, spec.height);
        if (!frame.transport) {
          throw new Error(
            `transport envelope ${core}: ${label} carried no transport tally — the optics gate did not reach the lane`,
          );
        }
        observedSamples.set(frame, sampleEvidence);
        return frame;
      };

      const toRowFrame = (
        frame: SurfaceComputeFrame,
      ): SurfaceTransportEnvelopeFrame => {
        const transport = frame.transport;
        if (!transport) {
          throw new Error(
            `transport envelope ${core}: frame lost its transport tally`,
          );
        }
        return {
          width: frame.width,
          height: frame.height,
          wallMs: frame.wallMs,
          gpuMs: frame.gpuMs,
          truncated: frame.truncated,
          counts: frame.counts,
          transport,
          maxBatchMs: Math.max(
            0,
            ...transport.batchMs,
            ...(observedSamples.get(frame) ?? []).map(
              (sample) => sample.maxBatchMs,
            ),
          ),
          sampleEvidence: observedSamples.get(frame) ?? [],
        };
      };

      const heapBefore = heapNow();
      // 1. The preview: the app's shape (1 sample) at the app's budget.
      const preview = await runFrame("preview", previewSpec, {
        budgetMs: SURFACE_TRANSPORT_ENVELOPE_PREVIEW_BUDGET_MS,
      });
      // 2. The preview repeat: determinism on completed frames, the
      // production-realistic reuse shape (steady raster, reused buffers).
      const repeat = await runFrame("preview-repeat", previewSpec, {
        budgetMs: SURFACE_TRANSPORT_ENVELOPE_PREVIEW_BUDGET_MS,
      });
      const byteIdentical =
        preview.truncated || repeat.truncated
          ? null
          : surfaceTransportBytesEqual(preview.pixels, repeat.pixels);
      // 3. The settle: the qualified 4-SPP convention, unbudgeted — the
      // app settle's own shape (the schedule is bounded by construction).
      const settle = await runFrame("settle", settleSpec, {
        samples: SURFACE_TRANSPORT_ENVELOPE_SETTLE_SAMPLES,
      });
      // 4. The cancel probe: a 1-sample settle-size frame cancelled
      // mid-flight; latency from cancel() to the null resolution is the
      // user-visible checkpoint. Retried at halved delays when the frame
      // completes before the cancel lands.
      let cancelProbe: SurfaceTransportEnvelopeRow["cancelProbe"] = {
        attempts: 0,
        delayMs: 0,
        latencyMs: 0,
        cancelledToNull: false,
      };
      const probeBase = Math.max(150, Math.round(preview.wallMs * 2));
      for (let attempt = 0; attempt < 3; attempt++) {
        const delayMs = Math.round(probeBase / 2 ** attempt);
        const done = renderer.renderFrame(settleSpec, {});
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        const t0 = performance.now();
        renderer.cancel();
        const cancelled = (await done) === null;
        if (cancelled) {
          cancelProbe = {
            attempts: attempt + 1,
            delayMs,
            latencyMs: performance.now() - t0,
            cancelledToNull: true,
          };
          break;
        }
      }
      const heapAfter = heapNow();
      const row: SurfaceTransportEnvelopeRow = {
        core,
        system: sys.name,
        backend,
        adapterLabel: renderer.adapterLabel,
        ...(arm.preset
          ? {
              finiteScene: {
                preset: arm.preset,
                previewSpec,
                settleSpec,
                conventions: si
                  ? [
                      "Actual starter block (Glass material), room and saved view with fresh-app lighting/fog defaults",
                      "Fixed 16:9 rasters: 256x144 preview at 1 sample; 512x288 settle at 4 samples (app default 8)",
                      "Native acceptance height 288; app preview/full shadow and AO quality; the starter's own depth",
                      "Renderer work only: no UI, presentation, adaptive preview governor or export encoding",
                      `Production sphere-inversion continuation quantum: ${String(SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS)} processed paths per submission`,
                    ]
                  : [
                      "Actual preset optics, room and saved view with fresh-app lighting/fog defaults",
                      "Fixed 16:9 rasters: 256x144 preview at 1 sample; 512x288 settle at 4 samples (app default 8)",
                      "Native acceptance height 288; app preview/full shadow and AO quality; finite construction level remains 2",
                      "Renderer work only: no UI, presentation, adaptive preview governor or export encoding",
                      `Production finite scheduling quantum: ${String(FINITE_TRANSPORT_CHUNK_PATHS)} processed paths per submission; guard and optical tolerances unchanged`,
                    ],
              },
            }
          : {}),
        preview: toRowFrame(preview),
        previewRepeat: {
          wallMs: repeat.wallMs,
          byteIdentical,
          sampleEvidence: observedSamples.get(repeat) ?? [],
        },
        settle: {
          ...toRowFrame(settle),
          samples: SURFACE_TRANSPORT_ENVELOPE_SETTLE_SAMPLES,
        },
        cancelProbe,
        retainedBytes,
        ...(heapBefore !== undefined && heapAfter !== undefined
          ? { heapWatch: { beforeBytes: heapBefore, afterBytes: heapAfter } }
          : {}),
      };
      rows.push(row);

      // THE DEPTH CURVE (sphere-inversion arms, when asked): the starter's
      // block at every depth the glass admission allows, one unbudgeted
      // preview-raster frame each, on a fresh renderer per depth (the
      // construction, its table and its generation slots all follow the
      // depth). Wall, census and worst submission per point: the curve a
      // later look decision is spent against.
      if (siDe && depthCurve) {
        for (
          let depth = 1;
          depth <= SPHERE_INVERSION_GLASS_MAX_DEPTH;
          depth++
        ) {
          const atDepth = siBuild(depth);
          const slots = sphereInversionShadeSlots(
            sphereInversionGenerationSlots(atDepth.depth),
            arm.siBlock,
            atDepth.boundingRadius,
            true,
          );
          if (!slots.materials?.optics)
            throw new Error(
              `glass depth curve ${core} D${String(depth)}: no optics wire`,
            );
          status(
            `glass depth curve ${core}: depth ${String(depth)} at ${String(SURFACE_TRANSPORT_ENVELOPE_PREVIEW_WIDTH)}x${String(SURFACE_TRANSPORT_ENVELOPE_PREVIEW_HEIGHT)}…`,
          );
          const curveRenderer = await SurfaceComputeRenderer.create(
            siTarget(atDepth),
            slots.colors,
            slots.trapIndices,
            { materials: slots.materials, opticsBackend: "sphereInversion" },
          );
          try {
            const frame = await curveRenderer.renderFrame(
              specFor(
                SURFACE_TRANSPORT_ENVELOPE_PREVIEW_WIDTH,
                SURFACE_TRANSPORT_ENVELOPE_PREVIEW_HEIGHT,
                "preview",
                { materials: slots.materials, maxDepth: atDepth.depth },
              ),
              {},
            );
            if (!frame?.transport)
              throw new Error(
                `glass depth curve ${core} D${String(depth)}: no frame or no transport tally`,
              );
            depthCurve.push({
              core,
              preset: arm.preset!,
              depth,
              width: frame.width,
              height: frame.height,
              wallMs: frame.wallMs,
              hit: frame.counts.hit,
              resolved: frame.transport.resolved,
              unresolved: frame.transport.unresolved,
              invalid: frame.transport.invalid,
              maxBatchMs: Math.max(0, ...frame.transport.batchMs),
            });
          } finally {
            curveRenderer.destroy();
          }
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
    } finally {
      renderer?.destroy();
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
  return rows;
}

/** One point of the glass depth-versus-cost curve: the starter's block at
 * one depth, one unbudgeted 256×144 1-sample frame. */
interface SurfaceGlassDepthPoint {
  core: string;
  preset: string;
  depth: number;
  width: number;
  height: number;
  wallMs: number;
  hit: number;
  resolved: number;
  unresolved: number;
  invalid: number;
  maxBatchMs: number;
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

/** The FORWARD cores' shared interface (surface-de-gpu.ts's contract;
 * escape, bulb and escape4 all take it):
 * 0 = params uniform, 1 = maps storage read, 2 = input storage read,
 * 3 = output storage read_write.
 *
 * Binding 1 is declared here for the two ESCAPE cores, whose formula
 * CHAIN is a list of forward maps on that binding — one `GpuMap` per link
 * in 3D, one `GpuMap4` in 4D. The BULB kernel never declares it (its single
 * forward map rides the params uniform's
 * 208..271 variant block), which is fine in the harmless direction: a
 * LAYOUT may carry an entry a shader ignores, so that leg binds one zero
 * stride and shares this definition rather than forking a 3-entry twin.
 * The reverse would throw — a bind group missing an entry the layout
 * declares is invalid. */
function surfaceForwardBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "surface-de forward bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        // The ESCAPE core's formula chain (one GpuMap per link).
        // The BULB core ignores it — a layout may carry entries a shader
        // never declares, which is what lets both legs share this one.
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

/** The march "unproject" interface: the march set (0-3) plus
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

/** {@link ensureSurfaceEvalBuffers}'s FORWARD-core twin (made
 * core-agnostic for the bulb, which passes the packed params in rather
 * than naming a packer): the same lazy-create-once contract, with the
 * caller passing BOTH packed buffers — the escape core's formula chain
 * rides the maps binding (`packEscapeGpuMaps`), while the bulb
 * core's single map still rides the params variant block and takes one
 * zero stride here (see {@link surfaceForwardBindGroupLayout}). */
async function ensureSurfaceForwardEvalBuffers<TDe>(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sys: SurfaceForwardSystemState<TDe>,
  paramsData: ArrayBuffer,
  mapsData: Float32Array,
): Promise<NonNullable<SurfaceForwardSystemState<TDe>["buffers"]>> {
  if (sys.buffers) return sys.buffers;
  const n = sys.queries.length;
  const inputData = new Float32Array(n * 4);
  sys.queries.forEach((q, i) => {
    inputData[i * 4] = q[0];
    inputData[i * 4 + 1] = q[1];
    inputData[i * 4 + 2] = q[2];
  });
  const params = await createSurfaceBuffer(
    device,
    `surface-de forward params ${sys.name}`,
    paramsData.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(params, 0, paramsData);
  const maps = await createSurfaceBuffer(
    device,
    `surface-de forward maps ${sys.name}`,
    mapsData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(maps, 0, new Float32Array(mapsData));
  const input = await createSurfaceBuffer(
    device,
    `surface-de forward queries ${sys.name}`,
    inputData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(input, 0, inputData);
  const output = await createSurfaceBuffer(
    device,
    `surface-de forward results ${sys.name}`,
    n * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const staging = await createSurfaceBuffer(
    device,
    `surface-de forward staging ${sys.name}`,
    n * 4,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const bindGroup = device.createBindGroup({
    label: `surface-de forward bind group ${sys.name}`,
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

function destroySurfaceForwardEvalBuffers<TDe>(
  sys: SurfaceForwardSystemState<TDe>,
): void {
  if (!sys.buffers) return;
  sys.buffers.params.destroy();
  sys.buffers.maps.destroy();
  sys.buffers.input.destroy();
  sys.buffers.output.destroy();
  sys.buffers.staging.destroy();
  sys.buffers = undefined;
}

/** {@link ensureSurfaceEvalBuffers}' affine4 twin (M3): the same
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

/** Shared by every eval leg (fold/affine/lens AND escape): the
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

/** One tiling ABI/agreement scenario. It is deliberately compact, but
 * compares against `tiling-de.ts` after a REAL WebGPU implementation has
 * compiled, bound, and dispatched the tiled Params shape. In particular, it
 * catches a fold/narrowing term composed at the wrong point and a host buffer
 * sized for the live fields alone instead of WGSL's 16-byte-rounded struct. */
interface SurfaceTilingAbiSpec {
  balloon?: boolean;
  lens?: boolean;
  lensPost?: boolean;
  evalStride?: boolean;
  name: string;
  core: SurfaceKernelConfig["core"];
  tiling: ResolvedTiling;
  params: ArrayBuffer;
  maps: Float32Array;
  queries: Vec3[];
  cpu: number[];
  toleranceRadius: number;
}

/** Compact composed-field queries with explicit missing-feature controls.
 * Both Balloon terms must win, and removing tiling or Balloon must change
 * the answer well beyond the standing eval tolerance. Stable off-boundary
 * queries keep this ABI leg separate from the broad frontier ensembles. */
function surfaceFiniteBalloonAbiSpec(
  sys: SurfaceMarchSystem,
  tiling: ResolvedFiniteTiling,
  evalStride = false,
): SurfaceTilingAbiSpec {
  const balloon = surfaceCpuBalloonFor(sys, 0.9, tiling);
  const view4 = "view4" in sys ? sys.view4 : null;
  const radius = surfaceOriginVisibleRadius(sys.de);
  const toleranceRadius =
    "view4" in sys ? surface4ToleranceR(sys.de) : sys.de.boundingRadius;
  const scalar = (q: Vec3) =>
    surfaceBalloonMarchEstimate(sys.de, balloon, q, 0, view4);
  const estimate = (q: Vec3) =>
    evalStride
      ? surfaceBalloonMarchSample(sys.de, balloon, q, 0, view4).stride
      : scalar(q);
  const queries: Vec3[] = [];
  const cpu: number[] = [];
  const counts = [0, 0];
  let withoutTilingMargin = 0;
  let withoutBalloonMargin = 0;
  const rng = mulberry32(0xb41100 + (view4 ? 4 : 3));
  for (let attempt = 0; attempt < 2048 && queries.length < 8; attempt++) {
    const q = [0, 1, 2].map(() =>
      Math.fround((2 * rng() - 1) * radius * (attempt % 2 ? 2.5 : 0.7)),
    ) as Vec3;
    const value = estimate(q);
    const tolerance = surfaceEvalTol(value, toleranceRadius);
    const plain = surfaceMarchEstimate(sys.de, q, 0, view4, tiling);
    const shell = scalar(q) < plain ? 1 : 0;
    if (counts[shell] >= 4 || !Number.isFinite(value)) continue;
    let stable = true;
    for (let axis = 0; axis < 3 && stable; axis++) {
      for (const sign of [-1, 1]) {
        const nearby = [...q] as Vec3;
        nearby[axis] += sign * radius * 1e-5;
        if (Math.abs(estimate(nearby) - value) > tolerance * 0.25)
          stable = false;
      }
    }
    if (!stable) continue;
    const noTiling = surfaceBalloonMarchEstimate(
      sys.de,
      { b: balloon.b, far: balloon.far },
      q,
      0,
      view4,
    );
    withoutTilingMargin = Math.max(
      withoutTilingMargin,
      Math.abs(noTiling - scalar(q)) / tolerance,
    );
    withoutBalloonMargin = Math.max(
      withoutBalloonMargin,
      Math.abs(plain - scalar(q)) / tolerance,
    );
    counts[shell]++;
    queries.push(q);
    cpu.push(value);
  }
  if (
    queries.length !== 8 ||
    Math.min(withoutTilingMargin, withoutBalloonMargin) < 8
  ) {
    throw new Error(
      `finite Balloon fixture ${sys.name}: requires 4+4 strict/source winners and both missing-feature controls beyond 8 eval tolerances; got ${counts.join("+")} and ${withoutTilingMargin.toFixed(2)}/${withoutBalloonMargin.toFixed(2)}`,
    );
  }
  return {
    name: `${evalStride ? "stride-" : ""}balloon-${sys.name}-${tiling.group}`,
    core: surfaceMarchCore(sys),
    tiling,
    balloon: true,
    lens: sys.de.foldFinal !== null,
    lensPost: (sys.de.foldFinal?.postInvM ?? null) !== null,
    evalStride,
    params: packSurfaceMarchParams(
      sys,
      { itemCount: queries.length },
      { ...balloon.b, far: balloon.far },
      tiling,
    ),
    maps: new Float32Array(
      "view4" in sys ? packSurfaceGpuMaps4(sys.de) : packSurfaceGpuMaps(sys.de),
    ),
    queries,
    cpu,
    toleranceRadius,
  };
}

async function runSurfaceTilingAbiLeg(
  device: GPUDevice,
  specs: readonly SurfaceTilingAbiSpec[],
  wg: number,
  status: (text: string) => void,
): Promise<void> {
  const layout = surfaceForwardBindGroupLayout(device);
  const pipelineLayout = device.createPipelineLayout({
    label: "surface-de tiling ABI pipeline layout",
    bindGroupLayouts: [layout],
  });
  for (const spec of specs) {
    status(`tiling ABI: compiling ${spec.name}…`);
    const { pipeline } = await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: spec.core,
        width: SURFACE_FOLD_BEAM_WIDTH,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        tiling: spec.tiling,
        balloon: spec.balloon,
        lens: spec.lens,
        lensPost: spec.lensPost,
        evalStride: spec.evalStride,
      }),
      "evalQueries",
      `surface-de tiling ABI ${spec.name}`,
    );
    const state: SurfaceForwardSystemState<null> = {
      name: `tiling ABI ${spec.name}`,
      de: null,
      queries: spec.queries,
      cpu64: spec.cpu,
      cpu32: spec.cpu,
      stable: spec.cpu.map(() => true),
    };
    try {
      await ensureSurfaceForwardEvalBuffers(
        device,
        layout,
        state,
        spec.params,
        spec.maps,
      );
      const output = await runSurfaceEvalDispatch(device, pipeline, state, wg);
      for (let i = 0; i < spec.cpu.length; i++) {
        const gpu = output[i];
        const cpu = spec.cpu[i];
        const tolerance = surfaceEvalTol(cpu, spec.toleranceRadius);
        if (!Number.isFinite(gpu) || Math.abs(gpu - cpu) > tolerance) {
          throw new Error(
            `tiling ABI ${spec.name} q${String(i)}: ` +
              `gpu=${String(gpu)} cpu=${String(cpu)} tol=${String(tolerance)}`,
          );
        }
      }
    } finally {
      destroySurfaceForwardEvalBuffers(state);
    }
  }
}

/** The standard surface eval tolerance — `compareSurfaceAgreement`'s formula,
 * factored out so its escape-leg twin ({@link compareSurfaceForwardAgreement})
 * uses the IDENTICAL bound rather than a second copy that could drift. */
function surfaceEvalTol(cpu: number, R: number): number {
  return Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(cpu), 0.05 * R));
}

/** Thrown by the device-sanity canary ({@link createSurfaceCanary})
 * when the shared device stops reproducing its own baseline mid-run. The
 * section's outer catch turns it into the `"device-unreliable"` verdict
 * instead of a plausible-looking numeric "fail". */
class SurfaceDeviceUnreliableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurfaceDeviceUnreliableError";
  }
}

/** Canary query count — big enough to exercise the whole refined-ladder
 * descent across the attractor and its surroundings, small enough that a
 * check (dispatch + readback sync) is noise against any leg. */
const SURFACE_CANARY_QUERY_COUNT = 128;
/** Canary workgroup size — the private-variant default. */
const SURFACE_CANARY_WG = 64;
/** Canary query seed (arbitrary, frozen so every run replays the identical
 * dispatch). */
const SURFACE_CANARY_SEED = 0x76b9;

interface SurfaceCanary {
  sanity: SurfaceDeviceSanityResult;
  /** Re-dispatch the canary and bit-compare against the t0 baseline.
   * Resolves clean or throws {@link SurfaceDeviceUnreliableError};
   * `boundary` names the leg that just finished (it lands in
   * `sanity.trippedAt`, the verdict reason, and a note). */
  check(boundary: string): Promise<void>;
  destroy(): void;
}

/**
 * The device-sanity tripwire. Observed incident: `bench:surface`
 * on SwiftShader, run concurrently with the full vitest suite + a dev
 * server + a driven browser, reported plausible gating failures
 * (lens4MandelboxOverAffine fail=676/700 maxAbs=0.96, persisting into the
 * next leg) that vanished on a quiet machine — a mid-run software-Vulkan
 * device upset under CPU starvation, not a kernel defect, and ~40 min of
 * baseline-vs-feature bisection to prove that. The failure class is
 * detectable in-run because this section's arithmetic is DETERMINISTIC:
 * the cross-check legs already gate exact f32 equality across pipeline
 * variants, so a re-dispatch of one frozen pipeline over frozen buffers
 * must reproduce its own earlier readback bit for bit. Any drift proves
 * the device's answers changed mid-run — at which point every numeric row
 * is suspect and "rerun on a quiet machine" is the only honest verdict.
 *
 * Mechanism: a self-contained affine-core eval (its own tetra DE, its own
 * 128 frozen queries, its own buffers — no lifecycle overlap with the leg
 * systems, whose buffers legs re-ensure and the finally destroys). The
 * baseline is captured by dispatching TWICE at t0 — nondeterminism before
 * any leg has run is itself an upset — then `check()` re-dispatches at
 * every leg banner and bit-compares (Uint32Array views: NaN-safe, no
 * tolerance questions). A `device.lost` latch (ignoring the routine
 * `"destroyed"` reason) and an `onuncapturederror`→notes hook ride along.
 *
 * Scope, honestly: leg-granular and device-wide. An upset that corrupts
 * exactly one leg's own readback and heals before the boundary check still
 * lands as that leg's numeric fail; the observed class (state that
 * persists — the only kind reruns can't immediately absolve) is caught,
 * and clean checks bracket the upset window from both sides. Setup
 * failures (DE build, pipeline, buffers) DISABLE the canary with a note
 * rather than blocking the bench — the legs themselves will surface real
 * device trouble; but a baseline DISPATCH failure or t0 nondeterminism
 * throws {@link SurfaceDeviceUnreliableError} outright, because a device
 * that cannot reproduce a trivial dispatch twice cannot certify anything.
 *
 * `syntheticTripAt` (`surfaceCanaryTrip=N`) corrupts the Nth check's
 * readback in-place so the whole trip → verdict → exit-code path can be
 * rehearsed end-to-end; the detail string says SYNTHETIC so the rehearsal
 * can never read as a real upset.
 */
async function createSurfaceCanary(
  device: GPUDevice,
  pipelineLayout: GPUPipelineLayout,
  bindGroupLayout: GPUBindGroupLayout,
  syntheticTripAt: number,
  onNote: (note: string) => void,
): Promise<SurfaceCanary | { disabled: string }> {
  // Wired before setup so a run whose canary fails to arm still discloses
  // device loss / uncaptured errors through notes.
  let lostReason: string | undefined;
  void device.lost.then((info) => {
    if (info.reason === "destroyed") return;
    lostReason = `${info.reason}: ${info.message}`;
    onNote(`device.lost fired mid-run — ${lostReason}`);
  });
  device.onuncapturederror = (event): void => {
    onNote(`uncaptured device error: ${event.error.message}`);
  };

  const setup = await (async (): Promise<
    | { sys: SurfaceSystemState; pipeline: GPUComputePipeline }
    | { disabled: string }
  > => {
    try {
      const transforms = surfaceAffineTetra();
      const de = buildSurfaceDE(transforms, null, SURFACE_NO_SYMMETRY);
      const rng = mulberry32(SURFACE_CANARY_SEED);
      const ext = 1.2 * de.boundingRadius;
      const queries: Vec3[] = [];
      for (let i = 0; i < SURFACE_CANARY_QUERY_COUNT; i += 1) {
        queries.push([
          Math.fround(ext * (2 * rng() - 1)),
          Math.fround(ext * (2 * rng() - 1)),
          Math.fround(ext * (2 * rng() - 1)),
        ]);
      }
      // cpu stays empty: the canary never compares against an oracle — its
      // whole contract is bit-exact agreement with its own t0 readback.
      const sys: SurfaceSystemState = {
        name: "canary",
        core: "affine",
        de,
        transforms,
        queries,
        cpu: [],
      };
      const code = surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine",
        width: SURFACE_AFFINE_LADDER_WIDTH,
        workgroupSize: SURFACE_CANARY_WG,
        sharedFrontier: false,
        bnbStage2: false,
      });
      const { pipeline } = await buildSurfacePipeline(
        device,
        pipelineLayout,
        code,
        "evalQueries",
        "surface-de canary",
      );
      await ensureSurfaceEvalBuffers(device, bindGroupLayout, sys);
      return { sys, pipeline };
    } catch (e) {
      return { disabled: describeError(e) };
    }
  })();
  if ("disabled" in setup) return setup;
  const { sys, pipeline } = setup;

  const dispatch = async (context: string): Promise<Float32Array> => {
    try {
      return await runSurfaceEvalDispatch(
        device,
        pipeline,
        sys,
        SURFACE_CANARY_WG,
      );
    } catch (e) {
      throw new SurfaceDeviceUnreliableError(
        `canary dispatch failed ${context}: ${describeError(e)}`,
      );
    }
  };
  const first = await dispatch("capturing the baseline");
  const second = await dispatch("re-checking the baseline");
  const baseline = first;
  const baselineBits = new Uint32Array(baseline.buffer);
  const drift = (
    out: Float32Array,
  ): { mismatches: number; maxAbsDrift: number } => {
    const bits = new Uint32Array(out.buffer);
    let mismatches = 0;
    let maxAbsDrift = 0;
    for (let i = 0; i < baselineBits.length; i += 1) {
      if (bits[i] === baselineBits[i]) continue;
      mismatches += 1;
      const abs = Math.abs(out[i] - baseline[i]);
      if (Number.isFinite(abs) && abs > maxAbsDrift) maxAbsDrift = abs;
    }
    return { mismatches, maxAbsDrift };
  };
  {
    const t0 = drift(second);
    if (t0.mismatches > 0) {
      throw new SurfaceDeviceUnreliableError(
        `canary baseline nondeterministic before any leg ran — ` +
          `${t0.mismatches}/${SURFACE_CANARY_QUERY_COUNT} values changed between ` +
          `two identical dispatches (maxAbs ${t0.maxAbsDrift.toExponential(2)})`,
      );
    }
  }

  const sanity: SurfaceDeviceSanityResult = {
    checks: 0,
    n: SURFACE_CANARY_QUERY_COUNT,
  };
  const trip = (boundary: string, detail: string): never => {
    sanity.trippedAt = boundary;
    sanity.detail = detail;
    onNote(`device-sanity canary TRIPPED after ${boundary}: ${detail}`);
    throw new SurfaceDeviceUnreliableError(
      `device-sanity canary tripped after ${boundary} — ${detail}`,
    );
  };
  return {
    sanity,
    async check(boundary: string): Promise<void> {
      if (lostReason !== undefined) {
        trip(boundary, `device.lost fired mid-run (${lostReason})`);
      }
      const out = await dispatch(`at "${boundary}"`).catch((e: unknown) =>
        trip(boundary, describeError(e)),
      );
      const synthetic =
        syntheticTripAt > 0 && sanity.checks + 1 === syntheticTripAt;
      if (synthetic) {
        // Flip one exponent bit of the first value — an unmistakable,
        // finite drift for the rehearsal to detect and report.
        new Uint32Array(out.buffer)[0] ^= 0x40000000;
      }
      const d = drift(out);
      if (d.mismatches > 0) {
        trip(
          boundary,
          `${synthetic ? `SYNTHETIC (surfaceCanaryTrip=${syntheticTripAt}) — ` : ""}` +
            `${d.mismatches}/${sanity.n} canary values changed vs the t0 baseline ` +
            `(maxAbs drift ${d.maxAbsDrift.toExponential(2)}) — the identical ` +
            `dispatch previously reproduced bit for bit`,
        );
      }
      sanity.checks += 1;
    },
    destroy(): void {
      destroySurfaceEvalBuffers(sys);
    },
  };
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
 * {@link compareSurfaceAgreement}'s FORWARD-leg twin (escape first, then
 * parameterized on the f32 evaluator and the tolerance radius so the bulb
 * leg shares the identical error math rather than a second copy that could
 * drift). A forward escape-time orbit is CHAOTIC — with no
 * beam-of-several-chains to absorb a
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
 * The forward-orbit eval legs' POST-HOC flip verification — the march
 * legs' per-mismatch discipline lifted over here, and
 * evaluator-parameterized beside its ensemble twin above, so escape and
 * bulb share one definition. A stable-classified
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
function forwardShadowFlipVerified(
  evalF32: (p: Vec3) => number,
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
        if (Math.abs(evalF32(p) - gpuValue) <= tol) {
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

function compareSurfaceForwardAgreement<TDe>(
  sys: SurfaceForwardSystemState<TDe>,
  R: number,
  evalF32: (p: Vec3) => number,
  cfg: SurfaceKernelConfig,
  gpu: Float32Array,
  compileMs: number,
  gpuMs: number,
): SurfaceAgreementRow {
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
      forwardShadowFlipVerified(evalF32, sys.queries[i], gpu[i], tol)
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
    // Forward-orbit rows always gate, like affine: the loop has no width
    // sweep, so there is no narrower-than-production row to demote.
    gating: true,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    // Not meaningful here — surfaceQueries' jittered/uniform/exact layout
    // doesn't describe escapeQueries'/bulbQueries' uniform/boundary/cluster
    // mix. These legs' own query-mix diagnostic is `excluded` below.
    failuresByClass: { jittered: 0, uniform: 0, exact: 0 },
    excluded: sys.cpu64.length - stableCount,
    chaoticFlips,
    compileMs,
    gpuMs,
  };
}

/**
 * {@link compareSurfaceAgreement}'s affine4-leg twin (M3): the
 * identical per-row error math and {@link surfaceEvalTol} bound against the
 * COMPOSED f64 oracle values, with `R` from {@link surface4ToleranceR}
 * (the lens-aware radius the query generator already scaled from). The
 * refined beam's mins absorb f32 trajectory flips exactly as the 3D M0
 * ladder's do (the measured verdict for ladder cores) — p99 ~2e-7
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
 * {@link compareSurface4Agreement}'s fold4-leg twin (M4): the
 * identical per-row error math, {@link surfaceEvalTol} bound, and pre-hoc
 * oracle-continuity exclusion (`sys.cpu`/`sys.stable` already computed
 * against the PLAIN composed oracle — `estimateSurface4Composed(...,
 * false)`, `descendFold4` refine=false). The ONE difference from the
 * fixed-width affine4 ladder: fold4 has a real frontier WIDTH to sweep
 * (`width` is LIVE, surface-de-gpu.ts's module doc), so `gating` mirrors
 * the 3D fold row's own idiom ({@link compareSurfaceAgreement}) instead of
 * affine4's "always gate" — only rows at the CPU oracle's fixed
 * `SURFACE_FOLD_BEAM_WIDTH` frontier width compare like against like;
 * narrower rows are the same narrow-width erosion measurement,
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
  sys: SurfaceMarchSystem,
  pose: SurfaceGpuPose,
  software: boolean,
  capMs: number,
  onProgress: (text: string) => void,
  balloon: {
    center: Vec3;
    rho: number;
    R: number;
    far: number;
  } | null = null,
  tiling: ResolvedFiniteTiling | null = null,
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
      const params = packSurfaceMarchParams(
        sys,
        {
          itemCount: slice.length,
          stepsThisPass,
          marchSteps: SURFACE_MARCH_STEPS,
          pose,
          cutoff: 0,
          footprint: 0,
        },
        balloon,
        tiling,
      );
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
 * Leg A driver: compile the march kernel at the app's EXACT config
 * (`rays:"unproject"`, production width, private frontier, stage-2 off,
 * `SURFACE_COMPUTE_WORKGROUP_SIZE`), march the agreement raster to
 * completion through {@link runSurfaceUnprojectMarch}'s bounded host loop,
 * then emulate every ray on the CPU (f32 unproject + plain-estimateDistance
 * march) and gate statuses + hit `t` per ray. Throws on compile/buffer
 * failure — the caller notes it and fails the section.
 */
async function runSurfaceUnprojectLeg(
  device: GPUDevice,
  sys: SurfaceMarchSystem,
  software: boolean,
  status: (text: string) => void,
  activity: ActivityBadge,
  balloonR: number | null = null,
  tiling: ResolvedFiniteTiling | null = null,
  authoredPose?: SurfaceGpuPose,
): Promise<SurfaceUnprojectRow> {
  const core = surfaceMarchCore(sys);
  const view4 = "view4" in sys ? sys.view4 : null;
  const width = SURFACE_UNPROJ_WIDTH;
  const height = SURFACE_UNPROJ_HEIGHT;
  const rays = width * height;
  const pose = authoredPose ?? buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  // balloonMarch: a non-null balloonR marches the SAME system
  // through the balloon kernel — buildBalloon's numbers packed at the
  // frozen 272 offset, the balloon march entry replacing the sphere gate
  // — against the CPU emulator's balloon arm. The pose stays the plain
  // leg's (the app frames the attractor the same way; balloon rays that
  // start outside the visible sphere are exactly the entry this leg
  // exists to pin).
  const balloonCpu: SurfaceCpuBalloon | null =
    balloonR === null ? null : surfaceCpuBalloonFor(sys, balloonR, tiling);
  const balloonPack =
    balloonCpu === null
      ? null
      : {
          center: balloonCpu.b.center,
          rho: balloonCpu.b.rho,
          R: balloonCpu.b.R,
          far: balloonCpu.far,
        };

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
    // Stage C: the system's own core + lens, the app renderer's
    // exact derivation. mandelboxKifs keeps its byte-identical fold
    // source (explicit fold core + lens:false are the pinned off state).
    core,
    lens: sys.de.foldFinal !== null,
    lensPost: (sys.de.foldFinal?.postInvM ?? null) !== null,
    balloon: balloonPack !== null,
    tiling,
    width:
      core === "fold" || core === "fold4"
        ? SURFACE_FOLD_BEAM_WIDTH
        : SURFACE_AFFINE_LADDER_WIDTH,
    workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
    sharedFrontier: false,
    bnbStage2: false,
    ...(view4 ? { slabExt: false } : {}),
    ...(!("view4" in sys) && sys.de.condensation
      ? { condensation: surfaceCondensationKernelSpec(sys.de) }
      : {}),
    ...(sys.de.schedule ? { schedule: surfaceScheduleKernelSpec(sys.de) } : {}),
    ...(sys.de.chaos ? { chaos: surfaceChaosKernelSpec(sys.de) } : {}),
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
    packSurfaceMarchParams(
      sys,
      {
        itemCount: 0,
        stepsThisPass: 1,
        marchSteps: SURFACE_MARCH_STEPS,
        pose,
        cutoff: 0,
        footprint: 0,
      },
      balloonPack,
      tiling,
    ).byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
  const mapsData = new Float32Array(
    "view4" in sys ? packSurfaceGpuMaps4(sys.de) : packSurfaceGpuMaps(sys.de),
  );
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
        // Inert in march mode (only invProjView and the dither flag
        // reach it), but required on the interface — this leg traces
        // the whole width x height raster, so offset is the origin.
        bgOffset: [0, 0],
        bgExtent: [width, height],
        // Also inert in march mode; linear (0) needs no real
        // center/scale.
        bgCenter: [0.5, 0.5],
        bgScale: [1, 1],
        bgShape: 0,
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
      sys,
      pose,
      software,
      SURFACE_UNPROJ_CAP_MS,
      (text) => status(`march-unproject: ${text}`),
      balloonPack,
      tiling,
    );
    console.info(
      `[surface-bench] march-unproject: march done — ${String(outcome.passes)} passes, ` +
        `${outcome.gpuMs.toFixed(0)}ms gpu${outcome.truncated ? ", TRUNCATED" : ""}`,
    );

    const boundaryFlipRule =
      "excluded from failures: (a) boundaryFlips — status mismatch with " +
      "|tGpu − tCpu| <= max(2e-4·R, 2e-3·max(|tCpu|, 0.05·R)): same " +
      "trajectory, terminal event reclassified by f32/f64 noise; (b) " +
      "hitTCorridorMatches — both-hit rays over that t tolerance with a " +
      "strict CPU d < eps point inside the same legal march corridor " +
      "[tGpu-tol,tGpu+tol], excluded only up to min(7, floor(3% of " +
      "both-hit rays)); " +
      "(c) silhouetteFlips — one-side-HIT status mismatch whose CPU closest " +
      "approach lands within the hit-t tolerance of the hitting side's t AND " +
      "within 1.5x either side of d/eps == 1: same trajectory, same point, " +
      "acceptance decided by f32-vs-f64 rounding. " +
      "Diverged trajectories and off-surface endpoints still fail.";
    const row: SurfaceUnprojectRow = {
      system: balloonR === null ? sys.name : `${sys.name}+balloon@R${balloonR}`,
      width:
        core === "fold" || core === "fold4"
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
      hitTCorridorMatches: 0,
      hitTCorridorCap: 0,
      bothHits: 0,
      hitTFailures: 0,
      failures: 0,
      diagnostics: [],
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
          balloonCpu,
          view4,
        );
        const ray = py * width + px;
        cpuStatus[ray] = res.status;
        cpuT[ray] = res.t;
        if (tiling && balloonCpu && res.status === SURFACE_GPU_RAY_HIT) {
          const p = ro.map((v, i) => v + rd[i] * res.t) as Vec3;
          // Shade attribution uses the strict scalar/probe minimum with no
          // acceptance cutoff; paired stride never chooses the material.
          const hit = surfaceBalloonMarchDistance(
            sys.de,
            balloonCpu,
            p,
            0,
            view4,
          );
          const counts = (row.finiteBalloonHits ??= { source: 0, shell: 0 });
          counts[hit.shell ? "shell" : "source"]++;
        }
      }
      status(`march-unproject: cpu emulator row ${py + 1}/${height}…`);
      await new Promise<void>((resolve) => setTimeout(resolve));
    }

    const R = sys.de.boundingRadius;
    // Every mismatch past the boundary rule describes itself,
    // tagged with the verdict it received — the excluded ones too, so a run
    // can confirm the silhouette rule fired on the rays it was meant to and
    // not on others. Capped: a whole-feature divergence would otherwise
    // print thousands of lines to say one thing.
    const failureDiagnostics: string[] = [];
    const informationalDiagnostics: string[] = [];
    for (let ray = 0; ray < rays; ray++) {
      const gpuStatus = outcome.states[ray * 4 + 1];
      const gpuT = outcome.states[ray * 4];
      const gpuLastD = outcome.states[ray * 4 + 3];
      const cs = cpuStatus[ray];
      const ct = cpuT[ray];
      if (gpuStatus === SURFACE_GPU_RAY_HIT) row.gpuHits++;
      if (cs === SURFACE_GPU_RAY_HIT) row.cpuHits++;
      if (gpuStatus === SURFACE_GPU_RAY_HIT && cs === SURFACE_GPU_RAY_HIT) {
        row.bothHits++;
      }
      const tol = Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(ct), 0.05 * R));
      if (gpuStatus !== cs) {
        row.statusMismatches++;
        if (ct >= 0 && gpuT >= 0 && Math.abs(gpuT - ct) <= tol) {
          row.boundaryFlips++;
        } else {
          // boundaryFlips cannot catch a hit-vs-miss pair — it
          // compares terminal t, but a miss runs on to the sphere exit
          // while a hit stops at the surface, so that gap is always huge.
          // Ask instead whether the CPU march's own CLOSEST APPROACH (not
          // just its terminal event) lands at the hitting side's t: same
          // trajectory, same point, disagreeing only about which side of
          // d < eps that point fell on. Measured real-Iris examples on both
          // the fold and lens field classes land immediately around
          // d/eps=1 — silhouette flips, not estimator disagreement.
          const px = ray % width;
          const py = Math.floor(ray / width);
          const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
          const approach = surfaceCpuMarchApproach(
            sys.de,
            ro,
            rd,
            pose.pixelEps,
            SURFACE_MARCH_STEPS,
            balloonCpu,
            view4,
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
          const target = silhouette
            ? informationalDiagnostics
            : failureDiagnostics;
          if (target.length < SURFACE_MISMATCH_DIAG_CAP) {
            target.push(
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
                    gpuLastD,
                    cpuStatus: cs,
                    cpuT: ct,
                    tol,
                  },
                  balloonCpu,
                  view4,
                ),
            );
          }
        }
      } else if (gpuStatus === SURFACE_GPU_RAY_HIT) {
        const err = Math.abs(gpuT - ct);
        if (err > row.maxAbsT) row.maxAbsT = err;
        if (err > tol) {
          // Compare output geometry, not the first samples chosen by two
          // marchers: accept only when the strict CPU d < eps condition
          // occurs inside the existing legal t corridor.
          const px = ray % width;
          const py = Math.floor(ray / width);
          const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
          const corridor = surfaceCpuHitTCorridor(
            sys.de,
            ro,
            rd,
            pose.pixelEps,
            gpuT,
            tol,
            balloonCpu,
            view4,
          );
          if (corridor.hit) {
            row.hitTCorridorMatches++;
          } else {
            row.hitTFailures++;
          }
          const target = corridor.hit
            ? informationalDiagnostics
            : failureDiagnostics;
          if (target.length < SURFACE_MISMATCH_DIAG_CAP) {
            const approach = surfaceCpuMarchApproach(
              sys.de,
              ro,
              rd,
              pose.pixelEps,
              SURFACE_MARCH_STEPS,
              balloonCpu,
              view4,
            );
            target.push(
              (corridor.hit ? "corridor match " : "FAILS ") +
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
                    gpuLastD,
                    cpuStatus: cs,
                    cpuT: ct,
                    tol,
                  },
                  balloonCpu,
                  view4,
                ) +
                ` corridor: minD/eps=${corridor.minRatio.toExponential(2)}` +
                `@t=${corridor.tAtMin.toExponential(4)}`,
            );
          }
        }
      }
    }
    row.hitTCorridorCap = Math.min(
      SURFACE_HIT_T_CORRIDOR_HARD_CAP,
      Math.floor(row.bothHits * SURFACE_HIT_T_CORRIDOR_CAP_FRACTION),
    );
    const corridorOverflow = Math.max(
      0,
      row.hitTCorridorMatches - row.hitTCorridorCap,
    );
    if (corridorOverflow > 0) {
      failureDiagnostics.unshift(
        `FAILS corridor matches ${String(row.hitTCorridorMatches)} exceed cap ${String(row.hitTCorridorCap)}`,
      );
    }
    row.failures =
      row.statusMismatches -
      row.boundaryFlips -
      row.silhouetteFlips +
      row.hitTFailures +
      corridorOverflow;
    row.diagnostics = [...failureDiagnostics, ...informationalDiagnostics];
    for (const diag of row.diagnostics) {
      console.info(`[surface-bench] march-unproject: mismatch — ${diag}`);
    }
    console.info(
      `[surface-bench] march-unproject: compared — statusMm=${String(row.statusMismatches)} ` +
        `boundary=${String(row.boundaryFlips)} silhouette=${String(row.silhouetteFlips)} ` +
        `corridor=${String(row.hitTCorridorMatches)}/${String(row.hitTCorridorCap)} ` +
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
 * Leg B driver: one end-to-end IFS frame through the
 * PRODUCTION `SurfaceComputeRenderer` — its own device, its own march/shade
 * pipelines, the app's host loop — at full-tier knobs, presented onto the
 * section's canvas (progressively, like the app's settle presents). Colors
 * and trap indices come from `surface-slots.ts`'s `surfaceSlotColors`/
 * `surfaceTrapIndices` — the same helpers `main.ts` calls — so slot keying
 * (a map's "By Transform" color; its authored `colorIndex`, else the even
 * spread) matches the app exactly. Throws on renderer-creation failure or a
 * null frame — the caller fails the section. `cpuSanity` strengthens the
 * forward/4D frame legs' strided hit-rate precedent to a same-pixel hit-mask
 * oracle; the mesh leg enables it so binding 11 is checked against the CPU
 * Surface marcher rather than merely compiled and pictured.
 */
async function runSurfaceComputeFrameLeg(
  sys:
    | SurfaceFrameSystem
    | Pick<Surface4SystemState, "name" | "de" | "transforms" | "view4">,
  software: boolean,
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
  options: {
    canvasLabel?: string;
    cpuSanity?: boolean;
    label?: string;
    smallRaster?: boolean;
    cheapShade?: boolean;
    deterministic?: boolean;
    balloonR?: number;
    tiling?: ResolvedFiniteTiling;
    pose?: SurfaceGpuPose;
    pattern?: boolean;
  } = {},
): Promise<SurfaceComputeFrameRow> {
  const width = options.smallRaster
    ? SURFACE_UNPROJ_WIDTH
    : software
      ? SURFACE_FRAME_WIDTH_SW
      : SURFACE_FRAME_WIDTH;
  const height = options.smallRaster
    ? SURFACE_UNPROJ_HEIGHT
    : software
      ? SURFACE_FRAME_HEIGHT_SW
      : SURFACE_FRAME_HEIGHT;
  const budgetMs = software
    ? SURFACE_FRAME_BUDGET_SW_MS
    : SURFACE_FRAME_BUDGET_MS;
  const view4 = "view4" in sys ? sys.view4 : null;
  const balloonCpu =
    options.balloonR === undefined
      ? null
      : surfaceCpuBalloonFor(sys, options.balloonR, options.tiling);
  const balloonPack = balloonCpu
    ? { ...balloonCpu.b, far: balloonCpu.far }
    : undefined;
  const materials = options.pattern
    ? surfaceSlotMaterials(
        sys.transforms.map((transform) => ({
          ...transform,
          surfacePattern: { kind: "wood", axis: "z", scale: 6, strength: 0.8 },
        })),
        sys.de.maps,
        sys.de.patternCalibration,
      )
    : null;
  const pose = options.pose ?? buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  const colors = surfaceSlotColors(sys.transforms, sys.de.maps);
  const trapIndices = surfaceTrapIndices(sys.transforms, sys.de.maps);

  const label = options.label ?? "compute frame";
  activity.setState("gpu", `Surface ${label} (app path)`);
  status(`${label}: creating SurfaceComputeRenderer…`);
  const renderer = await SurfaceComputeRenderer.create(
    "view4" in sys
      ? {
          kind: "ifs4",
          de: sys.de,
          ...(balloonPack ? { balloon: true } : {}),
          ...(options.tiling ? { tiling: options.tiling } : {}),
        }
      : {
          kind: "ifs",
          de: sys.de,
          ...(balloonPack ? { balloon: true } : {}),
          ...(options.tiling ? { tiling: options.tiling } : {}),
        },
    colors,
    trapIndices,
    materials ? { materials } : {},
  );
  try {
    const canvas = options.canvasLabel
      ? surfaceLabeledCanvas(
          dom,
          options.canvasLabel,
          `SurfaceComputeRenderer ${label} — ${sys.name}`,
          width,
          height,
        )
      : surfaceFrameCanvas(dom, width, height);
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(
        pose,
        "view4" in sys
          ? balloonBall4(sys.de).center
          : balloonBall(sys.de).center,
      ),
      // The harness's fixed acceptance slope (tier-pinned acceptance
      // semantics) — the same eps leg A marched with; trace slope from
      // this raster's own height, scene.ts's convention.
      acceptPixelEps: SURFACE_PIXEL_EPS,
      tracePixelEps:
        (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / height,
      maxDepth: sys.de.maxDepth,
      marchSteps: SURFACE_MARCH_STEPS,
      shadowSteps: options.cheapShade ? 0 : SURFACE_FRAME_SHADOW_STEPS,
      aoTaps: options.cheapShade ? 0 : SURFACE_FRAME_AO_TAPS,
      hitFloor: SURFACE_GPU_HIT_FLOOR,
      lightDir: surfaceNormalize([0.5, 0.8, 0.3]),
      ambient: 0.25,
      // Harness convention: black backdrop, like the eval legs' own
      // packSurfaceGpuShade calls — the compute-frame legs compare HIT
      // RATES against the CPU sanity march, never miss-pixel colors.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
      colorSource: 0,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: options.cheapShade || options.deterministic ? false : true,
      ...(view4 ? { view4 } : {}),
      ...(balloonPack
        ? {
            balloon: balloonPack,
            balloonTint: [0.2, 0.5, 0.9] as Vec3,
            balloonTintStrength: 0.65,
          }
        : {}),
      ...(materials ? { materials } : {}),
      ...(options.tiling && balloonPack
        ? {
            // A visible independent echo palette makes the balloon-only binding
            // and strict shell gate execute in the production shade pipeline.
            balloonLut: Uint8Array.from({ length: 256 * 4 }, (_, i) => {
              const channel = i % 4;
              const step = Math.floor(i / 4);
              return channel === 0
                ? step
                : channel === 1
                  ? 255 - step
                  : channel === 2
                    ? 160
                    : 255;
            }),
            balloonLutVersion: 1,
          }
        : {}),
    };
    status(`${label}: rendering ${width}x${height}…`);
    console.info(
      `[surface-bench] ${label}: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
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
    drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
    let sanityGpuHitRate: number | undefined;
    let sanityCpuHitRate: number | undefined;
    let sanitySamples: number | undefined;
    let sanityHitMismatches: number | undefined;
    let sanityMismatchRate: number | undefined;
    if (options.cpuSanity) {
      let cpuHits = 0;
      let gpuHits = 0;
      let mismatches = 0;
      const sampled = surfaceSanityPixels(width, height);
      const ro: Vec3 = [
        Math.fround(pose.ro[0]),
        Math.fround(pose.ro[1]),
        Math.fround(pose.ro[2]),
      ];
      for (let i = 0; i < sampled.length; i++) {
        const ray = sampled[i];
        const px = ray % width;
        const py = Math.floor(ray / width);
        const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
        const result = surfaceCpuMarchState(
          sys.de,
          ro,
          rd,
          SURFACE_PIXEL_EPS,
          SURFACE_MARCH_STEPS,
          balloonCpu,
          view4,
        );
        const cpuHit = result.status === SURFACE_GPU_RAY_HIT;
        const gpuHit = frame.layers[ray * 4] !== 0;
        if (cpuHit) cpuHits++;
        if (gpuHit) gpuHits++;
        if (gpuHit !== cpuHit) mismatches++;
        if ((i & 31) === 31) {
          status(`${label}: CPU sanity ${i + 1}/${sampled.length}…`);
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      sanitySamples = sampled.length;
      sanityHitMismatches = mismatches;
      sanityGpuHitRate = gpuHits / Math.max(1, sampled.length);
      sanityCpuHitRate = cpuHits / Math.max(1, sampled.length);
      sanityMismatchRate = mismatches / Math.max(1, sampled.length);
    }
    console.info(
      `[surface-bench] ${label}: done — ${String(frame.passes)} passes, ` +
        `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)}` +
        (sanityGpuHitRate !== undefined && sanityCpuHitRate !== undefined
          ? ` (gpu rate ${sanityGpuHitRate.toFixed(3)} vs cpu sanity ${sanityCpuHitRate.toFixed(3)}, ` +
            `sample mismatches=${String(sanityHitMismatches)}/${String(sanitySamples)})`
          : "") +
        `${frame.truncated ? ", TRUNCATED" : ""}`,
    );
    return {
      width: frame.width,
      height: frame.height,
      adapterLabel: renderer.adapterLabel,
      software: renderer.software,
      wallMs: frame.wallMs,
      gpuMs: frame.gpuMs,
      passes: frame.passes,
      truncated: frame.truncated,
      counts: frame.counts,
      ...(sanityGpuHitRate !== undefined ? { sanityGpuHitRate } : {}),
      ...(sanityCpuHitRate !== undefined ? { sanityCpuHitRate } : {}),
      ...(sanitySamples !== undefined ? { sanitySamples } : {}),
      ...(sanityHitMismatches !== undefined ? { sanityHitMismatches } : {}),
      ...(sanityMismatchRate !== undefined ? { sanityMismatchRate } : {}),
    };
  } finally {
    renderer.destroy();
  }
}

/**
 * Leg B's escape twin: one end-to-end frame through the
 * PRODUCTION renderer with a `{ kind: "escape" }` target — the app path
 * for `analyzeEscapeSystem` sessions (forward-orbit core, no maps buffer,
 * one shade slot). Geometry sanity is a strided CPU march compared as HIT
 * RATES (the timing legs' `SURFACE_SANITY_HIT_RATE_TOL` idiom), NOT the
 * per-pixel status-exclusion tiers — deliberate: the march entry
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
  // The canvas label, so the cross-family arm gets its own
  // picture instead of painting over the fold one (surfaceLabeledCanvas
  // reuses by label, and only captions on creation).
  canvasLabel = "frame-escape",
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
      canvasLabel,
      `compute frame escape — ${sys.name}`,
      width,
      height,
    );
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(pose),
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
      // Harness convention: black backdrop, like the eval legs' own
      // packSurfaceGpuShade calls — the compute-frame legs compare HIT
      // RATES against the CPU sanity march, never miss-pixel colors.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
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

/**
 * The march kernel's own `groundPlaneStatus`, mirrored term for
 * term — the analytic geometry that turns a sphere-gate/sphere-exit MISS
 * into {@link SURFACE_GPU_RAY_PLANE}. From the WGSL `surfaceDeKernelWgsl`
 * emits under `groundPlane: true`, verbatim:
 *
 * ```wgsl
 * if (ro.y <= params.groundY || rd.y >= -1.0e-6) { return MISS; }
 * let tp = (params.groundY - ro.y) / rd.y;
 * let rel = (ro + rd * tp).xz - params.groundBallC.xz;
 * if (dot(rel, rel) >= params.groundFadeEnd * params.groundFadeEnd) {
 *   return MISS;
 * }
 * return PLANE;
 * ```
 *
 * One-sided (from below the floor everything is background), downward rays
 * only, and bounded by fadeEnd — past the band the shade returns pure
 * background anyway, so those rays keep the cheap one-write MISS path.
 *
 * The CALLER applies it to a MISS and to nothing else: the kernel splices
 * this call in at exactly three sites (`disc < 0`, `tFar <= 0`, and the step
 * loop's `t > tFar` sphere exit), while the step-BUDGET exit writes
 * EXHAUSTED literally — so an exhausted ray never planes, however far below
 * the horizon it points.
 */
function surfaceGroundPlaneStatus(
  ro: Vec3,
  rd: Vec3,
  gp: { y: number; fadeEnd: number; ballCenter: Vec3 },
): number {
  if (ro[1] <= gp.y || rd[1] >= -1.0e-6) return SURFACE_GPU_RAY_MISS;
  const tp = (gp.y - ro[1]) / rd[1];
  const relX = ro[0] + rd[0] * tp - gp.ballCenter[0];
  const relZ = ro[2] + rd[2] * tp - gp.ballCenter[2];
  if (relX * relX + relZ * relZ >= gp.fadeEnd * gp.fadeEnd) {
    return SURFACE_GPU_RAY_MISS;
  }
  return SURFACE_GPU_RAY_PLANE;
}

/**
 * Leg B's GROUND-PLANE twin — one end-to-end frame through the
 * PRODUCTION `SurfaceComputeRenderer` with `{ kind: "ifs", groundPlane:
 * true }`, which is the only place in this bench where a ground-plane
 * kernel is compiled, packed, marched AND shaded. Everything else about
 * the plane is pinned by source/packer unit tests and in-browser
 * verification; what those cannot reach is the composition — the appended
 * 336-byte params block arriving at the offset the generated struct reads,
 * the fifth ray status surviving the host's terminal-ray compaction, and
 * the shade batches pricing PLANE terminals with the hits.
 *
 * OPT-IN (`config.planeFrame`) because it is a SECOND end-to-end frame on
 * top of the five leg B already renders, and its subject — a floor — is
 * orthogonal to every gating question the standard section answers.
 *
 * Fixture is the caller's choice; `affineTetra` is what the section
 * passes: the cheapest 3D core (fold-free ⇒ `core: "affine"`, the refined
 * ladder rather than a fold frontier), so an extra frame stays affordable
 * even on SwiftShader, and its ball sits at the origin under a camera at
 * ~+0.87R, which is what guarantees the frame actually contains plane
 * pixels rather than passing vacuously.
 *
 * Geometry sanity is the {@link runSurfaceComputeFrameEscapeLeg} idiom: a
 * strided CPU march compared as RATES, not per-pixel statuses — but here
 * two of them, hit and plane. Both bands are
 * {@link SURFACE_SANITY_HIT_RATE_TOL}: the two rates come out of the SAME
 * stride sample, so they carry the same sampling noise, and the plane test
 * itself is exact analytic geometry that adds none of its own (its only
 * error source is the hit/miss split it inherits). The band's width is set
 * by that sampling: at stride 8 the software raster leaves 84 samples,
 * where a rate near 0.5 has a ~5.5% binomial sigma — 0.15 is ~3 of them.
 *
 * Throws on renderer-creation failure or a null frame; the caller fails the
 * section.
 */
async function runSurfaceComputeFramePlaneLeg(
  sys: SurfaceSystemState,
  software: boolean,
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
): Promise<SurfacePlaneFrameRow> {
  const width = software ? SURFACE_FRAME_WIDTH_SW : SURFACE_FRAME_WIDTH;
  const height = software ? SURFACE_FRAME_HEIGHT_SW : SURFACE_FRAME_HEIGHT;
  const budgetMs = software
    ? SURFACE_FRAME_BUDGET_SW_MS
    : SURFACE_FRAME_BUDGET_MS;
  const pose = buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  const colors = surfaceSlotColors(sys.transforms, sys.de.maps);
  const trapIndices = surfaceTrapIndices(sys.transforms, sys.de.maps);
  // scene.ts's floor, derived the app's way: the session ball is
  // `balloonBall(de)` (enterSurfaceComputeSession re-derives exactly this),
  // and surfaceGroundPlaneSpec applies the GROUND_PLANE_* multiples to it.
  const ball = balloonBall(sys.de);
  const groundPlane = {
    y: ball.center[1] - ball.radius * SURFACE_PLANE_DROP,
    fadeStart: ball.radius * SURFACE_PLANE_FADE_START,
    fadeEnd: ball.radius * SURFACE_PLANE_FADE_END,
    ballCenter: ball.center,
    ballRadius: ball.radius,
    albedo: SURFACE_PLANE_ALBEDO,
  };

  activity.setState("gpu", "Surface compute frame (ground plane)");
  status("compute frame plane: creating SurfaceComputeRenderer…");
  const renderer = await SurfaceComputeRenderer.create(
    { kind: "ifs", de: sys.de, groundPlane: true },
    colors,
    trapIndices,
  );
  try {
    const canvas = surfaceLabeledCanvas(
      dom,
      "frame-plane",
      `compute frame ground plane — ${sys.name}`,
      width,
      height,
    );
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(pose, ball.center),
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
      // The other frame legs' black backdrop — this leg compares RATES too,
      // never miss-pixel colors. It does mean the floor's own radial fade
      // runs out into black rather than into a gradient; the STATUS the
      // march assigns, which is what the leg measures, is untouched by it.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
      colorSource: 0,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: true,
      // A plane session's spec MUST carry the floor block (the
      // renderer throws otherwise — the 336-byte struct has no default).
      groundPlane,
    };
    status(`compute frame plane: rendering ${width}x${height}…`);
    console.info(
      `[surface-bench] compute frame plane: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
    );
    const frame = await renderer.renderFrame(spec, {
      budgetMs,
      onProgress: (pixels) => {
        drawSurfaceComputeFrame(canvas, pixels, width, height);
      },
    });
    if (!frame) {
      throw new Error(
        "renderFrame resolved null — the ground-plane app path produced no frame",
      );
    }
    drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
    // Strided CPU sanity march: the kernel's own unproject rays over the
    // identical f32 matrix, then surfaceCpuMarchState — whose check order
    // (sphere exit, then budget, then eval) IS marchRays' — and the plane
    // classification applied to its MISS terminal alone, exactly where the
    // kernel splices `groundPlaneStatus` in.
    let cpuHits = 0;
    let cpuPlane = 0;
    const sampled = surfaceSanityPixels(width, height);
    for (const ray of sampled) {
      const px = ray % width;
      const py = Math.floor(ray / width);
      const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
      const st = surfaceCpuMarchState(
        sys.de,
        pose.ro,
        rd,
        SURFACE_PIXEL_EPS,
        SURFACE_MARCH_STEPS,
      );
      if (st.status === SURFACE_GPU_RAY_HIT) {
        cpuHits++;
      } else if (
        st.status === SURFACE_GPU_RAY_MISS &&
        surfaceGroundPlaneStatus(pose.ro, rd, groundPlane) ===
          SURFACE_GPU_RAY_PLANE
      ) {
        cpuPlane++;
      }
    }
    const rays = width * height;
    const samples = Math.max(1, sampled.length);
    const sanityGpuHitRate = frame.counts.hit / rays;
    const sanityCpuHitRate = cpuHits / samples;
    const sanityGpuPlaneRate = frame.counts.plane / rays;
    const sanityCpuPlaneRate = cpuPlane / samples;
    console.info(
      `[surface-bench] compute frame plane: done — ${String(frame.passes)} passes, ` +
        `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)} ` +
        `plane=${String(frame.counts.plane)} ` +
        `(gpu hit ${sanityGpuHitRate.toFixed(3)} vs cpu ${sanityCpuHitRate.toFixed(3)}, ` +
        `gpu plane ${sanityGpuPlaneRate.toFixed(3)} vs cpu ${sanityCpuPlaneRate.toFixed(3)})` +
        `${frame.truncated ? ", TRUNCATED" : ""}`,
    );
    return {
      system: sys.name,
      width: frame.width,
      height: frame.height,
      wallMs: frame.wallMs,
      gpuMs: frame.gpuMs,
      passes: frame.passes,
      truncated: frame.truncated,
      counts: frame.counts,
      plane: {
        y: groundPlane.y,
        fadeStart: groundPlane.fadeStart,
        fadeEnd: groundPlane.fadeEnd,
        ballRadius: groundPlane.ballRadius,
      },
      sanityGpuHitRate,
      sanityCpuHitRate,
      sanityGpuPlaneRate,
      sanityCpuPlaneRate,
      sanitySamples: sampled.length,
    };
  } finally {
    renderer.destroy();
  }
}

/**
 * The lattice frame legs' CPU-system descriptor — one union for the four
 * lattice families, each carrying the system state the shared leg body
 * needs (the family selects the kernel core, the CPU oracle, the
 * authority radius and the 4D view).
 */
type SurfaceLatticeFrameSystem =
  | { family: "inverse3"; sys: SurfaceSystemState }
  | { family: "escape"; sys: SurfaceEscapeSystemState }
  | { family: "inverse4"; sys: Surface4SystemState }
  | { family: "escape4"; sys: SurfaceEscape4SystemState };

/** The lattice estimator authority for a family — the kernel wrappers'
 * ball-term rule: the full visible radius for the inverse descents, the
 * bailout marching ball for the forward orbits. */
function surfaceLatticeAuthorityRadius(
  family: SurfaceLatticeFrameSystem["family"],
  de: { boundingRadius: number; visibleBoundingRadius: number },
): number {
  return family === "escape" || family === "escape4"
    ? de.boundingRadius
    : de.visibleBoundingRadius;
}

/** The 4D carrier's inverse rotor from the bench's view: the view's
 * `rotor` array is the WORLD rotor (row-major), and the carrier's slab
 * coordinate is the ATTRACTOR y of the lifted query — the inverse rotor's
 * y row = the rotor's transpose (the lift's own math, `rot[i]·p.x +
 * rot[4+i]·p.y + …`, which is exactly what the kernel's packed
 * `rotorInvR1` holds). */
function surfaceLatticeInverseRotor(view: SurfaceGpu4View): number[] {
  const rot = view.rotor;
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[r * 4 + c] = rot[c * 4 + r];
  }
  return out;
}

/** The lattice frame legs' strided CPU sanity march: the kernel's own
 * unproject rays over the identical f32 matrix, the lattice marcher's
 * quantities — the PRESENTATION CARRIER interval (world sphere ∩
 * attractor-y slab, the frozen window multiplier) as the march gate
 * instead of the visible-sphere gate, eps = max(acceptEps·t, R·hitFloor)
 * — over the family's own TILED CPU oracle (the exact estimator the
 * kernel wrapper mirrors), every SURFACE_SANITY_STRIDE-th pixel. The
 * plane classification applies surfaceGroundPlaneStatus to MISS terminals
 * exactly where the kernel splices groundPlaneStatus in (carrier-miss
 * rays included). */
function surfaceLatticeCpuSanity(
  system: SurfaceLatticeFrameSystem,
  tiling: ResolvedLatticeTiling,
  invProjView: Float32Array,
  ro: Vec3,
  width: number,
  height: number,
  groundPlane: SurfaceGpuGroundPlane | null,
): { hits: number; planes: number; samples: number } {
  const family = system.family;
  const de = system.sys.de;
  const fourD = family === "inverse4" || family === "escape4";
  const R = surfaceLatticeAuthorityRadius(
    family,
    de as { boundingRadius: number; visibleBoundingRadius: number },
  );
  const presentation: LatticePresentation = {
    contentRadius: R,
    outerRadius: R * LATTICE_PRESENTATION_RADIUS_MULT,
  };
  const inverseRotor = fourD
    ? surfaceLatticeInverseRotor(
        (
          system as {
            family: "inverse4" | "escape4";
            sys: { view4: SurfaceGpu4View };
          }
        ).sys.view4,
      )
    : null;
  const view4 = fourD
    ? (
        system as {
          family: "inverse4" | "escape4";
          sys: { view4: SurfaceGpu4View };
        }
      ).sys.view4
    : null;
  const lift = (p: Vec3): Vec4 => {
    const rot = view4!.rotor;
    return [
      rot[0] * p[0] + rot[4] * p[1] + rot[8] * p[2] + rot[12] * view4!.w0,
      rot[1] * p[0] + rot[5] * p[1] + rot[9] * p[2] + rot[13] * view4!.w0,
      rot[2] * p[0] + rot[6] * p[1] + rot[10] * p[2] + rot[14] * view4!.w0,
      rot[3] * p[0] + rot[7] * p[1] + rot[11] * p[2] + rot[15] * view4!.w0,
    ];
  };
  const estimate = (p: Vec3, eps: number): number => {
    switch (family) {
      case "inverse3": {
        const d = system.sys.de;
        return deHasFolds(d)
          ? estimateDistanceTiled(tiling, d, p, eps)
          : estimateDistanceRefinedTiled(tiling, d, p, eps);
      }
      case "escape": {
        const d = system.sys.de;
        return estimateEscapeDistanceTiled(tiling, d, p);
      }
      case "inverse4": {
        const d = system.sys.de;
        const q = lift(p);
        return deHasFolds4(d)
          ? estimateDistance4Tiled(tiling, d, q)
          : estimateDistance4RefinedTiled(tiling, d, q);
      }
      case "escape4": {
        const d = system.sys.de;
        return estimateEscapeDistance4Tiled(tiling, d, lift(p));
      }
    }
  };
  const stepScale =
    family === "escape" || family === "escape4"
      ? ESCAPE_STEP_SCALE
      : (de as SurfaceDE).stepScale;
  const hitFloorR =
    family === "escape" || family === "escape4"
      ? R
      : (de as SurfaceDE).boundingRadius;
  let hits = 0;
  let planes = 0;
  const sampled = surfaceSanityPixels(width, height);
  for (const ray of sampled) {
    const px = ray % width;
    const py = Math.floor(ray / width);
    const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
    const interval = fourD
      ? intersectLatticePresentation4(
          ro,
          rd,
          view4!.w0,
          inverseRotor!,
          presentation,
        )
      : intersectLatticePresentation3(ro, rd, presentation);
    if (interval === null) {
      // The kernel's carrier-miss path: the gate writes MISS, and the
      // ground-plane splice classifies that MISS — mirror it.
      if (
        groundPlane &&
        surfaceGroundPlaneStatus(ro, rd, groundPlane) === SURFACE_GPU_RAY_PLANE
      ) {
        planes++;
      }
      continue;
    }
    let t = interval.tEnter;
    let hit = false;
    for (let i = 0; i < SURFACE_MARCH_STEPS && t <= interval.tFar; i++) {
      const eps =
        (family === "inverse3" || family === "inverse4"
          ? surfaceSwirlAcceptanceScale(de as SurfaceDE | SurfaceDE4)
          : 1) *
        Math.max(SURFACE_PIXEL_EPS * t, hitFloorR * SURFACE_GPU_HIT_FLOOR);
      const d = estimate(
        [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t],
        eps,
      );
      if (d < eps) {
        hit = true;
        break;
      }
      t += d * stepScale;
    }
    if (hit) {
      hits++;
    } else if (
      groundPlane &&
      surfaceGroundPlaneStatus(ro, rd, groundPlane) === SURFACE_GPU_RAY_PLANE
    ) {
      planes++;
    }
  }
  return { hits, planes, samples: sampled.length };
}

/**
 * The lattice carrier frame leg — one end-to-end frame through the
 * PRODUCTION `SurfaceComputeRenderer` for each of the four lattice
 * families (3D inverse, 3D escape, 4D inverse, 4D escape, each with an
 * optional ground plane), the acceptance matrix's seam-crossing
 * march/unproject/shade proof: the production host loop marches the
 * kernel's unproject rays across the canonical cell (framed by the
 * contract's cell carrier radius, so the raster genuinely crosses the
 * x/z — and in 4D the w — seams), runs the FULL shade pass (normal,
 * shadow, AO, fog from the carrier's tEnter), and a strided CPU sanity
 * march over the same rays with the family's tiled oracle and the same
 * carrier gate gates the hit rate — plus the PLANE terminal count when
 * `plane` is set, against the CPU's own ground-plane classification.
 *
 * The camera frames the CANONICAL CELL rather than the untiled attractor
 * (docs/tiling-contract.md's camera paragraph) — a raster framed on R
 * alone would stare at the middle of the floor with the seams far
 * outside the frustum.
 */
interface SurfaceLatticeFrameRow {
  system: string;
  family: SurfaceLatticeFrameSystem["family"];
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
  sanityGpuHitRate: number;
  sanityCpuHitRate: number;
  sanityGpuPlaneRate?: number;
  sanityCpuPlaneRate?: number;
  sanitySamples: number;
}

async function runSurfaceLatticeFrameLeg(
  system: SurfaceLatticeFrameSystem,
  tiling: ResolvedLatticeTiling,
  software: boolean,
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
  options: { plane?: boolean } = {},
): Promise<SurfaceLatticeFrameRow> {
  const family = system.family;
  const sys = system.sys;
  const de = sys.de;
  const fourD = family === "inverse4" || family === "escape4";
  const width = software ? SURFACE_FRAME_WIDTH_SW : SURFACE_FRAME_WIDTH;
  const height = software ? SURFACE_FRAME_HEIGHT_SW : SURFACE_FRAME_HEIGHT;
  const budgetMs = software
    ? SURFACE_FRAME_BUDGET_SW_MS
    : SURFACE_FRAME_BUDGET_MS;
  const R = surfaceLatticeAuthorityRadius(
    family,
    de as { boundingRadius: number; visibleBoundingRadius: number },
  );
  const cellR = fourD
    ? latticeCameraCarrierRadius4(tiling.h, R)
    : latticeCameraCarrierRadius3(tiling.h, R);
  // The canonical-cell framing: the standard pose at
  // SURFACE_POSE_DIST_FACTOR × the CELL carrier radius.
  const pose = buildSurfacePose(
    { visibleBoundingRadius: R },
    width,
    height,
    (SURFACE_POSE_DIST_FACTOR * cellR) / R,
  );
  const invProjView = surfaceInvProjView({ boundingRadius: R }, pose);
  const groundPlane: SurfaceGpuGroundPlane | null = options.plane
    ? (() => {
        const ball = { center: [0, 0, 0] as Vec3, radius: R };
        return {
          y: ball.center[1] - ball.radius * SURFACE_PLANE_DROP,
          fadeStart: ball.radius * SURFACE_PLANE_FADE_START,
          fadeEnd: ball.radius * SURFACE_PLANE_FADE_END,
          ballCenter: ball.center,
          ballRadius: ball.radius,
          albedo: SURFACE_PLANE_ALBEDO,
        };
      })()
    : null;

  const kind: SurfaceComputeTarget["kind"] =
    family === "escape"
      ? "escape"
      : family === "escape4"
        ? "escape4"
        : family === "inverse4"
          ? "ifs4"
          : "ifs";
  const label = `lattice ${family}${options.plane ? " plane" : ""}`;
  activity.setState("gpu", `Surface ${label} (app path)`);
  status(`${label}: creating SurfaceComputeRenderer…`);
  const renderer = await SurfaceComputeRenderer.create(
    {
      kind,
      de,
      tiling,
      groundPlane: options.plane ?? false,
    } as SurfaceComputeTarget,
    family === "escape" || family === "escape4"
      ? [[0.8, 0.5, 0.2]]
      : surfaceSlotColors(
          (sys as { transforms: Transform[] }).transforms,
          (de as SurfaceDE).maps,
        ),
    family === "escape" || family === "escape4"
      ? [0]
      : surfaceTrapIndices(
          (sys as { transforms: Transform[] }).transforms,
          (de as SurfaceDE).maps,
        ),
  );
  try {
    const canvas = surfaceLabeledCanvas(
      dom,
      `frame-lattice-${family}`,
      `lattice carrier frame — ${family}`,
      width,
      height,
    );
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(pose, [0, 0, 0]),
      acceptPixelEps: SURFACE_PIXEL_EPS,
      tracePixelEps:
        (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / height,
      maxDepth:
        family === "escape" || family === "escape4"
          ? ESCAPE_TIME_ITERATIONS
          : (de as SurfaceDE).maxDepth,
      marchSteps: SURFACE_MARCH_STEPS,
      shadowSteps: SURFACE_FRAME_SHADOW_STEPS,
      aoTaps: SURFACE_FRAME_AO_TAPS,
      hitFloor: SURFACE_GPU_HIT_FLOOR,
      lightDir: surfaceNormalize([0.5, 0.8, 0.3]),
      ambient: 0.25,
      // Harness convention: black backdrop — the leg compares RATES,
      // never miss-pixel colors.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
      colorSource: 0,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: true,
      ...(fourD
        ? {
            view4: (sys as { view4: SurfaceGpu4View }).view4,
          }
        : {}),
      ...(groundPlane ? { groundPlane } : {}),
    };
    status(`${label}: rendering ${width}x${height}…`);
    console.info(
      `[surface-bench] ${label}: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
    );
    const frame = await renderer.renderFrame(spec, {
      budgetMs,
      onProgress: (pixels) => {
        drawSurfaceComputeFrame(canvas, pixels, width, height);
      },
    });
    if (!frame) {
      throw new Error(`${label}: renderFrame resolved null`);
    }
    drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
    const sanity = surfaceLatticeCpuSanity(
      system,
      tiling,
      invProjView,
      pose.ro,
      width,
      height,
      groundPlane,
    );
    const rays = width * height;
    const samples = Math.max(1, sanity.samples);
    const sanityGpuHitRate = frame.counts.hit / rays;
    const sanityCpuHitRate = sanity.hits / samples;
    const sanityGpuPlaneRate = groundPlane
      ? frame.counts.plane / rays
      : undefined;
    const sanityCpuPlaneRate = groundPlane
      ? sanity.planes / samples
      : undefined;
    console.info(
      `[surface-bench] ${label}: done — ${String(frame.passes)} passes, ` +
        `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)} ` +
        `plane=${String(frame.counts.plane)} ` +
        `(gpu hit ${sanityGpuHitRate.toFixed(3)} vs cpu ${sanityCpuHitRate.toFixed(3)}` +
        (groundPlane
          ? `, gpu plane ${sanityGpuPlaneRate!.toFixed(3)} vs cpu ${sanityCpuPlaneRate!.toFixed(3)})`
          : ")") +
        `${frame.truncated ? ", TRUNCATED" : ""}`,
    );
    return {
      system: sys.name,
      family,
      width: frame.width,
      height: frame.height,
      wallMs: frame.wallMs,
      gpuMs: frame.gpuMs,
      passes: frame.passes,
      truncated: frame.truncated,
      counts: frame.counts,
      sanityGpuHitRate,
      sanityCpuHitRate,
      sanityGpuPlaneRate,
      sanityCpuPlaneRate,
      sanitySamples: samples,
    };
  } finally {
    renderer.destroy();
  }
}

/** The ifs4 frame leg's strided CPU sanity march (affine4 first, then
 * widened to the fold4 core): the kernel's own unproject rays
 * over the identical f32 matrix, the affine4/fold4 marcher's shared
 * quantities — the SLICE-ADJUSTED sphere gate (sliceVisR · 1.02,
 * recomputed the packer's offset-24 way from max(|w0| − h, 0)), cone eps
 * = max(acceptEps·t, R4·hitFloor), t += d·de.stepScale — with the
 * COMPOSED f64 oracle as the estimator, every 8th pixel in both axes.
 * `refined` picks the SAME oracle mode the kernel core marches
 * (`estimateSurface4Composed`'s doc): callers pass `!deHasFolds4(de)` —
 * `true` (the affine4 ladder's `estimateDistance4Refined`) for aff4Kaleido,
 * `false` (fold4's plain `estimateDistance4`) for fold4Boxfold. Returns the
 * sampled hit rate. */
function surface4CpuSanityRate(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  invProjView: Float32Array,
  ro: Vec3,
  width: number,
  height: number,
  refined: boolean,
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
      const eps =
        surfaceSwirlAcceptanceScale(de) *
        Math.max(SURFACE_PIXEL_EPS * t, R4 * SURFACE_GPU_HIT_FLOOR);
      const d = estimateSurface4Composed(
        de,
        view4,
        [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t],
        refined,
      );
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
 * Leg B's ifs4 twin (stage B2, later widened to the fold4 core): TWO
 * end-to-end frames through the PRODUCTION renderer with ONE `{ kind:
 * "ifs4" }` target — the app path for
 * `analyzeSurfaceSystem4` sessions (GpuMap4 maps at binding 1, the
 * REQUIRED spec-carried `view4`) — the second frame at a DIFFERENT view4
 * (rotated rotor, different w0), proving the per-frame view repack end to
 * end on the same renderer: `spec.view4` is per-renderFrame state, exactly
 * scene.ts's live rotor/slice contract. Generic over `sys`:
 * `SurfaceComputeRenderer.create` picks `core: "affine4"` vs `core:
 * "fold4"` from `deHasFolds4(sys.de)` on its own (surface-compute.ts), so
 * this same body backs both the affine4 leg (aff4Kaleido) and the fold4
 * leg (fold4Boxfold) — nothing here is aff4Kaleido-specific. colorSource 3
 * (radius) so the rotor-lifted shade arm (the `visRadius4` normalizer)
 * executes; `lut: null` binds the renderer's white LUT — the arm still
 * samples it, geometry is what the leg gates. Sanity per frame is the
 * escape twin's strided CPU rate-band march ({@link
 * surface4CpuSanityRate}), its `refined` flag matched to whichever core
 * `create` picked so the sanity oracle never disagrees with the kernel
 * over a refined-vs-plain tightness delta rather than a real miss; no
 * chaotic-flip machinery — the ladder/frontier core's band absorbs edge
 * pixels (per-query agreement is M3/M4's job).
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
  // (visR = R4 here — aff4Kaleido/fold4Boxfold both carry no final lens).
  const pose = buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  const colors = surfaceSlotColors(sys.transforms, sys.de.maps);
  const trapIndices = surfaceTrapIndices(sys.transforms, sys.de.maps);
  // The CPU sanity march (in `runOne` below) must use the SAME oracle mode
  // the renderer's kernel core marches — plain estimateDistance4 for a
  // fold4-routed DE, refined otherwise (surface4CpuSanityRate's doc).
  const sanityRefined = !deHasFolds4(sys.de);

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
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(pose),
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
      // Harness convention: black backdrop, like the eval legs' own
      // packSurfaceGpuShade calls — the compute-frame legs compare HIT
      // RATES against the CPU sanity march, never miss-pixel colors.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
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
        sanityRefined,
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
 * The shade probe-width A/B pixel diff: RGB-only (the kernel never writes
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
 * The probe-width verdict's leg: the shipped shade-probe width
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
      camForward: pose.fwd,
      focusDepth: surfaceCameraDepth(pose, balloonBall(mbox.de).center),
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
      // Harness convention: black backdrop, like the eval legs' own
      // packSurfaceGpuShade calls — the compute-frame legs compare HIT
      // RATES against the CPU sanity march, never miss-pixel colors.
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
      colorSource: 0,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: true,
    };
  };

  activity.setState("gpu", "Surface shade probe-width A/B");
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

/** The opt-in sweep leg: builds one kaleidoscope order's affine4
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

/** The opt-in sweep leg: builds one kaleidoscope order's FOLD4 system +
 * frozen view, mirroring {@link buildAff4SweepSystem} one core over — same
 * eligibility-throw idiom (fixed fixture family; an ineligible order is a
 * bench bug), same identity-rotor / `w0 = 0.2 · boundingRadius` /
 * zero-thickness view recipe, same order-parametrized `plane: "xz",
 * twist: 1` kaleidoscope — but over `surfaceFold4Boxfold()`'s base pair
 * (M4's own `fold4Boxfold` fixture, `surface-de-4d.test.ts`'s
 * `pureBoxfoldPair4` verbatim) instead of the affine ladder's base maps.
 * Boxfold's 4D branch fan is 81 branches per map — the heaviest COMMON
 * fold family (isometric-only, `sigma_c = 1` on all 81 — M4's own doc) —
 * so this curve is the fold-4D-at-high-order datum the 4D routing
 * question needs; mandelbox (243 branches per map) scales roughly 3x on
 * top of it, which this leg doesn't need to chase separately to answer
 * that question. */
function buildFold4SweepSystem(order: number): {
  de: SurfaceDE4;
  view4: SurfaceGpu4View;
} {
  const transforms = surfaceFold4Boxfold();
  const symmetry: SymmetryParams = { order, plane: "xz", twist: 1 };
  const eligibility = analyzeSurfaceSystem4(transforms, null);
  if (eligibility.status === "ineligible") {
    throw new Error(
      `fold4 sweep fixture order ${String(order)} is ineligible: ` +
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
 * The opt-in per-kaleidoscope-order affine4/fold4 eval-kernel timing
 * sweep (`config.aff4Sweep`, `--surface-aff4-sweep=1`). Originally a
 * two-arm affine4 slab/no-slab A/B answering the 4D kernel-cost question
 * (the affine4 COMPUTE kernel measured ~1.7x FASTER than the fragment-GLSL
 * tracer at kaleidoscope order 1 but ~35x SLOWER at order 6, real Iris Xe;
 * orders 2-5 were never measured, and it was unknown whether the slowdown
 * is the eval kernel's own superlinear cost in symmetry order or an
 * artifact of the app's host march loop on top of it) — this leg still
 * times the BARE eval kernel — no march, no host loop, no shading — at
 * every order in {@link SURFACE_AFF4_SWEEP_ORDERS}, but now across FIVE
 * arms spanning TWO cores: `core: "affine4"` runs `slab` (today's shipped
 * kernel), `noslab` (`slabExt: false`, the original register-pressure
 * probe), and `noslab` with `mapsUniform: true`; `core: "fold4"` runs only
 * `noslab` and `noslab`+`mapsUniform: true` (no slab arm — the slice-slab
 * question is already covered on the affine4 ladder above, and separately
 * by M4's own dedicated slabExt A/B on `fold4Boxfold`, so this leg's fold4
 * arms stay narrowly scoped to the axis below they actually add). The two
 * NEW axes:
 *
 * (1) UNIFORM vs STORAGE maps isolates the per-iteration maps-load tax.
 * The fragment-GLSL 4D tracer this kernel lost to at order 6 reads its
 * maps from a std140 uniform BLOCK, which Mesa serves from the
 * constant cache / push space; the WGSL storage loads this kernel emits
 * instead sit in the innermost sector-sweep loop AND inside every
 * `refinedCert` re-sweep, behind Tint's runtime-sized-array robustness
 * clamp (surface-de-gpu.ts's `mapsUniform` option doc). Each core's
 * `noslab` arm against its own `noslab`+`mapsUniform` arm A/Bs this
 * directly — affine4 and fold4 both carry the comparison, so the leg can
 * tell whether any tax it finds is core-specific or a property of the maps
 * binding alone.
 *
 * (2) The FOLD4 curve is the fold-4D-at-high-order datum this leg was
 * missing — {@link buildFold4SweepSystem}'s boxfold fixture, the heaviest
 * COMMON fold family. Comparing the fold4 curve's SHAPE against affine4's
 * also attributes affine4's own superlinearity: fold4 has NO `refinedCert`
 * by construction (surface-de-4d.ts's `descendFold4`), so if fold4 scales
 * roughly linearly in order while affine4 does not, the residual is
 * `refinedCert`'s divergence amplification, not the maps path — a question
 * neither the original two-arm sweep nor the maps-load probe alone could
 * separate out. `fold4`'s frontier `width` is {@link
 * SURFACE_FOLD_BEAM_WIDTH} — the CPU oracle's own fixed frontier width and
 * the M4 agreement leg's GATING row, mirrored exactly (M4's width-4 row is
 * informational-only there and has no counterpart here).
 *
 * (3) ADAPTIVE batch sizing (replacing the original fixed {@link
 * SURFACE_AFF4_SWEEP_BATCH} target) is watchdog safety, not a measurement
 * refinement: an order-6 fold4 eval at a fixed 65536-query batch would be
 * one multi-ten-second GPU submission — exactly the i915-watchdog risk the
 * app bounds every production submission against (strip-planner.ts's
 * module doc). Each (order, core) pair times a small pilot dispatch first
 * ({@link SURFACE_AFF4_SWEEP_PILOT_TILES} tiles of {@link affine4Queries}'
 * 700-query mix, on that core's `noslab`+storage pipeline — the same
 * pipeline its own `noslab` arm times for real) and derives a batch sized
 * toward {@link SURFACE_AFF4_SWEEP_TARGET_MS} of wall time per timed
 * dispatch, clamped to [the pilot's own size, the adapter's batch ceiling]
 * and rounded to a whole number of 700-query tiles so the derived batch's
 * `queries.length` always equals the `itemCount` packed into params. Every
 * arm of the SAME (order, core) pair shares that one derived size, keeping
 * the pair's A/B comparable; sizes legitimately differ ACROSS (order, core)
 * pairs — a cheap low-order affine4 pair reaches the ceiling, an expensive
 * order-6 fold4 pair sizes far below it.
 *
 * Every arm's pipeline compiles ONCE, before the order loop (surface-de-
 * gpu.ts's `slabExt`/`mapsUniform` docs: "the kernel text does not depend
 * on symmetry order"). The two `mapsUniform: true` pipelines compile
 * against `layout: "auto"` rather than this section's shared
 * `pipelineLayout`, because their binding 1 is typed `uniform` where the
 * shared `bindGroupLayout` declares `read-only-storage` — WebGPU has no
 * "same layout, different binding type" option (`buildSurfacePipeline`'s
 * doc); their bind groups are built from their OWN pipeline's
 * `getBindGroupLayout(0)` instead. Every arm's warmup dispatch (untimed)
 * doubles as its agreement-gate value — the kernel is a pure function of
 * its buffers, so a second untimed readback would only re-measure numbers
 * the warmup already produced ({@link runSurfaceEvalDispatch}, reused
 * rather than reinventing dispatch plumbing). The {@link
 * SURFACE_AFF4_SWEEP_REPS} TIMED dispatches that follow carry no readback
 * in their own submission — the march timing config's idiom
 * (`runSurfaceMarchConfig`): `performance.now()` spans submit →
 * `onSubmittedWorkDone` of the compute pass ALONE, so a copy-to-staging
 * cost never contaminates a fast configuration's measurement.
 *
 * GATING: {@link SURFACE_AFF4_SWEEP_TOL_FACTOR}'s doc — every pair this leg
 * compares (affine4 slab-vs-noslab, and each core's own uniform-vs-storage)
 * is mathematically bit-identical by construction, so any mismatch past
 * FMA/contraction noise is a real divergence between the two code paths,
 * and fails the section exactly like the M3 leg's own agreement gate.
 * Skips (silent when `!config.aff4Sweep`, noted on a software adapter
 * without `surfaceForce=1`) never fail anything — the section stays
 * exactly as gate-worthy as it was before this leg existed. Progressive:
 * `onUpdate` fires once per completed order, so a mid-sweep error (caught
 * by the caller) still leaves every prior order's rows visible in
 * `results.aff4Sweep` rather than losing them.
 *
 * MEASURED VERDICT (real Iris Xe, 2026-08-11 — the 4D kernel-cost closure
 * run): axis (1) REFUTED — uniform maps moved nothing (fold4 0.99x flat
 * at every order, affine4 0.79-1.02x), values bit-identical, so the arms
 * stay as the refutation's standing gate and production never sets
 * `mapsUniform`. Axis (2) landed the real answer: BOTH curves are
 * superlinear (affine4 x14.4, fold4 x76.4 at order 6 vs the 6x naive work
 * ratio) and fold4's — with no `refinedCert` at all — is the worse,
 * refuting the divergence-amplified-refinement suspect too; the CPU
 * oracle then reproduced both shapes on these exact mixes (x13.5/x58.9 —
 * `scripts/aff4-order-cpu.harness.ts`), so the superlinearity is the
 * ALGORITHM's own depth growth (more sectors → better-surviving beam
 * candidates → deeper descents, each level itself O(order)), which both
 * the compute kernel and the fragment GLSL pay alike. SwiftShader
 * reproduced the same shapes (x21.8/x75). The kernel is exonerated for
 * the app-level order-6 compute-vs-fragment gap — that residual is the
 * compute arm's march-loop scheduling under an expensive-DE regime, and
 * lives on its own bead.
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
  const affineWidth = SURFACE_AFFINE_LADDER_WIDTH;
  const fold4Width = SURFACE_FOLD_BEAM_WIDTH;

  activity.setState("gpu", "Surface affine4/fold4 maps-binding sweep");
  status("aff4 sweep: compiling kernels…");
  const { pipeline: slabPipeline, compileMs: slabCompileMs } =
    await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine4",
        width: affineWidth,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        // slabExt absent = true — today's shipped kernel.
      }),
      "evalQueries",
      "surface-de aff4-sweep affine4-slab",
    );
  const { pipeline: noslabPipeline, compileMs: noslabCompileMs } =
    await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine4",
        width: affineWidth,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        slabExt: false,
      }),
      "evalQueries",
      "surface-de aff4-sweep affine4-noslab",
    );
  const { pipeline: noslabUniformPipeline, compileMs: noslabUniformCompileMs } =
    await buildSurfacePipeline(
      device,
      "auto",
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "affine4",
        width: affineWidth,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        slabExt: false,
        mapsUniform: true,
      }),
      "evalQueries",
      "surface-de aff4-sweep affine4-noslab-uniform",
    );
  const { pipeline: fold4Pipeline, compileMs: fold4CompileMs } =
    await buildSurfacePipeline(
      device,
      pipelineLayout,
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "fold4",
        width: fold4Width,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        slabExt: false,
      }),
      "evalQueries",
      "surface-de aff4-sweep fold4-noslab",
    );
  const { pipeline: fold4UniformPipeline, compileMs: fold4UniformCompileMs } =
    await buildSurfacePipeline(
      device,
      "auto",
      surfaceDeKernelWgsl({
        mode: "eval",
        core: "fold4",
        width: fold4Width,
        workgroupSize: wg,
        sharedFrontier: false,
        bnbStage2: false,
        slabExt: false,
        mapsUniform: true,
      }),
      "evalQueries",
      "surface-de aff4-sweep fold4-noslab-uniform",
    );

  const compileMs: Record<string, number> = {
    "affine4-slab": slabCompileMs,
    "affine4-noslab": noslabCompileMs,
    "affine4-noslab-uniform": noslabUniformCompileMs,
    "fold4-noslab": fold4CompileMs,
    "fold4-noslab-uniform": fold4UniformCompileMs,
  };
  notes.push(
    "aff4 sweep: compiled " +
      `affine4-slab=${slabCompileMs.toFixed(0)}ms ` +
      `affine4-noslab=${noslabCompileMs.toFixed(0)}ms ` +
      `affine4-noslab-uniform=${noslabUniformCompileMs.toFixed(0)}ms ` +
      `fold4-noslab=${fold4CompileMs.toFixed(0)}ms ` +
      `fold4-noslab-uniform=${fold4UniformCompileMs.toFixed(0)}ms`,
  );

  const batchCap = software
    ? SURFACE_AFF4_SWEEP_BATCH_SW
    : SURFACE_AFF4_SWEEP_BATCH;
  if (software) {
    notes.push(
      `aff4 sweep: software adapter — batch ceiling reduced to ${String(SURFACE_AFF4_SWEEP_BATCH_SW)} queries (real-driver runs cap at ${String(SURFACE_AFF4_SWEEP_BATCH)})`,
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

  // The maps-load probe: a fixed 24-slot footprint regardless of how
  // many maps the system actually has (surface-de-gpu.ts's
  // SURFACE_GPU_UNIFORM_MAP_SLOTS doc) — WebGPU validates the FULL bound
  // type size at bind-group creation, and a fresh buffer is zero-filled,
  // so writing the (much shorter) real maps data into it is complete.
  const uniformMapsBytes =
    SURFACE_GPU_UNIFORM_MAP_SLOTS * SURFACE_GPU_MAP4_VEC4 * 16;

  // One params/maps(storage+uniform)/input/output/staging set, sized for
  // `queries.length` — shared shape for both the untimed pilot dispatch and
  // the real timed batch (two allocate/try/finally-destroy phases per
  // (order, core), this function's own pattern run twice). The uniform maps
  // buffer is allocated even for a pilot (which only ever dispatches on a
  // storage pipeline) so there is exactly one packing code path — the
  // wasted ~3KB alloc costs nothing a pilot needs to be fast about.
  const allocateBuffers = async (
    order: number,
    core: "affine4" | "fold4",
    phase: "pilot" | "batch",
    de: SurfaceDE4,
    view4: SurfaceGpu4View,
    queries: Vec3[],
  ): Promise<{
    params: GPUBuffer;
    mapsStorage: GPUBuffer;
    mapsUniform: GPUBuffer;
    input: GPUBuffer;
    output: GPUBuffer;
    staging: GPUBuffer;
  }> => {
    const n = queries.length;
    const tag = `${core} order${String(order)} ${phase}`;
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
      `aff4-sweep params ${tag}`,
      paramsData.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(params, 0, paramsData);
    const mapsStorage = await createSurfaceBuffer(
      device,
      `aff4-sweep maps-storage ${tag}`,
      mapsData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(mapsStorage, 0, mapsData);
    // The probe's uniform-usage twin — same content, full 24-slot
    // footprint (this function's doc above).
    const mapsUniformBuf = await createSurfaceBuffer(
      device,
      `aff4-sweep maps-uniform ${tag}`,
      uniformMapsBytes,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(mapsUniformBuf, 0, mapsData);
    const input = await createSurfaceBuffer(
      device,
      `aff4-sweep queries ${tag}`,
      inputData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    device.queue.writeBuffer(input, 0, inputData);
    const output = await createSurfaceBuffer(
      device,
      `aff4-sweep results ${tag}`,
      n * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const staging = await createSurfaceBuffer(
      device,
      `aff4-sweep staging ${tag}`,
      n * 4,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    return {
      params,
      mapsStorage,
      mapsUniform: mapsUniformBuf,
      input,
      output,
      staging,
    };
  };
  const destroyBuffers = (bufs: {
    params: GPUBuffer;
    mapsStorage: GPUBuffer;
    mapsUniform: GPUBuffer;
    input: GPUBuffer;
    output: GPUBuffer;
    staging: GPUBuffer;
  }): void => {
    bufs.params.destroy();
    bufs.mapsStorage.destroy();
    bufs.mapsUniform.destroy();
    bufs.input.destroy();
    bufs.output.destroy();
    bufs.staging.destroy();
  };
  const buildBindGroup = (
    layout: GPUBindGroupLayout,
    label: string,
    bufs: {
      params: GPUBuffer;
      maps: GPUBuffer;
      input: GPUBuffer;
      output: GPUBuffer;
    },
  ): GPUBindGroup =>
    device.createBindGroup({
      label,
      layout,
      entries: [
        { binding: 0, resource: { buffer: bufs.params } },
        { binding: 1, resource: { buffer: bufs.maps } },
        { binding: 2, resource: { buffer: bufs.input } },
        { binding: 3, resource: { buffer: bufs.output } },
      ],
    });

  // Adaptive batch sizing (this function's doc, point (3)): a small pilot
  // dispatch on `storagePipeline` measures this (order, core)'s own
  // µs/query, then derives a batch sized toward SURFACE_AFF4_SWEEP_TARGET_MS
  // of wall time, clamped to [the pilot's own size, `batchCap`] and rounded
  // to a whole number of 700-query tiles — the caller tiles `base` by the
  // returned `tiles` directly, so `queries.length` is always exactly what
  // gets packed as `itemCount`, never a value the clamp could desync from
  // the tile grid (batchCap, 65536/8192, isn't itself a multiple of 700, so
  // the clamp runs in TILE units, not raw query count).
  const sizeAff4SweepBatch = async (
    order: number,
    core: "affine4" | "fold4",
    de: SurfaceDE4,
    view4: SurfaceGpu4View,
    seed: number,
    storagePipeline: GPUComputePipeline,
  ): Promise<{ base: Vec3[]; tiles: number }> => {
    // affine4's ladder carries a refinedCert the query mix's boundary
    // bisection should track; fold4 has none (descendFold4 refine=false —
    // M4's own affine4Queries call), so its mix uses the SAME plain
    // estimator its kernel actually marches.
    const base = affine4Queries(de, view4, seed, core === "affine4");
    const pilotQueries: Vec3[] = [];
    for (let t = 0; t < SURFACE_AFF4_SWEEP_PILOT_TILES; t++) {
      pilotQueries.push(...base);
    }
    const bufs = await allocateBuffers(
      order,
      core,
      "pilot",
      de,
      view4,
      pilotQueries,
    );
    try {
      const bindGroup = buildBindGroup(
        bindGroupLayout,
        `aff4-sweep pilot bind group ${core} order${String(order)}`,
        {
          params: bufs.params,
          maps: bufs.mapsStorage,
          input: bufs.input,
          output: bufs.output,
        },
      );
      status(`aff4 sweep: order ${String(order)} ${core} — pilot…`);
      activity.setState(
        "gpu",
        `Surface affine4/fold4 sweep — order ${String(order)} (${core} pilot)`,
      );
      const pilotN = pilotQueries.length;
      const t0 = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(storagePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(pilotN / wg));
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t0;
      const usPerQuery = (ms * 1000) / pilotN;
      const targetQueries = (SURFACE_AFF4_SWEEP_TARGET_MS * 1000) / usPerQuery;
      const rawTiles = Math.round(targetQueries / base.length);
      const maxTiles = Math.floor(batchCap / base.length);
      const tiles = clamp(rawTiles, SURFACE_AFF4_SWEEP_PILOT_TILES, maxTiles);
      notes.push(
        `aff4 sweep order ${String(order)} ${core} pilot: n=${String(pilotN)} ms=${ms.toFixed(3)} → batch ${String(tiles * base.length)}`,
      );
      return { base, tiles };
    } finally {
      destroyBuffers(bufs);
    }
  };

  // Runs one arm (untimed warmup + SURFACE_AFF4_SWEEP_REPS timed reps),
  // pushing its row/note — the original single-variant sweep's `runVariant`
  // closure, parametrized over core/maps too so every arm shares one body.
  const runArm = async (
    order: number,
    core: "affine4" | "fold4",
    variant: "slab" | "noslab",
    maps: "storage" | "uniform",
    pipeline: GPUComputePipeline,
    queries: Vec3[],
    buffers: {
      output: GPUBuffer;
      staging: GPUBuffer;
      bindGroup: GPUBindGroup;
    },
  ): Promise<Float32Array> => {
    const n = queries.length;
    const label = `${core} ${variant} maps=${maps}`;
    status(`aff4 sweep: order ${String(order)} (${label}) — warmup…`);
    activity.setState(
      "gpu",
      `Surface affine4/fold4 sweep — order ${String(order)} (${label})`,
    );
    // Untimed warmup — its return value is ALSO this arm's agreement-gate
    // value; see this function's doc for why a second readback would be
    // redundant.
    const gpu = await runSurfaceEvalDispatch(
      device,
      pipeline,
      { queries, buffers },
      wg,
    );
    const timedMs: number[] = [];
    for (let rep = 0; rep < SURFACE_AFF4_SWEEP_REPS; rep++) {
      status(
        `aff4 sweep: order ${String(order)} (${label}) — timed ${String(rep + 1)}/${String(SURFACE_AFF4_SWEEP_REPS)}…`,
      );
      const t0 = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, buffers.bindGroup);
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
      core,
      variant,
      maps,
      n,
      reps: timedMs.length,
      minMs,
      meanMs,
      usPerQuery,
    });
    notes.push(
      `aff4 sweep order ${String(order)} ${core} ${variant} maps=${maps}: n=${String(n)} reps=${String(timedMs.length)} ` +
        `min=${minMs.toFixed(3)}ms mean=${meanMs.toFixed(3)}ms us/query=${usPerQuery.toFixed(3)}`,
    );
    return gpu;
  };

  // Elementwise exact-equality check between two already-run arms —
  // SURFACE_AFF4_SWEEP_TOL_FACTOR's doc for why every pair this leg forms
  // is expected to agree bit for bit.
  const pushAgreement = (
    order: number,
    pair: SurfaceAff4SweepAgreement["pair"],
    gpuA: Float32Array,
    gpuB: Float32Array,
    boundingRadius: number,
  ): void => {
    let mismatches = 0;
    let maxAbs = 0;
    for (let i = 0; i < gpuA.length; i++) {
      if (gpuA[i] !== gpuB[i]) {
        mismatches++;
        maxAbs = Math.max(maxAbs, Math.abs(gpuA[i] - gpuB[i]));
      }
    }
    const tol = SURFACE_AFF4_SWEEP_TOL_FACTOR * boundingRadius;
    const withinTolerance = maxAbs <= tol;
    agreement.push({
      order,
      pair,
      n: gpuA.length,
      mismatches,
      maxAbs,
      withinTolerance,
    });
    if (mismatches > 0) {
      if (withinTolerance) {
        notes.push(
          `aff4 sweep order ${String(order)} ${pair}: ${String(mismatches)} sub-tolerance mismatches ` +
            `(maxAbs ${maxAbs.toExponential(2)}) — fma/contraction noise`,
        );
      } else {
        failed = true;
        notes.push(
          `aff4 sweep order ${String(order)} ${pair}: ${String(mismatches)} mismatches, ` +
            `maxAbs ${maxAbs.toExponential(2)} exceeds tolerance ${tol.toExponential(2)} — ` +
            "DISAGREE, failing the leg",
        );
      }
    }
  };

  // One core's full arm set for one order: pilot-size the batch, allocate
  // real buffers at that size, run every arm this core is entitled to
  // (affine4: slab / noslab-storage / noslab-uniform; fold4: noslab-storage
  // / noslab-uniform only — this function's doc for why fold4 skips slab),
  // and gate the uniform-vs-storage pair (plus, for affine4, slab-vs-noslab).
  const runAff4SweepCore = async (
    order: number,
    core: "affine4" | "fold4",
    de: SurfaceDE4,
    view4: SurfaceGpu4View,
    seed: number,
    storagePipeline: GPUComputePipeline,
    uniformPipeline: GPUComputePipeline,
    slabPipelineForArm: GPUComputePipeline | null,
  ): Promise<void> => {
    const { base, tiles } = await sizeAff4SweepBatch(
      order,
      core,
      de,
      view4,
      seed,
      storagePipeline,
    );
    const queries: Vec3[] = [];
    for (let t = 0; t < tiles; t++) queries.push(...base);

    const bufs = await allocateBuffers(
      order,
      core,
      "batch",
      de,
      view4,
      queries,
    );
    try {
      const storageBindGroup = buildBindGroup(
        bindGroupLayout,
        `aff4-sweep ${core} storage bind group order${String(order)}`,
        {
          params: bufs.params,
          maps: bufs.mapsStorage,
          input: bufs.input,
          output: bufs.output,
        },
      );
      const uniformBindGroup = buildBindGroup(
        uniformPipeline.getBindGroupLayout(0),
        `aff4-sweep ${core} uniform bind group order${String(order)}`,
        {
          params: bufs.params,
          maps: bufs.mapsUniform,
          input: bufs.input,
          output: bufs.output,
        },
      );
      const storageBuffers = {
        output: bufs.output,
        staging: bufs.staging,
        bindGroup: storageBindGroup,
      };
      const uniformBuffers = {
        output: bufs.output,
        staging: bufs.staging,
        bindGroup: uniformBindGroup,
      };

      let gpuSlab: Float32Array | null = null;
      if (slabPipelineForArm) {
        gpuSlab = await runArm(
          order,
          core,
          "slab",
          "storage",
          slabPipelineForArm,
          queries,
          storageBuffers,
        );
      }
      const gpuNoslabStorage = await runArm(
        order,
        core,
        "noslab",
        "storage",
        storagePipeline,
        queries,
        storageBuffers,
      );
      const gpuNoslabUniform = await runArm(
        order,
        core,
        "noslab",
        "uniform",
        uniformPipeline,
        queries,
        uniformBuffers,
      );

      if (gpuSlab) {
        pushAgreement(
          order,
          "slab-vs-noslab",
          gpuSlab,
          gpuNoslabStorage,
          de.boundingRadius,
        );
      }
      const pair =
        core === "affine4"
          ? "affine4-uniform-vs-storage"
          : "fold4-uniform-vs-storage";
      pushAgreement(
        order,
        pair,
        gpuNoslabUniform,
        gpuNoslabStorage,
        de.boundingRadius,
      );
    } finally {
      destroyBuffers(bufs);
    }
  };

  for (const order of SURFACE_AFF4_SWEEP_ORDERS) {
    status(`aff4 sweep: order ${String(order)} — building systems…`);
    const aff4 = buildAff4SweepSystem(order);
    const fold4 = buildFold4SweepSystem(order);

    await runAff4SweepCore(
      order,
      "affine4",
      aff4.de,
      aff4.view4,
      900 + order,
      noslabPipeline,
      noslabUniformPipeline,
      slabPipeline,
    );
    await runAff4SweepCore(
      order,
      "fold4",
      fold4.de,
      fold4.view4,
      1900 + order,
      fold4Pipeline,
      fold4UniformPipeline,
      null,
    );

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
  heading.textContent = "surface-de compute kernel — ";
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
 * "fail" with the error in `reason`/`notes` — except a device-sanity
 * canary trip, which is the "device-unreliable" verdict: the
 * shared device stopped reproducing its own baseline mid-run, so numeric
 * rows are not evidence either way and the only honest instruction is
 * "rerun on a quiet machine" (see {@link createSurfaceCanary}).
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
    // The fold's AUTHORED lengths. Appended after the existing
    // fold entries rather than inserted among them: the march-unproject
    // leg falls back to `foldSystems[0]` when mandelboxKifs is excluded
    // (surfaceSystems=synthetic), and that leg's fixture should not change
    // because a new agreement row arrived.
    {
      name: "foldParameterizedPostPair",
      transforms: withSurfaceBenchPost(surfaceFoldParameterizedPair()),
    },
    // M0 — the AFFINE core's systems. Fold-free base maps, so the
    // routing below hands them the refined ladder and its own oracle.
    { name: "affineTetra", transforms: surfaceAffineTetra() },
    {
      name: "affineTwistPostFinal",
      transforms: withSurfaceBenchPost(surfaceAffineTwist()),
      finalTransform: surfaceAffineTwistFinal(),
      symmetry: { order: 3, plane: "xz" },
    },
    // Stage B (M1) — the fold FINAL lens systems. `buildSurfaceDE`
    // turns each fold-carrying final into `de.foldFinal`; the CPU calls
    // below route through `descendLens` on their own, and the M1 leg
    // compiles the kernel with `lens: true` around each system's core.
    {
      name: "lensBoxfoldPostOverAffine",
      transforms: withSurfaceBenchPost(surfaceAffineTetra()),
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
    // The lens's own authored lengths, over M0's affine base
    // (see surfaceLensParameterizedFinal's doc for why the lens block is a
    // second, independently-packed site).
    {
      name: "lensParameterizedOverAffine",
      transforms: surfaceAffineTetra(),
      finalTransform: surfaceLensParameterizedFinal(),
    },
    {
      name: "lensSwirlPostOverAffine",
      transforms: withSurfaceBenchPost(surfaceAffineTetra()),
      finalTransform: surfaceLensSwirlFinal(),
    },
    {
      name: "lensSwirlPostOverFold",
      transforms: surfaceFoldBoxfoldPair(),
      finalTransform: surfaceLensSwirlFinal(),
    },
    // Condensation is appended as its own field class. It must not enter the
    // shared affine pipeline below because its gear ShapeSpec is generated
    // into shader source; the dedicated M8 leg compiles that source and
    // reuses the same 700-query oracle/comparator.
    {
      name: "gearworksCondensation",
      transforms: gearworks(),
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
      // The DE picks BOTH the kernel core and the CPU oracle, by
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
  const foldPostSystem = systems.find(
    (system) => system.name === "foldParameterizedPostPair",
  );
  for (const name of ["lensSwirlPostOverAffine", "lensSwirlPostOverFold"]) {
    const lens = systems.find((system) => system.name === name)?.de.foldFinal;
    if (lens?.swirlRadius === undefined || lens.postInvM === null) {
      throw new Error(`required swirl lens fixture ${name} did not build live`);
    }
  }
  const affineFinalPostSystem = systems.find(
    (system) => system.name === "affineTwistPostFinal",
  );
  const productionPostLensSystem = systems.find(
    (system) => system.name === "lensBoxfoldPostOverAffine",
  );
  if (!foldPostSystem?.de.maps.some((map) => map.postInvM !== null)) {
    throw new Error("required Surface fold post fixture did not build live");
  }
  if (
    !affineFinalPostSystem?.de.maps.some((map) => map.postInvM !== null) ||
    affineFinalPostSystem.de.final === null ||
    systemDefs.find((def) => def.name === "affineTwistPostFinal")
      ?.finalTransform?.post === undefined
  ) {
    throw new Error(
      "required Surface affine map/final post fixture did not build live",
    );
  }
  if (
    !productionPostLensSystem?.de.maps.some((map) => map.postInvM !== null) ||
    productionPostLensSystem.de.foldFinal?.postInvM === null ||
    productionPostLensSystem.de.foldFinal?.postInvM === undefined
  ) {
    throw new Error(
      "required production Surface map/lens post fixture did not build live",
    );
  }
  const mandelboxStressSystem = systems.find(
    (system) => system.name === "lensMandelboxOverAffine",
  );
  if (
    mandelboxStressSystem === undefined ||
    mandelboxStressSystem.de.foldFinal === null ||
    mandelboxStressSystem.de.maps.some((map) => map.postInvM !== null) ||
    mandelboxStressSystem.de.foldFinal.postInvM !== null
  ) {
    throw new Error(
      "required unposted Mandelbox lens stress fixture did not build cleanly",
    );
  }

  // Tier 3's mesh field deliberately stays out of `systems`: the direct
  // eval/unproject layouts above freeze the older buffer-only 0..4 binding
  // set, whereas the production renderer owns binding 11's 3D atlas texture.
  // Leg B below is therefore the cleaner end-to-end proof: the shipped Star
  // Foundry target compiles, uploads, marches and shades through that texture,
  // then a strided `surfaceCpuMarchState` run supplies the Surface oracle.
  let meshCondensationSystem: SurfaceFrameSystem | null = null;
  try {
    const transforms = presetTransforms("starFoundry");
    const de = buildSurfaceDE(transforms, null, SURFACE_NO_SYMMETRY);
    if (!de.condensation) {
      throw new Error("Star Foundry did not produce a condensation field");
    }
    meshCondensationSystem = {
      name: "starFoundryMeshCondensation",
      de,
      transforms,
    };
  } catch (e) {
    results.notes.push(`starFoundry mesh frame fixture: ${describeError(e)}`);
  }
  render();

  // ----- Scheduled hybrid: shipped Sponge of Ferns, CPU oracle ----------
  // This is deliberately a fixed, must-build fixture rather than another
  // best-effort systemDefs entry. Four affine fern maps plus the twenty
  // affine Menger B maps occupy all 24 physical records, and depth 2 makes
  // both B levels and the B->A boundary live. The schedule-aware chaos-game
  // query cloud samples the composed object rather than A in isolation.
  status(`cpu oracle: ${SURFACE_SCHEDULE_ROW_3D}…`);
  activity.setState("cpu", "Surface scheduled CPU oracle — 3D");
  await new Promise<void>((resolve) => setTimeout(resolve));
  const scheduledTransforms = presetTransforms("spongeOfFerns");
  const scheduledHybrid = PRESET_SCHEDULES.spongeOfFerns?.();
  if (!scheduledHybrid) {
    throw new Error("scheduled Surface bench fixture is missing its schedule");
  }
  const scheduledDe = buildSurfaceDE(
    scheduledTransforms,
    null,
    SURFACE_NO_SYMMETRY,
    { schedule: scheduledHybrid },
  );
  const scheduledSpec = surfaceScheduleKernelSpec(scheduledDe);
  if (scheduledSpec.mapCount + scheduledSpec.scheduleMapCount !== 24) {
    throw new Error(
      `scheduled Surface bench fixture must occupy 24 map records, got ${String(
        scheduledSpec.mapCount + scheduledSpec.scheduleMapCount,
      )}`,
    );
  }
  const scheduledQueries = surfaceQueries(
    scheduledTransforms,
    scheduledDe.boundingRadius,
    null,
    SURFACE_NO_SYMMETRY,
    scheduledHybrid,
  );
  const scheduledSystem: SurfaceSystemState = {
    name: SURFACE_SCHEDULE_ROW_3D,
    core: "affine",
    de: scheduledDe,
    transforms: scheduledTransforms,
    queries: scheduledQueries,
    cpu: scheduledQueries.map((q) =>
      estimateDistanceRefined(scheduledDe, q, 0),
    ),
  };
  render();

  // ----- Graph-directed xaos: shipped isolated Fern | Sponge -----------
  // This is the full 24-map preset, not a synthetic mini-graph. Its chi
  // rows split the fern and sponge into disconnected inverse-chain
  // components, while the chaos-game's sub-orbit re-entry samples both.
  // The spec call is deliberately unconditional: if graph projection ever
  // disappears, the benchmark fails before it can compile a classic kernel.
  status(`cpu oracle: ${SURFACE_CHAOS_ROW_3D}…`);
  activity.setState("cpu", "Surface xaos CPU oracle — 3D");
  await new Promise<void>((resolve) => setTimeout(resolve));
  const chaosTransforms = presetTransforms("fernSponge");
  const chaosDe = buildSurfaceDE(chaosTransforms, null, SURFACE_NO_SYMMETRY);
  const chaosSpec = surfaceChaosKernelSpec(chaosDe);
  if (chaosDe.maps.length !== 24 || chaosSpec.activeStateCount !== 24) {
    throw new Error(
      `xaos Surface bench fixture must expose 24 active maps/states, got ` +
        `${String(chaosDe.maps.length)}/${String(chaosSpec.activeStateCount)}`,
    );
  }
  const chaosQueries = surfaceQueries(chaosTransforms, chaosDe.boundingRadius);
  const chaosSystem: SurfaceSystemState = {
    name: SURFACE_CHAOS_ROW_3D,
    core: "affine",
    de: chaosDe,
    transforms: chaosTransforms,
    queries: chaosQueries,
    cpu: chaosQueries.map((q) => estimateDistanceRefined(chaosDe, q, 0)),
  };
  render();

  // ----- Escape-time systems: a SEPARATE gate + CPU oracle -----
  // `buildSurfaceDE` refuses these shapes by design (single non-contracting
  // pure-fold map — `analyzeEscapeSystem` is its deliberate complement), so
  // they never enter `systemDefs`/`systems` above and never touch
  // `deHasFolds`/fold/affine routing. Five SINGLE-MAP systems: both fold arms
  // gated solo (boxfold, spherefold), both together (mandelbox), an off-axis
  // rotated/scaled matrix with a negative fold weight, and a second
  // spherefold carrying the live post-affine. The radial-only spherefold is
  // deliberate: the replaced posted Mandelbox fixture put 242/700 queries
  // outside the existing f32-stability gate even after reducing the post.
  // This replacement is a POST-WIRE row, not a second shape census: none of
  // its 700 f64 samples reaches the nominal DE < 0.02 shell. Its first run's
  // 286 exclusions were instead the stale f32 twin documented above; after
  // that twin applies the post, all 700 queries are stable and still compare
  // the GPU's posted result against the independent f64 oracle.
  //
  // THREE MORE SINCE THE CHAIN LANDED, and they are the load-bearing ones
  // for the chain: the orbit CYCLES through the document's transform list,
  // so on any single-map fixture the whole inner step is a no-op and every
  // mutation of it passes (the bulb leg's sigma_max lesson, one level up).
  // So `escChainPair` runs two links whose FOLD KIND, weight and matrix
  // all differ (a kernel that read slot 0 every step, or applied the
  // links in the wrong order, gets a different orbit); `escChainTriple`
  // adds the third fold kind, so both `kind` dispatches are exercised
  // per-link rather than per-system; and `escChainKaleido` is the same
  // pair under a 5-fold kaleidoscope, because the query-space wedge fold
  // is equally a no-op on every unsymmetrised row.
  //
  // AND FOUR CROSS-FAMILY ROWS SINCE THE POWER LINKS (their own block at
  // the end of the list, with the measured exclusion budget that picked
  // their pre-scales): every row above is fold-only, so none of them
  // reaches the two POWER link kinds, the `kind < 4` guard that keeps them
  // out of the fold pair, or the chain-level `logEstimate` flag.
  const escapeSystemDefs: {
    name: string;
    transforms: Transform[];
    seed: number;
    symmetry?: SymmetryParams;
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
      name: "escSpherefoldPost",
      seed: 405,
      transforms: withSurfaceBenchPost([
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "spherefold", weight: 2 }],
        },
      ]),
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
    // The chain rows — escape-chain.harness.ts's own fixtures,
    // which is where their measured bound/step-violation and fill numbers
    // come from.
    {
      name: "escChainPair",
      seed: 406,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
    },
    {
      name: "escChainTriple",
      seed: 407,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
        {
          id: 2,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "spherefold", weight: 1.2 }],
        },
      ],
    },
    {
      name: "escChainKaleido",
      seed: 408,
      symmetry: { order: 5, plane: "xz" },
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
    },
    // The chain whose links carry DIFFERENT fold apparatus from
    // each other. `EscapeLink` holds its own `boxLimit`/`minRadius2`/
    // `fixedRadius2` resolved at build, and the two shader mirrors pack one
    // slot per link — so the case a per-DOCUMENT wire would pass and a
    // per-LINK one must not is exactly this: link 0 a mandelbox at
    // (0.375, 0.5, 0.75), link 1 a boxfold at wall 3. A kernel that read
    // link 0's radii for every step, or hoisted one set out of the cycle,
    // agrees with its oracle on every other escape row here, where the
    // links either share the classic set or there is only one link.
    //
    // Link 1's sphere pair is ABSENT on purpose, and it is the half of the
    // fixture that pins "absent means classic" ACROSS THE WIRE: a boxfold
    // reads no sphere radii, but the link still packs some, and they must
    // arrive as 0.5/1 (0.25/1 squared) rather than as zeros or as link 0's
    // 0.25/0.5. A per-link wire that zero-filled the fields its own fold
    // kind ignores would look correct until a chain mixed kinds.
    {
      name: "escChainParameterized",
      seed: 409,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [
            {
              type: "mandelbox",
              weight: 2,
              minRadius: 0.375,
              fixedRadius: 0.5,
              boxLimit: 0.75,
            },
          ],
        },
        {
          id: 1,
          position: [-0.1, 0.2, 0],
          rotation: [0.2, 0, 0.1],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 1.5, boxLimit: 3 }],
        },
      ],
    },
    // The CROSS-FAMILY rows. A link may now be one of two POWER
    // maps (`ESCAPE_LINK_BULB` 4, `ESCAPE_LINK_QSQUARE` 5) beside the three
    // folds, and every row above is fold-only — so all four of the
    // feature's moving parts are invisible to them: the kernels' `kind < 4`
    // GUARD (a power kind reaching the fold pair satisfies BOTH `!= 2` and
    // `!= 1` and silently runs both folds — escape-de.ts's EscapeLinkKind
    // doc names that hazard), the two power bodies and their local factors
    // (`8·|y|⁷`, `2·|y|`), and `EscapeDE.logEstimate` on the wire
    // (`escParams.w`, offset 268), which swaps the whole chain's estimate
    // from `r / dr` to the Böttcher form `0.5·r·ln r / dr`. A fold-only
    // chain packs 0 there, so the nine rows above ALSO pin that the flag
    // leaves them bit-identical.
    //
    // The four cover the power kinds in every chain POSITION, which is
    // what a `kind` read from the wrong slot would survive otherwise: the
    // first two put one in the TAIL (a kernel reading the params block's
    // frozen HEAD link for every step runs mandelbox twice and fails),
    // `escChainPowerMid` puts one BETWEEN two folds of different kinds in a
    // 3-cycle (so the guard is exercised per-link rather than per-system,
    // and the fold links' own radii lanes must still arrive intact past a
    // link that reads none), and `escChainBulbPair` is the two-power chain
    // the module doc calls "a genuinely new set" — the only row where a
    // power map is link 0, i.e. the one the head-link ballast agrees with.
    //
    // PRE-SCALES ARE MEASURED, not tuned by eye: a power link is stiff
    // (`escapeLinkStiffnessLimit`), so its `scale` is what keeps the object
    // off both walls — empty on one side, near-solid on the other. Measured
    // on the CPU oracle at these exact parameters (bailout-ball fill /
    // queries the ENSEMBLE classifier excludes of 700 / queries landing in
    // the mix's own `DE < 0.02` boundary shell), against the two fold-only
    // controls:
    //
    //   escMandelbox     (control)  fill 3.42%  excl  58  nearBnd 283
    //   escChainPair     (control)  fill 1.56%  excl  71  nearBnd 281
    //   escChainBulb                fill 7.71%  excl  72  nearBnd 106
    //   escChainQsquare             fill 6.18%  excl  57  nearBnd 285
    //   escChainPowerMid            fill 7.62%  excl   1  nearBnd 144
    //   escChainBulbPair            fill 9.57%  excl  22  nearBnd 300
    //
    // — every row inside `SURFACE_ESCAPE_EXCLUDED_CAP` (140) with room to
    // spare, and three of the four BELOW the fold controls. That is not
    // luck and it is worth writing down: a power orbit escapes
    // super-exponentially, so its membership decision is made in one or two
    // steps and there is far less of the marginal population the ensemble
    // classifier exists to bracket. The prediction going in was the
    // opposite (`8·r⁷` at r ~ 1.2 is ~27x per link against the folds' ~8x),
    // and it is wrong about the CLASSIFIER for the same reason cycling
    // rescued the stiff chains: the query re-enters after every link.
    //
    // HOW THAT TABLE WAS OBTAINED IS THE REUSABLE PART, and the next
    // person adding an escape fixture should start here rather than
    // guessing a parameter and running the GPU six times. The `excluded`
    // column costs NO GPU: `forwardQueryStable` compares this file's f32
    // twin against the f64 oracle and nothing else, so a candidate's
    // exclusion budget — the one number a new forward-orbit row can
    // plausibly fail its cap on — is a pure function of the fixture,
    // computable in about a second per candidate. Sweep the parameter on
    // the CPU, pick, and spend the bench run on the question only a real
    // driver can answer (`failures`, `chaoticFlips`, `maxAbsErr`). The
    // measured runs then confirmed the method rather than merely using
    // it: every `excluded` above came back IDENTICAL from both adapters.
    //
    // AND PICK FOR WHAT THE ROW TESTS, not for the smallest number. The
    // instructive rejection is `mbox2 -> bulb` at pre-scale 0.5: excl 10
    // — the cheapest candidate measured, five rows better than the one
    // shipped — but its object is small enough (fill 3.00%) that the
    // query mix's chord bisection lands only 16 of 700 queries in the
    // `DE < 0.02` shell, against 106 at 0.4. A nearly-free row that
    // samples the far field is worth less than a slightly dearer one that
    // samples the boundary, which is where a distance estimator is
    // actually hard. Pre-scale 0.3 was rejected from the other side (excl
    // 96, fill 25.77% — legal, and a richer object, but 96 of the 140
    // budget spent for it). The same two-sided read picked the others:
    // qsquare 0.4 over 0.5 (fill 6.18% vs 1.30%, nearBnd 285 vs 269, for
    // excl 57 vs 42) and the mid-chain bulb at 0.3 over 0.4 (fill 7.62%
    // vs 2.42% at excl 1 vs 40).
    //
    // AND THE ROWS THEMSELVES, MEASURED ON BOTH ADAPTERS (private w12
    // s2=off wg64, n=700 each; `--display=:0` real Iris Xe / gen-12lp
    // first, the default SwiftShader run second). fail / maxAbs / p99Abs /
    // excluded / verified chaotic flips:
    //
    //   escChainBulb      0  2.98e-6  8.52e-7  72  1  |  0  3.91e-6  9.54e-7  72  0
    //   escChainQsquare   0  7.70e-6  7.42e-7  57  0  |  0  7.70e-6  7.38e-7  57  0
    //   escChainPowerMid  0  2.51e-6  1.00e-6   1  0  |  0  7.43e-6  9.18e-7   1  0
    //   escChainBulbPair  0  1.53e-5  5.27e-6  22  3  |  0  1.74e-5  6.98e-6  22  0
    //
    // Both adapters gate CLEAN on all four, worst flip count 3 against
    // `SURFACE_ESCAPE_FLIP_CAP`'s 7 and worst exclusion 72 against 140, so
    // NO cap moved and none needed to (the cross-family work went in
    // expecting to have to argue for one). `excluded` is
    // adapter-INDEPENDENT by construction — the ensemble classifier is
    // CPU-only — and it duly reads identical in both columns, which is the
    // same cross-adapter identity the escChainKaleido false-failure
    // diagnosis leaned on. The real-Iris run is the one that judges these
    // rows (this file's standing advice for every forward-orbit leg); the
    // SwiftShader run's only failure is the pre-existing, known
    // SwiftShader-only `escChainKaleido` false failure (fail=5, flips=21,
    // maxAbs 1.333), reproduced here bit for bit and untouched by these
    // fixtures.
    {
      name: "escChainBulb",
      seed: 410,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          // The pre-scale IS the parameter here (escape-de.ts's POWER LINKS
          // ARE STIFF table): 0.4 sits mid-range of the measured 0.2-1.0
          // span where this chain renders, at 7.71% ball fill.
          scale: [0.4, 0.4, 0.4],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ],
    },
    {
      name: "escChainQsquare",
      seed: 411,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.4, 0.4, 0.4],
          variations: [{ type: "qsquare", weight: 1 }],
        },
      ],
    },
    {
      name: "escChainPowerMid",
      seed: 412,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.3, 0.3, 0.3],
          variations: [{ type: "bulb", weight: 1 }],
        },
        {
          id: 2,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "spherefold", weight: 1.2 }],
        },
      ],
    },
    {
      name: "escChainBulbPair",
      seed: 413,
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "bulb", weight: 1 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          // Rotated, or the two links would be the same map and the row
          // could not tell a cycle from a single map re-applied.
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "bulb", weight: 1 }],
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
      // The kaleidoscope row carries a symmetry, so both gate
      // and build take the def's own (the others default to order 1,
      // exactly as before).
      const symmetry = def.symmetry;
      const eligibility = analyzeEscapeSystem(def.transforms, null, symmetry);
      if (eligibility.status === "ineligible") {
        results.notes.push(
          `${def.name}: skipped — ${eligibility.reasons.join("; ")}`,
        );
      } else {
        const de = buildEscapeDE(def.transforms, null, symmetry);
        const queries = escapeQueries(de, def.seed);
        const cpu64 = queries.map((q) => estimateEscapeDistance(de, q));
        const cpu32 = queries.map((q) => estimateEscapeDistanceF32(de, q));
        const R = de.boundingRadius;
        // The f32-stability gate (compareSurfaceForwardAgreement's doc):
        // only queries the ENSEMBLE classifier (forwardQueryStable — the
        // fround twin at the query plus its six one-ULP neighbors, all
        // agreeing with the f64 oracle) enter the GPU comparison below.
        const stable = cpu64.map((c64, i) =>
          forwardQueryStable(
            (q) => estimateEscapeDistanceF32(de, q),
            queries[i],
            c64,
            surfaceEvalTol(c64, R),
          ),
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
  const escapePostSystem = escapeSystems.find(
    (system) => system.name === "escSpherefoldPost",
  );
  if (
    escapePostSystem?.de.links.length !== 1 ||
    escapePostSystem.de.links[0].kind !== ESCAPE_LINK_SPHEREFOLD ||
    escapePostSystem.de.links[0].postM === null
  ) {
    throw new Error(
      "required post-affine escape fixture escSpherefoldPost did not build live",
    );
  }

  // ----- Escape4 systems: the escape gate's 4D HALF -----------
  // `analyzeEscapeSystem4` is `analyzeEscapeSystem` with the flatness
  // clause removed and a `bulb` refusal added, so these systems are
  // refused by BOTH 3D gates above (each carries a map that reaches out of
  // the `w = 0` slice) and by `analyzeSurfaceSystem4` (they do not all
  // contract) — a fourth separate gate, and therefore a fourth defs list,
  // query generator, state array and leg. They sit here rather than beside
  // the affine4/fold4 fixtures because what they share is the ORBIT, not
  // the dimension: the whole file's forward-orbit machinery
  // (`forwardQueryStable`, `forwardShadowFlipVerified`,
  // `compareSurfaceForwardAgreement`, `ensureSurfaceForwardEvalBuffers`)
  // serves them unchanged.
  //
  // Each def freezes its own view (rotor + `w0`; `sliceHalfW` is always 0
  // — `packEscape4GpuParams` throws otherwise, because a forward orbit
  // cannot thread a segment). SIX systems, each carrying exactly one thing
  // the others cannot see:
  //
  //   esc4ChainWRot          the headline shape — a two-link fold chain
  //                          whose tail link ROTATES into `w` (`xw` 0.35).
  //                          Identity view, so the orbit is the only 4D
  //                          thing in the row.
  //   esc4SpherefoldPost     a single radial fold with the live post plus a
  //                          small xw rotation, so this row pins the forward
  //                          post wire on a genuinely 4D orbit without the
  //                          Mandelbox's f32-chaotic box seams.
  //   esc4ChainQsquare       the FULL quaternion square beside a fold, at a
  //                          nonzero `w` TRANSLATION (the quaternion `k`
  //                          component), under a NON-IDENTITY rotor. The
  //                          only row with `logEstimate` true, so it is
  //                          also the one that pins `esc4Params.x`.
  //   esc4ChainKaleido       an order-5 kaleidoscope in the `xw` PLANE —
  //                          the one thing the 3D leg structurally cannot
  //                          reach (`analyzeEscapeSystem` refuses a
  //                          kaleidoscope that rotates into 4D), and the
  //                          only user of `SYM_PLANE_CODE4`'s six-plane
  //                          code.
  //   esc4ChainSlice         a nonzero `w0` at the IDENTITY rotor.
  //   esc4ChainSliceRot      the same system at a nonzero `w0` AND a
  //                          non-identity rotor — the CROSS term, and not
  //                          redundant: a kernel that added `w0` to the
  //                          lifted `w` component after the rotor instead
  //                          of inside it passes both single-term rows and
  //                          fails only this one (measured, on
  //                          `liftEscape4F32`'s doc).
  //
  // THE FIXTURE PARAMETERS ARE MEASURED, by the cross-family rows' method:
  // `excluded` is a pure function of the fixture and costs NO GPU (the
  // ensemble classifier compares this file's f32 twin against the f64
  // oracle and nothing else), so the budget was swept on the CPU first and
  // the fixtures picked out of it. Bailout-ball fill (`probeEscapeFill4`,
  // the 4-ball) / ensemble exclusions of 700 / queries landing in the
  // mix's own `DE < 0.02` boundary shell, against the 3D controls for
  // scale:
  //
  //   escMandelbox        (3D control)  fill 3.42%  excl  58  nearBnd 283
  //   escChainPair        (3D control)  fill 1.56%  excl  71  nearBnd 281
  //   esc4ChainWRot                     fill 0.66%  excl  78  nearBnd 176
  //   esc4ChainQsquare                  fill 1.73%  excl  58  nearBnd 163
  //   esc4ChainKaleido                  fill 0.68%  excl  69  nearBnd 174
  //   esc4ChainSlice                    fill 0.46%  excl  44  nearBnd 171
  //   esc4ChainSliceRot                 fill 0.46%  excl  70  nearBnd 178
  //
  // — every measured row inside `SURFACE_ESCAPE_EXCLUDED_CAP` (140) with
  // room to spare, and in the same band as the 3D controls. The new posted
  // spherefold replaces a posted parameterized Mandelbox chain that excluded
  // 250/700 even with a smaller post; changing field class preserves the
  // classifier rather than weakening it. Like its 3D twin it is deliberately
  // a POST-WIRE row rather than a boundary-shape datum (0/700 samples below
  // DE 0.02). Omitting its post from the f32 twin produced 290 base-orbit
  // exclusions (117 uniform + 73 bisection + all 100 origin-cluster); applying
  // the post returns it to 0/700 without a special comparator. The existing
  // f64-oracle gate therefore stays unchanged. `esc4ChainQsquare`'s 0.4
  // pre-scale is `escChainQsquare`'s own, re-measured here rather than inherited
  // (0.5 reads fill 0.29%/nearBnd 151, 0.3 reads 8.50%/nearBnd 158 at excl 61).
  const escape4SystemDefs: {
    name: string;
    transforms: Transform[];
    seed: number;
    symmetry?: SymmetryParams;
    view4: (de: EscapeDE4) => SurfaceGpu4View;
  }[] = [
    {
      name: "esc4ChainWRot",
      seed: 801,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          // The 4D degree of freedom this whole module exists for: the
          // tail link rotates x toward w, so the orbit leaves the `w = 0`
          // hyperplane even though the query never does.
          w: { rotation: { xw: 0.35 } },
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
      view4: () => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "esc4SpherefoldPost",
      seed: 802,
      transforms: withSurfaceBenchPost([
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          w: { rotation: { xw: 0.12 } },
          variations: [{ type: "spherefold", weight: 2 }],
        },
      ]),
      view4: () => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "esc4ChainQsquare",
      seed: 803,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          // The pre-scale IS the parameter for a power link (escape-de.ts's
          // POWER LINKS ARE STIFF table); the `w` translation is the `k`
          // component the k-sweep measured, and it is what makes this FULL
          // quaternion square rather than its `w = 0` restriction — the
          // orbit's `w` lane is nonzero from the first step.
          scale: [0.4, 0.4, 0.4],
          w: { position: 0.35 },
          variations: [{ type: "qsquare", weight: 1 }],
        },
      ],
      // The non-identity rotor lives on this row because it is the one
      // whose orbit already exercises every `w` lane — a rotor that
      // scrambles the lifted query cannot hide behind a `w`-inert map here.
      view4: () => ({
        rotor: symmetryRotation4("xw", 0.6),
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "esc4ChainKaleido",
      seed: 804,
      // A `w`-PLANE wedge fold: `analyzeEscapeSystem` refuses this outright
      // ("the kaleidoscope rotates into 4D"), so no 3D row can reach
      // `SYM_PLANE_CODE4`'s codes 3..5 or the fold's `w` axis.
      symmetry: { order: 5, plane: "xw" },
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          w: { rotation: { xw: 0.3 } },
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
      view4: () => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0,
      }),
    },
    {
      name: "esc4ChainSlice",
      seed: 805,
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          w: { rotation: { yw: 0.4 }, position: 0.2 },
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
      // `w0` alone, at the identity rotor — the prologue's other term, on
      // its own so a failure names it.
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.2 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "esc4ChainSliceRot",
      seed: 806,
      // Deliberately `esc4ChainSlice`'s system verbatim: the two rows
      // differ in the VIEW alone, which is what makes the pair a
      // controlled A/B on the prologue rather than two unrelated fixtures.
      transforms: [
        {
          id: 0,
          position: [0.4, 0.3, 0.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
        },
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, (20 * Math.PI) / 180, 0],
          scale: [1, 1, 1],
          w: { rotation: { yw: 0.4 }, position: 0.2 },
          variations: [{ type: "boxfold", weight: 1.6 }],
        },
      ],
      view4: (de) => ({
        rotor: symmetryRotation4("zw", 0.5),
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
  ];
  const escape4Systems: SurfaceEscape4SystemState[] = [];
  for (const def of escape4SystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface escape4 CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    try {
      const symmetry = def.symmetry;
      const eligibility = analyzeEscapeSystem4(def.transforms, null, symmetry);
      if (eligibility.status === "ineligible") {
        results.notes.push(
          `${def.name}: skipped — ${eligibility.reasons.join("; ")}`,
        );
      } else {
        const de = buildEscapeDE4(def.transforms, null, symmetry);
        const view4 = def.view4(de);
        const queries = escape4Queries(de, view4, def.seed);
        // Both oracles see the query through the SAME view lift the kernel
        // applies — f64 here, f32 in the twin (estimateEscape4Composed's
        // doc). The lift rides INSIDE the f32 closure because the
        // classifier's ULP walks perturb the 3D marched point.
        const cpu64 = queries.map((q) => estimateEscape4Composed(de, view4, q));
        const evalF32 = (q: Vec3): number =>
          estimateEscapeDistance4F32(de, liftEscape4F32(view4, q));
        const cpu32 = queries.map(evalF32);
        const R = de.boundingRadius;
        // The identical seven-orbit ensemble gate the 3D escape leg uses.
        const stable = cpu64.map((c64, i) =>
          forwardQueryStable(evalF32, queries[i], c64, surfaceEvalTol(c64, R)),
        );
        escape4Systems.push({
          name: def.name,
          de,
          view4,
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
  const escape4PostSystem = escape4Systems.find(
    (system) => system.name === "esc4SpherefoldPost",
  );
  if (
    escape4PostSystem?.de.links.length !== 1 ||
    escape4PostSystem.de.links[0].kind !== ESCAPE_LINK_SPHEREFOLD ||
    escape4PostSystem.de.links[0].postM === null ||
    ![3, 7, 11, 12, 13, 14].some(
      (i) => escape4PostSystem.de.links[0].m[i] !== 0,
    )
  ) {
    throw new Error(
      "required post-affine escape4 fixture esc4SpherefoldPost did not build live",
    );
  }

  // ----- Mandelbulb systems: the escape gate's SIBLING -----
  // `analyzeBulbSystem` admits exactly one shape — a lone pure triplex
  // power at weight 1, flat, non-singular, no final, no kaleidoscope — and
  // both `buildSurfaceDE` and `analyzeEscapeSystem` refuse it, so like the
  // escape systems these carry their own defs, query generator and leg.
  // FOUR systems, and the third is the load-bearing one: `dr` seeds at
  // `sigma_max(M)` and its recurrence's trailing term is `+ sigma_max(M)`,
  // so on an IDENTITY or ROTATION map (sigmaMax = 1) dropping either term
  // is a BIT-EXACT no-op that passes the whole suite — the mutation the
  // quaternion-Julia oracle shipped undetected one object over.
  // `bulbScaled` is the uniformly scaled fixture (s = 1.3 > 1) that makes
  // both visible; `bulbRotAniso` additionally separates sigmaMax from
  // sigmaMin (the escape radius reads min, the derivative reads max) under
  // an off-axis M, the deliberately-worst archetype this family's
  // `escMandelboxRot` plays one object over.
  const bulbSystemDefs: {
    name: string;
    transforms: Transform[];
    seed: number;
  }[] = [
    {
      name: "bulbClassic",
      seed: 601,
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ],
    },
    {
      name: "bulbOffset",
      seed: 602,
      transforms: [
        {
          id: 0,
          position: [0.35, -0.2, 0.15],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ],
    },
    {
      name: "bulbScaled",
      seed: 603,
      transforms: [
        {
          id: 0,
          position: [0.12, -0.05, 0.08],
          rotation: [0, 0, 0],
          scale: [1.3, 1.3, 1.3],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ],
    },
    {
      name: "bulbRotAniso",
      seed: 604,
      transforms: [
        {
          id: 0,
          position: [0.2, -0.15, 0.1],
          rotation: [0.3, 0.2, 0.5],
          scale: [1.15, 0.85, 1],
          variations: [{ type: "bulb", weight: 1 }],
        },
      ],
    },
  ];
  const bulbSystems: SurfaceBulbSystemState[] = [];
  for (const def of bulbSystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface bulb CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    try {
      const eligibility = analyzeBulbSystem(def.transforms);
      if (eligibility.status === "ineligible") {
        results.notes.push(
          `${def.name}: skipped — ${eligibility.reasons.join("; ")}`,
        );
      } else {
        const de = buildBulbDE(def.transforms);
        const queries = bulbQueries(de, def.seed);
        const cpu64 = queries.map((q) => estimateBulbDistance(de, q));
        const cpu32 = queries.map((q) => estimateBulbDistanceF32(de, q));
        const R = de.boundingRadius;
        // The identical seven-orbit ensemble gate the escape leg uses —
        // the fround twin at the query plus its six one-ULP neighbors,
        // all agreeing with the f64 oracle.
        const stable = cpu64.map((c64, i) =>
          forwardQueryStable(
            (q) => estimateBulbDistanceF32(de, q),
            queries[i],
            c64,
            surfaceEvalTol(c64, R),
          ),
        );
        bulbSystems.push({
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

  // ----- Affine4 (4D) systems (M3): a THIRD separate gate -----
  // `buildSurfaceDE` has no 4D shape at all — these systems live behind
  // `analyzeSurfaceSystem4`/`buildSurfaceDE4` and the kernel's view lift,
  // so like the escape leg they carry their own defs, query generator,
  // comparator and (M3 below) leg. Each def freezes its own view (rotor +
  // w0 + sliceHalfW), built AFTER the DE so w0/h can scale from the probed
  // radius; together the four cover the pure DE at the identity view, the
  // 4D double-rotation sector sweep at a nonzero w0, the 4D final
  // lens under a w-mixing pose rotor, and the slab query (every
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
      name: "aff4PostFinal",
      seed: 503,
      transforms: withSurfaceBenchPost(surfaceAff4FinalBase()),
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
      transforms: withSurfaceBenchPost(surfaceAff4Tetra()),
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
  const aff4PostFinalSystem = affine4Systems.find(
    (system) => system.name === "aff4PostFinal",
  );
  const aff4SlabSystem = affine4Systems.find(
    (system) => system.name === "aff4Slab",
  );
  if (
    !aff4PostFinalSystem?.de.maps.some((map) => map.postInvM !== null) ||
    aff4PostFinalSystem.de.final === null ||
    affine4SystemDefs.find((def) => def.name === "aff4PostFinal")
      ?.finalTransform?.post === undefined
  ) {
    throw new Error("required affine4 map/final post fixture is not live");
  }
  if (
    !aff4SlabSystem?.de.maps.some((map) => map.postInvM !== null) ||
    !(aff4SlabSystem.view4.sliceHalfW > 0)
  ) {
    throw new Error("required affine4 post+slab fixture is not live");
  }

  // The same shipped fixture flat-lifted to 4D. Identity rotor, w0=0 and
  // zero slab thickness make this a direct 3D-to-4D lift while still
  // executing affine4's schedule-aware descent and packing contracts.
  status(`cpu oracle: ${SURFACE_SCHEDULE_ROW_4D}…`);
  activity.setState("cpu", "Surface scheduled CPU oracle — flat 4D");
  await new Promise<void>((resolve) => setTimeout(resolve));
  const scheduledDe4 = buildSurfaceDE4(
    scheduledTransforms,
    null,
    SURFACE_NO_SYMMETRY,
    { schedule: scheduledHybrid },
  );
  const scheduledSpec4 = surfaceScheduleKernelSpec(scheduledDe4);
  if (scheduledSpec4.mapCount + scheduledSpec4.scheduleMapCount !== 24) {
    throw new Error(
      `scheduled flat-4D Surface bench fixture must occupy 24 map records, got ${String(
        scheduledSpec4.mapCount + scheduledSpec4.scheduleMapCount,
      )}`,
    );
  }
  const scheduledView4: SurfaceGpu4View = {
    rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w0: 0,
    sliceHalfW: 0,
  };
  // Reuse the 3D row's schedule-aware cloud queries verbatim. This makes
  // the row a controlled dimensional-parity check at the exact same f32
  // points, while avoiding affine4Queries' deliberately ULP-tight boundary
  // bisections: with 20 outer B maps those engineered points densely park
  // on beam-selection discontinuities, where pointwise f32/f64 comparison
  // is not a meaningful kernel-accuracy question. The 3D scheduled march
  // leg separately gates the actual near-surface ray trajectory.
  const scheduledQueries4 = scheduledQueries;
  const scheduledCpu4 = scheduledQueries4.map((q) =>
    estimateSurface4Composed(scheduledDe4, scheduledView4, q),
  );
  const scheduledR4 = surface4ToleranceR(scheduledDe4);
  const scheduledSystem4: Surface4SystemState = {
    name: SURFACE_SCHEDULE_ROW_4D,
    de: scheduledDe4,
    view4: scheduledView4,
    transforms: scheduledTransforms,
    queries: scheduledQueries4,
    cpu: scheduledCpu4,
    stable: scheduledCpu4.map((c, i) =>
      surface4QueryStable(
        scheduledDe4,
        scheduledView4,
        scheduledQueries4[i],
        c,
        surfaceEvalTol(c, scheduledR4),
      ),
    ),
  };
  render();

  // Flat 4D lift of the identical graph and the identical 3D f32 queries.
  // Reusing the query set keeps this a controlled dimensional-parity row
  // and avoids moving boundary probes onto a different beam-selection seam.
  status(`cpu oracle: ${SURFACE_CHAOS_ROW_4D}…`);
  activity.setState("cpu", "Surface xaos CPU oracle — flat 4D");
  await new Promise<void>((resolve) => setTimeout(resolve));
  const chaosDe4 = buildSurfaceDE4(chaosTransforms, null, SURFACE_NO_SYMMETRY);
  const chaosSpec4 = surfaceChaosKernelSpec(chaosDe4);
  if (chaosDe4.maps.length !== 24 || chaosSpec4.activeStateCount !== 24) {
    throw new Error(
      `xaos flat-4D Surface bench fixture must expose 24 active maps/states, got ` +
        `${String(chaosDe4.maps.length)}/${String(chaosSpec4.activeStateCount)}`,
    );
  }
  const chaosView4: SurfaceGpu4View = {
    rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w0: 0,
    sliceHalfW: 0,
  };
  const chaosQueries4 = chaosQueries;
  const chaosCpu4 = chaosQueries4.map((q) =>
    estimateSurface4Composed(chaosDe4, chaosView4, q),
  );
  const chaosR4 = surface4ToleranceR(chaosDe4);
  const chaosSystem4: Surface4SystemState = {
    name: SURFACE_CHAOS_ROW_4D,
    de: chaosDe4,
    view4: chaosView4,
    transforms: chaosTransforms,
    queries: chaosQueries4,
    cpu: chaosCpu4,
    stable: chaosCpu4.map((c, i) =>
      surface4QueryStable(
        chaosDe4,
        chaosView4,
        chaosQueries4[i],
        c,
        surfaceEvalTol(c, chaosR4),
      ),
    ),
  };
  render();

  // M4: the FOLD4 core's own fixed fixture family — the same
  // "def-time eligibility gate throws" idiom as affine4SystemDefs above,
  // for the same reason (fixed fixtures; an ineligible one is a bench bug).
  // Four systems (a fifth for the authored lengths — see its own comment
  // below), each `surfaceFold4Boxfold`/`surfaceFold4Mandelbox`
  // (`surface-de-4d.test.ts`'s own fixtures verbatim, so bench and CPU
  // tests pin the identical systems) under a different view/symmetry: the
  // pure DE at a nonzero w0 (fold4Boxfold), the widest fold class at the
  // same view (fold4Mandelbox, 243 branches per map), the 4D kaleidoscope
  // sweep through fold branches (fold4Kaleido), and the slab query
  // threaded through them (fold4Slab, every ext register live). `null`
  // finalTransform always — fold4 FINAL lenses are the LATER phase, out of
  // this cut (surface-de-gpu.ts's module doc).
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
      transforms: withSurfaceBenchPost(surfaceFold4Boxfold()),
      view4: (de) => ({
        rotor: symmetryRotation4("yw", 0.55),
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0.1 * de.boundingRadius,
      }),
    },
    // The fold's AUTHORED lengths one dimension up (see
    // surfaceFold4Parameterized's doc), plus the family's live post-affine
    // coverage. Viewed at the same nonzero w0 as fold4Boxfold/fold4Mandelbox
    // above.
    {
      name: "fold4ParameterizedPost",
      seed: 525,
      transforms: withSurfaceBenchPost(surfaceFold4Parameterized()),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.2 * de.boundingRadius,
        sliceHalfW: 0,
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
  for (const required of ["fold4Slab", "fold4ParameterizedPost"]) {
    const system = fold4Systems.find(
      (candidate) => candidate.name === required,
    );
    if (
      !system?.de.maps.some((map) => map.postInvM !== null) ||
      (required === "fold4Slab" && !(system.view4.sliceHalfW > 0))
    ) {
      throw new Error(`required fold4 post fixture ${required} is not live`);
    }
  }

  // The 4D LENS fixture family (M5 below) — a fold FINAL
  // over the affine4/fold4 fixtures' own base shapes, `descendLens4`'s
  // branch sweep exercised one dimension up. Same "def-time eligibility
  // gate throws" idiom as affine4SystemDefs/fold4SystemDefs above (fixed
  // fixtures; an ineligible one is a bench bug, not a leg quietly running
  // short). The base for the affine-ladder trio is `pentatope()` —
  // `surface-de-4d.test.ts`'s lens suite uses it throughout ("Base
  // transforms are pentatope() ... 4D's analogue of 3D's
  // sierpinskiTetrahedron() base"), so bench and CPU tests pin the same
  // lensed systems, exactly like `fold4Boxfold` already pins
  // `pureBoxfoldPair4` verbatim.
  //
  // Three systems wrap the REFINED affine4 ladder: `pentatope()` carries no
  // fold maps of its own (`deHasFolds4` false), so `descendLens4`'s root
  // descents run the plain ladder and the lens mirrors
  // `estimateDistance4Refined` — `lens4BoxPostOverAffine` (the posted
  // boxfold lens over a posted base at the shipped identity-rotor view),
  // `lens4MandelboxOverAffine` (the unposted 243-branch mandelbox lens fan,
  // this leg's widest per-query branch count), and `lens4Slab` (the SAME
  // boxfold lens re-viewed through
  // `aff4Slab`'s exact slab — boxfold-only on both the base, trivially
  // true here, and the lens keeps `slabExact4` true, so the slab's
  // segment machinery rides through the lens too). The fourth,
  // `lens4BoxOverFold`, wraps the FOLD frontier instead: the same boxfold
  // lens over `fold4Boxfold`'s own pair (`pureBoxfoldPair4`, fold maps at
  // the base), so `descendLens4`'s root descents route through
  // `descendFold4` and the lens mirrors PLAIN `estimateDistance4` — the
  // M4 fold row's estimator, one lens over.
  const lens4AffineSystemDefs: {
    name: string;
    seed: number;
    transforms: Transform[];
    finalTransform: Transform;
    view4: (de: SurfaceDE4) => SurfaceGpu4View;
  }[] = [
    {
      name: "lens4BoxPostOverAffine",
      seed: 541,
      transforms: withSurfaceBenchPost(pentatope()),
      finalTransform: surfaceLens4BoxfoldFinal(),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "lens4MandelboxOverAffine",
      seed: 542,
      transforms: pentatope(),
      finalTransform: surfaceLens4MandelboxFinal(),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "lens4Slab",
      seed: 543,
      transforms: pentatope(),
      finalTransform: surfaceLens4BoxfoldFinal(),
      view4: (de) => ({
        rotor: symmetryRotation4("yw", 0.55),
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0.1 * de.boundingRadius,
      }),
    },
    {
      name: "lens4SwirlPostOverAffine",
      seed: 544,
      transforms: withSurfaceBenchPost(pentatope()),
      finalTransform: surfaceLensSwirlFinal(true),
      view4: (de) => ({
        rotor: symmetryRotation4("xw", 0.4),
        w0: 0.08 * de.visibleBoundingRadius,
        sliceHalfW: 0,
      }),
    },
  ];
  const lens4AffineSystems: Surface4SystemState[] = [];
  for (const def of lens4AffineSystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface lens4 CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    const eligibility = analyzeSurfaceSystem4(
      def.transforms,
      def.finalTransform,
    );
    if (eligibility.status === "ineligible") {
      throw new Error(
        `lens4 bench fixture ${def.name} is ineligible: ` +
          eligibility.reasons.join("; "),
      );
    }
    const de = buildSurfaceDE4(def.transforms, def.finalTransform);
    if (de.foldFinal === null) {
      throw new Error(
        `lens4 bench fixture ${def.name} did not build a fold-final lens ` +
          "(regressed to an affine final, or none at all)",
      );
    }
    const view4 = def.view4(de);
    const queries = affine4Queries(de, view4, def.seed);
    const cpu = queries.map((q) => estimateSurface4Composed(de, view4, q));
    const R = surface4ToleranceR(de);
    const stable = cpu.map((c, i) =>
      surface4QueryStable(de, view4, queries[i], c, surfaceEvalTol(c, R)),
    );
    lens4AffineSystems.push({
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

  // The ONE lens4 system that wraps the FOLD frontier —
  // see the block comment above for why this def is separate from
  // lens4AffineSystemDefs (a different base, a different core, a
  // different CPU estimator — `estimateDistance4` plain, not refined).
  const lens4FoldSystemDefs: {
    name: string;
    seed: number;
    transforms: Transform[];
    finalTransform: Transform;
    view4: (de: SurfaceDE4) => SurfaceGpu4View;
  }[] = [
    {
      name: "lens4BoxOverFold",
      seed: 551,
      transforms: surfaceFold4Boxfold(),
      finalTransform: surfaceLens4BoxfoldFinal(),
      view4: (de) => ({
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0.15 * de.boundingRadius,
        sliceHalfW: 0,
      }),
    },
    {
      name: "lens4SwirlPostOverFold",
      seed: 552,
      transforms: surfaceFold4Boxfold(),
      finalTransform: surfaceLensSwirlFinal(true),
      view4: (de) => ({
        // The previous yw/.08R slice lay in a gap in this sparse attractor.
        // This tilted, nonzero-w cut gives six CPU hits at the fixed 96x54
        // agreement raster, with zero exhausted rays plain and with Balloon.
        rotor: symmetryRotation4("zw", 1.4),
        w0: -0.275 * de.visibleBoundingRadius,
        sliceHalfW: 0,
      }),
    },
  ];
  const lens4FoldSystems: Surface4SystemState[] = [];
  for (const def of lens4FoldSystemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface lens4 CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    const eligibility = analyzeSurfaceSystem4(
      def.transforms,
      def.finalTransform,
    );
    if (eligibility.status === "ineligible") {
      throw new Error(
        `lens4 bench fixture ${def.name} is ineligible: ` +
          eligibility.reasons.join("; "),
      );
    }
    const de = buildSurfaceDE4(def.transforms, def.finalTransform);
    if (de.foldFinal === null) {
      throw new Error(
        `lens4 bench fixture ${def.name} did not build a fold-final lens ` +
          "(regressed to an affine final, or none at all)",
      );
    }
    if (!deHasFolds4(de)) {
      throw new Error(
        `lens4 bench fixture ${def.name} has no base fold maps — ` +
          "descendLens4 would route through the plain ladder, not " +
          "descendFold4, pinning the wrong estimator",
      );
    }
    const view4 = def.view4(de);
    // refined=false throughout: this system's lens wraps descendFold4, so
    // both the query mix's boundary bisection and the CPU oracle values
    // below use the PLAIN estimateDistance4 (estimateSurface4Composed's
    // doc) — the fold4SystemDefs loop's convention, one lens over.
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
    lens4FoldSystems.push({
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
  const lens4BoxPostSystem = lens4AffineSystems.find(
    (system) => system.name === "lens4BoxPostOverAffine",
  );
  if (
    !lens4BoxPostSystem?.de.maps.some((map) => map.postInvM !== null) ||
    lens4BoxPostSystem.de.foldFinal?.postInvM === null ||
    lens4BoxPostSystem.de.foldFinal?.postInvM === undefined
  ) {
    throw new Error("required lens4 map/lens post fixture is not live");
  }
  for (const system of [...lens4AffineSystems, ...lens4FoldSystems]) {
    if ((system.de.foldFinal?.postInvM ?? null) === null) {
      throw new Error(
        `required lens4 post fixture ${system.name} did not build live`,
      );
    }
  }

  // Lens systems are their own leg: `lens` is a per-SYSTEM kernel option
  // (the wrapper is generated source), while the fold/affine legs share
  // one pipeline per CONFIG — a lens system run through those pipelines
  // would march the bare base attractor and disagree with its own oracle.
  const foldSystems = systems.filter(
    (s) =>
      s.core === "fold" &&
      s.de.foldFinal === null &&
      s.de.condensation === undefined,
  );
  const affineSystems = systems.filter(
    (s) =>
      s.core === "affine" &&
      s.de.foldFinal === null &&
      s.de.condensation === undefined,
  );
  const lensSystems = systems.filter(
    (s) => s.de.foldFinal !== null && s.de.condensation === undefined,
  );
  const swirlSystems: SurfaceMarchSystem[] = [
    ...lensSystems,
    ...lens4AffineSystems,
    ...lens4FoldSystems,
  ].filter((sys) => sys.de.foldFinal?.swirlRadius !== undefined);
  if (swirlSystems.length !== 4) {
    throw new Error(
      "required swirl fixture matrix must contain all four base cores",
    );
  }
  const condensationSystems = systems.filter(
    (s) => s.de.condensation !== undefined,
  );
  if (systems.length === 0) {
    results.reason = "no eligible systems (see notes)";
    status(`skipped — ${results.reason}`);
    activity.setState("idle", "Done");
    render();
    return results;
  }

  // The finite-tiling agreement scenarios are deliberately compact: three
  // named points per core, enough to cross a chamber wall, activate the
  // analytic clip, and make F4's w-bearing fourth root live. They compare
  // against tiling-de.ts after real compile + bind + dispatch. Keeping the
  // params buffers at their exact packer byteLength is also the point — a
  // 4-byte tail fails because WGSL rounds Params to 16-byte alignment.
  const tiling3 = resolveTiling({ group: "b3", clip: PEACE_SIGN_SHAPE })!;
  const tiling4 = resolveTiling({ group: "f4", clip: PEACE_SIGN_SHAPE })!;
  const requireSystem = <T>(family: string, list: readonly T[]): T => {
    const first = list[0];
    if (!first) {
      throw new Error(`finite-tiling ABI fixture is missing ${family}`);
    }
    return first;
  };
  const tilingAffine = requireSystem("affine", affineSystems);
  const tilingFold = requireSystem("fold", foldSystems);
  const tilingEscape = requireSystem("escape", escapeSystems);
  const tilingBulb = requireSystem("bulb", bulbSystems);
  const tilingAffine4 = requireSystem("affine4", affine4Systems);
  const tilingFold4 = requireSystem("fold4", fold4Systems);
  const tilingEscape4 = requireSystem("escape4", escape4Systems);
  const tilingQueries: Vec3[] = (
    [
      [-0.75, 0.4, -0.2], // B3 root 0 is violated: a real chamber crossing.
      [2.5, 1.7, -1.3], // Well outside the Peace-sign clip: clip max is live.
      [0.2, -0.8, 0.9], // F4 root 3 couples this z to the nonzero w below.
    ] as Vec3[]
  ).map((q) => q.map(Math.fround) as Vec3);
  const tilingAffine4View: SurfaceGpu4View = {
    ...tilingAffine4.view4,
    w0: 0.37 * tilingAffine4.de.boundingRadius,
    sliceHalfW: 0,
  };
  const tilingFold4View: SurfaceGpu4View = {
    ...tilingFold4.view4,
    w0: 0.37 * tilingFold4.de.boundingRadius,
    sliceHalfW: 0,
  };
  const tilingEscape4View: SurfaceGpu4View = {
    ...tilingEscape4.view4,
    w0: 0.37 * tilingEscape4.de.boundingRadius,
    sliceHalfW: 0,
  };
  const liftTiling4 = (view: SurfaceGpu4View, q: Vec3): Vec4 => {
    const rot = view.rotor;
    return [0, 1, 2, 3].map(
      (i) =>
        rot[i] * q[0] +
        rot[4 + i] * q[1] +
        rot[8 + i] * q[2] +
        rot[12 + i] * view.w0,
    ) as Vec4;
  };
  const tilingAbiSpecs: SurfaceTilingAbiSpec[] = [
    {
      name: "affine-b3",
      core: "affine",
      tiling: tiling3,
      params: packSurfaceGpuParams(
        tilingAffine.de,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling3,
      ),
      maps: new Float32Array(packSurfaceGpuMaps(tilingAffine.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateDistanceRefinedTiled(tiling3, tilingAffine.de, q),
      ),
      toleranceRadius: tilingAffine.de.boundingRadius,
    },
    {
      name: "fold-b3",
      core: "fold",
      tiling: tiling3,
      params: packSurfaceGpuParams(
        tilingFold.de,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling3,
      ),
      maps: new Float32Array(packSurfaceGpuMaps(tilingFold.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateDistanceTiled(tiling3, tilingFold.de, q),
      ),
      toleranceRadius: tilingFold.de.boundingRadius,
    },
    {
      name: "escape-b3",
      core: "escape",
      tiling: tiling3,
      params: packEscapeGpuParams(
        tilingEscape.de,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling3,
      ),
      maps: new Float32Array(packEscapeGpuMaps(tilingEscape.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateEscapeDistanceTiled(tiling3, tilingEscape.de, q),
      ),
      toleranceRadius: tilingEscape.de.boundingRadius,
    },
    {
      name: "bulb-b3",
      core: "bulb",
      tiling: tiling3,
      params: packBulbGpuParams(
        tilingBulb.de,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling3,
      ),
      // Bulb has no maps declaration; one inert stride satisfies the
      // shared explicit layout, exactly as its full agreement leg does.
      maps: new Float32Array(SURFACE_GPU_MAP_VEC4 * 4),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateBulbDistanceTiled(tiling3, tilingBulb.de, q),
      ),
      toleranceRadius: tilingBulb.de.boundingRadius,
    },
    {
      name: "affine4-f4",
      core: "affine4",
      tiling: tiling4,
      params: packSurface4GpuParams(
        tilingAffine4.de,
        tilingAffine4View,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling4,
      ),
      maps: new Float32Array(packSurfaceGpuMaps4(tilingAffine4.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateDistance4RefinedTiled(
          tiling4,
          tilingAffine4.de,
          liftTiling4(tilingAffine4View, q),
        ),
      ),
      toleranceRadius: surface4ToleranceR(tilingAffine4.de),
    },
    {
      name: "fold4-f4",
      core: "fold4",
      tiling: tiling4,
      params: packSurface4GpuParams(
        tilingFold4.de,
        tilingFold4View,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling4,
      ),
      maps: new Float32Array(packSurfaceGpuMaps4(tilingFold4.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateDistance4Tiled(
          tiling4,
          tilingFold4.de,
          liftTiling4(tilingFold4View, q),
        ),
      ),
      toleranceRadius: surface4ToleranceR(tilingFold4.de),
    },
    {
      name: "escape4-f4",
      core: "escape4",
      tiling: tiling4,
      params: packEscape4GpuParams(
        tilingEscape4.de,
        tilingEscape4View,
        { itemCount: tilingQueries.length },
        null,
        null,
        tiling4,
      ),
      maps: new Float32Array(packEscape4GpuMaps(tilingEscape4.de)),
      queries: tilingQueries,
      cpu: tilingQueries.map((q) =>
        estimateEscapeDistance4Tiled(
          tiling4,
          tilingEscape4.de,
          liftTiling4(tilingEscape4View, q),
        ),
      ),
      toleranceRadius: tilingEscape4.de.boundingRadius,
    },
  ];

  // The mirrored-lattice twin uses one system-owned resolved block per core:
  // its h derives from that estimator's exact authority radius, so sharing a
  // single 3D/4D object here would itself violate the wire contract. Each
  // three-query row lands on, immediately before, and immediately after an
  // x seam. The 4D views rotate that visible x coordinate into attractor w,
  // making the lattice's fourth folded axis numerically live too.
  const latticeFor = (radius: number) =>
    resolveTiling(
      { kind: "lattice", cellScale: 1.25, clip: PEACE_SIGN_SHAPE },
      radius,
    );
  const latticeQueriesFor = (h: number, radius: number): Vec3[] => {
    const seamEps = h / 32;
    return [h, h - seamEps, h + seamEps].map(
      (x) =>
        [
          Math.fround(x),
          Math.fround(-0.11 * radius),
          Math.fround(0.17 * radius),
        ] as Vec3,
    );
  };
  const latticeView4 = (radius: number): SurfaceGpu4View => ({
    // Proper +90° xw rotation. The packer stores its transpose, so the eval
    // lift maps visible x -> attractor -w and w0 -> attractor x.
    rotor: [0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    w0: 0.2 * radius,
    sliceHalfW: 0,
  });

  const latticeAffine = latticeFor(tilingAffine.de.visibleBoundingRadius);
  const latticeAffineQueries = latticeQueriesFor(
    latticeAffine.h,
    latticeAffine.radius,
  );
  const latticeFold = latticeFor(tilingFold.de.visibleBoundingRadius);
  const latticeFoldQueries = latticeQueriesFor(
    latticeFold.h,
    latticeFold.radius,
  );
  const latticeEscape = latticeFor(tilingEscape.de.boundingRadius);
  const latticeEscapeQueries = latticeQueriesFor(
    latticeEscape.h,
    latticeEscape.radius,
  );
  const latticeBulb = latticeFor(tilingBulb.de.boundingRadius);
  const latticeBulbQueries = latticeQueriesFor(
    latticeBulb.h,
    latticeBulb.radius,
  );
  const latticeAffine4 = latticeFor(tilingAffine4.de.visibleBoundingRadius);
  const latticeAffine4Queries = latticeQueriesFor(
    latticeAffine4.h,
    latticeAffine4.radius,
  );
  const latticeAffine4View = latticeView4(latticeAffine4.radius);
  const latticeFold4 = latticeFor(tilingFold4.de.visibleBoundingRadius);
  const latticeFold4Queries = latticeQueriesFor(
    latticeFold4.h,
    latticeFold4.radius,
  );
  const latticeFold4View = latticeView4(latticeFold4.radius);
  const latticeEscape4 = latticeFor(tilingEscape4.de.boundingRadius);
  const latticeEscape4Queries = latticeQueriesFor(
    latticeEscape4.h,
    latticeEscape4.radius,
  );
  const latticeEscape4View = latticeView4(latticeEscape4.radius);
  const latticeAbiSpecs: SurfaceTilingAbiSpec[] = [
    {
      name: "lattice-affine",
      core: "affine",
      tiling: latticeAffine,
      params: packSurfaceGpuParams(
        tilingAffine.de,
        { itemCount: latticeAffineQueries.length },
        null,
        null,
        latticeAffine,
      ),
      maps: new Float32Array(packSurfaceGpuMaps(tilingAffine.de)),
      queries: latticeAffineQueries,
      cpu: latticeAffineQueries.map((q) =>
        estimateDistanceRefinedTiled(latticeAffine, tilingAffine.de, q),
      ),
      toleranceRadius: latticeAffine.radius,
    },
    {
      name: "lattice-fold",
      core: "fold",
      tiling: latticeFold,
      params: packSurfaceGpuParams(
        tilingFold.de,
        { itemCount: latticeFoldQueries.length },
        null,
        null,
        latticeFold,
      ),
      maps: new Float32Array(packSurfaceGpuMaps(tilingFold.de)),
      queries: latticeFoldQueries,
      cpu: latticeFoldQueries.map((q) =>
        estimateDistanceTiled(latticeFold, tilingFold.de, q),
      ),
      toleranceRadius: latticeFold.radius,
    },
    {
      name: "lattice-escape",
      core: "escape",
      tiling: latticeEscape,
      params: packEscapeGpuParams(
        tilingEscape.de,
        { itemCount: latticeEscapeQueries.length },
        null,
        null,
        latticeEscape,
      ),
      maps: new Float32Array(packEscapeGpuMaps(tilingEscape.de)),
      queries: latticeEscapeQueries,
      cpu: latticeEscapeQueries.map((q) =>
        estimateEscapeDistanceTiled(latticeEscape, tilingEscape.de, q),
      ),
      toleranceRadius: latticeEscape.radius,
    },
    {
      name: "lattice-bulb",
      core: "bulb",
      tiling: latticeBulb,
      params: packBulbGpuParams(
        tilingBulb.de,
        { itemCount: latticeBulbQueries.length },
        null,
        null,
        latticeBulb,
      ),
      maps: new Float32Array(SURFACE_GPU_MAP_VEC4 * 4),
      queries: latticeBulbQueries,
      cpu: latticeBulbQueries.map((q) =>
        estimateBulbDistanceTiled(latticeBulb, tilingBulb.de, q),
      ),
      toleranceRadius: latticeBulb.radius,
    },
    {
      name: "lattice-affine4",
      core: "affine4",
      tiling: latticeAffine4,
      params: packSurface4GpuParams(
        tilingAffine4.de,
        latticeAffine4View,
        { itemCount: latticeAffine4Queries.length },
        null,
        null,
        latticeAffine4,
      ),
      maps: new Float32Array(packSurfaceGpuMaps4(tilingAffine4.de)),
      queries: latticeAffine4Queries,
      cpu: latticeAffine4Queries.map((q) =>
        estimateDistance4RefinedTiled(
          latticeAffine4,
          tilingAffine4.de,
          liftTiling4(latticeAffine4View, q),
        ),
      ),
      toleranceRadius: latticeAffine4.radius,
    },
    {
      name: "lattice-fold4",
      core: "fold4",
      tiling: latticeFold4,
      params: packSurface4GpuParams(
        tilingFold4.de,
        latticeFold4View,
        { itemCount: latticeFold4Queries.length },
        null,
        null,
        latticeFold4,
      ),
      maps: new Float32Array(packSurfaceGpuMaps4(tilingFold4.de)),
      queries: latticeFold4Queries,
      cpu: latticeFold4Queries.map((q) =>
        estimateDistance4Tiled(
          latticeFold4,
          tilingFold4.de,
          liftTiling4(latticeFold4View, q),
        ),
      ),
      toleranceRadius: latticeFold4.radius,
    },
    {
      name: "lattice-escape4",
      core: "escape4",
      tiling: latticeEscape4,
      params: packEscape4GpuParams(
        tilingEscape4.de,
        latticeEscape4View,
        { itemCount: latticeEscape4Queries.length },
        null,
        null,
        latticeEscape4,
      ),
      maps: new Float32Array(packEscape4GpuMaps(tilingEscape4.de)),
      queries: latticeEscape4Queries,
      cpu: latticeEscape4Queries.map((q) =>
        estimateEscapeDistance4Tiled(
          latticeEscape4,
          tilingEscape4.de,
          liftTiling4(latticeEscape4View, q),
        ),
      ),
      toleranceRadius: latticeEscape4.radius,
    },
  ];

  // Both dimensions and both inverse-map families, then the posted swirl
  // lens's scalar and paired-stride forms under the same finite union.
  const finiteBalloonBaseSystems: SurfaceMarchSystem[] = [
    tilingAffine,
    tilingFold,
    { ...tilingAffine4, view4: tilingAffine4View },
    { ...tilingFold4, view4: tilingFold4View },
  ];
  const finiteBalloonSpecs: SurfaceTilingAbiSpec[] = [];
  for (const sys of [...finiteBalloonBaseSystems, ...swirlSystems]) {
    const tiling = resolveTiling({ group: "view4" in sys ? "f4" : "b3" })!;
    finiteBalloonSpecs.push(surfaceFiniteBalloonAbiSpec(sys, tiling));
    if (sys.de.foldFinal)
      finiteBalloonSpecs.push(surfaceFiniteBalloonAbiSpec(sys, tiling, true));
  }
  tilingAbiSpecs.push(...finiteBalloonSpecs);
  const finiteBalloonFrames = surfaceFiniteBalloonFrameFixtures();

  const symmetryTiling = buildSurfaceTilingSymmetryAbiSpecs(surfaceEvalTol);
  tilingAbiSpecs.push(...symmetryTiling.finite);
  latticeAbiSpecs.push(...symmetryTiling.lattice);

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
  // The affine core's single agreement config (M0): its ladder is
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
  let emitterOnlyFailed = false;
  let tilingAbiFailed = false;
  let latticeTilingAbiFailed = false;
  // Set when the escape eval leg's f32-stability gate excludes too
  // large a fraction of a system's 700 queries (SURFACE_ESCAPE_EXCLUDED_CAP)
  // — separate from `anyAgreementFail` (computed at verdict time from
  // `results.agreement`) because an over-wide exclusion is a red flag even
  // when the surviving `failures` count itself is 0.
  let escapeGateFail = false;
  // The bulb eval leg's analog of escapeGateFail — same two
  // caps (SURFACE_BULB_EXCLUDED_CAP for the pre-hoc ensemble exclusions,
  // SURFACE_BULB_FLIP_CAP for the post-hoc verified shadow flips).
  let bulbGateFail = false;
  // The escape4 eval leg's analog, reading the ESCAPE leg's own
  // two caps rather than a pair of its own — it is the same orbit one
  // dimension up, the same ensemble classifier and the same 700-query mix,
  // so a separate number would be an unearned degree of freedom (and the
  // measured exclusion census, 44-78 of 700, sits inside the 3D band).
  let escape4GateFail = false;
  // M3: the affine4 leg's analog — set when the oracle-continuity
  // gate excludes more than SURFACE_AFFINE4_EXCLUDED_CAP of a system's
  // queries, for exactly the reason above.
  let affine4GateFail = false;
  // M4: the fold4 leg's analog of affine4GateFail, per-system cap
  // (fold4ExcludedCap).
  let fold4GateFail = false;
  // M4: the fold4 leg's slabExt A/B on fold4Boxfold — set when the
  // slabExt:true/false kernels disagree beyond SURFACE_FOLD4_SLABEXT_TOL_FACTOR
  // at sliceHalfW 0, where surface-de-gpu.ts's slabExt doc says they must
  // be mathematically bit-identical (runSurfaceAff4SweepLeg's own gate,
  // one estimator class over).
  let fold4SlabExtFailed = false;
  // The M5 lens4 leg's analog of affine4GateFail/
  // fold4GateFail — per-system cap (lens4ExcludedCap), checked on every
  // GATING lens4 row (the three affine4-cored rows always gate; the one
  // fold4-cored row only at its production width, mirroring M4).
  let lens4GateFail = false;
  // The pack-guard pin (CPU-only, no GPU dispatch) —
  // `packSurface4GpuParams` must THROW for a swirl-final DE queried
  // through a nonzero sliceHalfW (the slabSupported4 refusal,
  // surface-de-gpu.ts). Set when it does NOT throw, or throws for an
  // unrelated reason.
  let lens4PackGuardFailed = false;
  // M5b: the cover leg's analog of lens4GateFail — per-system cap
  // (cover4ExcludedCap), checked on every gating cover row.
  let cover4GateFail = false;
  // M5b: the cover h=0 identity A/B — set when the covered kernel's
  // `sliceHalfW <= 0` branch disagrees with the `slabExt: false` point
  // kernel beyond SURFACE_FOLD4_SLABEXT_TOL_FACTOR.
  let cover4IdentityFailed = false;
  // The optical-transport agreement legs' gate — set when any core's
  // boundary/trace comparison throws (the leg fails closed; its throw
  // message carries the core, probe index and both sides' values).
  let transportGateFail = false;
  // The sphere-inversion legs' gate (sphere-inversion-legs.ts): any eval,
  // march, frame or compile failure there.
  let sphereInversionFailed = false;

  const configLabel = (cfg: SurfaceKernelConfig): string =>
    cfg.core === "affine"
      ? `affine-ladder w${cfg.width} wg${cfg.wg}`
      : cfg.core === "affine4"
        ? `affine4-ladder w${cfg.width} wg${cfg.wg}`
        : cfg.core === "escape"
          ? `escape-forward wg${cfg.wg}`
          : cfg.core === "escape4"
            ? `escape4-forward wg${cfg.wg}`
            : cfg.core === "bulb"
              ? `bulb-forward wg${cfg.wg}`
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

  // The device-sanity canary, destroyed in the finally — declared
  // out here so the finally can reach it.
  let canary: SurfaceCanary | undefined;
  try {
    const bindGroupLayout = surfaceBindGroupLayout(device);
    const pipelineLayout = device.createPipelineLayout({
      label: "surface-de pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });

    // ----- Device-sanity canary — armed before any leg -----
    // Its t0 baseline brackets every dispatch below; each leg banner
    // re-checks it, so a mid-run device upset (the contended-SwiftShader
    // class) becomes a "device-unreliable" verdict at the boundary where
    // it is first visible instead of plausible numeric fails downstream.
    // See createSurfaceCanary's doc.
    status("arming device-sanity canary…");
    const canaryCreated = await createSurfaceCanary(
      device,
      pipelineLayout,
      bindGroupLayout,
      config.canaryTrip,
      (note) => {
        results.notes.push(note);
        render();
      },
    );
    if ("disabled" in canaryCreated) {
      results.notes.push(
        `device-sanity canary disabled — ${canaryCreated.disabled} ` +
          `(tripwire off this run; a mid-run device upset would land as numeric fails)`,
      );
      render();
    } else {
      canary = canaryCreated;
      results.deviceSanity = canaryCreated.sanity;
    }
    const canaryCheck = async (boundary: string): Promise<void> => {
      await canary?.check(boundary);
    };

    // ----- The sphere-inversion cores (sphereInv / sphereInv4) -----
    // Pinned against the f64 seed-orbit estimator on their own fixtures
    // (sphere-inversion.ts's module doc). The timing subjects run the
    // existing fold (mandelboxKifs, production width) and escape4 kernels on
    // the SAME eval harness, so the µs/query rows compare like with like.
    const runSphereInversionLegs = async (): Promise<void> => {
      try {
        activity.setState("gpu", "Surface sphere-inversion legs");
        const timingSubjects: SiTimingSubject[] = [];
        const kifs = systems.find(
          (s) => s.name === "mandelboxKifs" && s.core === "fold",
        );
        if (kifs) {
          timingSubjects.push({
            name: "mandelboxKifs",
            core: `fold w${SURFACE_FOLD_BEAM_WIDTH}`,
            code: surfaceDeKernelWgsl({
              mode: "eval",
              core: "fold",
              width: SURFACE_FOLD_BEAM_WIDTH,
              workgroupSize: 16,
              sharedFrontier: false,
              bnbStage2: false,
            }),
            packParams: (itemCount) =>
              packSurfaceGpuParams(kifs.de, {
                itemCount,
                cutoff: 0,
                footprint: 0,
              }),
            maps: new Float32Array(packSurfaceGpuMaps(kifs.de)),
            queries: kifs.queries,
          });
        }
        const esc4 = escape4Systems[0];
        if (esc4) {
          timingSubjects.push({
            name: esc4.name,
            core: "escape4",
            code: surfaceDeKernelWgsl({
              mode: "eval",
              core: "escape4",
              width: SURFACE_FOLD_BEAM_WIDTH,
              workgroupSize: 16,
              sharedFrontier: false,
              bnbStage2: false,
            }),
            packParams: (itemCount) =>
              packEscape4GpuParams(esc4.de, esc4.view4, {
                itemCount,
                cutoff: 0,
              }),
            maps: new Float32Array(packEscape4GpuMaps(esc4.de)),
            queries: esc4.queries,
          });
        }
        const si = await runSphereInversionBench({
          device,
          software: acquired.software,
          tol: surfaceEvalTol,
          status,
          update: (partial) => {
            results.sphereInversion = partial;
            render();
          },
          onFrame: (label, caption, pixels, width, height) => {
            drawSurfaceComputeFrame(
              surfaceLabeledCanvas(dom, label, caption, width, height),
              pixels,
              width,
              height,
            );
          },
          timingSubjects,
        });
        results.sphereInversion = si;
        for (const note of si.notes) results.notes.push(note);
        if (si.failed) sphereInversionFailed = true;
      } catch (e) {
        sphereInversionFailed = true;
        results.notes.push(`sphere-inversion legs: ${describeError(e)}`);
      }
      render();
    };

    if (config.sphereInversionOnly) {
      await runSphereInversionLegs();
      await canaryCheck("the sphere-inversion legs");
      // The glass backend's transport agreement legs ride this path too, so
      // iterating on the family's optics does not need the whole section.
      try {
        const { rows, notes: transportNotes } =
          await runSurfaceTransportAgreementLegs(
            device,
            {
              descent: [],
              escape: [],
              bulb: [],
              affine4: [],
              fold4: [],
              escape4: [],
            },
            status,
            activity,
            (text) => results.notes.push(text),
            "sphereInversion",
          );
        results.transportAgreement = rows;
        for (const n of transportNotes) results.notes.push(n);
        for (const row of rows)
          results.notes.push(surfaceTransportAgreementNote(row));
        if (rows.length === 0) sphereInversionFailed = true;
      } catch (e) {
        sphereInversionFailed = true;
        results.notes.push(`transport agreement: ${describeError(e)}`);
      }
      render();
      await canaryCheck("the sphere-inversion transport legs");
      if (config.siGlassEnvelope) {
        if (acquired.software) {
          results.notes.push(
            "glass envelope: skipped on a software adapter — the lines are real-driver measurements",
          );
        } else {
          const depthCurve: SurfaceGlassDepthPoint[] = [];
          const envelope: NonNullable<SurfaceDeResults["glassEnvelope"]> = {
            rows: [],
            lines: [],
            depthCurve,
          };
          results.glassEnvelope = envelope;
          setSurfaceComputeSchedulePins({
            siExactNormal: config.siExactNormal,
            siJointOff: config.siJointOff,
          });
          if (config.siExactNormal)
            results.notes.push(
              "glass envelope: EXACT MÖBIUS NORMAL arm (the look A/B, not the shipped normal)",
            );
          if (config.siJointOff)
            results.notes.push(
              "glass envelope: JOINT POOL OFF (one pool per supersample, the schedule A/B)",
            );
          try {
            envelope.rows = await runSurfaceTransportEnvelopeLeg(
              [],
              [],
              dom,
              status,
              activity,
              undefined,
              false,
              "sphereInversion",
              depthCurve,
            );
            for (const row of envelope.rows) {
              // The curved-glass epic's own preview line is 1 s, tighter
              // than the finite direction's 1.5 s; every other line is
              // shared.
              const misses = surfaceTransportEnvelopeRowFailures(row).filter(
                (miss) => !miss.startsWith("preview wall"),
              );
              if (
                row.preview.truncated ||
                row.preview.wallMs > GLASS_ENVELOPE_PREVIEW_LINE_MS
              )
                misses.unshift(
                  `preview wall ${row.preview.wallMs.toFixed(0)}ms > ${String(GLASS_ENVELOPE_PREVIEW_LINE_MS)}ms line` +
                    (row.preview.truncated ? " (truncated)" : ""),
                );
              envelope.lines.push({
                core: row.core,
                system: row.system,
                misses,
              });
              results.notes.push(surfaceTransportEnvelopeNote(row));
              results.notes.push(
                `glass envelope ${row.core} × ${row.system}: ${misses.length === 0 ? "every line PASS" : `MISS — ${misses.join("; ")}`}`,
              );
            }
            for (const p of depthCurve)
              results.notes.push(
                `glass depth curve ${p.core} D${String(p.depth)}: ${p.wallMs.toFixed(0)}ms at ${String(p.width)}x${String(p.height)}, hits ${String(p.hit)}, resolved ${String(p.resolved)} unresolved ${String(p.unresolved)} invalid ${String(p.invalid)}, worst submission ${p.maxBatchMs.toFixed(1)}ms`,
              );
          } catch (e) {
            // A thrown leg is not a measured MISS: it is a failure.
            sphereInversionFailed = true;
            results.notes.push(`glass envelope: ${describeError(e)}`);
          }
          setSurfaceComputeSchedulePins({});
          render();
          await canaryCheck("the glass envelope leg");
        }
      }
      results.verdict = sphereInversionFailed ? "fail" : "skipped";
      results.reason = sphereInversionFailed
        ? "sphere-inversion compile/eval/march/frame failure — see sphereInversion and notes"
        : "surfaceSphereInversionOnly: only the sphere-inversion legs ran (and passed); every other leg was skipped, so this certifies nothing about the section";
      render();
      status(results.verdict + ` — ${results.reason}`);
      return results;
    }

    // Zero recursive maps must still evaluate C0, preserve its winning
    // material, and shade through the production entry in both dimensions.
    try {
      activity.setState(
        "gpu",
        "Surface emitter-only eval/hit-info/shade agreement",
      );
      const rows = await runSurfaceEmitterOnlyAgreement(
        device,
        surfaceEvalTol,
        status,
      );
      for (const row of rows) {
        results.notes.push(
          `${row.name}: ${row.queries} eval/hit-info/shade queries, ` +
            `max eval error ${row.evalMaxError.toExponential(3)}, ` +
            `hit-info mismatches ${row.hitInfoMismatches}, shade byte error ${row.shadeMaxByteError}, palette byte error ${row.paletteMaxByteError}`,
        );
      }
    } catch (e) {
      emitterOnlyFailed = true;
      results.notes.push(
        `emitter-only eval/hit-info/shade: ${describeError(e)}`,
      );
    }
    render();
    await canaryCheck("the emitter-only eval/hit-info/shade agreement leg");

    // ----- Finite tiling: all-seven compile/bind/numeric ABI gate -----
    // This runs before the broad agreement matrices so a too-short uniform
    // tail or a bad public wrapper reports as its own failure rather than a
    // generic later device error. Three queries per core keep it cheap.
    try {
      const tilingWg = surfaceWgFor(config, "private");
      activity.setState("gpu", "Surface finite-tiling ABI agreement");
      await runSurfaceTilingAbiLeg(device, tilingAbiSpecs, tilingWg, status);
      results.notes.push(
        `finite tiling + Balloon: ${finiteBalloonSpecs.length}/12 scalar/paired-stride rows, all four descent cores plus posted swirl, 8 queries each with both missing-feature controls beyond 8 eval tolerances`,
        "finite tiling ABI: 7/7 cores compiled, bound exact-size params, " +
          "dispatched, and agreed with tiling-de.ts at 3/3 queries",
        `finite tiling + symmetry: ${symmetryTiling.finite.length}/6 families agreed at 6/6 queries; ` +
          `minimum symmetry control margin ${Math.min(...symmetryTiling.finite.map((s) => s.minimumSymmetryDeltaTolerances)).toFixed(2)} eval tolerances`,
      );
    } catch (e) {
      tilingAbiFailed = true;
      results.notes.push(`finite tiling ABI: ${describeError(e)}`);
    }
    render();
    await canaryCheck("the finite-tiling ABI agreement leg");

    // ----- Mirrored lattice: all-seven eval compile/bind/numeric gate -----
    // This is intentionally eval-only. It pins the fold/ball/clip composition,
    // exact code+h tail, and x/z/w seam arithmetic without implying that the
    // routed march/unproject/shade carriers have landed.
    try {
      const tilingWg = surfaceWgFor(config, "private");
      activity.setState("gpu", "Surface lattice-tiling ABI agreement");
      await runSurfaceTilingAbiLeg(device, latticeAbiSpecs, tilingWg, status);
      results.notes.push(
        "lattice tiling ABI: 7/7 cores compiled, bound exact-size code+h " +
          "params, dispatched, and agreed with tiling-de.ts at 3/3 seam queries",
        `lattice tiling + symmetry: ${symmetryTiling.lattice.length}/6 families agreed at 6/6 queries; ` +
          `minimum symmetry control margin ${Math.min(...symmetryTiling.lattice.map((s) => s.minimumSymmetryDeltaTolerances)).toFixed(2)} eval tolerances`,
      );
    } catch (e) {
      latticeTilingAbiFailed = true;
      results.notes.push(`lattice tiling ABI: ${describeError(e)}`);
    }
    render();
    await canaryCheck("the lattice-tiling ABI agreement leg");

    // ----- Mirrored lattice: the routed carrier acceptance matrix -----
    // The ABI leg above pins the ESTIMATOR; these frame legs pin the LIVE
    // carrier use end to end through the production renderer: the march's
    // unproject rays across the canonical cell (framed by the contract's
    // cell carrier radius, so the raster genuinely crosses the seams), the
    // full shade pass (normal/shadow/AO/fog from the carrier's tEnter),
    // and — in the plane row — the fifth PLANE terminal. The CPU sanity
    // marches the SAME rays with the family's tiled oracle through the
    // SAME carrier gate, and the hit/plane rate bands gate agreement the
    // way the other frame legs do.
    let latticeFrameFailed = false;
    try {
      const latticeFrames: {
        system: SurfaceLatticeFrameSystem;
        tiling: ResolvedLatticeTiling;
        plane?: boolean;
      }[] = [
        {
          system: { family: "inverse3", sys: tilingFold },
          tiling: latticeFold,
        },
        {
          system: { family: "escape", sys: tilingEscape },
          tiling: latticeEscape,
        },
        {
          system: { family: "inverse4", sys: tilingAffine4 },
          tiling: latticeAffine4,
        },
        {
          system: { family: "escape4", sys: tilingEscape4 },
          tiling: latticeEscape4,
        },
        {
          system: { family: "inverse3", sys: tilingFold },
          tiling: latticeFold,
          plane: true,
        },
      ];
      for (const frame of latticeFrames) {
        const row = await runSurfaceLatticeFrameLeg(
          frame.system,
          frame.tiling,
          acquired.software,
          dom,
          status,
          activity,
          { plane: frame.plane },
        );
        const gap = Math.abs(row.sanityGpuHitRate - row.sanityCpuHitRate);
        const planeGap =
          row.sanityGpuPlaneRate === undefined ||
          row.sanityCpuPlaneRate === undefined
            ? null
            : Math.abs(row.sanityGpuPlaneRate - row.sanityCpuPlaneRate);
        results.notes.push(
          `lattice frame ${row.family}${frame.plane ? " plane" : ""} ` +
            `${row.width}x${row.height}: passes=${String(row.passes)} ` +
            `hit=${String(row.counts.hit)} miss=${String(row.counts.miss)} ` +
            `plane=${String(row.counts.plane)} truncated=${String(row.truncated)} ` +
            `hitRate gpu=${row.sanityGpuHitRate.toFixed(3)} cpu=${row.sanityCpuHitRate.toFixed(3)}` +
            (planeGap === null
              ? ""
              : ` planeRate gpu=${row.sanityGpuPlaneRate!.toFixed(3)} cpu=${row.sanityCpuPlaneRate!.toFixed(3)}`),
        );
        if (row.truncated) {
          results.notes.push(
            `lattice frame ${row.family}: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget — ` +
              (acquired.software
                ? "accepted on a software adapter"
                : "failing the leg: a real-adapter lattice frame must complete"),
          );
          if (!acquired.software) latticeFrameFailed = true;
        } else {
          if (row.counts.hit === 0 && !acquired.software) {
            latticeFrameFailed = true;
            results.notes.push(
              `lattice frame ${row.family}: zero hit rays on a real adapter — failing the leg`,
            );
          }
          if (gap > SURFACE_SANITY_HIT_RATE_TOL && !acquired.software) {
            latticeFrameFailed = true;
            results.notes.push(
              `lattice frame ${row.family}: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
            );
          }
          if (
            planeGap !== null &&
            planeGap > SURFACE_SANITY_HIT_RATE_TOL &&
            !acquired.software
          ) {
            latticeFrameFailed = true;
            results.notes.push(
              `lattice frame ${row.family}: plane-rate gap ${planeGap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
            );
          }
        }
        render();
      }
    } catch (e) {
      latticeFrameFailed = true;
      results.notes.push(`lattice frame: ${describeError(e)}`);
    }
    render();
    await canaryCheck("the lattice carrier frame legs");

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

    await canaryCheck("the fold agreement leg");

    // ----- M0: the AFFINE core's agreement leg — GATING -----
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

    await canaryCheck("the M0 affine agreement leg");

    // ----- Scheduled 3D affine agreement — GATING -----------------------
    // Its own pipeline is load-bearing: schedule map counts are compile-time
    // source inputs, so sharing M0's classic pipeline would only prove that
    // the buffers can be bound. The ordinary comparator pins every one of
    // the schedule-aware CPU oracle's 700 values at the fixed affine width.
    {
      const cfg = affineEvalConfig;
      const label = `${SURFACE_SCHEDULE_ROW_3D} ${configLabel(cfg)}`;
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface scheduled agreement — ${label}`);
      let scheduledPipeline: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine",
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
          schedule: surfaceScheduleKernelSpec(scheduledSystem.de),
        });
        ({ pipeline: scheduledPipeline } = await buildSurfacePipeline(
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
      if (scheduledPipeline !== null) {
        await ensureSurfaceEvalBuffers(
          device,
          bindGroupLayout,
          scheduledSystem,
        );
        const gpu = await runSurfaceEvalDispatch(
          device,
          scheduledPipeline,
          scheduledSystem,
          cfg.wg,
        );
        results.agreement.push(
          compareSurfaceAgreement(scheduledSystem, cfg, gpu),
        );
      }
      render();
    }

    await canaryCheck("the scheduled 3D agreement leg");

    // ----- Graph-directed 3D affine agreement — GATING -----------------
    // A dedicated source compile is essential here: without the explicit
    // chaos spec, packing masks alone would still run the classic all-paths
    // descent and could turn this into a vacuous buffer-layout test.
    {
      const cfg = affineEvalConfig;
      const label = `${SURFACE_CHAOS_ROW_3D} ${configLabel(cfg)}`;
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface xaos agreement — ${label}`);
      let chaosPipeline: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine",
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
          chaos: surfaceChaosKernelSpec(chaosSystem.de),
        });
        ({ pipeline: chaosPipeline } = await buildSurfacePipeline(
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
      if (chaosPipeline !== null) {
        await ensureSurfaceEvalBuffers(device, bindGroupLayout, chaosSystem);
        const gpu = await runSurfaceEvalDispatch(
          device,
          chaosPipeline,
          chaosSystem,
          cfg.wg,
        );
        results.agreement.push(compareSurfaceAgreement(chaosSystem, cfg, gpu));
      }
      render();
    }

    await canaryCheck("the graph-directed 3D agreement leg");

    // ----- M8: the condensation affine-core agreement leg — GATING -----
    // Gearworks is deliberately compiled on its own: emitter ShapeSpecs are
    // code-generated, while poses, shade selectors and the inclusive depth
    // band ride the ordinary params/maps buffers. Its CPU values and query
    // mix were built by the same path as M0, so the existing comparator is
    // still the oracle gate; only the compiled source differs.
    for (const sys of condensationSystems) {
      const cfg: SurfaceKernelConfig = {
        ...affineEvalConfig,
        core: sys.core,
      };
      const label = `condensation ${configLabel(cfg)}`;
      status(`agreement: compiling ${label} (${sys.name})…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: sys.core,
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
          condensation: surfaceCondensationKernelSpec(sys.de),
        });
        const { pipeline } = await buildSurfacePipeline(
          device,
          pipelineLayout,
          code,
          "evalQueries",
          `surface-de eval ${label} ${sys.name}`,
        );
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

    await canaryCheck("the M8 condensation agreement leg");

    // ----- M1 (stage B): the fold-lens agreement leg — GATING -----
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
          lensPost: (sys.de.foldFinal?.postInvM ?? null) !== null,
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

    await canaryCheck("the M1 fold-lens agreement leg");

    // ----- balloonEval: the inverted-union eval leg — GATING -----
    // Three systems — the affine default, one fold system, the pure-fold
    // lens archetype — x the balloon spike's two R regimes (0.35 early /
    // 1.6 rest). Each pipeline compiles the system's OWN core+lens
    // with `balloon: true`; the params pack `buildBalloon`'s numbers as
    // the third argument (the oracle link), and the CPU oracle is
    // `estimateBalloonDistance` over the same core-routed estimator the
    // plain rows pinned. Same tolerance, fail=0 expected: both terms are
    // certified descents the kernels already mirror — the wrapper adds
    // ~3 flops. Rows gate through the standard agreement machinery.
    const balloonEvalSystems = systems.filter((s) =>
      [
        "affineTetra",
        "foldSpherefoldPair",
        "lensBoxfoldPostOverAffine",
      ].includes(s.name),
    );
    for (const sys of balloonEvalSystems) {
      for (const rMult of [0.35, 1.6]) {
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
        const label = `balloon@R${String(rMult)} ${configLabel(cfg)}`;
        status(`agreement: compiling ${label} (${sys.name})…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        let balloonParams: GPUBuffer | null = null;
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: sys.core,
            lens: sys.de.foldFinal !== null,
            lensPost: (sys.de.foldFinal?.postInvM ?? null) !== null,
            balloon: true,
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
          const ball = balloonBall(sys.de);
          const b = buildBalloon(sys.de, rMult);
          const balloon = {
            center: b.center,
            rho: b.rho,
            R: b.R,
            far: BALLOON_FAR_CAP_RHO * ball.radius,
          };
          const fn =
            sys.core === "fold" ? estimateDistance : estimateDistanceRefined;
          const cpu = sys.queries.map(
            (q) => estimateBalloonDistance(fn, sys.de, b, q, 0, 0).d,
          );
          // The shared query/maps/output buffers, with a balloon-block
          // params buffer (304 bytes) swapped into a leg-local bind group.
          const bufs = await ensureSurfaceEvalBuffers(
            device,
            bindGroupLayout,
            sys,
          );
          const paramsData = packSurfaceGpuParams(
            sys.de,
            { itemCount: sys.queries.length, cutoff: 0, footprint: 0 },
            balloon,
          );
          balloonParams = await createSurfaceBuffer(
            device,
            `surface-de balloon params ${sys.name}`,
            paramsData.byteLength,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          );
          device.queue.writeBuffer(balloonParams, 0, paramsData);
          const bindGroup = device.createBindGroup({
            label: `surface-de balloon bind group ${sys.name}`,
            layout: bindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: balloonParams } },
              { binding: 1, resource: { buffer: bufs.maps } },
              { binding: 2, resource: { buffer: bufs.input } },
              { binding: 3, resource: { buffer: bufs.output } },
            ],
          });
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            {
              queries: sys.queries,
              buffers: {
                output: bufs.output,
                staging: bufs.staging,
                bindGroup,
              },
            },
            cfg.wg,
          );
          results.agreement.push(
            compareSurfaceAgreement(
              { ...sys, name: `balloon(${sys.name})@R${String(rMult)}`, cpu },
              cfg,
              gpu,
            ),
          );
        } catch (e) {
          compileFailed = true;
          results.notes.push(
            `agreement ${label} ${sys.name}: ${describeError(e)}`,
          );
        } finally {
          balloonParams?.destroy();
        }
        render();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    }

    for (const sys of swirlSystems) {
      for (const [rMult, evalStride] of [
        [0.35, false],
        [1.6, false],
        [0.35, true],
        [1.6, true],
      ] as const) {
        status(`agreement: swirl Balloon × ${sys.name}…`);
        activity.setState("gpu", `Swirl Balloon agreement — ${sys.name}`);
        try {
          const row = await runSurfaceSwirlBalloonEvalLeg(
            device,
            bindGroupLayout,
            sys,
            surfaceWgFor(config, "private"),
            rMult,
            evalStride,
          );
          results.agreement.push(row);
          results.notes.push(
            `swirl Balloon ${row.system}: shellQueries=${String(row.shellQueries)}/${String(row.n)}`,
          );
          if ((row.shellQueries ?? 0) === 0 || row.shellQueries === row.n) {
            lens4GateFail = true;
            results.notes.push(
              `swirl Balloon ${row.system}: both union terms must win in the interleaved base/inverted query mix`,
            );
          }
          if ((row.excluded ?? 0) > lens4ExcludedCap(sys.name)) {
            lens4GateFail = true;
            results.notes.push(
              `swirl Balloon ${sys.name}: excluded ${String(row.excluded)} queries exceeds the existing lens4 continuity cap`,
            );
          }
        } catch (e) {
          compileFailed = true;
          results.notes.push(`swirl Balloon ${sys.name}: ${describeError(e)}`);
        }
        render();
      }
    }

    await canaryCheck("the balloonEval leg");

    // ----- M2: the ESCAPE core's agreement leg — GATING -----
    // Forward escape-time systems never enter `systems` above — `buildSurfaceDE`
    // refuses their shape by design — so `escapeSystems` (built right after
    // the systemDefs CPU-oracle loop) is the only source for this leg. One
    // pipeline for every system: the escape core takes no width/variant/
    // stage2 sweep (inert, like the affine ladder), and its maps binding
    // carries the formula CHAIN rather than inverse descent maps
    // (one `GpuMap` per link, `packEscapeGpuMaps`), so this leg
    // gets its own bind group layout and buffers helper rather than
    // `ensureSurfaceEvalBuffers`'s descent-shaped one.
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
      const escapeLayout = surfaceForwardBindGroupLayout(device);
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
          await ensureSurfaceForwardEvalBuffers(
            device,
            escapeLayout,
            sys,
            packEscapeGpuParams(sys.de, {
              itemCount: sys.queries.length,
              cutoff: 0,
            }),
            // The chain the kernel cycles through.
            packEscapeGpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            escapeEvalConfig.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            (q) => estimateEscapeDistanceF32(sys.de, q),
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
                "f32-stability gate — see compareSurfaceForwardAgreement's doc",
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

    await canaryCheck("the M2 escape agreement leg");

    // ----- M6: the BULB core's agreement leg — GATING -----
    // The escape leg's exact shape one formula over: `bulbSystems` is the
    // only source (no other gate admits a pure triplex power), one
    // pipeline serves every system (no width/variant/stage2 sweep — all
    // inert), and the core declares no maps binding, so it borrows the
    // escape leg's 3-binding layout and forward buffers helper. The gate
    // is the same two-layer chaotic-orbit discipline: pre-hoc, only
    // ensemble-stable queries enter (`forwardQueryStable`, capped by
    // SURFACE_BULB_EXCLUDED_CAP); post-hoc, a residual failure is
    // absolved only if some 1..4-ULP neighbor orbit reproduces the GPU's
    // value (`forwardShadowFlipVerified`, capped by
    // SURFACE_BULB_FLIP_CAP).
    if (bulbSystems.length > 0) {
      const bulbEvalConfig: SurfaceKernelConfig = {
        core: "bulb",
        variant: "private",
        width: SURFACE_FOLD_BEAM_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = configLabel(bulbEvalConfig);
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      const bulbLayout = surfaceForwardBindGroupLayout(device);
      const bulbPipelineLayout = device.createPipelineLayout({
        label: "surface-de bulb pipeline layout",
        bindGroupLayouts: [bulbLayout],
      });
      let bulbPipeline: GPUComputePipeline | null = null;
      let bulbCompileMs = 0;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "bulb",
          width: bulbEvalConfig.width,
          workgroupSize: bulbEvalConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: bulbPipeline, compileMs: bulbCompileMs } =
          await buildSurfacePipeline(
            device,
            bulbPipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
      }
      if (bulbPipeline !== null) {
        const pipeline = bulbPipeline;
        for (const sys of bulbSystems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceForwardEvalBuffers(
            device,
            bulbLayout,
            sys,
            packBulbGpuParams(sys.de, {
              itemCount: sys.queries.length,
              cutoff: 0,
            }),
            // One zero stride: the bulb kernel declares no maps binding
            // (its single map rides the params variant block), so this
            // buffer exists only to satisfy the shared layout.
            new Float32Array(SURFACE_GPU_MAP_VEC4 * 4),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            bulbEvalConfig.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            (q) => estimateBulbDistanceF32(sys.de, q),
            bulbEvalConfig,
            gpu,
            bulbCompileMs,
            gpuMs,
          );
          results.agreement.push(row);
          const excluded = row.excluded ?? 0;
          if (excluded > SURFACE_BULB_EXCLUDED_CAP) {
            bulbGateFail = true;
            results.notes.push(
              `bulb agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                `queries (> ${SURFACE_BULB_EXCLUDED_CAP}) from the ` +
                "f32-stability gate — see compareSurfaceForwardAgreement's doc",
            );
          }
          const flips = row.chaoticFlips ?? 0;
          if (flips > SURFACE_BULB_FLIP_CAP) {
            bulbGateFail = true;
            results.notes.push(
              `bulb agreement ${sys.name}: ${flips} verified chaotic ` +
                `flips (> ${SURFACE_BULB_FLIP_CAP}) — a systematic ` +
                "disagreement is wearing chaos's costume; failing the leg",
            );
          }
          render();
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      render();
    }

    await canaryCheck("the M6 bulb agreement leg");

    // ----- M3: the AFFINE4 core's agreement leg — GATING -----
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

    await canaryCheck("the M3 affine4 agreement leg");

    // ----- Scheduled flat-lift affine4 agreement — GATING ---------------
    // A second compile-gated pipeline proves the schedule reaches affine4
    // source generation as well as its params/maps packers. The view is an
    // exact flat lift, but the CPU oracle and WGSL both execute the 4D core.
    {
      const cfg: SurfaceKernelConfig = {
        core: "affine4",
        variant: "private",
        width: SURFACE_AFFINE_LADDER_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = `${SURFACE_SCHEDULE_ROW_4D} ${configLabel(cfg)}`;
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface scheduled agreement — ${label}`);
      let scheduledPipeline4: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine4",
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
          schedule: surfaceScheduleKernelSpec(scheduledSystem4.de),
        });
        ({ pipeline: scheduledPipeline4 } = await buildSurfacePipeline(
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
      if (scheduledPipeline4 !== null) {
        await ensureSurface4EvalBuffers(
          device,
          bindGroupLayout,
          scheduledSystem4,
        );
        const gpu = await runSurfaceEvalDispatch(
          device,
          scheduledPipeline4,
          scheduledSystem4,
          cfg.wg,
        );
        const row = compareSurface4Agreement(scheduledSystem4, cfg, gpu);
        results.agreement.push(row);
        const excluded = row.excluded ?? 0;
        if (excluded > SURFACE_AFFINE4_EXCLUDED_CAP) {
          affine4GateFail = true;
          results.notes.push(
            `affine4 agreement ${scheduledSystem4.name}: excluded ${String(excluded)}/${String(
              row.n,
            )} queries (> ${String(SURFACE_AFFINE4_EXCLUDED_CAP)}) from the ` +
              "oracle-continuity gate",
          );
        }
      }
      render();
    }

    await canaryCheck("the scheduled flat-4D agreement leg");

    // ----- Graph-directed flat-lift affine4 agreement — GATING ----------
    {
      const cfg: SurfaceKernelConfig = {
        core: "affine4",
        variant: "private",
        width: SURFACE_AFFINE_LADDER_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = `${SURFACE_CHAOS_ROW_4D} ${configLabel(cfg)}`;
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface xaos agreement — ${label}`);
      let chaosPipeline4: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine4",
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: false,
          bnbStage2: false,
          chaos: surfaceChaosKernelSpec(chaosSystem4.de),
        });
        ({ pipeline: chaosPipeline4 } = await buildSurfacePipeline(
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
      if (chaosPipeline4 !== null) {
        await ensureSurface4EvalBuffers(device, bindGroupLayout, chaosSystem4);
        const gpu = await runSurfaceEvalDispatch(
          device,
          chaosPipeline4,
          chaosSystem4,
          cfg.wg,
        );
        const row = compareSurface4Agreement(chaosSystem4, cfg, gpu);
        results.agreement.push(row);
        const excluded = row.excluded ?? 0;
        if (excluded > SURFACE_AFFINE4_EXCLUDED_CAP) {
          affine4GateFail = true;
          results.notes.push(
            `affine4 agreement ${chaosSystem4.name}: excluded ${String(excluded)}/${String(
              row.n,
            )} queries (> ${String(SURFACE_AFFINE4_EXCLUDED_CAP)}) from the ` +
              "oracle-continuity gate",
          );
        }
      }
      render();
    }

    await canaryCheck("the graph-directed flat-4D agreement leg");

    // ----- M4: the FOLD4 core's agreement leg -----
    // The fold frontier one dimension up, behind the SAME view lift as M3
    // — `descendFold4` refine=FALSE (surface-de-4d.ts) as the fold4
    // GLSL/WGSL body marches it — pinned against the COMPOSED f64 oracle
    // at `refined=false` (`estimateSurface4Composed`'s doc). TWO widths,
    // one pipeline each, both dispatched against the SAME four systems'
    // buffers (the params/maps/queries data doesn't depend on kernel
    // width — only the compiled source does): `SURFACE_FOLD_BEAM_WIDTH`
    // (12) is the CPU oracle's own fixed frontier width, so it GATES; 4 is
    // the same narrow-width erosion measurement 3D's fold rows
    // already run, informational only
    // (`compareSurfaceFold4Agreement`'s `gating` rule — the 3D fold row's
    // idiom, not M3's fixed-width "always gate"). Private variant, stage2
    // off always: the fold4 frontier is function-scope private by
    // construction and the branch-and-bound skips are not emitted at all
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

      // M4's slabExt A/B (mirrors runSurfaceAff4SweepLeg's own
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

    await canaryCheck("the M4 fold4 agreement leg");

    // ----- M5: the 4D LENS agreement leg -----
    // The fold-FINAL lens (`descendLens4`) wrapped around EITHER 4D core,
    // pinned against the SAME composed-oracle machinery M3/M4 already use —
    // `de.foldFinal` alone routes `estimateDistance4`/`estimateDistance4Refined`
    // through `descendLens4` (surface-de-4d.ts), so `estimateSurface4Composed`'s
    // calls in the fixture loop above already pin the lens; this leg only
    // adds the GPU side. `lens4AffineSystems` (three systems) wrap the
    // REFINED affine4 ladder — fold-free base maps (`pentatope`), so the
    // wrapper's root descents are the plain refined descent, mirroring
    // `estimateDistance4Refined` exactly like M3's rows — and ALWAYS gate,
    // one fixed-width-4 pipeline for all three (M3's shape). `lens4FoldSystems`
    // (one system) wraps the FOLD frontier — a fold base (`fold4Boxfold`'s
    // pair), so the wrapper routes through `descendFold4` and mirrors PLAIN
    // `estimateDistance4` — and sweeps the SAME two widths as M4 (12 gates,
    // 4 is the narrow-width erosion measurement, informational).
    if (lens4AffineSystems.length > 0) {
      const lens4AffineConfig: SurfaceKernelConfig = {
        core: "affine4",
        variant: "private",
        width: SURFACE_AFFINE_LADDER_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = `lens4 ${configLabel(lens4AffineConfig)}`;
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      let lens4AffinePipeline: GPUComputePipeline | null = null;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "affine4",
          lens: true,
          lensPost: true,
          width: lens4AffineConfig.width,
          workgroupSize: lens4AffineConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: lens4AffinePipeline } = await buildSurfacePipeline(
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
      if (lens4AffinePipeline !== null) {
        const pipeline = lens4AffinePipeline;
        for (const sys of lens4AffineSystems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            lens4AffineConfig.wg,
          );
          const row = compareSurface4Agreement(sys, lens4AffineConfig, gpu);
          results.agreement.push(row);
          const excluded = row.excluded ?? 0;
          const cap = lens4ExcludedCap(sys.name);
          if (excluded > cap) {
            lens4GateFail = true;
            results.notes.push(
              `lens4 agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                `queries (> ${cap}) from the oracle-continuity gate — ` +
                "see surface4QueryStable's doc",
            );
          }
          render();
          await new Promise<void>((resolve) => setTimeout(resolve));
        }
      }
      render();
    }

    if (lens4FoldSystems.length > 0) {
      const lens4FoldConfigs: SurfaceKernelConfig[] = [
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
      for (const cfg of lens4FoldConfigs) {
        const label = `lens4 ${configLabel(cfg)}`;
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        let lens4FoldPipeline: GPUComputePipeline | null = null;
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: "fold4",
            lens: true,
            lensPost: true,
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
          });
          ({ pipeline: lens4FoldPipeline } = await buildSurfacePipeline(
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
        if (lens4FoldPipeline !== null) {
          const pipeline = lens4FoldPipeline;
          for (const sys of lens4FoldSystems) {
            status(`agreement: ${label} × ${sys.name}…`);
            await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
            const gpu = await runSurfaceEvalDispatch(
              device,
              pipeline,
              sys,
              cfg.wg,
            );
            const row = compareSurfaceFold4Agreement(sys, cfg, gpu);
            results.agreement.push(row);
            if (cfg.width === SURFACE_FOLD_BEAM_WIDTH) {
              const excluded = row.excluded ?? 0;
              const cap = lens4ExcludedCap(sys.name);
              if (excluded > cap) {
                lens4GateFail = true;
                results.notes.push(
                  `lens4 agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
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
    }

    // The pack-guard pin (CPU-only, no GPU dispatch): a SWIRL-final DE
    // queried through a nonzero sliceHalfW must be REFUSED by
    // `packSurface4GpuParams` (`slabSupported4` — the swirl inverse bends
    // the segment with no point cover in this frame), while a
    // spherefold-final DE must PACK: the bounded midpoint cover is that
    // system's slab answer. Neither system touches the GPU (the pack alone
    // is under test), so both run once here. Checks the CAUGHT message
    // too, not just "did it throw": a throw for the WRONG reason (e.g.
    // the footprint guard, which these calls deliberately avoid by
    // omitting `footprint`) would false-pass a regressed slab guard.
    {
      const guardFinal: Transform = {
        id: 197,
        position: [0.05, 0.1, 0],
        rotation: [0.2, 0.1, 0],
        scale: [0.8, 0.8, 0.8],
        w: { position: 0.07, rotation: { yw: -0.15 } },
        variations: [{ type: "spherefold", weight: 0.6 }],
      };
      const guardDe = buildSurfaceDE4(pentatope(), guardFinal);
      const guardView = {
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0.1 * guardDe.boundingRadius,
      };
      let spherefoldRefused = false;
      let spherefoldMessage = "";
      try {
        packSurface4GpuParams(guardDe, guardView, { itemCount: 1, cutoff: 0 });
      } catch (e) {
        spherefoldRefused = true;
        spherefoldMessage = describeError(e);
      }
      if (spherefoldRefused) {
        lens4PackGuardFailed = true;
        results.notes.push(
          "pack-guard: packSurface4GpuParams refused a spherefold-final DE " +
            `under sliceHalfW > 0 — "${spherefoldMessage}" — the bounded ` +
            "midpoint cover makes that system supported (slabSupported4)",
        );
      } else {
        results.notes.push(
          "pack-guard: spherefold-final slab packs (the cover's system)",
        );
      }
      const guardSwirlDe = buildSurfaceDE4(
        pentatope(),
        surfaceLensSwirlFinal(true),
      );
      let swirlRefused = false;
      let swirlMessage = "";
      try {
        packSurface4GpuParams(
          guardSwirlDe,
          {
            rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            w0: 0,
            sliceHalfW: 0.1 * guardSwirlDe.boundingRadius,
          },
          { itemCount: 1, cutoff: 0 },
        );
      } catch (e) {
        swirlRefused = true;
        swirlMessage = describeError(e);
      }
      if (!swirlRefused || !swirlMessage.includes("slabSupported4")) {
        lens4PackGuardFailed = true;
        results.notes.push(
          swirlRefused
            ? `pack-guard: packSurface4GpuParams threw for the WRONG reason — "${swirlMessage}" — expected the slabSupported4 slab refusal`
            : "pack-guard: packSurface4GpuParams did NOT throw for a " +
                "swirl-final DE under sliceHalfW > 0 — the slabSupported4 " +
                "refusal regressed (surface-de-gpu.ts)",
        );
      } else {
        results.notes.push(
          `pack-guard: swirl-final slab refusal confirmed — ${swirlMessage}`,
        );
      }
    }

    await canaryCheck("the M5 lens4 agreement leg");

    // ----- M5b: the nonlinear slab COVER's agreement leg — GATING -----
    // The bounded midpoint cover (surface-de-4d.ts's
    // estimateDistance4SlabCover) as BOTH 4D descent cores answer it:
    // `estimateSurface4Composed` routes a supported nonlinear slab through
    // the public cover automatically, so the fixture loops below already
    // built the CPU side; this leg only adds the GPU side. Two fixture
    // families, each at h = 0 (the bit-identity row), h = 0.10 R and
    // h = 0.25 R under two different pose rotors — the shipped samples per
    // slab query, 16 for the production count, so this leg's whole point
    // is that CPU f64 and GPU f32 agree WHILE the work multiplies:
    //   · `cover4SpherePair` — the recursive spherefold pair, a FOLD base
    //     (`deHasFolds4`), so the cover wraps the fold4 frontier and the
    //     oracle is the PLAIN estimator (`refined = false`, M4's arm);
    //   · `cover4MandelFinal` — the mandelbox FINAL lens over `pentatope`
    //     (fold-free base), so the cover wraps the affine4 ladder UNDER
    //     the lens and the oracle is the REFINED estimator (M5's affine
    //     arm) — the "final lens" half the cover exists for.
    // Every row GATES: the fold row at the CPU's fixed frontier width
    // (M4's gating rule), the affine row always (M3's). The h=0 rows also
    // get the identity A/B: the cover wrapper's `sliceHalfW <= 0.0` branch
    // IS the point body, so the covered kernel must agree with the
    // `slabExt: false` point kernel within the M4 slabExt tolerance.
    {
      const cover4Defs: {
        name: string;
        seed: number;
        transforms: Transform[];
        finalTransform: Transform | null;
        view4: (de: SurfaceDE4) => SurfaceGpu4View;
      }[] = [];
      const coverRotorA = symmetryRotation4("yw", 0.55);
      const coverRotorB = symmetryRotation4("xw", 0.62);
      const addCoverFixture = (
        prefix: string,
        seed: number,
        transforms: Transform[],
        finalTransform: Transform | null,
      ): void => {
        cover4Defs.push(
          {
            name: `${prefix}H0`,
            seed,
            transforms,
            finalTransform,
            view4: (de) => ({
              rotor: coverRotorA,
              w0: 0.15 * de.boundingRadius,
              sliceHalfW: 0,
            }),
          },
          {
            name: `${prefix}H10`,
            seed: seed + 1,
            transforms,
            finalTransform,
            view4: (de) => ({
              rotor: coverRotorA,
              w0: 0.15 * de.boundingRadius,
              sliceHalfW: 0.1 * de.boundingRadius,
            }),
          },
          {
            name: `${prefix}H25`,
            seed: seed + 2,
            transforms,
            finalTransform,
            view4: (de) => ({
              rotor: coverRotorB,
              w0: 0.08 * de.boundingRadius,
              sliceHalfW: 0.25 * de.boundingRadius,
            }),
          },
        );
      };
      addCoverFixture(
        "cover4SpherePair",
        561,
        surfaceCover4SpherefoldPair(),
        null,
      );
      addCoverFixture(
        "cover4MandelFinal",
        571,
        pentatope(),
        surfaceLens4MandelboxFinal(),
      );
      const cover4Systems: Surface4SystemState[] = [];
      for (const def of cover4Defs) {
        status(`cpu oracle: ${def.name}…`);
        activity.setState("cpu", `Surface cover CPU oracle — ${def.name}`);
        await new Promise<void>((resolve) => setTimeout(resolve));
        const eligibility = analyzeSurfaceSystem4(
          def.transforms,
          def.finalTransform,
        );
        if (eligibility.status === "ineligible") {
          throw new Error(
            `cover4 bench fixture ${def.name} is ineligible: ` +
              eligibility.reasons.join("; "),
          );
        }
        const de = buildSurfaceDE4(def.transforms, def.finalTransform);
        // The fixtures must actually NEED the cover: one that regressed to
        // slabExact4 would pass this leg through the exact segment path
        // and pin nothing about the cover.
        if (slabExact4(de)) {
          throw new Error(
            `cover4 bench fixture ${def.name} is slabExact4 — the cover is ` +
              "not what this row would exercise",
          );
        }
        if (!slabSupported4(de)) {
          throw new Error(
            `cover4 bench fixture ${def.name} is not slabSupported4 — the ` +
              "public entry (and the packer) would refuse its slab",
          );
        }
        // The core the app routes: a fold base takes the PLAIN fold4
        // frontier, a fold-free base the REFINED affine4 ladder — the
        // same `deHasFolds4` split M4/M5 use, and the same `refined` the
        // CPU oracle must be asked for.
        const refined = !deHasFolds4(de);
        const view4 = def.view4(de);
        const queries = affine4Queries(de, view4, def.seed, refined);
        const cpu = queries.map((q) =>
          estimateSurface4Composed(de, view4, q, refined),
        );
        const R = surface4ToleranceR(de);
        const stable = cpu.map((c, i) =>
          surface4QueryStable(
            de,
            view4,
            queries[i],
            c,
            surfaceEvalTol(c, R),
            refined,
          ),
        );
        cover4Systems.push({
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
      const cover4Gpu = new Map<string, Float32Array>();
      const cover4Groups = [
        {
          name: "cover4-fold",
          core: "fold4" as const,
          lens: false,
          lensPost: false,
          width: SURFACE_FOLD_BEAM_WIDTH,
          systems: cover4Systems.filter((sys) => deHasFolds4(sys.de)),
          compare: compareSurfaceFold4Agreement,
        },
        {
          name: "cover4-affine",
          core: "affine4" as const,
          lens: true,
          // The bench lens fixtures all carry a post (`SURFACE_BENCH_POST`),
          // so the kernel must compile the post inverse the CPU oracle's
          // `descendLens4` applies — M5's own `lensPost: true`. Without it
          // the cover samples a DIFFERENT lensed object (measured: 686/700
          // rows at ~0.6 absolute error before this flag was added).
          lensPost: true,
          width: SURFACE_AFFINE_LADDER_WIDTH,
          systems: cover4Systems.filter((sys) => !deHasFolds4(sys.de)),
          compare: compareSurface4Agreement,
        },
      ];
      for (const group of cover4Groups) {
        if (group.systems.length === 0) continue;
        const cfg: SurfaceKernelConfig = {
          core: group.core,
          variant: "private",
          width: group.width,
          stage2: false,
          wg: surfaceWgFor(config, "private"),
        };
        const label = `cover4 ${configLabel(cfg)}${group.lens ? " lens" : ""}`;
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        let pipeline: GPUComputePipeline | null = null;
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: group.core,
            lens: group.lens,
            lensPost: group.lensPost,
            slabExt: true,
            slabCover: true,
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
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
        }
        if (pipeline !== null) {
          for (const sys of group.systems) {
            status(`agreement: ${label} × ${sys.name}…`);
            await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
            const gpu = await runSurfaceEvalDispatch(
              device,
              pipeline,
              sys,
              cfg.wg,
            );
            cover4Gpu.set(sys.name, gpu);
            const row = group.compare(sys, cfg, gpu);
            results.agreement.push(row);
            const excluded = row.excluded ?? 0;
            const cap = cover4ExcludedCap(sys.name);
            if (excluded > cap) {
              cover4GateFail = true;
              results.notes.push(
                `cover4 agreement ${sys.name}: excluded ${String(excluded)}/${String(
                  row.n,
                )} queries (> ${String(cap)}) from the oracle-continuity gate — ` +
                  "see surface4QueryStable's doc",
              );
            }
            render();
            await new Promise<void>((resolve) => setTimeout(resolve));
          }
        }
        render();

        // The h=0 identity pin: the cover wrapper's `sliceHalfW <= 0.0`
        // branch is the point body verbatim, so the covered kernel must
        // agree with the `slabExt: false` point kernel elementwise on the
        // same queries — the M4 slabExt A/B's shape, one wrapper over.
        const h0Systems = group.systems.filter(
          (sys) => sys.view4.sliceHalfW === 0,
        );
        if (h0Systems.length > 0) {
          status(`${group.name} cover identity A/B: compiling…`);
          activity.setState(
            "gpu",
            `Surface DE ${group.name} cover identity A/B`,
          );
          try {
            const code = surfaceDeKernelWgsl({
              mode: "eval",
              core: group.core,
              lens: group.lens,
              lensPost: group.lensPost,
              slabExt: false,
              width: group.width,
              workgroupSize: cfg.wg,
              sharedFrontier: false,
              bnbStage2: false,
            });
            const { pipeline: noslabPipeline } = await buildSurfacePipeline(
              device,
              pipelineLayout,
              code,
              "evalQueries",
              `surface-de eval ${group.name} noslab`,
            );
            for (const sys of h0Systems) {
              const gpuCover = cover4Gpu.get(sys.name);
              await ensureSurface4EvalBuffers(device, bindGroupLayout, sys);
              const gpuNoslab = await runSurfaceEvalDispatch(
                device,
                noslabPipeline,
                sys,
                cfg.wg,
              );
              let mismatches = 0;
              let maxAbs = 0;
              if (gpuCover !== undefined) {
                for (let i = 0; i < gpuCover.length; i++) {
                  if (gpuCover[i] !== gpuNoslab[i]) {
                    mismatches++;
                    maxAbs = Math.max(
                      maxAbs,
                      Math.abs(gpuCover[i] - gpuNoslab[i]),
                    );
                  }
                }
              }
              const tol =
                SURFACE_FOLD4_SLABEXT_TOL_FACTOR * sys.de.boundingRadius;
              const withinTolerance = gpuCover !== undefined && maxAbs <= tol;
              results.crossChecks.push({
                kind: "cover-on-vs-noslab",
                system: sys.name,
                width: group.width,
                n: gpuNoslab.length,
                mismatches,
                maxDelta: maxAbs,
                note:
                  gpuCover === undefined
                    ? "MISSING cover row — the h=0 cover dispatch did not run"
                    : mismatches === 0
                      ? "exact — the cover's h=0 branch is the point body bit for bit"
                      : withinTolerance
                        ? "sub-tolerance mismatches (fma/contraction noise)"
                        : "MISMATCH — the cover's h=0 branch must be the point body (surface-de-gpu.ts's slabCover doc)",
              });
              if (!withinTolerance) {
                cover4IdentityFailed = true;
                results.notes.push(
                  `${group.name} cover identity A/B ${sys.name}: ` +
                    `${String(mismatches)} mismatches, maxAbs ` +
                    `${maxAbs.toExponential(2)} exceeds tolerance ` +
                    `${tol.toExponential(2)} — the cover's h=0 branch does ` +
                    "NOT reproduce the point kernel",
                );
              }
            }
          } catch (e) {
            cover4IdentityFailed = true;
            results.notes.push(
              `${group.name} cover identity A/B: ${describeError(e)}`,
            );
          }
          render();
        }
      }
    }

    await canaryCheck("the M5b cover agreement leg");

    // ----- M7: the ESCAPE4 core's agreement leg — GATING -----
    // The forward escape-time orbit ONE DIMENSION UP, behind the 4D cores'
    // view lift — `escape-de-4d.ts`'s `estimateEscapeDistance4` as the
    // `core: "escape4"` kernel mirrors it — pinned against the COMPOSED
    // f64 oracle (`estimateEscape4Composed`: the kernel's own
    // `rotorInv · vec4f(p, w0)` lift in f64, then the estimator). Without
    // this leg that kernel is unverified code, which is the whole reason
    // the oracle-discipline pattern exists (`flame.ts` <-> `flame-gpu.ts`,
    // one render mode over).
    //
    // Structurally it is M2's leg exactly — one pipeline for every system
    // (no width/variant/stage2 sweep: all three are inert on a forward
    // core), the escape leg's own 4-binding forward layout and buffers
    // helper, and the SAME two-layer chaotic-orbit gate at the SAME two
    // constants: pre-hoc, only ensemble-stable queries enter
    // (`forwardQueryStable`, capped by SURFACE_ESCAPE_EXCLUDED_CAP);
    // post-hoc, a residual failure is absolved only if some 1..4-ULP
    // neighbor orbit reproduces the GPU's value (`forwardShadowFlipVerified`,
    // capped by SURFACE_ESCAPE_FLIP_CAP). Reusing those caps rather than
    // minting escape4 twins is deliberate — it is the same recurrence, the
    // same query mix and the same classifier, and the measured exclusion
    // census (44-78 of 700) sits inside the 3D leg's own band.
    //
    // TWO THINGS DIFFER FROM M2, both of them the 4D tail's:
    //   - the params buffer is `packEscape4GpuParams(de, view4, …)`, which
    //     needs the system's frozen VIEW (rotor + w0), so the state
    //     carries one and the CPU oracle applies the identical lift;
    //   - the maps buffer is `packEscape4GpuMaps` in the `GpuMap4` layout
    //     (`SURFACE_GPU_MAP4_VEC4` vec4f per link, carrying a FORWARD 4x4)
    //     rather than the 3D `GpuMap`. This core DOES declare binding 1,
    //     exactly like `core: "escape"` — bulb is the one bindingless core
    //     left.
    //
    // Judge these rows on `--display=:0`, not SwiftShader alone: the escape
    // core's own lesson (a classifier that passed SwiftShader clean, then
    // real Iris flipped six "stable" rows) is a property of forward orbits,
    // not of the ambient dimension. The standing SwiftShader false failure
    // is on `escChainKaleido`, a 3D row; no escape4 row is implicated by
    // it, and any escape4 row that fails on a software rasteriser and
    // passes on a real driver should be reported with both columns rather
    // than absolved by analogy.
    if (escape4Systems.length > 0) {
      const escape4EvalConfig: SurfaceKernelConfig = {
        core: "escape4",
        variant: "private",
        width: SURFACE_FOLD_BEAM_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      };
      const label = configLabel(escape4EvalConfig);
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      const escape4Layout = surfaceForwardBindGroupLayout(device);
      const escape4PipelineLayout = device.createPipelineLayout({
        label: "surface-de escape4 pipeline layout",
        bindGroupLayouts: [escape4Layout],
      });
      let escape4Pipeline: GPUComputePipeline | null = null;
      let escape4CompileMs = 0;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          core: "escape4",
          width: escape4EvalConfig.width,
          workgroupSize: escape4EvalConfig.wg,
          sharedFrontier: false,
          bnbStage2: false,
        });
        ({ pipeline: escape4Pipeline, compileMs: escape4CompileMs } =
          await buildSurfacePipeline(
            device,
            escape4PipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
      }
      if (escape4Pipeline !== null) {
        const pipeline = escape4Pipeline;
        for (const sys of escape4Systems) {
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceForwardEvalBuffers(
            device,
            escape4Layout,
            sys,
            packEscape4GpuParams(sys.de, sys.view4, {
              itemCount: sys.queries.length,
              cutoff: 0,
            }),
            // The chain the kernel cycles through, in the 4D map layout.
            packEscape4GpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            escape4EvalConfig.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            // The comparator hands this closure 3D MARCHED points, so the
            // lift belongs inside it — the same f32 lift the kernel's
            // prologue performs (liftEscape4F32's doc).
            (q) =>
              estimateEscapeDistance4F32(sys.de, liftEscape4F32(sys.view4, q)),
            escape4EvalConfig,
            gpu,
            escape4CompileMs,
            gpuMs,
          );
          results.agreement.push(row);
          const excluded = row.excluded ?? 0;
          if (excluded > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4 agreement ${sys.name}: excluded ${excluded}/${row.n} ` +
                `queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP}) from the ` +
                "f32-stability gate — see compareSurfaceForwardAgreement's doc",
            );
          }
          const flips = row.chaoticFlips ?? 0;
          if (flips > SURFACE_ESCAPE_FLIP_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4 agreement ${sys.name}: ${flips} verified chaotic ` +
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

    await canaryCheck("the M7 escape4 agreement leg");

    // ----- The SHAPE-TRAP agreement legs (escape/bulb/escape4 + trap) -----
    // The trap is COLOR ONLY, so the CPU oracle values are the plain legs'
    // own — what these rows pin is everything the channel appends to the
    // wire and the module: the baked-SDF compile, the trap params block at
    // its ONE offset per dimension (a misplaced append corrupts the frozen
    // fields, which the distance agreement catches immediately — the
    // lens4Fold corruption's class), and the pads that hold the plane
    // region under it. One representative fixture per family, under the
    // same forward-orbit classifier layers and caps as the plain legs; the
    // rows are distinguished by the "+trap" system name.
    {
      const trap = resolveShapeTrap({
        shape: PEACE_SIGN_SHAPE,
        position: [0.3, -0.2, 0.5],
        rotation: [0.2, 0, 0.4],
        scale: 0.5,
        mode: "threshold",
        threshold: 0.3,
        fade: 0.05,
      });
      const trapLegs: {
        family: "escape" | "bulb" | "escape4";
        sys:
          | SurfaceEscapeSystemState
          | SurfaceBulbSystemState
          | SurfaceEscape4SystemState
          | undefined;
      }[] = [
        {
          family: "escape",
          sys:
            escapeSystems.find((s) => s.name === "escChainPair") ??
            escapeSystems[0],
        },
        { family: "bulb", sys: bulbSystems[0] },
        { family: "escape4", sys: escape4Systems[0] },
      ];
      for (const leg of trapLegs) {
        const base = leg.sys;
        if (!base) continue;
        const cfg: SurfaceKernelConfig = {
          core: leg.family,
          variant: "private",
          width: SURFACE_FOLD_BEAM_WIDTH,
          stage2: false,
          wg: surfaceWgFor(config, "private"),
        };
        const label = `${configLabel(cfg)}+trap`;
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        const layout = surfaceForwardBindGroupLayout(device);
        const pipelineLayout = device.createPipelineLayout({
          label: `surface-de ${leg.family}+trap pipeline layout`,
          bindGroupLayouts: [layout],
        });
        let pipeline: GPUComputePipeline | null = null;
        let compileMs = 0;
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: leg.family,
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
            shapeTrap: PEACE_SIGN_SHAPE,
          });
          ({ pipeline, compileMs } = await buildSurfacePipeline(
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
        if (pipeline === null) continue;
        // A fresh state that SHARES the base fixture's queries and oracle
        // values (the trap moves no distance) but owns its buffers, so the
        // plain leg's cached set is untouched and the row's system name is
        // its own.
        if (leg.family === "escape") {
          const src = base as SurfaceEscapeSystemState;
          const sys: SurfaceEscapeSystemState = {
            ...src,
            name: `${src.name}+trap`,
            buffers: undefined,
          };
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceForwardEvalBuffers(
            device,
            layout,
            sys,
            packEscapeGpuParams(
              sys.de,
              { itemCount: sys.queries.length, cutoff: 0 },
              null,
              trap,
            ),
            packEscapeGpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            cfg.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            (q) => estimateEscapeDistanceF32(sys.de, q),
            cfg,
            gpu,
            compileMs,
            gpuMs,
          );
          results.agreement.push(row);
          if ((row.excluded ?? 0) > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape+trap agreement ${sys.name}: excluded ` +
                `${row.excluded ?? 0}/${row.n} queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP})`,
            );
          }
          if ((row.chaoticFlips ?? 0) > SURFACE_ESCAPE_FLIP_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape+trap agreement ${sys.name}: ${row.chaoticFlips ?? 0} ` +
                `verified chaotic flips (> ${SURFACE_ESCAPE_FLIP_CAP})`,
            );
          }
          destroySurfaceForwardEvalBuffers(sys);
        } else if (leg.family === "bulb") {
          const src = base as SurfaceBulbSystemState;
          const sys: SurfaceBulbSystemState = {
            ...src,
            name: `${src.name}+trap`,
            buffers: undefined,
          };
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceForwardEvalBuffers(
            device,
            layout,
            sys,
            packBulbGpuParams(
              sys.de,
              { itemCount: sys.queries.length, cutoff: 0 },
              null,
              trap,
            ),
            // The bulb core declares no maps binding; one zero stride
            // fills the layout's slot exactly as the plain leg does.
            new Float32Array(SURFACE_GPU_MAP_VEC4 * 4),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            cfg.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            (q) => estimateBulbDistanceF32(sys.de, q),
            cfg,
            gpu,
            compileMs,
            gpuMs,
          );
          results.agreement.push(row);
          if ((row.excluded ?? 0) > SURFACE_BULB_EXCLUDED_CAP) {
            bulbGateFail = true;
            results.notes.push(
              `bulb+trap agreement ${sys.name}: excluded ` +
                `${row.excluded ?? 0}/${row.n} queries (> ${SURFACE_BULB_EXCLUDED_CAP})`,
            );
          }
          if ((row.chaoticFlips ?? 0) > SURFACE_BULB_FLIP_CAP) {
            bulbGateFail = true;
            results.notes.push(
              `bulb+trap agreement ${sys.name}: ${row.chaoticFlips ?? 0} ` +
                `verified chaotic flips (> ${SURFACE_BULB_FLIP_CAP})`,
            );
          }
          destroySurfaceForwardEvalBuffers(sys);
        } else {
          const src = base as SurfaceEscape4SystemState;
          const sys: SurfaceEscape4SystemState = {
            ...src,
            name: `${src.name}+trap`,
            buffers: undefined,
          };
          status(`agreement: ${label} × ${sys.name}…`);
          await ensureSurfaceForwardEvalBuffers(
            device,
            layout,
            sys,
            packEscape4GpuParams(
              sys.de,
              sys.view4,
              { itemCount: sys.queries.length, cutoff: 0 },
              null,
              trap,
            ),
            packEscape4GpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            cfg.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            sys.de.boundingRadius,
            (q) =>
              estimateEscapeDistance4F32(sys.de, liftEscape4F32(sys.view4, q)),
            cfg,
            gpu,
            compileMs,
            gpuMs,
          );
          results.agreement.push(row);
          if ((row.excluded ?? 0) > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4+trap agreement ${sys.name}: excluded ` +
                `${row.excluded ?? 0}/${row.n} queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP})`,
            );
          }
          if ((row.chaoticFlips ?? 0) > SURFACE_ESCAPE_FLIP_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4+trap agreement ${sys.name}: ${row.chaoticFlips ?? 0} ` +
                `verified chaotic flips (> ${SURFACE_ESCAPE_FLIP_CAP})`,
            );
          }
          destroySurfaceForwardEvalBuffers(sys);
        }
        render();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    }

    // ----- Shape-trap GEOMETRY agreement (escape + escape4) -----
    // Unlike the color-only rows above, these two rows change the distance
    // value: the posed peace-sign SDF is divided by dr AFTER each sampled
    // link, admitted only at levels 0..2, then min-unioned with the ordinary
    // escape term. The dedicated f32 twins include that same term, so the
    // forward-orbit stability classifier still separates chaotic orbit
    // divergence from a shader/packer defect. Bulb is deliberately absent:
    // power maps are outside the conformal fold-only geometry gate.
    {
      const trap = resolveShapeTrap({
        shape: PEACE_SIGN_SHAPE,
        position: [0.3, -0.2, 0.5],
        rotation: [0.2, 0, 0.4],
        scale: 0.5,
        geometry: true,
        geometryLevelMin: 0,
        geometryLevelMax: 2,
      });
      const cfgFor = (core: "escape" | "escape4"): SurfaceKernelConfig => ({
        core,
        variant: "private",
        width: SURFACE_FOLD_BEAM_WIDTH,
        stage2: false,
        wg: surfaceWgFor(config, "private"),
      });

      const escapeBase =
        escapeSystems.find((s) => s.name === "escChainPair") ??
        escapeSystems[0];
      if (escapeBase) {
        const cfg = cfgFor("escape");
        const label = `${configLabel(cfg)}+trap-geometry`;
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        const layout = surfaceForwardBindGroupLayout(device);
        const pipelineLayout = device.createPipelineLayout({
          label: "surface-de escape+trap-geometry pipeline layout",
          bindGroupLayouts: [layout],
        });
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: "escape",
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry: trap,
          });
          const { pipeline, compileMs } = await buildSurfacePipeline(
            device,
            pipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          );
          const evalF32 = (q: Vec3): number =>
            estimateEscapeDistanceF32(escapeBase.de, q, trap);
          const cpu64 = escapeBase.queries.map((q) =>
            estimateEscapeDistance(
              escapeBase.de,
              q,
              ESCAPE_TIME_ITERATIONS,
              trap,
            ),
          );
          const geometryWins = cpu64.reduce(
            (count, distance, i) =>
              count + (distance < escapeBase.cpu64[i] ? 1 : 0),
            0,
          );
          results.notes.push(
            `escape+trap-geometry active samples ${geometryWins}/${cpu64.length}`,
          );
          // A numerically green row whose trap never wins only re-tests the
          // classic escape term. Keep a material activation population so
          // the real-driver gate genuinely reaches the new min-union.
          if (geometryWins < 32) {
            escapeGateFail = true;
            results.notes.push(
              `escape+trap-geometry activation too sparse: ${geometryWins}/${cpu64.length} (< 32)`,
            );
          }
          const R = escapeBase.de.boundingRadius;
          const sys: SurfaceEscapeSystemState = {
            ...escapeBase,
            name: `${escapeBase.name}+trap-geometry`,
            cpu64,
            cpu32: escapeBase.queries.map(evalF32),
            stable: cpu64.map((c64, i) =>
              forwardQueryStable(
                evalF32,
                escapeBase.queries[i],
                c64,
                surfaceEvalTol(c64, R),
              ),
            ),
            buffers: undefined,
          };
          await ensureSurfaceForwardEvalBuffers(
            device,
            layout,
            sys,
            packEscapeGpuParams(
              sys.de,
              { itemCount: sys.queries.length, cutoff: 0 },
              null,
              trap,
            ),
            packEscapeGpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            cfg.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            R,
            evalF32,
            cfg,
            gpu,
            compileMs,
            gpuMs,
          );
          results.agreement.push(row);
          if ((row.excluded ?? 0) > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape+trap-geometry agreement ${sys.name}: excluded ` +
                `${row.excluded ?? 0}/${row.n} queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP})`,
            );
          }
          if ((row.chaoticFlips ?? 0) > SURFACE_ESCAPE_FLIP_CAP) {
            escapeGateFail = true;
            results.notes.push(
              `escape+trap-geometry agreement ${sys.name}: ` +
                `${row.chaoticFlips ?? 0} verified chaotic flips ` +
                `(> ${SURFACE_ESCAPE_FLIP_CAP})`,
            );
          }
          destroySurfaceForwardEvalBuffers(sys);
        } catch (e) {
          compileFailed = true;
          results.notes.push(`agreement ${label}: ${describeError(e)}`);
        }
        render();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }

      const escape4Base = escape4Systems[0];
      if (escape4Base) {
        const cfg = cfgFor("escape4");
        const label = `${configLabel(cfg)}+trap-geometry`;
        status(`agreement: compiling ${label}…`);
        activity.setState("gpu", `Surface DE agreement — ${label}`);
        const layout = surfaceForwardBindGroupLayout(device);
        const pipelineLayout = device.createPipelineLayout({
          label: "surface-de escape4+trap-geometry pipeline layout",
          bindGroupLayouts: [layout],
        });
        try {
          const code = surfaceDeKernelWgsl({
            mode: "eval",
            core: "escape4",
            width: cfg.width,
            workgroupSize: cfg.wg,
            sharedFrontier: false,
            bnbStage2: false,
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry: trap,
          });
          const { pipeline, compileMs } = await buildSurfacePipeline(
            device,
            pipelineLayout,
            code,
            "evalQueries",
            `surface-de eval ${label}`,
          );
          const evalF32 = (q: Vec3): number =>
            estimateEscapeDistance4F32(
              escape4Base.de,
              liftEscape4F32(escape4Base.view4, q),
              trap,
            );
          const cpu64 = escape4Base.queries.map((q) =>
            estimateEscape4Composed(escape4Base.de, escape4Base.view4, q, trap),
          );
          const geometryWins = cpu64.reduce(
            (count, distance, i) =>
              count + (distance < escape4Base.cpu64[i] ? 1 : 0),
            0,
          );
          results.notes.push(
            `escape4+trap-geometry active samples ${geometryWins}/${cpu64.length}`,
          );
          if (geometryWins < 32) {
            escape4GateFail = true;
            results.notes.push(
              `escape4+trap-geometry activation too sparse: ${geometryWins}/${cpu64.length} (< 32)`,
            );
          }
          const R = escape4Base.de.boundingRadius;
          const sys: SurfaceEscape4SystemState = {
            ...escape4Base,
            name: `${escape4Base.name}+trap-geometry`,
            cpu64,
            cpu32: escape4Base.queries.map(evalF32),
            stable: cpu64.map((c64, i) =>
              forwardQueryStable(
                evalF32,
                escape4Base.queries[i],
                c64,
                surfaceEvalTol(c64, R),
              ),
            ),
            buffers: undefined,
          };
          await ensureSurfaceForwardEvalBuffers(
            device,
            layout,
            sys,
            packEscape4GpuParams(
              sys.de,
              sys.view4,
              { itemCount: sys.queries.length, cutoff: 0 },
              null,
              trap,
            ),
            packEscape4GpuMaps(sys.de),
          );
          const t0 = performance.now();
          const gpu = await runSurfaceEvalDispatch(
            device,
            pipeline,
            sys,
            cfg.wg,
          );
          const gpuMs = performance.now() - t0;
          const row = compareSurfaceForwardAgreement(
            sys,
            R,
            evalF32,
            cfg,
            gpu,
            compileMs,
            gpuMs,
          );
          results.agreement.push(row);
          if ((row.excluded ?? 0) > SURFACE_ESCAPE_EXCLUDED_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4+trap-geometry agreement ${sys.name}: excluded ` +
                `${row.excluded ?? 0}/${row.n} queries (> ${SURFACE_ESCAPE_EXCLUDED_CAP})`,
            );
          }
          if ((row.chaoticFlips ?? 0) > SURFACE_ESCAPE_FLIP_CAP) {
            escape4GateFail = true;
            results.notes.push(
              `escape4+trap-geometry agreement ${sys.name}: ` +
                `${row.chaoticFlips ?? 0} verified chaotic flips ` +
                `(> ${SURFACE_ESCAPE_FLIP_CAP})`,
            );
          }
          destroySurfaceForwardEvalBuffers(sys);
        } catch (e) {
          compileFailed = true;
          results.notes.push(`agreement ${label}: ${describeError(e)}`);
        }
        render();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    }

    await canaryCheck("the shape-trap agreement legs");

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

    await canaryCheck("the cross-check leg");

    // ----- Leg A: march-unproject agreement — GATING -----
    // The app path's ray derivation against the CPU emulator, at the exact
    // kernel config SurfaceComputeRenderer compiles. An agreement gate, so
    // it runs on software adapters too (the CI path), like the eval legs.
    let unprojFailed = false;
    {
      // The leg compiles a FOLD march kernel, so it only ever runs on a
      // fold system (the affine systems beside them march a
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

      // Stage C: the same gate over a posted lens field class — the posted
      // affine core under the posted boxfold lens. Same truncation/failure
      // gating as the fold leg above.
      const lensSys = lensSystems.find(
        (s) => s.name === "lensBoxfoldPostOverAffine",
      );
      if (!lensSys) {
        results.marchUnprojectLens = {
          skipped: "lensBoxfoldPostOverAffine did not build (see notes)",
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

      // balloonMarch: the same gate through the balloon inverted-union —
      // one fold system's kernel with `balloon: true` at the rest regime
      // R = 1.6 (rest is what persists, and it measured clean; the 0.35
      // rough regime is the eval leg's to pin for values). Same
      // truncation/failure gating as the legs above, the silhouette-flip
      // machinery included (its caps unchanged).
      const balloonSys = foldSystems.find(
        (s) => s.name === "foldSpherefoldPair",
      );
      if (!balloonSys) {
        results.marchUnprojectBalloon = {
          skipped: "foldSpherefoldPair did not build (see notes)",
        };
        render();
      } else {
        try {
          const row = await runSurfaceUnprojectLeg(
            device,
            balloonSys,
            acquired.software,
            status,
            activity,
            1.6,
          );
          results.marchUnprojectBalloon = row;
          if (row.truncated) {
            unprojFailed = true;
            results.notes.push(
              `march-unproject balloon: truncated at ${SURFACE_UNPROJ_CAP_MS}ms — ` +
                "agreement not verifiable, failing the leg",
            );
          } else if (row.failures > 0) {
            unprojFailed = true;
          }
        } catch (e) {
          unprojFailed = true;
          results.marchUnprojectBalloon = { skipped: describeError(e) };
          results.notes.push(`march-unproject balloon: ${describeError(e)}`);
        }
        render();
      }

      // M8: the same bounded unproject gate over Gearworks' condensation
      // field. Appended after the established three legs so their fixtures,
      // output ordering and measurements stay stable.
      const condensationSys = condensationSystems.find(
        (s) => s.name === "gearworksCondensation",
      );
      if (!condensationSys) {
        unprojFailed = true;
        results.marchUnprojectCondensation = {
          skipped: "gearworksCondensation did not build (see notes)",
        };
        results.notes.push(
          "march-unproject condensation: Gearworks fixture did not build — failing the leg",
        );
        render();
      } else {
        try {
          const row = await runSurfaceUnprojectLeg(
            device,
            condensationSys,
            acquired.software,
            status,
            activity,
          );
          results.marchUnprojectCondensation = row;
          if (row.truncated) {
            unprojFailed = true;
            results.notes.push(
              `march-unproject condensation: truncated at ${SURFACE_UNPROJ_CAP_MS}ms — ` +
                "agreement not verifiable, failing the leg",
            );
          } else if (row.failures > 0) {
            unprojFailed = true;
          }
        } catch (e) {
          unprojFailed = true;
          results.marchUnprojectCondensation = {
            skipped: describeError(e),
          };
          results.notes.push(
            `march-unproject condensation: ${describeError(e)}`,
          );
        }
        render();
      }

      // The shipped scheduled hybrid through the same app-derived rays.
      // This leg has an extra anti-vacuity gate: it must dispatch, finish,
      // agree, and resolve a mixed hit/background raster on BOTH sides.
      try {
        const row = await runSurfaceUnprojectLeg(
          device,
          scheduledSystem,
          acquired.software,
          status,
          activity,
        );
        results.marchUnprojectSchedule = row;
        const acceptance = surfaceScheduleMarchAcceptance(row);
        results.notes.push(
          `march-unproject schedule ${row.system}: passes=${String(row.passes)} ` +
            `completed=${String(acceptance.completed)} agreed=${String(acceptance.agreed)} ` +
            `gpuHits=${String(row.gpuHits)}/${String(row.rays)} ` +
            `cpuHits=${String(row.cpuHits)}/${String(row.rays)} ` +
            `useful=${String(acceptance.gpuUseful && acceptance.cpuUseful)}`,
        );
        if (!acceptance.ok) {
          unprojFailed = true;
          results.notes.push(
            "march-unproject schedule: anti-vacuity gate failed — requires passes>0, " +
              "completion, failures=0, and a nonempty/non-full hit mix on GPU and CPU",
          );
        }
      } catch (e) {
        unprojFailed = true;
        results.marchUnprojectSchedule = { skipped: describeError(e) };
        results.notes.push(`march-unproject schedule: ${describeError(e)}`);
      }
      render();

      // The shipped isolated Fern | Sponge graph through the same
      // unprojected app rays. The explicit spec assertion plus the leg
      // driver's chaos-aware source options keep this from falling back to
      // the classic all-paths kernel.
      try {
        surfaceChaosKernelSpec(chaosSystem.de);
        const row = await runSurfaceUnprojectLeg(
          device,
          chaosSystem,
          acquired.software,
          status,
          activity,
        );
        results.marchUnprojectChaos = row;
        const acceptance = surfaceChaosMarchAcceptance(row);
        results.notes.push(
          `march-unproject chaos ${row.system}: passes=${String(row.passes)} ` +
            `completed=${String(acceptance.completed)} agreed=${String(acceptance.agreed)} ` +
            `gpuHits=${String(row.gpuHits)}/${String(row.rays)} ` +
            `cpuHits=${String(row.cpuHits)}/${String(row.rays)} ` +
            `useful=${String(acceptance.gpuUseful && acceptance.cpuUseful)}`,
        );
        if (!acceptance.ok) {
          unprojFailed = true;
          results.notes.push(
            "march-unproject chaos: anti-vacuity gate failed — requires passes>0, " +
              "completion, failures=0, and a nonempty/non-full hit mix on GPU and CPU",
          );
        }
      } catch (e) {
        unprojFailed = true;
        results.marchUnprojectChaos = { skipped: describeError(e) };
        results.notes.push(`march-unproject chaos: ${describeError(e)}`);
      }
      render();
    }

    results.marchUnprojectSwirl = [];
    for (const sys of swirlSystems) {
      for (const balloonR of [null, 1.6]) {
        try {
          const row = await runSurfaceUnprojectLeg(
            device,
            sys,
            acquired.software,
            status,
            activity,
            balloonR,
          );
          results.marchUnprojectSwirl.push(row);
          const useful =
            row.gpuHits > 0 &&
            row.gpuHits < row.rays &&
            row.cpuHits > 0 &&
            row.cpuHits < row.rays;
          results.notes.push(
            `march-unproject swirl ${row.system}: passes=${String(row.passes)} failures=${String(row.failures)} gpuHits=${String(row.gpuHits)}/${String(row.rays)} cpuHits=${String(row.cpuHits)}/${String(row.rays)} truncated=${String(row.truncated)}`,
          );
          if (
            row.truncated ||
            row.failures > 0 ||
            row.passes === 0 ||
            !useful
          ) {
            unprojFailed = true;
            results.notes.push(
              `march-unproject swirl ${row.system}: requires completion, existing per-ray agreement, and a nonempty/non-full hit mix on both processors`,
            );
          }
        } catch (e) {
          unprojFailed = true;
          results.notes.push(
            `march-unproject swirl ${sys.name}${balloonR === null ? "" : "+balloon"}: ${describeError(e)}`,
          );
        }
        render();
      }
    }

    results.marchUnprojectFiniteBalloon = [];
    for (const { sys, tiling, balloonR, pose } of finiteBalloonFrames) {
      try {
        const row = await runSurfaceUnprojectLeg(
          device,
          sys,
          acquired.software,
          status,
          activity,
          balloonR,
          tiling,
          pose,
        );
        results.marchUnprojectFiniteBalloon.push(row);
        results.notes.push(
          `march-unproject finite Balloon ${row.system}: passes=${row.passes} failures=${row.failures} gpuHits=${row.gpuHits}/${row.rays} cpuHits=${row.cpuHits}/${row.rays} source=${String(row.finiteBalloonHits?.source ?? 0)} shell=${String(row.finiteBalloonHits?.shell ?? 0)} truncated=${row.truncated}`,
        );
        if (
          row.truncated ||
          row.failures > 0 ||
          row.passes === 0 ||
          row.gpuHits === 0 ||
          row.cpuHits === 0 ||
          row.gpuHits === row.rays ||
          row.cpuHits === row.rays ||
          (row.finiteBalloonHits?.source ?? 0) === 0 ||
          (row.finiteBalloonHits?.shell ?? 0) === 0
        ) {
          unprojFailed = true;
        }
      } catch (e) {
        unprojFailed = true;
        results.notes.push(
          `march-unproject finite Balloon ${sys.name}: ${describeError(e)}`,
        );
      }
      render();
    }

    await canaryCheck("the march-unproject legs");

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

    await canaryCheck("the timing protocol");

    // ----- Leg B: end-to-end frame via SurfaceComputeRenderer --
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

      // Tier 3: Star Foundry through the production renderer rather than
      // the buffer-only direct-eval fixture. This is the path that owns the
      // frozen binding-11 texture and uploads the active mesh-atlas slab; the
      // strided CPU march makes it an agreement gate, not a compile-only
      // reachability leg.
      if (!meshCondensationSystem) {
        frameFailed = true;
        results.computeFrameMesh = {
          skipped: "Star Foundry mesh fixture did not build (see notes)",
        };
        results.notes.push(
          "compute frame mesh: Star Foundry fixture unavailable — failing the leg",
        );
      } else {
        try {
          const row = await runSurfaceComputeFrameLeg(
            meshCondensationSystem,
            acquired.software,
            dom,
            status,
            activity,
            {
              canvasLabel: "frame-mesh",
              cheapShade: true,
              cpuSanity: true,
              label: "compute frame mesh",
              smallRaster: true,
            },
          );
          results.computeFrameMesh = row;
          const gpuRate = row.sanityGpuHitRate;
          const cpuRate = row.sanityCpuHitRate;
          const rateGap =
            gpuRate === undefined || cpuRate === undefined
              ? Infinity
              : Math.abs(gpuRate - cpuRate);
          const mismatchRate = row.sanityMismatchRate ?? Infinity;
          const rendererSoftware = row.software ?? acquired.software;
          const activated = row.passes > 0;
          const geometry = row.counts.hit > 0;
          const sampledMixed =
            gpuRate !== undefined &&
            cpuRate !== undefined &&
            gpuRate > 0 &&
            gpuRate < 1 &&
            cpuRate > 0 &&
            cpuRate < 1;
          const settled =
            rendererSoftware ||
            (!row.truncated &&
              row.counts.miss > 0 &&
              row.counts.exhausted === 0 &&
              row.counts.active === 0);
          const rateAgreed =
            row.truncated || mismatchRate <= SURFACE_SANITY_HIT_RATE_TOL;
          results.notes.push(
            `compute frame mesh ${meshCondensationSystem.name} ${String(row.width)}x${String(
              row.height,
            )}: passes=${String(row.passes)} hit=${String(row.counts.hit)} ` +
              `miss=${String(row.counts.miss)} exhausted=${String(row.counts.exhausted)} ` +
              `active=${String(row.counts.active)} truncated=${String(row.truncated)} ` +
              `hitRate gpu=${gpuRate?.toFixed(3) ?? "n/a"} cpu=${cpuRate?.toFixed(3) ?? "n/a"} ` +
              `gap=${Number.isFinite(rateGap) ? rateGap.toFixed(3) : "n/a"} ` +
              `samePixelMismatch=${Number.isFinite(mismatchRate) ? mismatchRate.toFixed(3) : "n/a"} ` +
              `adapter=${row.adapterLabel ?? "unknown"} software=${String(rendererSoftware)}`,
          );
          if (
            !activated ||
            !geometry ||
            !sampledMixed ||
            !settled ||
            !rateAgreed
          ) {
            frameFailed = true;
            results.notes.push(
              "compute frame mesh: acceptance failed — requires dispatches and hits; " +
                "the same-pixel CPU/GPU sample must contain both hit and background; " +
                "a real adapter must settle to a HIT/MISS mix, and every completed frame's " +
                `sampled hit-mask mismatch rate must be <= ${String(SURFACE_SANITY_HIT_RATE_TOL)}`,
            );
          }
          if (row.truncated) {
            results.notes.push(
              `compute frame mesh: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget — ` +
                (rendererSoftware
                  ? "software-adapter activation/geometry only; the incomplete hit rate is disclosed but not gated"
                  : "failing the leg: a real-adapter mesh frame must complete"),
            );
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrameMesh = { skipped: describeError(e) };
          results.notes.push(`compute frame mesh: ${describeError(e)}`);
        }
      }
      render();

      // The production host-loop proof for the scheduled field class.
      // Unlike the ordinary presentation row, this one cannot pass merely
      // by creating its four pipelines: it must dispatch and resolve real
      // scheduled geometry. A real-GPU frame must additionally complete
      // with a clean HIT/MISS terminal mix and no exhausted or active rays.
      try {
        const row = await runSurfaceComputeFrameLeg(
          scheduledSystem,
          acquired.software,
          dom,
          status,
          activity,
        );
        results.computeFrameSchedule = row;
        const acceptance = surfaceScheduleFrameAcceptance(
          row,
          acquired.software,
        );
        results.notes.push(
          `compute frame schedule ${SURFACE_SCHEDULE_ROW_3D} ${String(row.width)}x${String(
            row.height,
          )}: passes=${String(row.passes)} hit=${String(row.counts.hit)} ` +
            `miss=${String(row.counts.miss)} exhausted=${String(row.counts.exhausted)} ` +
            `active=${String(row.counts.active)} truncated=${String(row.truncated)} ` +
            `activated=${String(acceptance.activated)} geometry=${String(acceptance.geometry)} ` +
            `settled=${String(acceptance.settled)}`,
        );
        if (!acceptance.ok) {
          frameFailed = true;
          results.notes.push(
            "compute frame schedule: acceptance failed — requires passes>0 and hit>0; " +
              "a completed real-adapter frame also requires miss>0, exhausted=0, active=0",
          );
        }
        if (row.truncated) {
          results.notes.push(
            `compute frame schedule: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget — ` +
              (acquired.software
                ? "accepted only when dispatch activation and scheduled geometry are visible"
                : "failing the leg: a real-adapter schedule frame must complete"),
          );
        }
      } catch (e) {
        frameFailed = true;
        results.computeFrameSchedule = { skipped: describeError(e) };
        results.notes.push(`compute frame schedule: ${describeError(e)}`);
      }
      render();

      // Production renderer over the graph-directed field. Software
      // truncation remains diagnostic-only, while real adapters must settle
      // every ray into a nonempty HIT/MISS mix.
      try {
        surfaceChaosKernelSpec(chaosSystem.de);
        const row = await runSurfaceComputeFrameLeg(
          chaosSystem,
          acquired.software,
          dom,
          status,
          activity,
        );
        results.computeFrameChaos = row;
        const acceptance = surfaceChaosFrameAcceptance(row, acquired.software);
        results.notes.push(
          `compute frame chaos ${SURFACE_CHAOS_ROW_3D} ${String(row.width)}x${String(
            row.height,
          )}: passes=${String(row.passes)} hit=${String(row.counts.hit)} ` +
            `miss=${String(row.counts.miss)} exhausted=${String(row.counts.exhausted)} ` +
            `active=${String(row.counts.active)} truncated=${String(row.truncated)} ` +
            `activated=${String(acceptance.activated)} geometry=${String(acceptance.geometry)} ` +
            `settled=${String(acceptance.settled)}`,
        );
        if (!acceptance.ok) {
          frameFailed = true;
          results.notes.push(
            "compute frame chaos: acceptance failed — requires passes>0 and hit>0; " +
              "a completed real-adapter frame also requires miss>0, exhausted=0, active=0",
          );
        }
        if (row.truncated) {
          results.notes.push(
            `compute frame chaos: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget — ` +
              (acquired.software
                ? "software-adapter diagnostic only; activation and visible geometry still gate"
                : "failing the leg: a real-adapter chaos frame must complete"),
          );
        }
      } catch (e) {
        frameFailed = true;
        results.computeFrameChaos = { skipped: describeError(e) };
        results.notes.push(`compute frame chaos: ${describeError(e)}`);
      }
      render();

      // Stage C: the PRODUCTION renderer over the posted lens field class —
      // lensBoxfoldPostOverAffine through the same create/frame protocol
      // (its DE derives core "affine" + lens:true and the branch-scaled
      // priors inside the renderer). Same gates.
      const lensSys = lensSystems.find(
        (s) => s.name === "lensBoxfoldPostOverAffine",
      );
      if (!lensSys) {
        results.computeFrameLens = {
          skipped: "lensBoxfoldPostOverAffine did not build (see notes)",
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

      // Leg B over the escape class — the PRODUCTION renderer on
      // escMandelbox through `{ kind: "escape" }` (forward-orbit core, no
      // maps buffer). Same gates, plus the strided CPU sanity march's
      // hit-rate band on real hardware (see the leg's design comment).
      //
      // NO BULB TWIN. When this leg was written the PRODUCTION
      // `SurfaceComputeRenderer`'s target union carried no
      // `{ kind: "bulb" }` arm at all, so a frame leg written against a
      // renderer path that did not exist would have pinned nothing; the
      // arm has since landed with the bulb routing, and the twin still has
      // not, because what it would buy is already bought here: the
      // march/shade ENTRY text is shared across every core (test-pinned)
      // and the bulb DE is eval-pinned by M6 above, which is exactly the
      // argument the escape frame leg's own doc makes for checking hit
      // RATES instead of pixels.
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

      // The same leg over a CROSS-FAMILY chain — one PRODUCTION
      // frame of `escChainBulb` (mandelbox -> triplex power) through the
      // unchanged `{ kind: "escape" }` target. The eval leg above pins the
      // VALUE body's two power branches over 700 stability-gated queries
      // per row; this pins what has no value-body counterpart — the
      // hit-info body's own power branch and the degree-selected escape
      // count — and demonstrates the routing claim end to end. Same
      // gates, same rate band, same truncation convention, and the same
      // per-frame cost as its fold sibling (measured 154ms on real Iris).
      const escXfamSys = escapeSystems.find((s) => s.name === "escChainBulb");
      if (!escXfamSys) {
        results.computeFrameEscapeXfam = {
          skipped: "escChainBulb did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrameEscapeLeg(
            escXfamSys,
            acquired.software,
            dom,
            status,
            activity,
            "frame-escape-xfam",
          );
          results.computeFrameEscapeXfam = row;
          results.notes.push(
            `compute frame escape xfam (escChainBulb) ${row.width}x${row.height}: ` +
              `wall=${row.wallMs.toFixed(0)}ms gpu=${row.gpuMs.toFixed(0)}ms ` +
              `passes=${String(row.passes)} hit=${String(row.counts.hit)} ` +
              `miss=${String(row.counts.miss)} exh=${String(row.counts.exhausted)} ` +
              `active=${String(row.counts.active)} rate gpu=${(row.sanityGpuHitRate ?? 0).toFixed(3)} ` +
              `cpu=${(row.sanityCpuHitRate ?? 0).toFixed(3)}` +
              (row.truncated ? " TRUNCATED" : ""),
          );
          if (row.counts.hit === 0 && !acquired.software) {
            frameFailed = true;
            results.notes.push(
              "compute frame escape xfam: zero hit rays on a real adapter — failing the leg",
            );
          }
          if (row.truncated) {
            results.notes.push(
              `compute frame escape xfam: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
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
                  `compute frame escape xfam: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march — informational on a software adapter`,
                );
              } else {
                frameFailed = true;
                results.notes.push(
                  `compute frame escape xfam: hit-rate gap ${gap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
                );
              }
            }
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrameEscapeXfam = { skipped: describeError(e) };
          results.notes.push(`compute frame escape xfam: ${describeError(e)}`);
        }
      }
      render();

      // Stage B2: leg B over the ifs4 class — TWO frames on
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

      // The fold4 twin of the leg above — the SAME
      // runSurfaceComputeFrame4Leg body, on the fold4Slab fixture instead
      // of aff4Kaleido. SurfaceComputeRenderer.create routes an ifs4
      // target whose DE carries fold maps to core:"fold4" on its own
      // (deHasFolds4, surface-compute.ts), so nothing here duplicates the
      // leg's create/frame protocol — only this invocation block, mirroring
      // how computeFrame/computeFrameLens already share one leg function
      // with per-system invocation blocks. Same gates as the leg above.
      // fold4Slab over fold4Boxfold deliberately: the boxfold pair's M4
      // view slices EMPTY at this leg's raster (measured — GPU and CPU
      // agreed on zero hits, pinning only the pipeline path), while the
      // slab view's ±0.1R capture renders dense hits, so this leg
      // exercises the shade batches AND the production slab-pipeline
      // selection (runFrame picks the slab pair off the live
      // sliceHalfW > 0) in one frame.
      const fold4Sys = fold4Systems.find((s) => s.name === "fold4Slab");
      if (!fold4Sys) {
        results.computeFrame4Fold = {
          skipped: "fold4Slab did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrame4Leg(
            fold4Sys,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFrame4Fold = row;
          const frames = [
            {
              label: "compute frame fold4",
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
                    label: "compute frame fold4 view2",
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
            // Unlike the aff4Kaleido block above — whose two views were
            // AUTHORED to hit, so any zero-hit real-adapter frame is
            // breakage — this fixture's view2 hyperplane legitimately
            // misses the attractor (deliberate: a completed empty frame
            // the CPU sanity march ALSO reads empty pins the noslab
            // pair's emptiness agreement). The zero-hit clause therefore
            // defers to the CPU march on completed frames — the
            // completed-empty-vs-CPU-hits clause below is the authority —
            // and fails only truncated zero-hit frames, where agreement
            // cannot be read.
            if (fr.counts.hit === 0 && !acquired.software && fr.truncated) {
              frameFailed = true;
              results.notes.push(
                `${fr.label}: zero hit rays in a truncated real-adapter frame — failing the leg`,
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
          results.computeFrame4Fold = { skipped: describeError(e) };
          results.notes.push(`compute frame fold4: ${describeError(e)}`);
        }
      }
      render();
    }

    // ----- Opt-in GROUND-PLANE frame leg ---------------------------------
    // Off by default (`config.planeFrame`, `surfacePlaneFrame=1`) and
    // silent when not requested — the aff4 sweep's opt-in shape, for the
    // same reason: it is extra end-to-end work layered on a section that
    // already renders five frames, and nothing else here needs a floor.
    // When it DOES run it gates exactly like its escape sibling (zero hits
    // on a real adapter; both rate bands on an untruncated frame), and its
    // numbers also land in `notes` in the frame-row voice, since the
    // headless runner's stdout printer does not know this row.
    if (config.planeFrame) {
      // affineTetra — the cheapest 3D core, ball at the origin under the
      // pose's raised camera (see the leg's doc for the full argument).
      const planeSys = systems.find((s) => s.name === "affineTetra");
      if (!planeSys) {
        results.computeFramePlane = {
          skipped: "affineTetra did not build (see notes)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFramePlaneLeg(
            planeSys,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFramePlane = row;
          results.notes.push(
            `compute frame plane ${row.system} ${row.width}x${row.height}: ` +
              `wall=${row.wallMs.toFixed(0)}ms gpu=${row.gpuMs.toFixed(0)}ms ` +
              `passes=${String(row.passes)} hit=${String(row.counts.hit)} ` +
              `plane=${String(row.counts.plane)} miss=${String(row.counts.miss)} ` +
              `exhausted=${String(row.counts.exhausted)} ` +
              `hitRate=${row.sanityGpuHitRate.toFixed(3)}/${row.sanityCpuHitRate.toFixed(3)} ` +
              `planeRate=${row.sanityGpuPlaneRate.toFixed(3)}/${row.sanityCpuPlaneRate.toFixed(3)} ` +
              `(gpu/cpu over ${String(row.sanitySamples)} sanity rays)` +
              (row.truncated ? " TRUNCATED" : ""),
          );
          if (row.counts.hit === 0 && !acquired.software) {
            frameFailed = true;
            results.notes.push(
              "compute frame plane: zero hit rays on a real adapter — failing the leg",
            );
          }
          if (row.truncated) {
            // A truncated frame leaves rays `active` — unresolved to any
            // terminal status — so neither its hit rate nor its plane rate
            // is comparable to the always-complete CPU sample, and a zero
            // plane tally could be simple incompleteness. Every geometry
            // check below is skipped, the timing legs'
            // `sanity = "skipped (truncated)"` convention.
            results.notes.push(
              `compute frame plane: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
                (acquired.software
                  ? " — accepted on a software adapter"
                  : " — informational (the rate-band checks are skipped while truncated)"),
            );
          } else {
            // A COMPLETED frame with no PLANE rays at all never exercised
            // the status this leg exists for — vacuous rather than slow, so
            // unlike the rate bands it fails on EVERY adapter
            // ({@link SurfaceDeResults.computeFrame4}'s
            // completed-empty-vs-CPU-hits clause, one status over). Guarded
            // on the CPU march finding some, so it can never fire on a pose
            // that legitimately has no floor in frame.
            if (row.counts.plane === 0 && row.sanityCpuPlaneRate > 0) {
              frameFailed = true;
              results.notes.push(
                "compute frame plane: zero PLANE rays on a completed frame while the CPU sanity march found some — failing the leg",
              );
            }
            // Same band for both rates, and the same
            // software-is-informational split as the escape leg's (see the
            // leg's doc for why one constant covers hit and plane alike).
            for (const rate of [
              {
                label: "hit",
                gap: Math.abs(row.sanityGpuHitRate - row.sanityCpuHitRate),
              },
              {
                label: "plane",
                gap: Math.abs(row.sanityGpuPlaneRate - row.sanityCpuPlaneRate),
              },
            ]) {
              if (rate.gap <= SURFACE_SANITY_HIT_RATE_TOL) continue;
              if (acquired.software) {
                results.notes.push(
                  `compute frame plane: ${rate.label}-rate gap ${rate.gap.toFixed(3)} vs the CPU sanity march — informational on a software adapter`,
                );
              } else {
                frameFailed = true;
                results.notes.push(
                  `compute frame plane: ${rate.label}-rate gap ${rate.gap.toFixed(3)} vs the CPU sanity march exceeds ${String(SURFACE_SANITY_HIT_RATE_TOL)} — failing the leg`,
                );
              }
            }
          }
        } catch (e) {
          frameFailed = true;
          results.computeFramePlane = { skipped: describeError(e) };
          results.notes.push(`compute frame plane: ${describeError(e)}`);
        }
      }
      render();
    }

    results.computeFrameSwirl = [];
    for (const sys of swirlSystems) {
      const frameSys =
        sys.name === "lensSwirlPostOverAffine"
          ? {
              name: "lensSwirlPostOverAffineBalloonMild",
              transforms: sys.transforms,
              de: buildSurfaceDE(
                sys.transforms,
                surfaceLensSwirlBalloonFinal(),
              ),
            }
          : sys;
      try {
        const row = await runSurfaceComputeFrameLeg(
          frameSys,
          acquired.software,
          dom,
          status,
          activity,
          {
            canvasLabel: `frame-swirl-${frameSys.name}`,
            label: `swirl ${frameSys.name} + Balloon + wood`,
            smallRaster: true,
            deterministic: true,
            cpuSanity: true,
            balloonR: 1.6,
            pattern: true,
          },
        );
        results.computeFrameSwirl.push({ ...row, system: frameSys.name });
        results.notes.push(
          `compute frame swirl ${frameSys.name}: passes=${String(row.passes)} hit=${String(row.counts.hit)} miss=${String(row.counts.miss)} exhausted=${String(row.counts.exhausted)} active=${String(row.counts.active)} truncated=${String(row.truncated)} sampleMismatch=${String(row.sanityMismatchRate)}`,
        );
        if (
          row.passes === 0 ||
          row.counts.hit === 0 ||
          (!acquired.software &&
            (row.truncated ||
              row.counts.active > 0 ||
              row.counts.exhausted > 0 ||
              row.counts.miss === 0 ||
              (row.sanityMismatchRate ?? 1) > SURFACE_SANITY_HIT_RATE_TOL))
        ) {
          frameFailed = true;
          results.notes.push(
            `compute frame swirl ${frameSys.name}: requires live hit shading on every adapter, and a completed mixed frame within the existing CPU sanity band on real hardware`,
          );
        }
      } catch (e) {
        frameFailed = true;
        results.notes.push(
          `compute frame swirl ${frameSys.name}: ${describeError(e)}`,
        );
      }
      render();
    }

    results.computeFrameFiniteBalloon = [];
    for (const { sys, tiling, balloonR, pose } of finiteBalloonFrames) {
      try {
        const row = await runSurfaceComputeFrameLeg(
          sys,
          acquired.software,
          dom,
          status,
          activity,
          {
            canvasLabel: `frame-finite-balloon-${sys.name}`,
            label: `finite tiling + Balloon ${sys.name}`,
            smallRaster: true,
            deterministic: true,
            cpuSanity: true,
            balloonR,
            tiling,
            pose,
            pattern: true,
          },
        );
        results.computeFrameFiniteBalloon.push({ ...row, system: sys.name });
        results.notes.push(
          `compute frame finite Balloon ${sys.name}: passes=${row.passes} hit=${row.counts.hit} miss=${row.counts.miss} exhausted=${row.counts.exhausted} active=${row.counts.active} truncated=${row.truncated} sampleMismatch=${String(row.sanityMismatchRate)}`,
        );
        if (
          row.passes === 0 ||
          row.counts.hit === 0 ||
          row.truncated ||
          row.counts.active > 0 ||
          row.counts.exhausted > 0 ||
          row.counts.miss === 0 ||
          (row.sanityMismatchRate ?? 1) > SURFACE_SANITY_HIT_RATE_TOL
        )
          frameFailed = true;
      } catch (e) {
        frameFailed = true;
        results.notes.push(
          `compute frame finite Balloon ${sys.name}: ${describeError(e)}`,
        );
      }
      render();
    }

    await canaryCheck("the compute-frame legs");

    // ----- Opt-in per-kaleidoscope-order affine4/fold4 timing ------------
    // sweep. Off by default (`config.aff4Sweep`, `surfaceAff4Sweep=1`) —
    // never runs in CI, and silent (no notes at all) when not requested,
    // like the shade A/B leg's own `surfaceShadeWidths` gate. GATING when
    // it does run: a slab/no-slab OR uniform/storage-maps disagreement
    // beyond the leg's tolerance fails the section (see
    // `runSurfaceAff4SweepLeg`'s doc) — unlike the shade A/B leg below,
    // which stays purely informational. Every row and the pipelines'
    // compileMs also land in `notes` (the computeFrame4 leg's
    // dual-reporting convention), so a headless run's stdout discloses
    // them via the existing `note:` printer without a bespoke stdout
    // formatter in gpu-flame-bench.mjs.
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

    await canaryCheck("the aff4 sweep leg");

    // ----- Shade A/B leg: cheap shading-probe-width vs the --------------
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

    await canaryCheck("the shade A/B leg");

    // The exact finite primary must agree before optical transport can
    // establish anything about the geometry that receives those samples.
    let finitePrimaryGateFail = false;
    try {
      activity.setState("gpu", "Finite primary boundary agreement");
      status("finite primary: independent camera-boundary agreement…");
      const rows = await runSurfaceFinitePrimaryAgreement(device);
      results.finitePrimaryAgreement = rows;
      if (rows.length !== 6) finitePrimaryGateFail = true;
      for (const row of rows) {
        results.notes.push(
          `finite primary ${row.core} level=${String(row.level)} ${row.rays} optics=false: ${String(row.queries)} checks, ${String(row.failures)} failures, max depth delta=${row.maxDepthDelta.toExponential(3)}`,
        );
        if (row.failures > 0) {
          finitePrimaryGateFail = true;
          for (const check of row.checks.filter((check) => !check.pass))
            results.notes.push(
              `finite primary ${row.core} ${check.label}: ${JSON.stringify(check)}`,
            );
        }
      }
    } catch (error) {
      finitePrimaryGateFail = true;
      results.notes.push(`finite primary agreement: ${describeError(error)}`);
    }
    render();
    await canaryCheck("the finite primary agreement legs");

    // ----- Optical-transport agreement legs (per core) — GATING -----
    // The emitted optics body (mode "shade" + optics) pinned per kernel
    // core against surface-transport-fixture.ts's CPU twin — the boundary
    // query on unanchored/anchored probes, the replay trace on the
    // primary-hit rays, over a deterministic probe set. Fail closed: any
    // comparison mismatch throws out of the leg, and the catch turns it
    // into the gate flag below; a missing fixture system skips with a
    // note instead.
    try {
      const { rows, notes: transportNotes } =
        await runSurfaceTransportAgreementLegs(
          device,
          {
            descent: systems,
            escape: escapeSystems,
            bulb: bulbSystems,
            affine4: affine4Systems,
            fold4: fold4Systems,
            escape4: escape4Systems,
          },
          status,
          activity,
          (text) => results.notes.push(text),
        );
      results.transportAgreement = rows;
      for (const n of transportNotes) results.notes.push(n);
      for (const row of rows) {
        // The computeFrame4 dual-reporting convention: the headless
        // runner's stdout printer predates this field, so the row also
        // lands in `notes` and the run's summary discloses it.
        results.notes.push(surfaceTransportAgreementNote(row));
      }
      if (rows.length === 0) {
        results.notes.push(
          "transport agreement: no core ran — every fixture system was unavailable (see notes)",
        );
      }
    } catch (e) {
      transportGateFail = true;
      results.notes.push(`transport agreement: ${describeError(e)}`);
    }
    render();

    await canaryCheck("the transport agreement legs");

    // ----- Optical-transport renderer envelope (GATING on real adapters) -----
    // The open criterion the kernel agreement legs cannot reach: an
    // optics-authored fixture document through the PRODUCTION renderer at
    // the delegated preview/settle rasters, gated on the decided envelope's
    // lines. A software adapter skips — the lines are real-driver
    // measurements, and SwiftShader timing certifies nothing (the
    // agreement legs above already cover the kernels' reachability).
    let transportEnvelopeGateFail = false;
    if (acquired.software) {
      results.notes.push(
        "transport envelope: skipped on a software adapter — the feasibility lines are real-driver measurements",
      );
    } else {
      try {
        const rows = await runSurfaceTransportEnvelopeLeg(
          systems,
          affine4Systems,
          dom,
          status,
          activity,
        );
        results.transportEnvelope = rows;
        for (const row of rows) {
          results.notes.push(surfaceTransportEnvelopeNote(row));
          if (surfaceTransportEnvelopeRowFailures(row).length > 0) {
            transportEnvelopeGateFail = true;
          }
        }
        if (rows.length < 2) {
          transportEnvelopeGateFail = true;
          results.notes.push(
            "transport envelope: fewer than two dimensional arms ran (see notes)",
          );
        }
      } catch (e) {
        transportEnvelopeGateFail = true;
        results.notes.push(`transport envelope: ${describeError(e)}`);
      }
      render();

      await canaryCheck("the transport envelope leg");
    }
    // Exact scheduling agreement is independent of adapter timing. Reuse
    // the finite envelope's actual preset recipe at a bounded raster and
    // retain every AA sample's raw state, including refusal controls.
    try {
      const rows: FiniteTransportChunkRow[] = [];
      results.finiteTransportChunks = rows;
      await runSurfaceTransportEnvelopeLeg(
        systems,
        affine4Systems,
        dom,
        status,
        activity,
        rows,
        acquired.software,
      );
      if (
        rows.length !== 2 ||
        rows[0]?.core !== "finite" ||
        rows[1]?.core !== "finite4"
      ) {
        transportGateFail = true;
        results.notes.push(
          "finite chunk agreement: both dimensional rows are required",
        );
      }
      for (const row of rows) {
        const failures = finiteTransportChunkFailures(row);
        results.notes.push(
          `finite chunk agreement ${row.core}: ${String(row.controls.length)} success controls, ${String(row.uncachedControls.length)} uncached controls, ${String(row.processedLimitControls.length)} processed-limit controls, ${String(failures.length)} failures`,
        );
        for (const failure of failures)
          results.notes.push(`finite chunk agreement ${row.core}: ${failure}`);
        if (failures.length > 0) transportGateFail = true;
      }
    } catch (error) {
      transportGateFail = true;
      results.notes.push(`finite chunk agreement: ${describeError(error)}`);
    }
    render();
    await canaryCheck("the finite chunk agreement controls");
    await runSphereInversionLegs();

    await canaryCheck("the sphere-inversion legs");

    // ----- Verdict -----
    // Only production-width rows gate: the CPU oracle's fold frontier is
    // the fixed SURFACE_FOLD_BEAM_WIDTH scratch, so narrower-width rows
    // measure the expected narrow-width erosion, not kernel disagreement (see
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
      bulbGateFail ||
      escape4GateFail ||
      affine4GateFail ||
      fold4GateFail ||
      fold4SlabExtFailed ||
      lens4GateFail ||
      lens4PackGuardFailed ||
      cover4GateFail ||
      cover4IdentityFailed ||
      aff4SweepFailed ||
      emitterOnlyFailed ||
      tilingAbiFailed ||
      latticeTilingAbiFailed ||
      latticeFrameFailed ||
      transportGateFail ||
      finitePrimaryGateFail ||
      transportEnvelopeGateFail ||
      sphereInversionFailed
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
                  : bulbGateFail
                    ? "bulb agreement leg excluded too many queries from its f32-stability gate — see notes"
                    : escape4GateFail
                      ? "escape4 agreement leg excluded too many queries from its f32-stability gate — see notes"
                      : affine4GateFail
                        ? "affine4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                        : fold4GateFail
                          ? "fold4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                          : fold4SlabExtFailed
                            ? "fold4 slabExt A/B: slab/no-slab kernels disagree beyond tolerance at sliceHalfW 0 — see notes"
                            : lens4GateFail
                              ? "lens4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                              : lens4PackGuardFailed
                                ? "lens4 pack-guard: packSurface4GpuParams did not refuse a swirl-final slab query — see notes"
                                : cover4GateFail
                                  ? "cover4 agreement leg excluded too many queries from its oracle-continuity gate — see notes"
                                  : cover4IdentityFailed
                                    ? "cover4 identity A/B: the cover's h=0 branch disagrees with the point kernel beyond tolerance — see notes"
                                    : emitterOnlyFailed
                                      ? "emitter-only eval/hit-info/shade agreement failure — see notes"
                                      : tilingAbiFailed
                                        ? "finite-tiling compile/bind/numeric ABI agreement failure — see notes"
                                        : latticeTilingAbiFailed
                                          ? "lattice-tiling eval compile/bind/numeric ABI agreement failure — see notes"
                                          : latticeFrameFailed
                                            ? "lattice carrier frame failure — see notes"
                                            : transportGateFail
                                              ? "transport agreement failure — see notes"
                                              : finitePrimaryGateFail
                                                ? "finite primary status/depth agreement failure — see finitePrimaryAgreement/notes"
                                                : transportEnvelopeGateFail
                                                  ? "transport envelope failure — see transportEnvelope/notes"
                                                  : sphereInversionFailed
                                                    ? "sphere-inversion compile/eval/march/frame failure — see sphereInversion and notes"
                                                    : "aff4 sweep leg: a kernel-variant pair (slab/no-slab or uniform/storage maps) disagrees beyond tolerance — see notes";
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
    if (e instanceof SurfaceDeviceUnreliableError) {
      // Not a kernel verdict at all — the device stopped
      // reproducing its own baseline, so every numeric row this run
      // produced (including any gating failures already recorded above)
      // is evidence of nothing. Remaining legs were skipped on purpose:
      // dispatching more work at a device that returns garbage only
      // burns the wall clock.
      results.verdict = "device-unreliable";
      results.reason =
        `${e.message}; numeric rows from this run are NOT evidence of a ` +
        `kernel defect — rerun on a quiet machine (idle CPU)`;
    } else {
      results.verdict = "fail";
      results.reason = `section error: ${describeError(e)}`;
    }
  } finally {
    canary?.destroy();
    for (const sys of systems) destroySurfaceEvalBuffers(sys);
    destroySurfaceEvalBuffers(scheduledSystem);
    destroySurfaceEvalBuffers(chaosSystem);
    for (const sys of escapeSystems) destroySurfaceForwardEvalBuffers(sys);
    for (const sys of bulbSystems) destroySurfaceForwardEvalBuffers(sys);
    for (const sys of escape4Systems) destroySurfaceForwardEvalBuffers(sys);
    for (const sys of affine4Systems) destroySurface4EvalBuffers(sys);
    destroySurface4EvalBuffers(scheduledSystem4);
    destroySurface4EvalBuffers(chaosSystem4);
    for (const sys of fold4Systems) destroySurface4EvalBuffers(sys);
    for (const sys of lens4AffineSystems) destroySurface4EvalBuffers(sys);
    for (const sys of lens4FoldSystems) destroySurface4EvalBuffers(sys);
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
  // software-tell definition (render-backend.ts).
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
  // `surface=1` runs the surface-DE section AFTER the flame
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
  if (
    filterNames &&
    [...filterNames].some((name) => !SCENARIOS.some((s) => s.name === name))
  ) {
    throw new Error("Unknown scenario name; refusing partial coverage");
  }
  // The shard applies AFTER any name filter, so the two compose: `?shard=`
  // alone splits the full sweep (the CI case), and `?scenarios=a,b,c&shard=`
  // splits a hand-picked subset when reproducing one shard locally.
  const activeScenarios = applyScenarioShard(
    BACKEND_SMOKE
      ? []
      : filterNames
        ? SCENARIOS.filter((s) => filterNames.has(s.name))
        : SCENARIOS,
    params.get("shard"),
  );

  const benchResults: BenchResults = {
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    adapter: null,
    scenarios: [],
    // "skipped" (not yet run) until runAll's own ss=1 check completes — see
    // computeAgreement.
    ss1DisplayDownsample: { skipped: "not yet run" },
    // Same "not yet run" state for the adaptive arms.
    adaptiveDisplay: {
      d3: { skipped: "not yet run" },
      d4: { skipped: "not yet run" },
    },
    // "skipped" until every leg (every scenario's comparison/displayDownsample
    // plus the ss=1 and adaptive checks) actually runs — see computeAgreement.
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
      benchResults.adaptiveDisplay,
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
      window.__BENCH_ACTIVE__ = def.name;
      recordResult(await runScenario(def, dom, currentDuration(), activity));
    } finally {
      window.__BENCH_ACTIVE__ = null;
      running = false;
      setButtonsDisabled(false);
    }
  }

  async function runSurfaceSection(): Promise<void> {
    // Incremental publishing: partial surface results are visible on
    // __BENCH_RESULTS__ while the (potentially long) section runs.
    window.__BENCH_ACTIVE__ = "surface-de";
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
      // `?surface=only` replaces the flame sweep with the
      // surface-DE section; without the param this branch is the unchanged
      // CI path.
      if (surfaceMode !== "only") {
        for (const def of activeScenarios) {
          const dom = domByName.get(def.name);
          if (!dom) continue;
          window.__BENCH_ACTIVE__ = def.name;
          recordResult(
            await runScenario(def, dom, currentDuration(), activity),
          );
        }
        // The standalone ss=1 display-downsample check — always run
        // as part of a full sweep (independent of any ?scenarios= filter
        // above), since it is the only leg that exercises the scale-1
        // pass-through path at all (see runSs1DisplayDownsampleCheck's doc),
        // and the headless runner's agreement verdict is meant to certify
        // the WHOLE kernel, not just whichever named scenarios were
        // requested.
        window.__BENCH_ACTIVE__ = "ss1-display-downsample";
        activity.setState("gpu", "GPU ss=1 check…");
        benchResults.ss1DisplayDownsample =
          await runSs1DisplayDownsampleCheck();
        // The adaptive density-estimate agreement legs — one per dimension,
        // both running the production backend against the CPU oracle. Same
        // standalone, always-on rationale as the ss=1 check above.
        window.__BENCH_ACTIVE__ = "adaptive-display";
        activity.setState("gpu", "GPU adaptive check…");
        benchResults.adaptiveDisplay = await runAdaptiveDisplayCheck();
        activity.setState("idle", "Done");
        recomputeAgreement();
        renderResults();
      }
      if (surfaceMode !== null) {
        await runSurfaceSection();
      }
    } finally {
      window.__BENCH_ACTIVE__ = null;
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
      window.__BENCH_ACTIVE__ = null;
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
    if (BACKEND_SMOKE) {
      benchResults.backendSmoke = await runBackendSmoke();
      renderResults();
    } else {
      await runAll();
    }
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
