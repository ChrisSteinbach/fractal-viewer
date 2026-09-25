/**
 * The GLASS SOLID's COMPOSITE: under a general Glass solid (`{level}` alone
 * with per-map media), a Glass map's subtree stays a CELL — glass needs a
 * closed interior — while every other map's subtree renders as the TRUE
 * ATTRACTOR, the fine detail the ordinary IFS Surface render draws, visible
 * directly and through the glass.
 *
 * THE OPAQUE CONTENT is `O = ∪_{a opaque} M_a(A)`, the attractor restricted
 * to the opaque first-level branches. Its distance is bounded by WRAPPING
 * the shipped IFS estimator rather than editing its descent:
 *
 *   dist(p, M_a(A)) = min_{y∈A} |M_a(M_a⁻¹p − y)| ≥ σ_min(M_a)·dist(M_a⁻¹p, A)
 *                   ≥ σ_min(M_a)·DE(M_a⁻¹p),
 *
 * so `min_a σ_min(M_a)·DE(M_a⁻¹p)` is a lower bound of `dist(p, O)` for ANY
 * estimator that lower-bounds `dist(·, A)` — the refined affine ladder
 * (`estimateDistanceRefined` / `estimateDistance4Refined`) in both
 * dimensions. The alternative the plan first named — a branch mask on the
 * descent's first level — would edit the hot beam in 3D, 4D and both shader
 * mirrors for the same bound; the wrapper changes no estimator byte, so an
 * unmasked result is byte-identical by construction.
 *
 * COST: one descent per SURVIVING branch. Branches are visited nearest
 * first by a CERTIFIED ball bound — `M_a(A) ⊆ M_a(levelBoxes[0])`, whose
 * image sits in the ball of radius `σ_max(M_a)·halfDiagonal` around the
 * image of the box centre — and a branch whose ball bound cannot beat the
 * running minimum is never descended, so a query near the surface pays
 * about one descent. The bound is the construction's invariant box, never
 * the estimator's probe-fitted ball, which is not a certificate.
 *
 * THE CUTOFF CONTRACT carries through the scale: a branch is asked at
 * `cutoff / σ_min`, so a returned `σ·d ≥ cutoff` is the branch's exact
 * value and a smaller one guarantees the full value is below the cutoff —
 * and the min over branches inherits both halves.
 *
 * SCOPE: exactly the general admission's (order-1 symmetry, identity
 * final, plain contracting affines — the maps the construction bakes), in
 * both dimensions. The query point is the INTRINSIC point (3D: the world
 * point; 4D: the posed slice point `finiteSolidIntrinsicPoint`), and a 4D
 * bound lower-bounds the in-slice distance because the pose rows are
 * orthonormal.
 */

import type { FiniteSolidGeneralConstruction } from "./finite-solid";
import {
  FINITE_SOLID_MEDIUM_OPAQUE_MAP,
  finiteSolidGeneralInverseMaps,
  type FiniteSolidGeneralMedia,
} from "./finite-solid";
import { estimateDistanceRefined, singularValues3 } from "./surface-de";
import type { SurfaceDE } from "./surface-de";
import { estimateDistance4Refined, singularValues4 } from "./surface-de-4d";
import type { SurfaceDE4 } from "./surface-de-4d";
import type { Vec3, Vec4 } from "./types";

/**
 * The composite's opaque march relaxation. The march steps `relax x DE`
 * instead of `DE`; a step that MAY have crossed the surface is detected
 * one evaluation later — a crossing at parameter D in (d_prev, step]
 * stands at distance step - D behind the landing point, so the DE there
 * is at most step - d_prev, and `d_prev + d_new > step` CERTIFIES no
 * crossing (the certified balls at both ends cover the travelled
 * interval). A step failing that test rolls back to the safe point
 * `p_prev + dir x d_prev` — inside the ball the descent certifies empty —
 * and halves the relaxation, floored at 1, where the test can never fire
 * (d_prev + d_new <= d_prev needs d_new <= 0, and the march only steps
 * from d >= eps). So no crossing is ever passed unhit — the march stays
 * EXACT — while clean stretches advance relax-fold. The full-estimate
 * step (relax 1) is the floor: worst case the rollback cycle re-marches
 * what classic would have, at the same eval cost. The value is measured
 * (the boot document's segment corpus, classic sweep): 1.25 cut march
 * evaluations 6.1% and the longest march 43 -> 37 with the classic
 * hit/miss classification unchanged march for march; 1.5 matched the
 * steps but flipped two classifications and left the max at 41, and 2.0
 * lost everywhere (rollback cascades grew the longest march to 48).
 */
export const FINITE_COMPOSITE_MARCH_RELAX = 1.25;

/** One opaque first-level branch: its inverse (row-major 4x4 + offset),
 * its smallest singular value, and its certified image ball. */
export interface FiniteSolidOpaqueBranch {
  /** The map's index in the construction (the media table's index). */
  index: number;
  invM: number[];
  invT: Vec4;
  sigmaMin: number;
  ballCenter: Vec4;
  ballRadius: number;
}

export type FiniteSolidOpaqueContent =
  | {
      dimension: 3;
      de: SurfaceDE;
      branches: FiniteSolidOpaqueBranch[];
    }
  | {
      dimension: 4;
      de: SurfaceDE4;
      branches: FiniteSolidOpaqueBranch[];
    };

/** The opaque content of a general construction under its media: every
 * branch whose code is opaque (0), each carrying the wrapper's inputs. The
 * estimator must be built from the SAME document (the attractor whose
 * branch images the construction's maps are); a 3D construction takes a
 * `SurfaceDE`, a 4D one a `SurfaceDE4`. */
export function buildFiniteSolidOpaqueContent(
  c: FiniteSolidGeneralConstruction,
  media: FiniteSolidGeneralMedia,
  de: SurfaceDE | SurfaceDE4,
): FiniteSolidOpaqueContent {
  if (media.length !== c.mapCount) {
    throw new RangeError(
      "finite-solid-composite: the media table must name every map",
    );
  }
  const dimension = c.dimension;
  const box = c.levelBoxes[0];
  const center: Vec4 = [0, 0, 0, 0];
  let halfDiagonal2 = 0;
  for (let axis = 0; axis < dimension; axis++) {
    center[axis] = 0.5 * (box.min[axis] + box.max[axis]);
    const half = 0.5 * (box.max[axis] - box.min[axis]);
    halfDiagonal2 += half * half;
  }
  const halfDiagonal = Math.sqrt(halfDiagonal2);
  const inverses = finiteSolidGeneralInverseMaps(c);
  const branches: FiniteSolidOpaqueBranch[] = [];
  for (let a = 0; a < c.mapCount; a++) {
    if (media[a] !== FINITE_SOLID_MEDIUM_OPAQUE_MAP) continue;
    const m = c.mapMatrix[a];
    // A 3D map carries the identity w row/column; its sigmas are the 3x3's.
    const sigmas =
      dimension === 3
        ? singularValues3([
            m[0],
            m[1],
            m[2],
            m[4],
            m[5],
            m[6],
            m[8],
            m[9],
            m[10],
          ])
        : singularValues4(m);
    const ballCenter: Vec4 = [0, 0, 0, 0];
    for (let row = 0; row < dimension; row++) {
      let sum = c.mapOffset[a][row];
      for (let col = 0; col < dimension; col++) {
        sum += m[row * 4 + col] * center[col];
      }
      ballCenter[row] = sum;
    }
    branches.push({
      index: a,
      invM: inverses[a].m,
      invT: inverses[a].t,
      sigmaMin: sigmas.min,
      ballCenter,
      ballRadius: sigmas.max * halfDiagonal,
    });
  }
  return dimension === 3
    ? { dimension: 3, de: de as SurfaceDE, branches }
    : { dimension: 4, de: de as SurfaceDE4, branches };
}

/** The masked opaque distance at the INTRINSIC point `q` (w ignored in 3D):
 * `min_a σ_min(M_a)·DE(M_a⁻¹q)` over the opaque branches, visited nearest
 * ball first and pruned by the certified ball bound. `branch` is the
 * winning branch's construction index (-1 when there is no opaque branch)
 * — the hit's slot attribution, the depth-0 map exactly as the ordinary
 * IFS Surface render's first choice. `cutoff` is the estimators' early-out
 * contract, carried through each branch's scale. */
export function finiteSolidOpaqueDistance(
  content: FiniteSolidOpaqueContent,
  q: Vec4,
  cutoff = 0,
): { d: number; branch: number } {
  const dimension = content.dimension;
  const order: Array<{ bound: number; branch: FiniteSolidOpaqueBranch }> = [];
  for (const branch of content.branches) {
    let r2 = 0;
    for (let axis = 0; axis < dimension; axis++) {
      const d = q[axis] - branch.ballCenter[axis];
      r2 += d * d;
    }
    order.push({ bound: Math.sqrt(r2) - branch.ballRadius, branch });
  }
  // Stable by construction index on ties, so the attribution is
  // deterministic.
  order.sort((x, y) => x.bound - y.bound || x.branch.index - y.branch.index);
  let best = Infinity;
  let bestBranch = -1;
  for (const { bound, branch } of order) {
    if (bound >= best) break;
    if (cutoff > 0 && best < cutoff) break;
    const m = branch.invM;
    const t = branch.invT;
    const local: Vec4 = [0, 0, 0, 0];
    for (let row = 0; row < dimension; row++) {
      let sum = t[row];
      for (let col = 0; col < dimension; col++)
        sum += m[row * 4 + col] * q[col];
      local[row] = sum;
    }
    const inner = cutoff > 0 ? cutoff / branch.sigmaMin : 0;
    const d =
      branch.sigmaMin *
      (content.dimension === 3
        ? estimateDistanceRefined(
            content.de,
            [local[0], local[1], local[2]] as Vec3,
            inner,
          )
        : estimateDistance4Refined(content.de, local, inner));
    if (d < best) {
      best = d;
      bestBranch = branch.index;
    }
  }
  return { d: best, branch: bestBranch };
}
