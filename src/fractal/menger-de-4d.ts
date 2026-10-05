/**
 * The twisted mod-Menger family's 4D half — the hyper-Menger carve with
 * the per-level SO(4) twist, the 3D estimator one dimension up under the
 * twin-file convention (`escape-de-4d.ts`'s rule): every constant,
 * vocabulary and certification argument imports from
 * `menger-twist.ts`/`menger-de.ts`, and only the vector arithmetic is
 * duplicated. The one genuinely NEW part is the fourth axis of the carve
 * (the hyper-Menger rule: a cell of the level's 3-by lattice is removed
 * when TWO OR MORE of its four coordinates sit in their middle thirds —
 * the 48-survivor rule `hyperMengerSpongeTransforms` encodes for the IFS)
 * and the twist's extra SO(4) degrees of freedom (the plane rotations
 * `affine4.ts`'s convention composes AFTER the 3D Euler part, so the
 * embedded upper-left 3×3 of the 4D twist reproduces the 3D twist's
 * matrix exactly).
 *
 * THE 4D CARVE TERM. Four per-axis indicators `r_i`, and the removed
 * condition "at least two coordinates in middle thirds" reads
 * `second-smallest(r) > 1` — computed as the minimum over all six
 * coordinate pairs of the pair's max, the same `min-of-maxes` shape the
 * 3D median is (there the three pairs give the median; here the six give
 * the second-smallest). Inside a removed pair-slab the value is the exact
 * wall distance, `/s` converting to world units, exactly as the 3D
 * module certifies.
 *
 * SOUNDNESS imports verbatim: `q <- R q + b` is an isometry of R^4 (the
 * 4D rotation's rows are orthonormal), so the running max over levels is
 * a true lower bound on the distance to the set at every twist; the
 * bounding ball is the construction's own box `[−1,1]⁴`'s circumscribed
 * sphere, radius 2, independent of the twist.
 */
import { rotationMatrixXYZ } from "./affine";
import { multiply4x4, rotationMatrix4 } from "./affine4";
import { MENGER_STEP_SCALE } from "./menger-de";
import type { MengerTwistConstruction } from "./menger-twist";
import type { Vec4 } from "./types";

/**
 * Everything the 4D marcher needs — the uniform/params wire format,
 * mirroring {@link estimateMengerDistance4}. The twist is pre-composed at
 * build time: the row-major 4×4 the level map applies (the 3D Euler
 * rotation embedded and composed with the authored w-plane rotations),
 * and the offset in `q <- R q + b` form.
 */
export interface MengerDE4 {
  /** Row-major 4×4 twist matrix `R`. */
  twistM: number[];
  /** The twist offset in `q <- R q + b` form: `b = R·[off, offW]`. */
  twistB: Vec4;
  /** Carve levels per evaluation. */
  levels: number;
  /** The construction's own bounding sphere: the `[−1,1]⁴` box's
   * circumscribed ball, radius 2. */
  boundingRadius: number;
  /** Same ball — no final-transform lens exists in this family. */
  visibleBoundingRadius: number;
  /** The level budget, for the preview tier's depth clamp. */
  maxDepth: number;
  /** March step multiplier ({@link MENGER_STEP_SCALE}). */
  stepScale: number;
}

/** GLSL `mod(x, 2)` — the 3D module's sawtooth, one dimension up. */
function sawtooth(x: number): number {
  return x - 2 * Math.floor(x / 2);
}

/** `sdBox(p, 1)` in R⁴ — the construction's own box. */
function boxDistance4(p: Vec4): number {
  const qx = Math.abs(p[0]) - 1;
  const qy = Math.abs(p[1]) - 1;
  const qz = Math.abs(p[2]) - 1;
  const qw = Math.abs(p[3]) - 1;
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  const mz = Math.max(qz, 0);
  const mw = Math.max(qw, 0);
  return (
    Math.sqrt(mx * mx + my * my + mz * mz + mw * mw) +
    Math.min(Math.max(Math.max(qx, qy), Math.max(qz, qw)), 0)
  );
}

/** The level's carve term in R⁴: `(second-largest(r) − 1)/s` — "at least
 * two of four coordinates in middle thirds" is `r`'s second-largest
 * exceeding 1 (the 3D median is the same statistic at three axes: its
 * second-largest IS its median). Computed as the maximum over the six
 * coordinate pairs of the pair's MIN — the pair of the two largest
 * values' min is the second-largest — the expression the WGSL mirror
 * writes, and the 3D `min-of-maxes`' mirror image rather than its copy
 * (there three axes make both forms the median; here only max-of-mins
 * reads the right order statistic). */
function carveTerm4(r: Vec4, s: number): number {
  const m = Math.max(
    Math.min(r[0], r[1]),
    Math.max(
      Math.min(r[0], r[2]),
      Math.max(
        Math.min(r[0], r[3]),
        Math.max(
          Math.min(r[1], r[2]),
          Math.max(Math.min(r[1], r[3]), Math.min(r[2], r[3])),
        ),
      ),
    ),
  );
  return (m - 1) / s;
}

/**
 * Precompute the 4D DE for a resolved construction. Throws on a refused
 * one — the resolver gates first, so reaching the throw is a bug.
 */
export function buildMengerDE4(
  construction: MengerTwistConstruction,
): MengerDE4 {
  // The 3D Euler part leads (upper-left block), the w-plane rotations
  // compose after it — `affine4.ts`'s convention, so the embedded 3×3
  // reproduces the 3D estimator's twist matrix exactly.
  const euler3 = rotationMatrixXYZ(
    construction.rotation[0],
    construction.rotation[1],
    construction.rotation[2],
  );
  const euler4 = [
    ...euler3.slice(0, 3),
    0,
    ...euler3.slice(3, 6),
    0,
    ...euler3.slice(6, 9),
    0,
    0,
    0,
    0,
    1,
  ];
  const planes = rotationMatrix4(construction.rotation4);
  const twistM = multiply4x4(planes, euler4);
  const off = construction.offset;
  const off4: Vec4 = [off[0], off[1], off[2], construction.offsetW];
  const twistB: Vec4 = [
    twistM[0] * off4[0] +
      twistM[1] * off4[1] +
      twistM[2] * off4[2] +
      twistM[3] * off4[3],
    twistM[4] * off4[0] +
      twistM[5] * off4[1] +
      twistM[6] * off4[2] +
      twistM[7] * off4[3],
    twistM[8] * off4[0] +
      twistM[9] * off4[1] +
      twistM[10] * off4[2] +
      twistM[11] * off4[3],
    twistM[12] * off4[0] +
      twistM[13] * off4[1] +
      twistM[14] * off4[2] +
      twistM[15] * off4[3],
  ];
  return {
    twistM,
    twistB,
    levels: construction.levels,
    boundingRadius: 2,
    visibleBoundingRadius: 2,
    maxDepth: construction.levels,
    stepScale: MENGER_STEP_SCALE,
  };
}

/** The winning level's fraction and the chain's terminal distance, left
 * in module scratch by the one loop — the 3D module's convention. */
let chainLevel = 0;
let chainDistance = 0;

/**
 * The 4D distance estimate. `maxLevels` clamps the level budget for the
 * preview tier's depth clamp; callers wanting the full estimate pass
 * nothing.
 */
export function estimateMengerDistance4(
  de: MengerDE4,
  p: Vec4,
  maxLevels = de.levels,
): number {
  runMengerChain4(de, p, maxLevels);
  return chainDistance;
}

/** The 4D trap coordinate: the WINNING level's fraction, the 3D
 * {@link !MengerDE | mengerTrap}'s twin. */
export function mengerTrap4(
  de: MengerDE4,
  p: Vec4,
  maxLevels = de.levels,
): number {
  runMengerChain4(de, p, maxLevels);
  return de.levels > 1 ? chainLevel / (de.levels - 1) : 0;
}

/**
 * The carve chain from `p`, leaving the terminal distance and winning
 * level in module scratch — the loop the `core:"menger4"` kernel mirrors
 * statement for statement.
 */
function runMengerChain4(de: MengerDE4, p: Vec4, maxLevels: number): void {
  const m = de.twistM;
  const b = de.twistB;
  let d = boxDistance4(p);
  let qx = p[0];
  let qy = p[1];
  let qz = p[2];
  let qw = p[3];
  let s = 1;
  let level = 0;
  for (let i = 0; i < maxLevels; i++) {
    const tx = qx;
    const ty = qy;
    const tz = qz;
    const tw = qw;
    qx = m[0] * tx + m[1] * ty + m[2] * tz + m[3] * tw + b[0];
    qy = m[4] * tx + m[5] * ty + m[6] * tz + m[7] * tw + b[1];
    qz = m[8] * tx + m[9] * ty + m[10] * tz + m[11] * tw + b[2];
    qw = m[12] * tx + m[13] * ty + m[14] * tz + m[15] * tw + b[3];
    const ax = sawtooth(qx * s) - 1;
    const ay = sawtooth(qy * s) - 1;
    const az = sawtooth(qz * s) - 1;
    const aw = sawtooth(qw * s) - 1;
    s *= 3;
    const rx = Math.abs(1 - 3 * Math.abs(ax));
    const ry = Math.abs(1 - 3 * Math.abs(ay));
    const rz = Math.abs(1 - 3 * Math.abs(az));
    const rw = Math.abs(1 - 3 * Math.abs(aw));
    const c = carveTerm4([rx, ry, rz, rw], s);
    if (c > d) {
      d = c;
      level = i;
    }
  }
  chainDistance = d;
  chainLevel = level;
}

/**
 * Membership: the point survives every level's carve and the box — the
 * certification tests' oracle, the same loop's second reader.
 */
export function mengerSetContains4(de: MengerDE4, p: Vec4): boolean {
  runMengerChain4(de, p, de.levels);
  return chainDistance <= 0;
}
