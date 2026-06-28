import type { Transform, Vec3 } from "./types";

/**
 * A composed affine map, stored as a row-major 3x3 linear part (rotation scaled
 * per column) plus a translation. Applying it to a point `p` computes
 * `m · p + t`, equivalent to a Three.js `Matrix4.compose(position, rotation,
 * scale)` applied to `(x, y, z, 1)`.
 */
export interface Affine {
  /** Row-major 3x3 = R · diag(scale). */
  m: number[];
  /** Translation (the transform's position). */
  t: Vec3;
}

/**
 * Row-major rotation matrix for intrinsic Euler angles in XYZ order. This
 * reproduces `THREE.Matrix4.makeRotationFromEuler(euler)` with `order = "XYZ"`
 * exactly, so fractals render identically to the original viewer.
 */
export function rotationMatrixXYZ(x: number, y: number, z: number): number[] {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);

  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  return [
    c * e,
    -c * f,
    d,
    af + be * d,
    ae - bf * d,
    -b * c,
    bf - ae * d,
    be + af * d,
    a * c,
  ];
}

/** Compose a {@link Transform} into an {@link Affine} (`M = T · R · S`). */
export function composeAffine(transform: Transform): Affine {
  const r = rotationMatrixXYZ(
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2],
  );
  const [sx, sy, sz] = transform.scale;
  // Scale each column of R: column c is scaled by scale[c].
  const m = [
    r[0] * sx,
    r[1] * sy,
    r[2] * sz,
    r[3] * sx,
    r[4] * sy,
    r[5] * sz,
    r[6] * sx,
    r[7] * sy,
    r[8] * sz,
  ];
  return { m, t: [...transform.position] };
}

/** Apply an affine map to a point: returns `m · (x, y, z) + t`. */
export function applyAffine(a: Affine, x: number, y: number, z: number): Vec3 {
  const { m, t } = a;
  return [
    m[0] * x + m[1] * y + m[2] * z + t[0],
    m[3] * x + m[4] * y + m[5] * z + t[1],
    m[6] * x + m[7] * y + m[8] * z + t[2],
  ];
}
