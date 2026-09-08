/** Author a swirl radius through the existing final affine and variation
 * weight. Radius is derived from the raw Surface bound; it is never a new
 * variation parameter or persisted field. Before the unchanged post-affine,
 * the edit keeps each output norm and carried z/w coordinates while changing
 * the radius-dependent xy turn. */
import { composeAffine } from "./affine";
import {
  composeAffine4,
  isFlatTransform,
  systemPartsAreNonFlat,
  toTransform4,
} from "./affine4";
import { transformHasEmitter } from "./chaos-game";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  transformStageSigmas,
} from "./surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  transformStageSigmas4,
} from "./surface-de-4d";
import {
  pureSwirlFinal,
  SWIRL_LENS_MAX_RADIUS,
  swirlPreRadius,
} from "./swirl-lens";
import type { HybridSchedule, SymmetryParams, Transform, Vec3 } from "./types";

export type SwirlLensRadiusAnalysis =
  { available: true; radius: number } | { available: false; reason: string };

export type SwirlLensRadiusEdit =
  { ok: true; transform: Transform } | { ok: false; reason: string };

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

function finalAffine(final: Transform, fourD: boolean) {
  const lifted = fourD ? toTransform4(final) : null;
  const affine = lifted ? composeAffine4(lifted) : composeAffine(final);
  const stages = lifted
    ? transformStageSigmas4(lifted)
    : transformStageSigmas(final);
  let reason: string | null = null;
  if (
    ![
      ...affine.m,
      ...affine.t,
      ...(final.post?.m ?? []),
      ...(final.post?.t ?? []),
    ].every(Number.isFinite) ||
    !Number.isFinite(stages.base.min) ||
    !Number.isFinite(stages.base.max) ||
    (stages.post !== null &&
      (!Number.isFinite(stages.post.min) || !Number.isFinite(stages.post.max)))
  ) {
    reason =
      "The final affine must contain finite geometry and singular bounds.";
  } else if (stages.base.min <= 0 || (stages.post?.min ?? 1) <= 0) {
    reason =
      "The final affine and post must be invertible to edit the swirl radius.";
  }
  return { affine, sigmaMax: stages.base.max, reason };
}

/** Derive the exact pre-swirl radius interpretation used by the builders,
 * including their 3D fitted center, full 4D origin ball, symmetry and finite
 * schedule. An over-cap radius remains available so it can be edited down.
 * Ordinary raw-system refusals become reasons; unexpected builder errors
 * propagate rather than being disguised as unsupported authoring. */
export function analyzeSwirlLensRadius(
  transforms: Transform[],
  final: Transform | null,
  symmetry: SymmetryParams = NO_SYMMETRY,
  schedule: HybridSchedule | null = null,
): SwirlLensRadiusAnalysis {
  if (!final || !pureSwirlFinal(final)) {
    return {
      available: false,
      reason: "The final transform needs one active Swirl variation.",
    };
  }
  if (transformHasEmitter(final)) {
    return {
      available: false,
      reason: "The final transform has a shape emitter.",
    };
  }
  // Match app routing. A schedule affects the raw bound but does not itself
  // switch the app to 4D; the chosen builder owns its schedule refusals.
  const fourD = systemPartsAreNonFlat(transforms, final, symmetry);
  const geometry = finalAffine(final, fourD);
  if (geometry.reason) return { available: false, reason: geometry.reason };
  const analysis = fourD
    ? analyzeSurfaceSystem4(transforms, null, schedule, symmetry)
    : analyzeSurfaceSystem(transforms, null, schedule, symmetry);
  if (analysis.status === "ineligible") {
    return {
      available: false,
      reason: `The raw system cannot bound the swirl radius: ${analysis.reasons.join("; ")}`,
    };
  }
  const { affine, sigmaMax } = geometry;
  let radius: number;
  if (fourD) {
    const raw = buildSurfaceDE4(transforms, null, symmetry, { schedule });
    radius = swirlPreRadius(affine.m, affine.t, sigmaMax, raw.boundingRadius);
  } else {
    const raw = buildSurfaceDE(transforms, null, symmetry, { schedule });
    radius = swirlPreRadius(
      affine.m,
      affine.t,
      sigmaMax,
      raw.boundingRadius,
      raw.boundCenter,
    );
  }
  return Number.isFinite(radius) && radius > 0
    ? { available: true, radius }
    : {
        available: false,
        reason: "The raw system has no finite positive swirl radius.",
      };
}

/** Scale ALL of the pre-affine by target/current, and divide the active
 * swirl weight by the same positive ratio. Rotations, shear, post-affine,
 * signs, metadata and dormant entries are preserved. Inherited w scale
 * continues to follow XYZ; an explicitly authored w scale/position scales
 * alongside them. The current radius must describe this same final/system.
 *
 * Targets above the Surface cap remain valid for other point consumers.
 * Exactly at the cap, a tiny inward margin (one part in 10^10) avoids a
 * normal f64 bound recomputation rounding over it; no eligibility tolerance
 * is relaxed. Callers that serialize or alter the raw system must recheck
 * its rebuilt radius, since this function cannot price those later edits. */
export function setSwirlLensRadius(
  final: Transform,
  currentRadius: number,
  targetRadius: number,
): SwirlLensRadiusEdit {
  const variation = pureSwirlFinal(final);
  if (!variation || transformHasEmitter(final)) {
    return {
      ok: false,
      reason: "The final transform needs one active Swirl variation.",
    };
  }
  const initial = finalAffine(final, !isFlatTransform(final));
  if (initial.reason) return { ok: false, reason: initial.reason };
  if (!(Number.isFinite(currentRadius) && currentRadius > 0)) {
    return {
      ok: false,
      reason: "The current swirl radius must be finite and positive.",
    };
  }
  if (!(Number.isFinite(targetRadius) && targetRadius > 0)) {
    return {
      ok: false,
      reason: "The requested swirl radius must be finite and positive.",
    };
  }
  if (targetRadius === currentRadius) return { ok: true, transform: final };
  const ratio =
    (targetRadius / currentRadius) *
    (targetRadius === SWIRL_LENS_MAX_RADIUS ? 1 - 1e-10 : 1);
  const weight = variation.weight / ratio;
  if (!(
    Number.isFinite(ratio) &&
    ratio > 0 &&
    Number.isFinite(weight) &&
    weight !== 0
  )) {
    return {
      ok: false,
      reason: "That radius exceeds the finite affine/weight range.",
    };
  }
  const values = [
    ...final.scale,
    ...final.position,
    ...(final.w?.scale === undefined ? [] : [final.w.scale]),
    ...(final.w?.position === undefined ? [] : [final.w.position]),
  ];
  if (
    values.some(
      (value) =>
        !Number.isFinite(value * ratio) || (value !== 0 && value * ratio === 0),
    )
  ) {
    return {
      ok: false,
      reason: "That radius exceeds the finite affine/weight range.",
    };
  }
  const transform: Transform = {
    ...final,
    scale: final.scale.map((value) => value * ratio) as Vec3,
    position: final.position.map((value) => value * ratio) as Vec3,
    variations: final.variations!.map((entry) =>
      entry === variation ? { ...entry, weight } : entry,
    ),
    ...(final.w === undefined
      ? {}
      : {
          w: {
            ...final.w,
            ...(final.w.scale === undefined
              ? {}
              : { scale: final.w.scale * ratio }),
            ...(final.w.position === undefined
              ? {}
              : { position: final.w.position * ratio }),
          },
        }),
  };
  const edited = finalAffine(transform, !isFlatTransform(transform));
  return edited.reason
    ? { ok: false, reason: edited.reason }
    : { ok: true, transform };
}
