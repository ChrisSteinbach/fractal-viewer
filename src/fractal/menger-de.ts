/**
 * The twisted mod-Menger sponge's 3D CPU oracle — the single-chain carve
 * estimator with the per-level rigid twist, and the f64 oracle the
 * `SURFACE_MENGER` GLSL arm and the `core:"menger"` WGSL kernel mirror
 * line for line. The construction, its vocabulary and the certification
 * argument are `menger-twist.ts`'s; this module is the 3D arithmetic.
 *
 * THE ESTIMATE. The repo construction, term for term (the twist applied
 * BEFORE each level's fold — including the first — while the enclosing box
 * is read untwisted, exactly as KentaYoshii/Raymarcher's loop does):
 *
 *     d = sdBox(p, 1)
 *     q = p;  s = 1
 *     repeat levels times:
 *       q = R(q + b)                  // the twist — an isometry
 *       a = mod(q*s, 2) - 1           // the sawtooth cell fold
 *       s *= 3
 *       r = |1 - 3|a||                // per-axis middle-third indicator
 *       c = (median(r) - 1) / s       // this level's carve
 *       d = max(d, c)
 *     DE = d
 *
 * WHY IT IS A TRUE DISTANCE BOUND AT EVERY TWIST. The map
 * `q <- R(q + b)` is an isometry of R^3, so each level's carve term is
 * the true WORLD distance from `p` to that level's removed pattern
 * measured through the twist — the level-m condition "`R^m p + o_m`
 * avoids the level-m bars" is exactly the membership condition the
 * construction carves by, and the bars' open interior contains no point
 * of the set. The running max over levels is therefore a lower bound on
 * the distance to the set; the untwisted chain is the field-standard
 * Menger SDF, and the isometry lifts it level by level unchanged. This
 * is the same shape of argument the trap-prefixed fold families use —
 * here it is EXACT per level (verified below), which is why no damping
 * machinery ships.
 *
 * EXACTNESS AT LEVEL 0, verified by hand and pinned in tests: the sawtooth
 * `a = mod(p*s,2)-1` folds each cell to `[−1,1)`, `r_i = |1−3|a_i|| > 1`
 * exactly on a coordinate's middle third, so `median(r) > 1` is "at
 * least two coordinates in middle thirds" — the removed cross. Inside a
 * removed bar `median(r) − 1 = 3·(distance to the bar walls)` in
 * cell units, and the `/s` converts to world units at every level, so
 * `c` reads the exact wall distance (`/3` and `×3` cancel at level 0 and
 * self-similarity keeps the accounting at every depth). At the box
 * center the estimate is exactly `1/3`; at `(0.1, 0.1, 0.8)` exactly
 * `7/30`; both pinned.
 *
 * NO MEMBERSHIP HOLE: the enclosing box contributes its own surface at
 * every setting, so unlike the escape chains this family needs no
 * empty-set probe — `mengerSetContains` exists for the certification
 * tests, not for a blank-frame signal.
 */
import { rotationMatrixXYZ } from "./affine";
import type { MengerTwistConstruction } from "./menger-twist";
import type { Vec3 } from "./types";

/**
 * March step scale. 1.0 — the estimate is exact per level (module doc),
 * and the sweep that pins it runs in the family's preview harness sheet;
 * the constant is the ONE definition the GLSL/WGSL mirrors import, exactly
 * as `bulb-de.ts`'s `BULB_STEP_SCALE` is.
 */
export const MENGER_STEP_SCALE = 1;

/**
 * Everything the marcher needs — the uniform/params wire format, mirroring
 * {@link estimateMengerDistance}. The twist is pre-composed at build time:
 * `R` is the row-major matrix the level map applies, `b` the offset
 * POST-rotation (the level map is `q <- R q + b`), so the per-eval work is
 * one 9-term matrix and one add.
 */
export interface MengerDE {
  /** Row-major 3×3 twist matrix `R` — the authored Euler rotation
   * (`affine.ts`'s convention). The 4D plane extensions are the 4D twin's
   * wire, not this module's. */
  twistM: number[];
  /** The twist offset in `q <- R q + b` form: `b = R·off`. */
  twistB: Vec3;
  /** Carve levels per evaluation. */
  levels: number;
  /** Marching bound in query space: the set is contained in the
   * construction's own box `[−1,1]³` (the carves only remove), so the
   * sphere tracer enters and exits against the box's circumscribed
   * ball — independent of the twist, which cannot move a point out of
   * the frame whose box bounds the set. */
  boundingRadius: number;
  /** Same ball — no final-transform lens exists in this family. */
  visibleBoundingRadius: number;
  /** The level budget, for the preview tier's depth clamp. */
  maxDepth: number;
  /** March step multiplier ({@link MENGER_STEP_SCALE}). */
  stepScale: number;
}

/** GLSL `mod(x, 2)`: `x − 2·floor(x/2)`. Duplicated in the 4D twin under
 * the twin-file convention — three lines, and the estimator is the text
 * the mirrors are written against. */
function sawtooth(x: number): number {
  return x - 2 * Math.floor(x / 2);
}

/** `sdBox(p, 1)` — the construction's own box. */
function boxDistance(p: Vec3): number {
  const qx = Math.abs(p[0]) - 1;
  const qy = Math.abs(p[1]) - 1;
  const qz = Math.abs(p[2]) - 1;
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  const mz = Math.max(qz, 0);
  return (
    Math.sqrt(mx * mx + my * my + mz * mz) +
    Math.min(Math.max(qx, Math.max(qy, qz)), 0)
  );
}

/** The level's carve term: `(median(r) − 1)/s`. `median` of three = the
 * max of each pair's max, minimised — `min(max(rx,ry), max(ry,rz),
 * max(rz,rx))` — the field's form, kept rather than a sort, because the
 * GLSL/WGSL mirrors write exactly this expression. */
function carveTerm(r: Vec3, s: number): number {
  const da = Math.max(r[0], r[1]);
  const db = Math.max(r[1], r[2]);
  const dc = Math.max(r[2], r[0]);
  return (Math.min(da, Math.min(db, dc)) - 1) / s;
}

/**
 * Precompute the DE for a resolved construction. Throws on a refused one
 * — the resolver gates first, so reaching the throw is a bug.
 */
export function buildMengerDE(construction: MengerTwistConstruction): MengerDE {
  const twistM = rotationMatrixXYZ(
    construction.rotation[0],
    construction.rotation[1],
    construction.rotation[2],
  );
  const off = construction.offset;
  const twistB: Vec3 = [
    twistM[0] * off[0] + twistM[1] * off[1] + twistM[2] * off[2],
    twistM[3] * off[0] + twistM[4] * off[1] + twistM[5] * off[2],
    twistM[6] * off[0] + twistM[7] * off[1] + twistM[8] * off[2],
  ];
  return {
    twistM,
    twistB,
    levels: construction.levels,
    boundingRadius: Math.sqrt(3),
    visibleBoundingRadius: Math.sqrt(3),
    maxDepth: construction.levels,
    stepScale: MENGER_STEP_SCALE,
  };
}

/** The winning level's fraction and the chain's terminal state, left in
 * module scratch by the one loop — `bulb-de.ts`'s one-shared-loop
 * convention, so the trap can never read a different chain than the
 * estimate ran. */
let chainLevel = 0;

/**
 * The distance estimate. `maxLevels` clamps the level budget for the
 * preview tier's depth clamp, through the same door the fold descents
 * use; callers wanting the full estimate pass nothing.
 */
export function estimateMengerDistance(
  de: MengerDE,
  p: Vec3,
  maxLevels = de.levels,
): number {
  runMengerChain(de, p, maxLevels);
  return chainDistance;
}

/** The shape/palette trap coordinate: the WINNING level's fraction — the
 * level whose carve term dominated the estimate — normalized by the
 * level count. This is the repo's own per-level color channel (`res.z =
 * (1+m)/4`), the analogue of the bulb core's escape-fraction trap, and
 * the f64 oracle the mirrors' trap lines pin against. */
export function mengerTrap(
  de: MengerDE,
  p: Vec3,
  maxLevels = de.levels,
): number {
  runMengerChain(de, p, maxLevels);
  return de.levels > 1 ? chainLevel / (de.levels - 1) : 0;
}

let chainDistance = 0;

/**
 * The carve chain from `p`, leaving the terminal distance and winning
 * level in module scratch — the loop the `SURFACE_MENGER` GLSL variant
 * and the `core:"menger"` kernel mirror statement for statement, factored
 * out of {@link estimateMengerDistance} so the estimate stays
 * bit-identical to its pinned history.
 */
function runMengerChain(de: MengerDE, p: Vec3, maxLevels: number): void {
  const m = de.twistM;
  const b = de.twistB;
  let d = boxDistance(p);
  let qx = p[0];
  let qy = p[1];
  let qz = p[2];
  let s = 1;
  let level = 0;
  for (let i = 0; i < maxLevels; i++) {
    // q <- R q + b, inlined term for term — the mirrors write exactly this.
    const tx = qx;
    const ty = qy;
    const tz = qz;
    qx = m[0] * tx + m[1] * ty + m[2] * tz + b[0];
    qy = m[3] * tx + m[4] * ty + m[5] * tz + b[1];
    qz = m[6] * tx + m[7] * ty + m[8] * tz + b[2];
    const ax = sawtooth(qx * s) - 1;
    const ay = sawtooth(qy * s) - 1;
    const az = sawtooth(qz * s) - 1;
    s *= 3;
    const rx = Math.abs(1 - 3 * Math.abs(ax));
    const ry = Math.abs(1 - 3 * Math.abs(ay));
    const rz = Math.abs(1 - 3 * Math.abs(az));
    const c = carveTerm([rx, ry, rz], s);
    if (c > d) {
      d = c;
      level = i;
    }
  }
  chainDistance = d;
  chainLevel = level;
}

/**
 * Membership: the point survives every level's carve and the box. The
 * certification tests read this — the DE and the membership are the same
 * loop's two readers (the `escape-de.ts` convention), so they cannot
 * disagree.
 */
export function mengerSetContains(de: MengerDE, p: Vec3): boolean {
  runMengerChain(de, p, de.levels);
  return chainDistance <= 0;
}
