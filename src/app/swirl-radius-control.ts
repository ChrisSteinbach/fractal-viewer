/** Radius-control policy at the app/codec boundary. The fractal helper is
 * intentionally broader: other point consumers accept over-cap radii, but
 * this control must never author a weight or explicit W field that changes
 * on a copy/reload. No document mutation occurs until preparation succeeds. */
import {
  analyzeSwirlLensRadius,
  setSwirlLensRadius,
  type SwirlLensRadiusEdit,
} from "../fractal/swirl-lens-edit";
import { pureSwirlFinal, SWIRL_LENS_MAX_RADIUS } from "../fractal/swirl-lens";
import type {
  HybridSchedule,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { MAX_VARIATION_WEIGHT } from "./persist";
import { MAX_W_POSITION, MAX_W_SCALE, MIN_W_SCALE } from "./state";

export type FinalSwirlRadiusControlAnalysis =
  | {
      available: true;
      radius: number;
      min: number;
      max: number;
      fitAvailable: boolean;
    }
  | { available: false; reason: string };

const GRID = 1000;

/** Check the actual edited values, not a predicted ratio: the cap's inward
 * margin and ordinary floating-point multiplication affect tight endpoints. */
function codecDomainRefusal(final: Transform): string | null {
  const swirl = pureSwirlFinal(final);
  if (!swirl) return "The final transform needs one active Swirl variation.";
  if (!(
    Number.isFinite(swirl.weight) &&
    Math.abs(swirl.weight) <= MAX_VARIATION_WEIGHT
  )) {
    return `That radius would put the Swirl weight outside ±${MAX_VARIATION_WEIGHT}; reduce the weight first.`;
  }
  if (final.w?.scale !== undefined) {
    const scale = Math.abs(final.w.scale);
    if (!(
      Number.isFinite(scale) &&
      scale >= MIN_W_SCALE &&
      scale <= MAX_W_SCALE
    )) {
      return `That radius would put the explicit W scale outside ${MIN_W_SCALE}–${MAX_W_SCALE}; adjust W scale first.`;
    }
  }
  if (
    final.w?.position !== undefined &&
    !(
      Number.isFinite(final.w.position) &&
      Math.abs(final.w.position) <= MAX_W_POSITION
    )
  ) {
    return `That radius would put W position outside ±${MAX_W_POSITION}; move W position toward zero first.`;
  }
  return null;
}

function candidateEdit(
  final: Transform,
  currentRadius: number,
  targetRadius: number,
): SwirlLensRadiusEdit {
  const edit = setSwirlLensRadius(final, currentRadius, targetRadius);
  if (!edit.ok) return edit;
  const reason = codecDomainRefusal(edit.transform);
  return reason ? { ok: false, reason } : edit;
}

function prepareFromRadius(
  transforms: Transform[],
  final: Transform,
  currentRadius: number,
  targetRadius: number,
  symmetry?: SymmetryParams,
  schedule?: HybridSchedule | null,
): SwirlLensRadiusEdit {
  const edit = candidateEdit(final, currentRadius, targetRadius);
  if (!edit.ok) return edit;
  const rebuilt = analyzeSwirlLensRadius(
    transforms,
    edit.transform,
    symmetry,
    schedule,
  );
  if (!rebuilt.available) return { ok: false, reason: rebuilt.reason };
  if (
    targetRadius <= SWIRL_LENS_MAX_RADIUS &&
    rebuilt.radius > SWIRL_LENS_MAX_RADIUS
  ) {
    return {
      ok: false,
      reason:
        "This transform could not fit the Surface radius; reduce Scale or Position.",
    };
  }
  if (Math.abs(rebuilt.radius - targetRadius) > targetRadius * 1e-8) {
    return {
      ok: false,
      reason:
        "The affine bounds cannot resolve that radius accurately; adjust Scale or Position.",
    };
  }
  return edit;
}

/** Preserve the exact authored readout even when it is off-grid or over the
 * Surface cap. Grid endpoints are conveniences; candidate checks remain the
 * authority, including a narrow off-grid interval retained around the current
 * value. Fit uses the complete candidate check, never just range membership. */
export function analyzeFinalSwirlRadiusControl(
  transforms: Transform[],
  final: Transform | null,
  symmetry?: SymmetryParams,
  schedule?: HybridSchedule | null,
): FinalSwirlRadiusControlAnalysis {
  const result = analyzeSwirlLensRadius(transforms, final, symmetry, schedule);
  if (!result.available) return result;
  const { radius } = result;
  if (!Number.isSafeInteger(Math.ceil(radius * GRID))) {
    return {
      available: false,
      reason: "The swirl radius is outside the numeric editor's range.",
    };
  }
  const swirl = pureSwirlFinal(final!)!;
  let minRatio = Math.abs(swirl.weight) / MAX_VARIATION_WEIGHT;
  let maxRatio = Infinity;
  if (final!.w?.scale !== undefined) {
    const scale = Math.abs(final!.w.scale);
    if (scale === 0) {
      return {
        available: false,
        reason: "Set a nonzero W scale before editing the swirl radius.",
      };
    }
    minRatio = Math.max(minRatio, MIN_W_SCALE / scale);
    maxRatio = Math.min(maxRatio, MAX_W_SCALE / scale);
  }
  if (final!.w?.position) {
    maxRatio = Math.min(maxRatio, MAX_W_POSITION / Math.abs(final!.w.position));
  }
  let lower = Math.ceil(Math.max(0.01, radius * minRatio) * GRID);
  let upper = Math.floor(
    Math.min(Math.max(2, radius), radius * maxRatio) * GRID,
  );
  if (!(Number.isSafeInteger(lower) && Number.isSafeInteger(upper))) {
    return {
      available: false,
      reason: "The swirl radius is outside the numeric editor's range.",
    };
  }
  // A mathematical boundary can still fail after the .5 inward margin or
  // one rounded product. Step past that boundary on the authored .001 grid.
  for (let i = 0; i < 2 && !candidateEdit(final!, radius, lower / GRID).ok; i++)
    lower++;
  for (
    let i = 0;
    i < 2 && upper > 0 && !candidateEdit(final!, radius, upper / GRID).ok;
    i++
  )
    upper--;
  const min = Math.min(Math.floor(radius * GRID), lower) / GRID;
  const max = Math.max(Math.ceil(radius * GRID), upper) / GRID;
  return {
    available: true,
    radius,
    min,
    max,
    fitAvailable: prepareFromRadius(
      transforms,
      final!,
      radius,
      SWIRL_LENS_MAX_RADIUS,
      symmetry,
      schedule,
    ).ok,
  };
}

/** Prepare a reversible edit; imported/other-renderer radii above .5 are
 * permitted, while requests at or below .5 must rebuild inside the hard cap. */
export function prepareFinalSwirlRadiusEdit(
  transforms: Transform[],
  final: Transform | null,
  targetRadius: number,
  symmetry?: SymmetryParams,
  schedule?: HybridSchedule | null,
): SwirlLensRadiusEdit {
  const current = analyzeSwirlLensRadius(transforms, final, symmetry, schedule);
  return current.available
    ? prepareFromRadius(
        transforms,
        final!,
        current.radius,
        targetRadius,
        symmetry,
        schedule,
      )
    : { ok: false, reason: current.reason };
}
