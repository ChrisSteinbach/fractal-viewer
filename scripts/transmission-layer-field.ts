/**
 * Experimental optical weight from positive variation of a smooth clearance
 * signal. This is a sampled appearance functional of the public DE, never
 * signed membership or absorption proportional to march iterations.
 *
 * A monotone approach from signal 0 to 1 contributes one interface weight;
 * an interior plateau and the outward fall contribute none. Partial rises
 * contribute fractional weight. Oscillations in the transition band DO add
 * weight, so smoothing does not establish estimator-noise immunity.
 */
export interface LayerFieldSettings {
  innerFraction: number;
  outerFraction: number;
}

export const LAYER_FIELD_DEFAULTS: Readonly<LayerFieldSettings> = Object.freeze(
  {
    innerFraction: 0.002,
    outerFraction: 0.003,
  },
);

/** Values and derivatives meet continuously at both ends of the band. */
export function clearanceLayerSignal(
  distance: number,
  radius: number,
  settings: Readonly<LayerFieldSettings> = LAYER_FIELD_DEFAULTS,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(settings.innerFraction) ||
    !Number.isFinite(settings.outerFraction) ||
    settings.innerFraction < 0 ||
    settings.outerFraction <= settings.innerFraction
  )
    throw new Error("Layer signal requires finite clearance, radius and band");
  const inner = settings.innerFraction * radius;
  const outer = settings.outerFraction * radius;
  const s = Math.max(0, Math.min(1, (outer - distance) / (outer - inner)));
  return s * s * (3 - 2 * s);
}

/** Keep the previous signal across work chunks; initialize it to 0 at entry. */
export function layerOpticalIncrement(
  previousSignal: number,
  currentSignal: number,
): number {
  if (
    !Number.isFinite(previousSignal) ||
    !Number.isFinite(currentSignal) ||
    previousSignal < 0 ||
    previousSignal > 1 ||
    currentSignal < 0 ||
    currentSignal > 1
  )
    throw new Error("Layer variation requires signals in [0, 1]");
  return Math.max(0, currentSignal - previousSignal);
}

/** Fractional interface composition; even an opaque material is inert at 0. */
export function layerThroughput(baseTau: number, increment: number): number {
  if (
    !Number.isFinite(baseTau) ||
    baseTau < 0 ||
    baseTau > 1 ||
    !Number.isFinite(increment) ||
    increment < 0
  )
    throw new Error(
      "Layer throughput requires tau in [0, 1] and finite weight",
    );
  return increment === 0 ? 1 : baseTau ** increment;
}

/** The deliberately small shader mirror for the harness-only device pilot. */
export const LAYER_FIELD_WGSL = /* wgsl */ `
fn clearanceLayerSignal(distance: f32, radius: f32) -> f32 {
  let inner = ${LAYER_FIELD_DEFAULTS.innerFraction} * radius;
  let outer = ${LAYER_FIELD_DEFAULTS.outerFraction} * radius;
  let s = clamp((outer - distance) / (outer - inner), 0.0, 1.0);
  return s * s * (3.0 - 2.0 * s);
}
fn layerOpticalIncrement(previousSignal: f32, currentSignal: f32) -> f32 {
  return max(0.0, currentSignal - previousSignal);
}
fn layerThroughput(baseTau: f32, increment: f32) -> f32 {
  if (increment == 0.0) { return 1.0; }
  return pow(baseTau, increment);
}
`;
