/**
 * Sphere inversion, and the one thing about it that is not mechanical:
 * WHAT IT DOES TO A BOUNDED REGION (fr-v7ca).
 *
 * Two features in this codebase push an uncertainty region through the same
 * map and would otherwise derive the same identity twice — the failure mode
 * `variations4.ts` avoids by importing `resolveFoldRadii` rather than
 * restating it, and the reason fr-v7ca and fr-qxxw agreed in writing that
 * "whichever lands first should EXPORT the helper":
 *
 *   - `surface-de-4d.ts`'s spherefold MID branch, where the fr-wa6o slab's
 *     SEGMENT crosses an inversion. A segment goes to a circular ARC there,
 *     and min-radius-over-chord is not min-radius-over-arc in either
 *     direction, so the segment certificate stops being a lower bound —
 *     unsound, not merely loose, which is what `slabExact4` refused. A BALL
 *     survives the crossing exactly, so the chain state carries a ball's
 *     worth of slack across it and re-emerges with a segment of zero length.
 *   - `balloon-de.ts`'s inverted-union echo, whose DE IS an inversion. Its
 *     shipped 4D lift (fr-qxxw) did NOT need this, because slice-then-invert
 *     keeps the inversion three-dimensional and a slab rides both terms
 *     untouched — but a future arm that transports a region through the echo
 *     wants this identity and not a second derivation of it.
 *
 * THE IDENTITY. Inversion through the sphere of radius `R` about the origin,
 * `u -> R² u / |u|²`, is a Möbius transformation, and Möbius transformations
 * take balls to balls EXACTLY:
 *
 *     B(c, r)  ->  B( R²c / (|c|² − r²),  R²r / (|c|² − r²) )    for |c| > r
 *
 * Both the image's centre and its radius are the source's own, scaled by the
 * SAME factor `R² / (|c|² − r²)` — which is why {@link inversionBallScale}
 * returns that one number and lets the caller apply it to whichever of the
 * two it holds. The proof is the standard one: inversion fixes the sphere
 * `|u| = R`, maps the pencil of spheres through `c` to itself, and is
 * conformal, so the image of a sphere not through the origin is a sphere;
 * evaluating on the two points where the line through the origin and `c`
 * meets `B` gives the near and far radii `R²/(|c| + r)` and `R²/(|c| − r)`,
 * whose midpoint and half-difference are the expressions above.
 *
 * THE DEGENERATE CASE IS THE USEFUL PART. When the ball CONTAINS the
 * inversion centre (`|c| <= r`) its image is unbounded — the origin goes to
 * infinity — and no finite ball encloses it. The identity's denominator says
 * so by going non-positive, and this module returns `0` there rather than a
 * signed number a caller might use. A caller reads that as "no information":
 * its bound degrades to zero, which is CONSERVATIVE and exactly what a
 * distance estimator wants at a point it cannot certify. It is also rare —
 * the region has to have grown until it swallows the fold's own centre.
 */

/**
 * The scale `R² / (|c|² − r²)` that carries `B(c, r)` to its image under
 * inversion through radius `R` about the origin: apply it to the ball's
 * centre for the image centre and to its radius for the image radius
 * (module doc's identity).
 *
 * @param dist    `|c|`, the distance from the inversion centre to the
 *                ball's centre.
 * @param radius  `r`, the ball's radius. Must be non-negative; a caller
 *                holding a segment plus slack passes their sum.
 * @param sphereR2 `R²`, the inversion sphere's SQUARED radius — squared
 *                because every caller already holds it that way (the fold
 *                family keeps `fR²`, and `escape-de.ts`'s links keep
 *                `fixedRadius2`).
 * @returns The scale, or `0` when the ball reaches the inversion centre
 *          (`|c| <= r`) and the image is unbounded — the conservative
 *          reading, never a negative scale.
 */
export function inversionBallScale(
  dist: number,
  radius: number,
  sphereR2: number,
): number {
  const denom = dist * dist - radius * radius;
  return denom > 0 ? sphereR2 / denom : 0;
}
