import type { Transform, Vec3 } from "./types";

/**
 * A composed affine map, stored as a row-major 3x3 linear part (rotation scaled
 * per column) plus a translation. Applying it to a point `p` computes
 * `m · p + t`, equivalent to a Three.js `Matrix4.compose(position, rotation,
 * scale)` applied to `(x, y, z, 1)`.
 */
/**
 * # One affine vocabulary, and where the post-affine does NOT live
 *
 * `composeAffine` composes a {@link Transform}'s OWN affine part
 * (`M = T · R · S · U`) and nothing else. VERDICT, settled when the
 * per-transform post-affine ({@link Transform.post}, flam3's `post=`) was
 * added: it STAYS PRE-POST. Its 16 non-test call sites mean "the map's own
 * affine part" — the chaos game's prepared rows, the inverse descents'
 * base inverses, the eligibility sigmas' pre-post linear part, the
 * guide-cell visualisation — and silently redefining that to include the
 * post would change the meaning of all of them at once. The post is
 * composed at the ENGINE sites that apply it (the step's post stage, the
 * descent's per-map post inverse, the WGSL packers' composed slot rows),
 * each reading `transform.post` directly; nothing here pre-composes it.
 *
 * Shared arithmetic this module owns so the consumers cannot drift:
 * {@link multiply3x3} (row-major product), {@link inverse3x3} (the adjugate
 * form the inverse descents price their base inverses with) and
 * {@link composeLinearAffine} (a linear-only matrix — a kaleidoscope copy
 * rotation — composed with a general affine, the forward post stage
 * `Rot_k ∘ P` the WGSL packers and the descent construction both build).
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
  // Shear: right-multiply by the unit upper-triangular U(shear), giving the
  // full map M = R · diag(scale) · U. With shear [a, b, c]: column 1 gains
  // a·column 0, and column 2 gains b·column 0 + c·column 1 (the *original*
  // column 1, so column 2 is updated before column 1). This is the missing
  // degree of freedom that lets a Transform express any affine map.
  const { shear } = transform;
  if (shear && (shear[0] !== 0 || shear[1] !== 0 || shear[2] !== 0)) {
    const [a, b, c] = shear;
    const c1x = m[1];
    const c1y = m[4];
    const c1z = m[7];
    m[2] += b * m[0] + c * c1x;
    m[5] += b * m[3] + c * c1y;
    m[8] += b * m[6] + c * c1z;
    m[1] += a * m[0];
    m[4] += a * m[3];
    m[7] += a * m[6];
  }
  return { m, t: [...transform.position] };
}

/**
 * The shear factor `U` as a row-major 3x3 matrix: the unit upper-triangular
 * matrix whose above-diagonal entries are `shear = [xy, xz, yz]`,
 *
 *     U = | 1  xy  xz |
 *         | 0   1  yz |
 *         | 0   0   1 |
 *
 * This is the exact `U` that {@link composeAffine} right-multiplies into
 * `R · diag(scale)` (there it is folded in by column operations rather than
 * materialised). Anything that needs the shear on its own — e.g. drawing a
 * guide cell as the parallelepiped the map sends the unit cube to — builds it
 * here, so the visualisation can never drift from how the fractal is generated.
 */
export function shearMatrix(shear: Vec3): number[] {
  const [xy, xz, yz] = shear;
  // prettier-ignore
  return [
    1, xy, xz,
    0, 1,  yz,
    0, 0,  1,
  ];
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

/**
 * Whether a post-affine IS the identity — the ONE "structurally identity"
 * test every seam shares (persist's omit-on-encode, the prepares'
 * identity-skip, the eligibility gates' absent-equivalence). EXACT
 * comparison, `shear`'s all-zero pattern: a matrix that is the identity
 * only up to rounding is a real (if nearly trivial) post and encodes —
 * a document that authored one keeps it, and nothing downstream has to
 * guess at a tolerance.
 */
export function isIdentityAffine(a: Affine): boolean {
  const { m, t } = a;
  return (
    m.length === 9 &&
    m[0] === 1 &&
    m[1] === 0 &&
    m[2] === 0 &&
    m[3] === 0 &&
    m[4] === 1 &&
    m[5] === 0 &&
    m[6] === 0 &&
    m[7] === 0 &&
    m[8] === 1 &&
    t[0] === 0 &&
    t[1] === 0 &&
    t[2] === 0
  );
}

/** Row-major 3x3 matrix product `a · b` — the composition's linear part when
 * `a` is applied after `b`. Consumers: the forward post stage's `Rot_k · P`
 * (`composeLinearAffine`) and `transformSigmas`' post-priced composite
 * `post.m · composeAffine(t).m` (`surface-de.ts`). */
export function multiply3x3(
  a: readonly number[],
  b: readonly number[],
): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/**
 * Row-major 3x3 inverse via adjugate/determinant — the ONE definition every
 * inverse consumer shares (`surface-de.ts`'s base inverses, the per-map
 * post inverses, the eligibility gates' invertibility pricing). The
 * eligibility gates guarantee `|det| >= sigma_min^3 > 0` for every map this
 * is called on; a singular matrix returns non-finite entries by contract,
 * never a throw (the gates refuse before the descent could divide).
 */
export function inverse3x3(m: readonly number[]): number[] {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  const inv = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ];
}

/**
 * The forward POST stage of one kaleidoscope copy: a linear-only matrix
 * (the copy's rotation, applied AFTER the post) composed with a general
 * affine — `(L ∘ P)(p) = L·(P.m·p + P.t) = (L·P.m)·p + L·P.t`. This is the
 * ONE composition the WGSL packers and the descent construction share, so
 * the packed slot rows and the CPU's sequential apply (`P` then `L`) can
 * never disagree about what a copy's post stage is.
 */
export function composeLinearAffine(
  linear: readonly number[],
  post: Affine,
): Affine {
  return {
    m: multiply3x3(linear, post.m),
    t: [
      linear[0] * post.t[0] + linear[1] * post.t[1] + linear[2] * post.t[2],
      linear[3] * post.t[0] + linear[4] * post.t[1] + linear[5] * post.t[2],
      linear[6] * post.t[0] + linear[7] * post.t[1] + linear[8] * post.t[2],
    ],
  };
}
