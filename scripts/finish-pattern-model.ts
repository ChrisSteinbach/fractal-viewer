/**
 * Pure CPU prototype for the hybrid surface-pattern coordinate stack.
 *
 * This is deliberately outside the production document/shader path.  It is
 * the refusal gate that chooses the formula and constants before
 * `SurfacePattern` becomes authored state.  Recognisable macrostructure is
 * object-attached; normalized rings/sheets may only replace a bounded share
 * of the *ramp output* once the source-space pixel footprint is small enough.
 */
import type { Vec3 } from "./de-preview";

export type PatternKind = "none" | "wood" | "marble" | "strata";
export type PatternAxis = "x" | "y" | "z";
export type PatternDetailMode = "hybrid" | "macro-only";

export interface PatternParams {
  kind: PatternKind;
  axis: PatternAxis;
  /** Periods across one normalized object-space unit. */
  scale: number;
  strength: number;
}

export interface NativeCalibration {
  low: number;
  high: number;
  invSpan: number;
  enabled: boolean;
  sampleCount: number;
}

export interface PatternQuery {
  /** Source/object-space point, normalized by system centre and radius. */
  objectP: Vec3;
  rings: number;
  sheets: number;
  ringsCalibration: NativeCalibration;
  sheetsCalibration: NativeCalibration;
  /** Approximate source-space width of one pixel, in normalized units. */
  pixelFootprint: number;
}

export interface PatternEvaluation {
  albedo: Vec3;
  macroRamp: number;
  detailRamp: number;
  detailGate: number;
  detailMix: number;
  outputRamp: number;
  nativeValue: number;
  nativeEnabled: boolean;
}

export const PATTERN_CALIBRATION_TRIM = 0.03;
export const PATTERN_MIN_NATIVE_SPAN = 0.02;
export const PATTERN_NOISE_OCTAVES = 3;

/** Detail is absent at ordinary framing and fully present in close-ups. */
export const PATTERN_DETAIL_FOOTPRINT_FULL = 0.0015;
export const PATTERN_DETAIL_FOOTPRINT_OFF = 0.012;

/** Native detail never wholly replaces the material-defining macro ramp. */
export const PATTERN_DETAIL_MIX: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 0.78,
  marble: 0.76,
  strata: 0.72,
};

/** Exact prototype defaults to carry into the downstream authoring bead. */
export const PATTERN_DEFAULT_SCALE: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 4.5,
  marble: 3.25,
  strata: 2.75,
};

export const PATTERN_NATIVE_PERIODS: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 6,
  marble: 5,
  strata: 4,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
const fract = (x: number): number => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return mix(sorted[lo], sorted[hi], at - lo);
}

/** Deterministic p03/p97 native-carrier calibration. */
export function calibrateNativeCarrier(
  samples: readonly number[],
): NativeCalibration {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const low = percentile(sorted, PATTERN_CALIBRATION_TRIM);
  const high = percentile(sorted, 1 - PATTERN_CALIBRATION_TRIM);
  const span = high - low;
  const enabled = sorted.length > 0 && span >= PATTERN_MIN_NATIVE_SPAN;
  return {
    low,
    high,
    invSpan: enabled ? 1 / span : 0,
    enabled,
    sampleCount: sorted.length,
  };
}

export function normalizeNativeCarrier(
  value: number,
  calibration: NativeCalibration,
): number {
  if (!calibration.enabled || !Number.isFinite(value)) return 0;
  return clamp01((value - calibration.low) * calibration.invSpan);
}

/** Pixel-footprint gate shared by all native carriers. */
export function patternDetailGate(pixelFootprint: number): number {
  if (!Number.isFinite(pixelFootprint) || pixelFootprint < 0) return 0;
  return (
    1 -
    smoothstep(
      PATTERN_DETAIL_FOOTPRINT_FULL,
      PATTERN_DETAIL_FOOTPRINT_OFF,
      pixelFootprint,
    )
  );
}

/** Integer-lattice hash to `[0, 1)`, deliberately shader-portable. */
function hash3(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(p: Vec3): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);
  const fx = smoothstep(0, 1, p[0] - ix);
  const fy = smoothstep(0, 1, p[1] - iy);
  const fz = smoothstep(0, 1, p[2] - iz);
  const c = (dx: number, dy: number, dz: number): number =>
    hash3(ix + dx, iy + dy, iz + dz) - 0.5;
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), fx), mix(c(0, 1, 0), c(1, 1, 0), fx), fy),
    mix(mix(c(0, 0, 1), c(1, 0, 1), fx), mix(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Three octaves: enough irregularity to break perfect bands, cheap to port. */
function fbm(p: Vec3): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < PATTERN_NOISE_OCTAVES; octave++) {
    sum +=
      amplitude *
      valueNoise([p[0] * frequency, p[1] * frequency, p[2] * frequency]);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

function axes(axis: PatternAxis): readonly [number, number, number] {
  if (axis === "x") return [0, 1, 2];
  if (axis === "z") return [2, 0, 1];
  return [1, 0, 2];
}

function woodRamp(phase: number): number {
  const t = fract(phase);
  const latewood = smoothstep(0.12, 0.72, t) * (1 - smoothstep(0.88, 1, t));
  const ringLine = 1 - smoothstep(0, 0.055, Math.min(t, 1 - t));
  return clamp01(latewood * 0.86 + ringLine * 0.32);
}

function marbleRamp(phase: number): number {
  const t = fract(phase);
  const d = Math.abs(t - 0.5);
  const body = 1 - smoothstep(0.045, 0.17, d);
  const hairline = 1 - smoothstep(0, 0.035, d);
  return clamp01(body * 0.76 + hairline * 0.34);
}

function strataRamp(phase: number): number {
  const t = fract(phase);
  const broad = smoothstep(0.08, 0.42, t) * (1 - smoothstep(0.58, 0.93, t));
  const seam = 1 - smoothstep(0, 0.045, Math.abs(t - 0.5));
  return clamp01(broad * 0.8 + seam * 0.24);
}

interface MacroSample {
  phase: number;
  ramp: number;
}

/**
 * Material-defining object-space coordinate. Wood is cylindrical about its
 * axis, marble is a low-frequency warped plane, and strata stays laminar.
 */
export function patternMacroSample(
  kind: Exclude<PatternKind, "none">,
  axis: PatternAxis,
  scale: number,
  p: Vec3,
): MacroSample {
  const [a, u, v] = axes(axis);
  const safeScale = Number.isFinite(scale) ? Math.max(0, scale) : 0;
  if (kind === "wood") {
    const radial = Math.hypot(p[u], p[v]);
    const wobble = fbm([
      p[u] * 1.45 + 7.1,
      p[a] * 0.34 - 2.3,
      p[v] * 1.45 + 4.7,
    ]);
    const phase = (radial + 0.13 * wobble) * safeScale;
    return { phase, ramp: woodRamp(phase) };
  }
  if (kind === "marble") {
    const plane = p[a] + 0.2 * p[u] - 0.13 * p[v];
    const warp = fbm([p[0] * 0.92 + 1.9, p[1] * 0.92 - 5.2, p[2] * 0.92 + 3.4]);
    const phase = (plane + 0.34 * warp) * safeScale;
    return { phase, ramp: marbleRamp(phase) };
  }
  const warp = fbm([p[u] * 0.62 - 4.3, p[a] * 0.22 + 8.1, p[v] * 0.62 + 2.7]);
  const phase = (p[a] + 0.075 * warp) * safeScale;
  return { phase, ramp: strataRamp(phase) };
}

function nativeSample(
  kind: Exclude<PatternKind, "none">,
  q: PatternQuery,
): { value: number; ramp: number; enabled: boolean } {
  const carrier = kind === "wood" ? q.ringsCalibration : q.sheetsCalibration;
  const raw = kind === "wood" ? q.rings : q.sheets;
  const value = normalizeNativeCarrier(raw, carrier);
  const phase = value * PATTERN_NATIVE_PERIODS[kind];
  const ramp =
    kind === "wood"
      ? woodRamp(phase)
      : kind === "marble"
        ? marbleRamp(phase)
        : strataRamp(phase);
  return { value, ramp, enabled: carrier.enabled };
}

function patternedAlbedo(
  base: Vec3,
  kind: Exclude<PatternKind, "none">,
  ramp: number,
): Vec3 {
  const dark =
    kind === "wood"
      ? ([0.43, 0.48, 0.57] as const)
      : kind === "marble"
        ? ([0.31, 0.34, 0.39] as const)
        : ([0.49, 0.56, 0.66] as const);
  return [
    base[0] * mix(1, dark[0], ramp),
    base[1] * mix(1, dark[1], ramp),
    base[2] * mix(1, dark[2], ramp),
  ];
}

/** Evaluate one hit, returning diagnostics used by the evidence harness. */
export function evaluateSurfacePattern(
  base: Vec3,
  params: PatternParams,
  q: PatternQuery,
  detailMode: PatternDetailMode = "hybrid",
): PatternEvaluation {
  if (params.kind === "none") {
    return {
      albedo: [base[0], base[1], base[2]],
      macroRamp: 0,
      detailRamp: 0,
      detailGate: 0,
      detailMix: 0,
      outputRamp: 0,
      nativeValue: 0,
      nativeEnabled: false,
    };
  }
  const macro = patternMacroSample(
    params.kind,
    params.axis,
    params.scale,
    q.objectP,
  );
  const native = nativeSample(params.kind, q);
  const gate =
    detailMode === "hybrid" && native.enabled
      ? patternDetailGate(q.pixelFootprint)
      : 0;
  const detailMix = gate * PATTERN_DETAIL_MIX[params.kind];
  // The anti-swim contract: crossfade completed ramp outputs, never phases.
  const outputRamp = mix(macro.ramp, native.ramp, detailMix);
  const full = patternedAlbedo(base, params.kind, outputRamp);
  const strength = clamp01(
    Number.isFinite(params.strength) ? params.strength : 0,
  );
  return {
    albedo: [
      mix(base[0], full[0], strength),
      mix(base[1], full[1], strength),
      mix(base[2], full[2], strength),
    ],
    macroRamp: macro.ramp,
    detailRamp: native.ramp,
    detailGate: gate,
    detailMix,
    outputRamp,
    nativeValue: native.value,
    nativeEnabled: native.enabled,
  };
}
