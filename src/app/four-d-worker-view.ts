/**
 * The mutable part of a Flame/Solid worker's active 4D projection. The
 * session retains the entry geometry and projection centre; a settled view
 * edit sends only the new rotor plus slice state. Each worker derives signed-w
 * normalization from that rotor and its retained entry support, so a newer
 * document cloud can never leak into an older active render.
 *
 * Both worker protocols use this one type so their live command cannot drift.
 */
export interface FourDWorkerView {
  /** Row-major 4x4 rotor matrix, the `composeRotorProjection4` convention. */
  rotor: number[];
  /** Whether the soft w-slice window is active. */
  sliceOn: boolean;
  /** Slice center in the normalized signed-w signal. */
  sliceCenter: number;
  /** Slice width (Gaussian falloff). */
  sliceWidth: number;
  /** Whether W-ramp color is recentered on the slice window. */
  sliceRelativeColor: boolean;
}

/** Exact command de-duplication. View controls already normalize their
 * values; equality here deliberately means "the same settled endpoint", not
 * an epsilon-based visual approximation. */
export function sameFourDWorkerView(
  current: FourDWorkerView,
  next: FourDWorkerView,
): boolean {
  return (
    sameFourDWorkerSpatialView(current, next) &&
    current.sliceRelativeColor === next.sliceRelativeColor
  );
}

/** Equality of the fields that can move/filter projected samples. When this
 * is true but full equality is false, only slice-relative color changed and a
 * worker whose current color path does not consume it may stage without
 * discarding useful accumulation. */
export function sameFourDWorkerSpatialView(
  current: FourDWorkerView,
  next: FourDWorkerView,
): boolean {
  return (
    current.sliceOn === next.sliceOn &&
    current.sliceCenter === next.sliceCenter &&
    current.sliceWidth === next.sliceWidth &&
    current.rotor.length === next.rotor.length &&
    current.rotor.every((value, index) => value === next.rotor[index])
  );
}
