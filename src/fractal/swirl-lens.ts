import type { Transform, Variation } from "./types";

/** Lens-only wire tag. Recursive map tags remain the fold vocabulary. */
export const SURFACE_LENS_SWIRL = 4;

/** Maximum supported origin radius before swirl. Global distance/acceptance
 * compensation preserves detail but costs more march steps at larger radii;
 * the fixed-geometry qualification lives in scripts/swirl-lens.harness.ts.
 * At rho=0.5 the mathematical G is 2; the stored upward-rounded f32 is
 * slightly larger, preserving the certificate through GPU upload. */
export const SWIRL_LENS_MAX_RADIUS = 0.5;

/** Origin bound of the PRE-SWIRL affine image of the raw estimator ball.
 * The 3D caller supplies its fitted center; the origin-centered 4D ball
 * omits it. Final variation weight and post-affine act after swirl, so
 * neither changes its supported twist radius. */
export function swirlPreRadius(
  matrix: readonly number[],
  translation: readonly number[],
  sigmaMax: number,
  radius: number,
  center?: readonly number[],
): number {
  let centerSquared = 0;
  for (let row = 0; row < translation.length; row++) {
    let component = translation[row];
    if (center) {
      for (let column = 0; column < translation.length; column++) {
        component += matrix[row * translation.length + column] * center[column];
      }
    }
    centerSquared += component * component;
  }
  return sigmaMax * radius + Math.sqrt(centerSquared);
}

/** Shared actionable refusal for both CPU analyzers and builder guards. */
export function swirlRadiusRefusal(radius: number): string | null {
  return Number.isFinite(radius) &&
    radius >= 0 &&
    radius <= SWIRL_LENS_MAX_RADIUS
    ? null
    : `final transform swirl pre-swirl radius ${radius.toFixed(3)} exceeds ` +
        `the supported ${SWIRL_LENS_MAX_RADIUS}; set Radius under Transforms → ` +
        "Final Transform → Variations → Swirl, or reduce final scale or " +
        "translation (swirl weight only resizes the output)";
}

/** Public shader/packer boundaries also accept hand-built DE objects;
 * require their swirl-specific certificate instead of uploading NaN. */
export function validatedSwirlLensRadius(radius: number | undefined): number {
  if (radius === undefined) {
    throw new Error("surface swirl lens is missing its pre-swirl radius");
  }
  const refusal = swirlRadiusRefusal(radius);
  if (refusal) throw new Error(refusal);
  return radius;
}

/** One inverse-Lipschitz bound for EVERY query against a set in ball(rho).
 *
 * Choose R = sqrt(rho²+2). For |u| <= R, the original chord bound
 * 1+rho(|u|+rho) is at most 1+rho(R+rho). Outside it, the rotation
 * difference is at most 2|y_xy| <= 2rho, so
 * |S⁻¹(u)-S⁻¹(y)| <= |u-y|+2rho. Since |u-y| >= |u|-rho > R-rho,
 * the ratio is at most 1+2rho/(R-rho). These two bounds agree exactly
 * because (R-rho)(R+rho)=2, giving G=1+rho²+rho*sqrt(rho²+2).
 *
 * The 32-epsilon relative margin covers the elementary f64 operations over
 * the supported radius interval; ceil-to-f32 then prevents shader upload
 * rounding from shrinking the bound. Store this value once on the built
 * lens: CPU distance, GPU wire and acceptance compensation share that exact
 * f32 number. Neither the builder nor an estimator query needs a root solve. */
export function swirlGlobalInverseLipschitz(radius: number): number {
  const rho = validatedSwirlLensRadius(radius);
  if (rho === 0) return 1;
  const squared = rho * rho;
  const bound =
    (1 + squared + rho * Math.sqrt(squared + 2)) * (1 + 32 * Number.EPSILON);
  const float = new Float32Array([bound]);
  if (float[0] < bound) new Uint32Array(float.buffer)[0]++;
  return float[0];
}

/** Shader/material boundaries also accept hand-built DE records. Require a
 * complete, sound and exactly representable coefficient; silently rounding
 * a different CPU coefficient at upload would break acceptance parity. */
export function validatedSwirlLensLipschitz(
  radius: number | undefined,
  lipschitz: number | undefined,
): number {
  const rho = validatedSwirlLensRadius(radius);
  const required = swirlGlobalInverseLipschitz(rho);
  if (
    lipschitz === undefined ||
    !Number.isFinite(lipschitz) ||
    Math.fround(lipschitz) !== lipschitz ||
    lipschitz < required
  ) {
    throw new Error(
      "surface swirl lens is missing a sound f32 Lipschitz bound",
    );
  }
  return lipschitz;
}

/** Apply only to the ENTIRE primary-hit epsilon, including its numeric
 * floor, and pass that epsilon as the DE cutoff. The certified stride stays
 * unchanged. The common G commutes through balloon's min and scale; the
 * existing visible-sphere floor can only make acceptance stricter outside
 * its source ball. Pixel footprint, start dither and shade probes keep
 * their ordinary units. */
export function surfaceSwirlAcceptanceScale(de: {
  foldFinal: { foldKind: number; swirlLipschitz?: number } | null;
}): number {
  const lens = de.foldFinal;
  return lens?.foldKind === SURFACE_LENS_SWIRL ? 1 / lens.swirlLipschitz! : 1;
}

/** Exactly one active swirl entry is invertible as a final lens. A blend
 * is a weighted sum, so it does not inherit swirl's inverse. Match the
 * production variation filter: nonfinite and zero weights are dormant. */
export function pureSwirlFinal(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  return active.length === 1 && active[0].type === "swirl" ? active[0] : null;
}

/** Invert the production swirl in either dimension, preserving z/w.
 * Swirl rotates xy by pi/2 - |p|² and preserves the FULL radius, so its
 * inverse uses that same radius with the opposite angle. `out` may alias
 * `point`; every input needed by the xy rotation is read before writing. */
export function inverseSwirlInto(
  point: readonly number[],
  out: number[],
): void {
  let radiusSquared = 0;
  for (const component of point) radiusSquared += component * component;
  const s = Math.sin(radiusSquared);
  const c = Math.cos(radiusSquared);
  const x = point[0];
  const y = point[1];
  out[0] = x * s + y * c;
  out[1] = -x * c + y * s;
  for (let i = 2; i < point.length; i++) out[i] = point[i];
}

/** The spike's query-dependent inverse-Lipschitz certificate between the
 * query and EVERY point of a set enclosed in the origin ball `rho`, in
 * 3D or 4D. Kept for the qualification's rejected-strategy comparison;
 * production uses {@link swirlGlobalInverseLipschitz} so the same constant
 * compensates distance and hit acceptance through outer unions.
 *
 * The derivative is a rotated rank-one shear of magnitude
 * 2|p_xy||p| <= 2r². Its norm on a radius-r ball is sqrt(1+r⁴)+r²;
 * the segment between query u and a set point stays in radius max(|u|,rho).
 * Separately, adding/subtracting the rotated set point gives the chord
 * bound 1+rho(|u|+rho). Both hold for every set point, so their minimum
 * does too. A pointwise Jacobian alone would not certify the segment.
 * Qualification and fixed-geometry image evidence: swirl-lens.harness.ts. */
export function swirlInverseLipschitz(
  queryRadius: number,
  rho: number,
): number {
  const radiusSquared = Math.max(queryRadius * queryRadius, rho * rho);
  return Math.min(
    Math.sqrt(1 + radiusSquared * radiusSquared) + radiusSquared,
    1 + rho * (queryRadius + rho),
  );
}
