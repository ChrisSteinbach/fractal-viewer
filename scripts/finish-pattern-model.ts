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
export const PATTERN_DETAIL_FOOTPRINT_FULL = 0.009;
export const PATTERN_DETAIL_FOOTPRINT_OFF = 0.012;

/** Close-ups transition fully to a material-shaped detail octave. */
export const PATTERN_DETAIL_MIX: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 1,
  marble: 1,
  strata: 1,
};

/** Exact prototype defaults to carry into the downstream authoring bead. */
export const PATTERN_DEFAULT_SCALE: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 3,
  marble: 1.35,
  strata: 2.6,
};

/**
 * Maximum phase displacement, in one material cycle, contributed by the
 * fractal-native carrier.  The carrier bends a coherent object-space detail
 * field; it never becomes a stand-alone texture again.
 */
export const PATTERN_NATIVE_WARP_CYCLES: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 0.08,
  marble: 0.1,
  strata: 0.08,
};

/** Highest dyadic detail octave admitted by the CPU refusal prototype. */
export const PATTERN_DETAIL_MAX_OCTAVE = 8;

/** Family-scale cycles targeted across one close-up footprint. */
export const PATTERN_DETAIL_SCALE_MULTIPLIER: Readonly<
  Record<Exclude<PatternKind, "none">, number>
> = {
  wood: 1,
  marble: 2.5,
  strata: 1,
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
  const latewood = smoothstep(0.62, 0.78, t) * (1 - smoothstep(0.91, 1, t));
  const ringLine = 1 - smoothstep(0, 0.04, Math.min(t, 1 - t));
  return Math.max(0.72 * latewood, ringLine);
}

function strataRamp(phase: number): number {
  const t = fract(phase);
  const broad = smoothstep(0.06, 0.16, t) * (1 - smoothstep(0.52, 0.66, t));
  const seam = 1 - smoothstep(0, 0.035, Math.abs(t - 0.61));
  return Math.max(0.72 * broad, seam);
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
      p[u] * 1.25 + 0.7,
      p[a] * 0.22 - 2.3,
      p[v] * 1.25 + 4.7,
    ]);
    // A second field varies much faster across the trunk than along it.  It
    // bends the cylindrical latewood into long axial grain without turning
    // the material into an isotropic noise texture.
    const axialGrain = fbm([p[u] * 3 + 8, p[a] * 0.35 - 4, p[v] * 3 - 6]);
    const phase = (radial + 0.1 * wobble + 0.025 * axialGrain) * safeScale;
    return { phase, ramp: woodRamp(phase) };
  }
  if (kind === "marble") {
    // Unlike the refused v1 formula, these veins are zero contours of two
    // low-frequency scalar fields, not repeated `fract` bands.  The plane
    // supplies geological direction; FBM makes the contours non-periodic.
    const qScale = safeScale / PATTERN_DEFAULT_SCALE.marble;
    const qa = p[a] * qScale;
    const qu = p[u] * qScale;
    const qv = p[v] * qScale;
    const plane = qa + 0.2 * qu - 0.12 * qv;
    const warpA = fbm([
      p[0] * qScale * 1.1 + 1.9,
      p[1] * qScale * 1.1 - 5.2,
      p[2] * qScale * 1.1 + 3.4,
    ]);
    const warpB = fbm([
      p[2] * qScale * 2.1 - 6.4,
      p[0] * qScale * 2.1 + 2.8,
      p[1] * qScale * 2.1 + 9.1,
    ]);
    const field = 0.34 * plane + warpA - 0.035;
    const branchField =
      0.2 * (0.58 * qa - 0.41 * qu + 0.29 * qv) +
      0.7 * warpA +
      0.46 * warpB -
      0.11;
    const branchGate = 1 - smoothstep(0.075, 0.19, Math.abs(warpA - warpB));
    const primaryDistance = Math.abs(field);
    const branchDistance = Math.abs(branchField);
    const core = Math.max(
      1 - smoothstep(0.018, 0.052, primaryDistance),
      branchGate * (1 - smoothstep(0.014, 0.044, branchDistance)),
    );
    const halo = Math.max(
      1 - smoothstep(0.052, 0.13, primaryDistance),
      0.72 * branchGate * (1 - smoothstep(0.044, 0.105, branchDistance)),
    );
    return { phase: field, ramp: clamp01(0.58 * halo + 0.42 * core) };
  }
  const warp = fbm([p[u] * 0.6 - 4.3, p[a] * 0.2 + 8.1, p[v] * 0.6 + 2.7]);
  const phase = (p[a] + 0.055 * warp) * safeScale;
  return { phase, ramp: strataRamp(phase) };
}

function nativeSample(q: PatternQuery): { value: number; enabled: boolean } {
  // Growth rings are wholly object-space above. Sheets are the more locally
  // reliable close-up carrier on the calibration fixtures; using them here
  // cannot redefine Wood because the completed detail ramp is gated off at
  // ordinary view and remains a bounded output crossfade.
  const carrier = q.sheetsCalibration;
  const raw = q.sheets;
  const value = normalizeNativeCarrier(raw, carrier);
  return { value, enabled: carrier.enabled };
}

function detailWarpPoint(
  kind: Exclude<PatternKind, "none">,
  axis: PatternAxis,
  detailScale: number,
  p: Vec3,
  native: { value: number; enabled: boolean },
): Vec3 {
  const out: Vec3 = [p[0], p[1], p[2]];
  if (!native.enabled || detailScale <= 0) return out;
  const [a, u] = axes(axis);
  const lane = kind === "wood" ? u : a;
  // Dividing by scale makes this a bounded PHASE displacement.  A wildly
  // varying trap can bend a line by at most the declared fraction of one
  // cycle, so it cannot recreate v1's corrosion texture.
  out[lane] +=
    ((native.value - 0.5) * PATTERN_NATIVE_WARP_CYCLES[kind]) / detailScale;
  return out;
}

/** Narrow, warped microveins used only after the footprint LOD opens. */
function marbleDetailRamp(axis: PatternAxis, scale: number, p: Vec3): number {
  const [a, u, v] = axes(axis);
  const safeScale = Math.max(0, scale);
  const warp = fbm([
    p[u] * safeScale * 0.28 + 3.7,
    p[a] * safeScale * 0.2 - 6.1,
    p[v] * safeScale * 0.28 + 1.9,
  ]);
  const warpB = fbm([
    p[v] * safeScale * 0.24 - 4.8,
    p[u] * safeScale * 0.18 + 2.6,
    p[a] * safeScale * 0.24 + 7.3,
  ]);
  const phase = (p[a] + 0.18 * p[u] - 0.11 * p[v]) * safeScale + 0.42 * warp;
  const branchPhase =
    (0.62 * p[a] - 0.47 * p[u] + 0.31 * p[v]) * safeScale * 0.78 +
    0.48 * warpB +
    1.37;
  const vein = (veinPhase: number): number => {
    const distance = Math.abs(fract(veinPhase) - 0.5);
    const core = 1 - smoothstep(0.018, 0.055, distance);
    const halo = 1 - smoothstep(0.055, 0.2, distance);
    return clamp01(0.58 * halo + 0.42 * core);
  };
  // Marble is not a white field plus ink lines: a broad, low-contrast cloud
  // keeps stone structure present between veins and prevents an arbitrary
  // close-up from landing on a perfectly plain patch.
  const cloud = 0.12 + 0.18 * clamp01(warp + 0.5);
  const ramp = Math.max(cloud, vein(phase), vein(branchPhase));
  // Keep close-up veins as legible as the sparse macro network.  This fixed
  // material contrast is intentionally independent of any fixture statistic.
  return clamp01(0.5 + (ramp - 0.5) * 1.12);
}

function materialDetailRamp(
  kind: Exclude<PatternKind, "none">,
  axis: PatternAxis,
  scale: number,
  p: Vec3,
): number {
  return kind === "marble"
    ? marbleDetailRamp(axis, scale, p)
    : patternMacroSample(kind, axis, scale, p).ramp;
}

function variancePreservingRampMix(a: number, b: number, t: number): number {
  const mixed = mix(a, b, t);
  // Crossfading unrelated dyadic octaves normally halves their variance at
  // t=.5, creating a visible soft interval mid-zoom.  This analytic gain is
  // global and deterministic (not measured from a fixture or image).
  const gain = 1 / Math.sqrt((1 - t) * (1 - t) + t * t);
  return clamp01(0.5 + (mixed - 0.5) * gain);
}

/**
 * A material-shaped detail octave selected from the source-space footprint.
 * Frequencies are dyadic object-space coordinates.  Crossfading completed
 * ramp outputs makes the function continuous as a zoom crosses an octave;
 * the texture never uses screen coordinates and therefore cannot stick to
 * the viewport.  Native sheets only bend this coherent field slightly.
 */
function scaleStableDetailRamp(
  kind: Exclude<PatternKind, "none">,
  axis: PatternAxis,
  scale: number,
  q: PatternQuery,
  native: { value: number; enabled: boolean },
): number {
  const footprint = Math.max(q.pixelFootprint, 1e-9);
  const desired = Math.max(
    1,
    (PATTERN_DETAIL_SCALE_MULTIPLIER[kind] * PATTERN_DETAIL_FOOTPRINT_OFF) /
      footprint,
  );
  const rawLevel = Math.log2(desired);
  const level = Math.max(
    0,
    Math.min(PATTERN_DETAIL_MAX_OCTAVE, Math.floor(rawLevel)),
  );
  const blend = smoothstep(0, 1, clamp01(rawLevel - level));
  const lowScale = scale * 2 ** level;
  const highScale = scale * 2 ** Math.min(PATTERN_DETAIL_MAX_OCTAVE, level + 1);
  const low = materialDetailRamp(
    kind,
    axis,
    lowScale,
    detailWarpPoint(kind, axis, lowScale, q.objectP, native),
  );
  if (level === PATTERN_DETAIL_MAX_OCTAVE) return low;
  const high = materialDetailRamp(
    kind,
    axis,
    highScale,
    detailWarpPoint(kind, axis, highScale, q.objectP, native),
  );
  return variancePreservingRampMix(low, high, blend);
}

function patternedAlbedo(
  base: Vec3,
  kind: Exclude<PatternKind, "none">,
  ramp: number,
): Vec3 {
  let factor: Vec3;
  if (kind === "wood") {
    const early: Vec3 = [1.06, 1.03, 0.92];
    const late: Vec3 = [0.3, 0.22, 0.16];
    const amount = smoothstep(0.04, 0.92, ramp);
    factor = [
      mix(early[0], late[0], amount),
      mix(early[1], late[1], amount),
      mix(early[2], late[2], amount),
    ];
  } else if (kind === "marble") {
    const halo: Vec3 = [0.68, 0.64, 0.61];
    const core: Vec3 = [0.18, 0.22, 0.28];
    const haloAmount = smoothstep(0.02, 0.58, ramp);
    const coreAmount = smoothstep(0.58, 1, ramp);
    factor = [
      mix(mix(1, halo[0], haloAmount), core[0], coreAmount),
      mix(mix(1, halo[1], haloAmount), core[1], coreAmount),
      mix(mix(1, halo[2], haloAmount), core[2], coreAmount),
    ];
  } else {
    const bed: Vec3 = [0.58, 0.62, 0.68];
    const seam: Vec3 = [0.38, 0.24, 0.16];
    const bedAmount = smoothstep(0.02, 0.72, ramp);
    const seamAmount = smoothstep(0.74, 1, ramp);
    factor = [
      mix(mix(1, bed[0], bedAmount), seam[0], seamAmount),
      mix(mix(1, bed[1], bedAmount), seam[1], seamAmount),
      mix(mix(1, bed[2], bedAmount), seam[2], seamAmount),
    ];
  }
  return [
    clamp01(base[0] * factor[0]),
    clamp01(base[1] * factor[1]),
    clamp01(base[2] * factor[2]),
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
  const native = nativeSample(q);
  const detailRamp = scaleStableDetailRamp(
    params.kind,
    params.axis,
    params.scale,
    q,
    native,
  );
  const gate =
    detailMode === "hybrid" && native.enabled
      ? patternDetailGate(q.pixelFootprint)
      : 0;
  const detailMix = gate * PATTERN_DETAIL_MIX[params.kind];
  // The anti-swim contract: crossfade completed ramp outputs, never phases.
  const outputRamp = mix(macro.ramp, detailRamp, detailMix);
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
    detailRamp,
    detailGate: gate,
    detailMix,
    outputRamp,
    nativeValue: native.value,
    nativeEnabled: native.enabled,
  };
}
