import type { Rotation4, Shear4, Transform, Transform4, Vec4 } from "./types";

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
 * Compose a {@link Transform4} into an {@link Affine4}
 * (`M = R · diag(scale) · U`). Each column `c` of the rotation is scaled by
 * `scale[c]` — the exact column-scaling pattern of `affine.ts`'s `composeAffine`
 * (`m[r*4+c] *= scale[c]`), one dimension up — then the unit upper-triangular
 * {@link Shear4} factor `U` is folded in by column operations, exactly as the 3D
 * `composeAffine` does (see {@link foldShear4}). Skipped entirely when `shear` is
 * absent or all-zero, so an unsheared system composes bit-identically to before
 * fr-hy8.
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
  if (transform.shear) foldShear4(m, transform.shear);
  return { m, t: [...transform.position] };
}

/**
 * Right-multiply a row-major 4x4 `B = R · diag(scale)` (in place) by the unit
 * upper-triangular {@link Shear4} factor `U`, giving `M = B · U`. With `U` as
 * documented on {@link Shear4}, column `j` of `M` is `B · (column j of U)`:
 *
 *     col0 = b0                              (unchanged)
 *     col1 = b1 + xy·b0
 *     col2 = b2 + xz·b0 + yz·b1
 *     col3 = b3 + xw·b0 + yw·b1 + zw·b2
 *
 * — every mix uses the ORIGINAL earlier columns. Updating columns in DESCENDING
 * order (3, then 2, then 1; col0 is never touched) is what makes that hold in
 * place: when col3 reads col1/col2 they are still original, and when col2 reads
 * col1 it is still original. This is the direct 4D extension of `affine.ts`'s
 * `composeAffine` shear fold (whose 3D `U` uses `[xy, xz, yz]` in exactly these
 * slots), and the whole point of the {@link Transform4} affine parameterization:
 * the remaining six degrees of freedom that let a 4D map express ANY affine map.
 */
function foldShear4(m: number[], shear: Shear4): void {
  const xy = shear.xy ?? 0;
  const xz = shear.xz ?? 0;
  const yz = shear.yz ?? 0;
  const xw = shear.xw ?? 0;
  const yw = shear.yw ?? 0;
  const zw = shear.zw ?? 0;
  if (xy === 0 && xz === 0 && yz === 0 && xw === 0 && yw === 0 && zw === 0) {
    return;
  }
  for (let r = 0; r < 4; r++) {
    const c0 = m[r * 4];
    const c1 = m[r * 4 + 1];
    const c2 = m[r * 4 + 2];
    // Descending order: col3 first (mixes original col0/1/2), then col2
    // (original col0/1), then col1 (original col0). Reading the saved c0/c1/c2
    // makes the "original earlier column" requirement explicit.
    m[r * 4 + 3] += xw * c0 + yw * c1 + zw * c2;
    m[r * 4 + 2] += xz * c0 + yz * c1;
    m[r * 4 + 1] += xy * c0;
  }
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
 * slice: position gains a `0` fourth coordinate, scale gains the map's MEAN
 * spatial contraction `(|sx|+|sy|+|sz|)/3` (below), the Euler-XYZ rotation is
 * rewritten as three plane angles, and — since fr-hy8 completed the
 * {@link Transform4} parameterization — the 3D shear and variations carry across
 * verbatim. The embed is now TOTAL: every 3D {@link Transform} is representable,
 * so there is no reject condition and no throw.
 *
 * ## Why `scale_w` is the mean contraction, not `1`
 *
 * `scale_w = 1` looks like the natural "leave w alone" choice, but it makes the
 * embedded system an ISOMETRY in w — no attractor in that direction. Untouched,
 * that merely leaves the cloud parked in whatever slice the seed landed in; the
 * moment a 4D edit (fr-2ou) gives the map a w-translation, `w' = w + t_w` has
 * no fixed point, w ratchets off to the escape limit, and the cloud "vanishes"
 * into constant reseeds. Contracting w at the map's mean spatial rate keeps ANY
 * 4D parameter edit a contraction, and makes the pure embed genuinely attract
 * to `w = 0` (the true 3D slice) rather than float wherever it was seeded. An
 * isotropic map embeds exactly like its native-4D counterpart — a ½-scale
 * flake map gets `scale_w = ½`, precisely the pentatope gasket's maps.
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
 * Shear and variations carry across into the identical-meaning
 * {@link Transform4} fields: the 3D shear `[xy, xz, yz]` becomes `{ xy, xz, yz }`
 * (the three `w`-column entries `xw`/`yw`/`zw` absent, i.e. 0 — the embedded map
 * shears only within the `w = 0` slice), and the variation list is copied as-is
 * (its 4D lift reproduces the 3D warp bit-for-bit on the `w = 0` slice — see
 * `variations4.ts`). So the `w = 0` slice of the embedded 4D system is exactly
 * the source 3D fractal, shear, variations and all.
 */
export function embedTransform3(t: Transform): Transform4 {
  const [rx, ry, rz] = t.rotation;
  const [px, py, pz] = t.position;
  const [sx, sy, sz] = t.scale;
  const meanContraction = (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3;
  const embedded: Transform4 = {
    position: [px, py, pz, 0],
    scale: [sx, sy, sz, meanContraction],
    // yz = rx, xz = −ry (the RY sign flip above), xy = rz.
    rotation: { yz: rx, xz: -ry, xy: rz },
  };
  // Carry the 3D shear into the w = 0 slice: [xy, xz, yz] → { xy, xz, yz },
  // leaving the w-column entries absent. Only when present (unsheared maps stay
  // a shearless Transform4 so composeAffine4 keeps its fast path).
  const { shear } = t;
  if (shear && (shear[0] !== 0 || shear[1] !== 0 || shear[2] !== 0)) {
    embedded.shear = { xy: shear[0], xz: shear[1], yz: shear[2] };
  }
  // Copy the variation list verbatim (its 4D lift is w = 0-exact). A fresh array
  // so later edits to either transform can't alias through.
  if (t.variations && t.variations.length > 0) {
    embedded.variations = t.variations.map((v) => ({ ...v }));
  }
  if (t.weight !== undefined) embedded.weight = t.weight;
  return embedded;
}

/**
 * Lift a 3D {@link Transform} to a {@link Transform4}: start from its flat
 * {@link embedTransform3} embedding, then splice in whatever `w` overrides the
 * transform carries (its optional `w` block). This is the general 3D → 4D
 * bridge for a system where "4D" is a per-transform, DERIVED property (see
 * {@link isFlatTransform}/{@link systemIsFlat}) rather than a separate mode —
 * every transform lifts through here, whether or not it actually carries any
 * `w` overrides.
 *
 * The splice is SPARSE: only fields actually present on `t.w` are touched, so
 * a transform with no `w` block returns EXACTLY `embedTransform3(t)` — same
 * object shape, same absent fields. In particular, `w.scale` absent leaves the
 * embed's derived mean spatial contraction untouched, which is the whole point
 * of leaving it derivable rather than materialised: it keeps tracking the
 * map's CURRENT scale-X/Y/Z (recomputed by `embedTransform3` on every call)
 * instead of freezing whatever the mean was when `w` was first added — see
 * `embedTransform3`'s JSDoc for why that derived contraction, not `1`, is what
 * keeps a later 4D edit contractive.
 */
export function toTransform4(t: Transform): Transform4 {
  const embedded = embedTransform3(t);
  const { w } = t;
  if (!w) return embedded;

  if (w.position !== undefined) embedded.position[3] = w.position;
  if (w.scale !== undefined) embedded.scale[3] = w.scale;

  if (w.rotation) {
    const { xw, yw, zw } = w.rotation;
    // embedTransform3 always sets `rotation` (even with every angle at its
    // default), so there is always an object here to splice the w-planes onto.
    const rotation = embedded.rotation;
    if (rotation) {
      if (xw !== undefined) rotation.xw = xw;
      if (yw !== undefined) rotation.yw = yw;
      if (zw !== undefined) rotation.zw = zw;
    }
  }

  if (w.shear) {
    const { xw, yw, zw } = w.shear;
    if (xw !== undefined || yw !== undefined || zw !== undefined) {
      // embedTransform3 only sets `shear` for a non-zero 3D shear, so an
      // unsheared base needs a fresh object to hold the w-only entries.
      const shear = embedded.shear ?? {};
      if (xw !== undefined) shear.xw = xw;
      if (yw !== undefined) shear.yw = yw;
      if (zw !== undefined) shear.zw = zw;
      embedded.shear = shear;
    }
  }

  return embedded;
}

/**
 * Whether a transform's optional `w` block ({@link Transform.w}) is absent or
 * trivial, i.e. the map has no 4D degrees of freedom in play and lives flat in
 * the `w = 0` slice. Mirrors {@link rotationMatrix4}'s skip-zero-factors
 * discipline: a field only disqualifies flatness when it is PRESENT and
 * non-zero — `w: {}` and `w: { scale: 0 }` are both flat, `w: { scale: 0.5 }`
 * is not — so a system round-tripped through explicit-zero `w` fields stays
 * exactly as flat as one with no `w` block at all.
 */
export function isFlatTransform(t: Transform): boolean {
  const { w } = t;
  if (!w) return true;
  if (w.position !== undefined && w.position !== 0) return false;
  if (w.scale !== undefined && w.scale !== 0) return false;
  if (w.rotation) {
    const { xw, yw, zw } = w.rotation;
    if (xw !== undefined && xw !== 0) return false;
    if (yw !== undefined && yw !== 0) return false;
    if (zw !== undefined && zw !== 0) return false;
  }
  if (w.shear) {
    const { xw, yw, zw } = w.shear;
    if (xw !== undefined && xw !== 0) return false;
    if (yw !== undefined && yw !== 0) return false;
    if (zw !== undefined && zw !== 0) return false;
  }
  return true;
}

/**
 * Whether every transform in a system is flat (see {@link isFlatTransform}) —
 * the derived condition that lets the app treat "4D" as a property of a
 * system (do any of its maps have 4D degrees of freedom in play?) rather than
 * a separate mode the whole system opts into.
 */
export function systemIsFlat(transforms: readonly Transform[]): boolean {
  return transforms.every(isFlatTransform);
}
