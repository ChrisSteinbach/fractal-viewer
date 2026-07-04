import type { Rotation4, Transform, Transform4, Vec4 } from "./types";

/**
 * A composed 4D affine map (fr-cbg spike), stored as a row-major 4x4 linear part
 * (rotation scaled per column) plus a translation. Applying it to a point `p`
 * computes `m · p + t`. Mirrors {@link import("./affine").Affine}, one dimension
 * up: `m` has 16 entries instead of 9, `t` has 4 instead of 3.
 */
export interface Affine4 {
  /** Row-major 4x4 = R · diag(scale). */
  m: number[];
  /** Translation (the transform's position). */
  t: Vec4;
}

/**
 * # 4D rotation convention (documented verbatim so callers can rely on it)
 *
 * A plane rotation `R_ab(θ)` maps
 *
 *     a' = a·cosθ − b·sinθ
 *     b' = a·sinθ + b·cosθ
 *
 * i.e. it rotates the `+a` axis toward the `+b` axis and leaves the other two
 * coordinates fixed. Matrices are row-major 4x4 `number[]` (length 16), applied
 * as `m · p` with the point a column on the right — exactly the convention of
 * `affine.ts` (its 3x3 `applyAffine`), one dimension up.
 *
 * With coordinate indices `x=0, y=1, z=2, w=3`, `R_ab(θ)` is the identity with
 * four entries overwritten: `(a,a)=cosθ`, `(a,b)=−sinθ`, `(b,a)=sinθ`,
 * `(b,b)=cosθ` at row-major offsets `a*4+a`, `a*4+b`, `b*4+a`, `b*4+b`.
 */
const PLANES: Readonly<Record<keyof Rotation4, readonly [number, number]>> = {
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2],
  xw: [0, 3],
  yw: [1, 3],
  zw: [2, 3],
};

/** A fresh row-major 4x4 identity (fresh so callers may scale it in place). */
function identity4(): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * The single-plane rotation `R_ab(θ)` for axis indices `a < b` — an identity
 * with the four in-plane entries overwritten per the convention above. The
 * untouched entries stay exactly `0`/`1`, which is what lets
 * {@link rotationMatrix4} keep the `w` row/column bit-exact when no `w`-plane
 * angle is set.
 */
function planeRotation4(a: number, b: number, angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity4();
  m[a * 4 + a] = c;
  m[a * 4 + b] = -s;
  m[b * 4 + a] = s;
  m[b * 4 + b] = c;
  return m;
}

/** Row-major 4x4 matrix product `a · b`. Called once per compose, not in the
 * hot loop, so a plain triple loop (not a 64-term unroll) is clearest here. */
function multiply4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[r * 4 + k] * b[k * 4 + c];
      }
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/**
 * The composed 4D rotation matrix (row-major 4x4) for a {@link Rotation4}, the
 * product
 *
 *     R = R_yz(yz) · R_xz(xz) · R_xy(xy) · R_xw(xw) · R_yw(yw) · R_zw(zw)
 *
 * leftmost factor applied last. The three 3D-plane factors (`yz`, `xz`, `xy`)
 * deliberately come first and in that order so the 3D embedding
 * ({@link embedTransform3}) is EXACT: their upper-left 3x3 reproduces
 * {@link import("./affine").rotationMatrixXYZ} entry-for-entry.
 *
 * Implementation detail that matters: factors whose angle is exactly `0` are
 * SKIPPED (never multiplied in as identities). Each 3D-plane factor has its `w`
 * row and column already exactly `[0,0,0,1]`, and a product of such matrices
 * keeps them bit-exact (the `w` terms are `1·x` and `+0`), so a 3D system
 * embedded at `w = 0` stays at `w = 0` to the last bit. With every angle absent
 * this returns the exact identity (`===` `0`/`1`, not a rounded product).
 */
export function rotationMatrix4(rotation: Rotation4): number[] {
  // Product order (leftmost applied last). The 3D planes lead so the embedded
  // upper-left 3x3 matches rotationMatrixXYZ exactly; the w-planes trail.
  const order: (keyof Rotation4)[] = ["yz", "xz", "xy", "xw", "yw", "zw"];
  let result: number[] | null = null;
  for (const plane of order) {
    const angle = rotation[plane];
    // Skip exact-zero (or absent) factors: multiplying by an identity is a
    // no-op mathematically but would round the untouched w row/column, so
    // skipping keeps a pure-3D rotation's w entries bit-exact.
    if (angle === undefined || angle === 0) continue;
    const [a, b] = PLANES[plane];
    const factor = planeRotation4(a, b, angle);
    result = result === null ? factor : multiply4(result, factor);
  }
  return result ?? identity4();
}

/**
 * Compose a {@link Transform4} into an {@link Affine4} (`M = R · diag(scale)`).
 * Each column `c` of the rotation is scaled by `scale[c]` — the exact
 * column-scaling pattern of `affine.ts`'s `composeAffine` (`m[r*4+c] *=
 * scale[c]`), one dimension up. No shear: the spike's {@link Transform4} has no
 * shear field, so unlike the 3D `composeAffine` there is nothing to fold in.
 */
export function composeAffine4(transform: Transform4): Affine4 {
  // rotationMatrix4 returns a fresh array, so scaling it in place is safe.
  const m = rotationMatrix4(transform.rotation ?? {});
  const s = transform.scale;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      m[r * 4 + c] *= s[c];
    }
  }
  return { m, t: [...transform.position] };
}

/** Apply a 4D affine map to a point: returns `m · (x, y, z, w) + t`. Hand-
 * unrolled (16 mults) — this is the chaos game's inner loop. */
export function applyAffine4(
  a: Affine4,
  x: number,
  y: number,
  z: number,
  w: number,
): Vec4 {
  const { m, t } = a;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0],
    m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1],
    m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2],
    m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3],
  ];
}

/**
 * # The 3D → 4D bridge
 *
 * Embed a 3D {@link Transform} as a {@link Transform4} living in the `w = 0`
 * slice: position gains a `0` fourth coordinate, scale a `1`, and the Euler-XYZ
 * rotation is rewritten as three plane angles.
 *
 * The mapping of the 3D rotation is the subtle part. `affine.ts`'s
 * `rotationMatrixXYZ` is `RX(x) · RY(y) · RZ(z)`. In plane terms
 *
 *     RX(θ) = R_yz(θ)        (rotate y toward z)
 *     RZ(θ) = R_xy(θ)        (rotate x toward y)
 *     RY(θ) = R_xz(−θ)       ← SIGN FLIP
 *
 * **The `RY` sign flip is deliberate and load-bearing.** A rotation *about* the
 * `+y` axis turns `+z` toward `+x` (right-hand rule), which is the OPPOSITE
 * orientation to `R_xz`'s "rotate `+x` toward `+z`". So `RY(θ) = R_xz(−θ)`, and
 * the embedded rotation is `{ yz: rx, xz: −ry, xy: rz }`. Because
 * {@link rotationMatrix4} multiplies its `yz·xz·xy` factors in exactly that
 * order, the composed 4x4's upper-left 3x3 equals `rotationMatrixXYZ(rx,ry,rz)`
 * to within floating-point rounding (the generic 4x4 products associate
 * differently than `rotationMatrixXYZ`'s hand-factored terms, so agreement is
 * ulp-level, not bitwise — the tests pin 1e-12), and its `w` row/column stay
 * exactly `[0,0,0,1]`.
 *
 * Shear and variations are NOT representable in the spike's {@link Transform4},
 * so rather than silently drop them (a wrong embed that looks right) this throws
 * a `RangeError` when the source transform carries a non-zero shear or any
 * enabled (weight > 0) variation.
 */
export function embedTransform3(t: Transform): Transform4 {
  const { shear } = t;
  if (shear && (shear[0] !== 0 || shear[1] !== 0 || shear[2] !== 0)) {
    throw new RangeError(
      "embedTransform3: shear is not representable in the 4D spike's Transform4",
    );
  }
  if (t.variations && t.variations.some((v) => v.weight > 0)) {
    throw new RangeError(
      "embedTransform3: variations are not representable in the 4D spike's Transform4",
    );
  }
  const [rx, ry, rz] = t.rotation;
  const [px, py, pz] = t.position;
  const [sx, sy, sz] = t.scale;
  const embedded: Transform4 = {
    position: [px, py, pz, 0],
    scale: [sx, sy, sz, 1],
    // yz = rx, xz = −ry (the RY sign flip above), xy = rz.
    rotation: { yz: rx, xz: -ry, xy: rz },
  };
  if (t.weight !== undefined) embedded.weight = t.weight;
  return embedded;
}
