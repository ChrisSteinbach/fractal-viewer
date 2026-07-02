/**
 * Distance-estimator math for the raymarching renderer (fr-yor).
 *
 * Pure and dependency-free like the rest of `src/fractal/`: no Three.js, no
 * DOM. This is the CPU **reference implementation** of the Mandelbulb distance
 * estimator that the GPU raymarcher in `src/app/raymarch-material.ts` mirrors
 * in GLSL. Keeping the core math here means the interesting part — the
 * distance field itself — is unit-tested deterministically without a WebGL
 * context, exactly the split the rest of the project uses (see
 * `docs/architecture.md`, "Why this split?"). The shader is a line-for-line
 * translation, so a test here pins the behaviour the GPU is expected to
 * reproduce.
 *
 * The Mandelbulb is the canonical distance-estimated 3-D fractal (White &
 * Nylander's power-8 formula, popularised by Mandelbulb3D / Fragmentarium).
 * Its analytic distance estimate is the standard
 *
 *   DE(p) = 0.5 · ln(r) · r / dr
 *
 * where `r` is the escaped orbit radius and `dr` its running derivative — a
 * lower bound on the distance from `p` to the fractal surface, which is exactly
 * what a sphere-tracing raymarcher needs to take safe steps.
 */

/** Orbit radius past which a point is treated as escaped (outside the bulb). */
const ESCAPE_RADIUS = 2;

/**
 * Estimate the distance from `(x, y, z)` to the surface of the Mandelbulb of
 * the given integer `power` (classic look is 8), iterating the escape-time
 * formula up to `iterations` times.
 *
 * Returns `0` for a point whose orbit never escapes within `iterations` (i.e.
 * one taken to be *inside* the set), and a positive lower-bound distance for a
 * point outside it. Always finite: the `r === 0` centre and a non-escaping
 * orbit both short-circuit before the `log(r)` term, so no `NaN`/`Inf` can
 * leak into a caller stepping along a ray.
 *
 * This is the reference the GLSL `mandelbulbDE` in the app layer mirrors; keep
 * the two in sync.
 */
export function mandelbulbDistance(
  x: number,
  y: number,
  z: number,
  power: number,
  iterations: number,
): number {
  let zx = x;
  let zy = y;
  let zz = z;
  let dr = 1;
  let r = 0;

  for (let i = 0; i < iterations; i++) {
    r = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (r > ESCAPE_RADIUS) break;
    // The origin has no defined spherical angle; leaving the running value at
    // its previous state (r starts at 0) keeps the estimate total there.
    if (r === 0) break;

    // To spherical coordinates, scale the angles by the power, back to
    // cartesian, then add the original point (the z ← z^n + c iteration).
    const theta = Math.acos(zz / r);
    const phi = Math.atan2(zy, zx);
    const zr = Math.pow(r, power);
    // dr ← n · r^(n-1) · dr + 1 (the derivative of the iteration).
    dr = Math.pow(r, power - 1) * power * dr + 1;

    const sinTheta = Math.sin(theta * power);
    zx = zr * sinTheta * Math.cos(phi * power) + x;
    zy = zr * sinTheta * Math.sin(phi * power) + y;
    zz = zr * Math.cos(theta * power) + z;
  }

  // Never escaped (or started at the centre): treat as inside the set.
  if (r <= ESCAPE_RADIUS) return 0;
  return (0.5 * Math.log(r) * r) / dr;
}
