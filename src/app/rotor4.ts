import type { Rotation4 } from "../fractal/types";

/**
 * # SO(4) as a quaternion pair — the app-side rotor for the 4D view (fr-woc)
 *
 * `orbit.ts` is the pure (no Three.js), unit-tested math for the 3D camera;
 * this module is its analogue for the 4D projection's VIEW rotation — the
 * tumble and the Shift-drag/Shift-wheel gestures in `interactions.ts` all
 * compose into one {@link RotorPair}, converted to a matrix only at the
 * `scene.setRot4` shader-uniform boundary (see `main.ts`). It never touches
 * the chaos game: that still runs `rotationMatrix4` (affine4.ts) at
 * generation time, per transform.
 *
 * ## Why a quaternion pair, not an accumulated matrix
 *
 * Every 3D rotation is `x ↦ q·x·q̄` for a unit quaternion `q` — SO(3) is (up to
 * an overall sign) the unit quaternions. The SO(4) analogue is a PAIR of unit
 * quaternions acting from both sides:
 *
 *     x ↦ p · x · q̄
 *
 * where the point `(x, y, z, w)` is read as the quaternion `P = w + x·i + y·j
 * + z·k` — note the SCALAR slot carries `w`, not a dropped fourth coordinate.
 * `rotorMatrix`'s `BASIS` array below encodes exactly this identification.
 *
 * Composing a new rotation `(dp, dq)` ON TOP of the current one — which is
 * what every tumble tick and every Shift-drag pixel does — is a pair of
 * quaternion products, not a 4x4 matrix product:
 *
 *     new = delta ∘ old   ⟺   p ← dp·p,  q ← dq·q
 *
 * since `(dp·p)·x·(dq·q)‾ = dp·(p·x·q̄)·dq̄` (using the standard reversal rule
 * `(dq·q)‾ = q̄·dq̄`) `= dp·(delta's own input)·dq̄`. {@link rotateInPlane} is
 * exactly this: left-multiply both halves by the plane's delta, then
 * renormalize.
 *
 * ## Why renormalize on every call
 *
 * `dp·p` and `dq·q` are each a product of two unit quaternions, so they are
 * unit length in exact arithmetic — but floating point isn't exact, and tens
 * of thousands of per-frame compositions (an hours-long idle tumble) let that
 * error accumulate. Renormalizing `p` and `q` back onto the unit 3-sphere
 * after every {@link rotateInPlane} call is the direct quaternion analogue of
 * Gram-Schmidt re-orthonormalizing an accumulated rotation MATRIX — cheaper
 * (rescale two 4-vectors vs. re-orthogonalize three 4-vectors), and it is the
 * whole reason this module accumulates a pair instead of just multiplying
 * `rotationMatrix4` outputs together frame after frame: matrix accumulation
 * has no equally-cheap renormalization step. `rotor4.test.ts`'s 20,000-step
 * drift test is the rent-payer for this choice.
 *
 * ## Per-plane deltas
 *
 * `rotationMatrix4` (affine4.ts) defines `R_ab(θ)` as rotating `+a` toward
 * `+b`, leaving the other two coordinates fixed; the table below reproduces
 * that convention exactly (checked entry-wise against it in
 * `rotor4.test.ts` — if a sign ever disagrees, the test is right and this
 * table is wrong, not the other way around). With `exp(α·u) = cos α + sin α·u`
 * for a unit imaginary `u`:
 *
 * | plane | dp            | dq            |
 * | ----- | ------------- | ------------- |
 * | xy    | exp(+θ/2·k)   | exp(+θ/2·k)   |
 * | yz    | exp(+θ/2·i)   | exp(+θ/2·i)   |
 * | xz    | exp(−θ/2·j)   | exp(−θ/2·j)   |
 * | xw    | exp(−θ/2·i)   | exp(+θ/2·i)   |
 * | yw    | exp(−θ/2·j)   | exp(+θ/2·j)   |
 * | zw    | exp(−θ/2·k)   | exp(+θ/2·k)   |
 *
 * The three planes that FIX `w` (xy, yz, xz) have `dq = dp`: conjugating by
 * the SAME unit quaternion on both sides cancels the scalar part entirely —
 * `q·(w + v)·q̄ = w·(q·q̄) + q·v·q̄ = w + (rotated v)` since `q·q̄ = 1` for a unit
 * `q` — reducing to the textbook 3D quaternion rotation of the vector part.
 * (The `xz` minus sign is the same orientation flip documented on
 * `embedTransform3`'s `RY` note in affine4.ts: rotation *about* `+y` turns
 * `+z` toward `+x`, the opposite handedness from `R_xz`'s "`+x` toward `+z`".)
 *
 * The three planes that MIX `w` in (xw, yw, zw) instead have `dq = d̄p`.
 * Sketch: left-multiplying `P` by `exp(α·i)` rotates the `(w,x)` pair by `α`
 * AND the `(y,z)` pair by `α`; right-multiplying by `exp(β·i)` rotates
 * `(w,x)` by `β` but `(y,z)` by `−β` — the two coordinate pairs pick up
 * OPPOSITE relative signs from a right-multiply, where they picked up the
 * SAME sign from a left-multiply. Wanting `θ` on the `xw` pair and exactly
 * `0` on the untouched `yz` pair is then a 2x2 linear system in the two
 * half-angles, solved by the half-angle split above; `j ↔ (w,y)/(z,x)` and
 * `k ↔ (w,z)/(x,y)` follow the same pattern.
 *
 * ## `rotorMatrix`
 *
 * Built column by column as the image of each basis quaternion under
 * `x ↦ p·x·q̄` — 8 quaternion multiplies total (2 per column × 4 columns).
 * This runs once per rendered 4D frame, so clarity beats a closed-form
 * 16-term expansion. Unlike `rotationMatrix4`'s exact-zero-skip trick, this
 * does NOT keep the `w` row/column bit-exact for a pure-3D rotation (every
 * entry here is a generic product of trig terms) — fine, since this matrix
 * only ever feeds the view uniform, never the chaos game.
 */

/** A quaternion, scalar-first: `[s, i, j, k]`. */
export type Quat = [number, number, number, number];

/**
 * The accumulated SO(4) view rotation: a point `(x,y,z,w)`, read as the
 * quaternion `P = w + x·i + y·j + z·k`, maps to `p · P · q̄`. See the module
 * doc comment for the derivation and the composition/renormalization rule.
 */
export interface RotorPair {
  p: Quat;
  q: Quat;
}

/** Hamilton product `a·b` (scalar-first `[s, i, j, k]`). */
function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Quaternion conjugate: negate the vector part, leave the scalar (`w`). */
function conj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Rescale onto the unit 3-sphere — see the module doc comment on why this
 * runs after every {@link rotateInPlane} composition. */
function normalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Index into a {@link Quat} of the imaginary units `i`, `j`, `k`. */
type ImaginaryUnit = 1 | 2 | 3;

/** `exp(angle·u) = cos(angle) + sin(angle)·u` for a basis imaginary unit `u` —
 * always a unit quaternion, for any real `angle`. */
function expUnit(unit: ImaginaryUnit, angle: number): Quat {
  const out: Quat = [Math.cos(angle), 0, 0, 0];
  out[unit] = Math.sin(angle);
  return out;
}

/**
 * Per-plane rotor deltas (derived in the module doc comment): which basis
 * unit (`i`=1, `j`=2, `k`=3) the delta rotates about, and the ± sign each of
 * `dp`/`dq` applies to the shared half-angle. `signP === signQ` (both `+1` or
 * both `−1`) for the three planes that fix `w` — i.e. `dq = dp`; opposite
 * signs for the three that mix `w` in — i.e. `dq = d̄p`.
 */
const PLANE_DELTA: Readonly<
  Record<keyof Rotation4, { unit: ImaginaryUnit; signP: 1 | -1; signQ: 1 | -1 }>
> = {
  xy: { unit: 3, signP: 1, signQ: 1 },
  yz: { unit: 1, signP: 1, signQ: 1 },
  xz: { unit: 2, signP: -1, signQ: -1 },
  xw: { unit: 1, signP: -1, signQ: 1 },
  yw: { unit: 2, signP: -1, signQ: 1 },
  zw: { unit: 3, signP: -1, signQ: 1 },
};

/** The identity rotation: `p = q = [1, 0, 0, 0]`. */
export function identityRotorPair(): RotorPair {
  return { p: [1, 0, 0, 0], q: [1, 0, 0, 0] };
}

/**
 * Compose a rotation by `angle` radians in the given coordinate `plane` ON
 * TOP of `pair` (delta applied after — see the module doc comment), and
 * renormalize. Pure: `pair` is read, never written.
 */
export function rotateInPlane(
  pair: RotorPair,
  plane: keyof Rotation4,
  angle: number,
): RotorPair {
  const { unit, signP, signQ } = PLANE_DELTA[plane];
  const half = angle / 2;
  const dp = expUnit(unit, signP * half);
  const dq = expUnit(unit, signQ * half);
  return {
    p: normalize(quatMul(dp, pair.p)),
    q: normalize(quatMul(dq, pair.q)),
  };
}

/** The basis quaternions for `x`, `y`, `z`, `w`, in that column order —
 * `e_w = [1,0,0,0]` is the pure scalar, matching `P = w + x·i + y·j + z·k`. */
const BASIS: readonly Quat[] = [
  [0, 1, 0, 0], // e_x
  [0, 0, 1, 0], // e_y
  [0, 0, 0, 1], // e_z
  [1, 0, 0, 0], // e_w
];

/**
 * The row-major 4x4 matrix for `pair`'s rotation (`x ↦ p·x·q̄`), for the
 * `uRot4` shader uniform. See the module doc comment for the derivation and
 * its one caveat (not bit-exact for pure-3D rotations, unlike `rotationMatrix4`).
 */
export function rotorMatrix(pair: RotorPair): number[] {
  const qc = conj(pair.q);
  const m = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    const v = quatMul(quatMul(pair.p, BASIS[c]), qc);
    m[0 * 4 + c] = v[1]; // x row ← i component
    m[1 * 4 + c] = v[2]; // y row ← j component
    m[2 * 4 + c] = v[3]; // z row ← k component
    m[3 * 4 + c] = v[0]; // w row ← scalar component
  }
  return m;
}
