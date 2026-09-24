/**
 * THE GENERAL CURVED SOLID, 3D: the signed condensation field over a FINITE
 * depth band, for an ordinary IFS of curved emitter shapes.
 *
 * The closed-solid glass backend admits emitter-only C0 (the root term) and
 * nothing else, because with recursive maps its field "describes only the
 * root term" (`surface-optics-backend.ts`). The displayed condensation set
 * over a band `[minDepth, maxDepth]` is the finite union
 *
 *     S = ∪ { f_w(E_e) : |w| in the band, e an emitter },
 *
 * where `w` runs over words in the base maps (and their kaleidoscope
 * copies), `f_w` is the composed forward affine and `E_e` the emitter's
 * posed shape. This module is that union's field and membership, the CPU
 * oracle a transport backend and its kernel mirror.
 *
 * THE FIELD. Each node of the word tree carries `q = f_w⁻¹(x)` and
 * `s = ∏ σ_min` over the word's maps, and contributes the root term the
 * descent already evaluates, `s · SHAPE_MARCH_SAFETY · min_e σ_min(e) ·
 * sdf_e(e⁻¹ q)` ({@link condensationDistance3}). The field is the min over
 * the band's nodes. It is SIGNED and certified in both directions:
 *
 * - Outside every member, each term is a lower bound on the distance to its
 *   member (an affine map moves a point's distance to a set by at least
 *   its smallest singular value), so their min bounds the distance to the
 *   union.
 * - Inside a member, the term is minus a lower bound on the clearance to
 *   that member's complement (the same inequality, applied to the
 *   complement, which the bijection carries to the complement), and the
 *   union's clearance is at least any member's. The min over terms is then
 *   minus the largest such bound, still conservative.
 * - Its SIGN IS EXACT. A term is negative only inside its member and zero
 *   only on its boundary, because every shape SDF's sign is exact (the
 *   min/max CSG fold keeps the sign). So membership is `field <= 0`, with
 *   no tangency cusp of the kind the sphere-inversion family's bound has.
 *
 * THE SEARCH is a branch-and-bound over the word tree against one invariant
 * ball `B(c, R)`: every map carries it into itself (`|f_i(c) − c| +
 * σ_max(f_i)·R <= R`) and every emitter's bounding ball lies inside it, so
 * a node's whole subtree lies in `f_w(B)`. A child whose local point sits
 * `δ > 0` outside `B` has its subtree's SET at world distance at least
 * `s·δ`. That certificate is sound for ANY shape SDF. The prune fires on a
 * weaker threshold, `S·s·δ·ρ^k·ρ_e` (`ρ` the smallest per-map singular
 * ratio `σ_min/σ_max`, `k` the levels left below the child, `ρ_e` the
 * emitters' own ratio). For an EXACT shape SDF that threshold lower-bounds
 * every term the subtree could contribute, so the pruned field EQUALS the
 * brute-force min over all words (the tests pin it bit for bit). For a
 * conservative SDF (a CSG intersection, an extruded gear) a pruned term can
 * be smaller than the threshold. The field is then larger than the
 * brute-force min but still sound, since the certificate it relied on
 * bounds the subtree's true distance. Inside a member, every term outside
 * `B` is positive, so pruning never loses the sign.
 *
 * WHAT IT REFUSES ({@link condensationSolidAdmission3}): no emitters; a
 * band without a finite `maxDepth` at most
 * {@link CONDENSATION_SOLID_MAX_DEPTH}; a fold, graph-directed selection,
 * a hybrid schedule, any final transform but the value-exact identity; an
 * emitter shape outside the EXACT-SDF vocabulary
 * ({@link condensationSolidShapeRefusal}); and a map that does not contract
 * in operator norm (`σ_max >= 1`, no invariant ball). Composition refusals
 * (tiling, balloon) are the router's.
 *
 * THE EMITTER RULE IS A LOOK DECISION as well as a soundness one. The field
 * is sound over any shape SDF, but only an exact one makes the pruned
 * field the brute-force union and keeps the transport's interior steps
 * long: the look sheets (`scripts/condensation-glass.harness.ts`) resolved
 * 97.6-100% of glass hits on sphere and torus emitters at every depth and
 * 52.3% on the conservative gear, whose unresolved pixels read as black
 * speckle. So the admitted shapes are the analytic primitives with exact
 * SDFs — sphere, box, torus with `minor <= major`, capsule — combined by
 * UNION only (a union of exact fields is exact outside and conservative
 * inside, and its sign is exact). An intersect part keeps the sign and
 * loses the distance; the gear and the baked mesh are conservative by
 * construction. They refuse, and no gear remedy is scheduled.
 *
 * THE 4D HALF is `condensation-solid-4d.ts`: the same search one dimension
 * up over the transport's penalty term, admitted only in the canonical
 * pose, where its slice is exactly this module's solid of the document's
 * 3D restriction.
 */
import { inverse3x3, multiply3x3 } from "./affine";
import { symmetryRotation } from "./chaos-game";
import {
  condensationDistance3,
  type CondensationDE3,
  type ResolvedCondensationDepthBand,
} from "./condensation-de";
import { SHAPE_MARCH_SAFETY, type ShapeSpec } from "./shapes";
import {
  singularValues3,
  SURFACE_FOLD_NONE,
  type SurfaceDE,
} from "./surface-de";
import type { Vec3 } from "./types";

/** The deepest band the solid admits. Terms grow as `maps^depth`, and the
 * sphere-inversion glass look was best at low depth (its look gate), so a
 * small ceiling costs nothing a glass subject needs. */
export const CONDENSATION_SOLID_MAX_DEPTH = 6;

/** Relative slack on the prune threshold, so a subtree is skipped only when
 * its bound clears the running minimum by more than rounding. */
const PRUNE_SLACK = 1e-12;

/** One word-tree edge: a base map's (or kaleidoscope copy's) composed
 * INVERSE, applied to a node's point to reach its child. */
export interface CondensationSolidMap3 {
  /** Row-major inverse linear part, sector un-rotation and post inverse
   * folded in: `inv(M) · inv(P) · Rot_kᵀ`. */
  invM: number[];
  /** Inverse translation. */
  invT: Vec3;
  /** Smallest singular value of the FORWARD map: the child's scale factor. */
  sigmaMin: number;
  /** Largest singular value of the FORWARD map (< 1, admission). */
  sigmaMax: number;
  /** The transform this edge inverts, for attribution. */
  baseIndex: number;
}

export interface CondensationSolid3 {
  maps: CondensationSolidMap3[];
  /** The emitters and the resolved band, exactly as the descent reads them. */
  condensation: CondensationDE3;
  band: ResolvedCondensationDepthBand;
  /** The invariant ball: every map carries it into itself and every
   * emitter's bounding ball lies inside it. */
  center: Vec3;
  radius: number;
  /** `min σ_min/σ_max` over the maps (1 with no maps). */
  mapRatio: number;
  /** `min σ_min/σ_max` over the emitters' own affines. */
  emitterRatio: number;
}

export type CondensationSolidAdmission =
  { ok: true } | { ok: false; reason: string };

export interface CondensationSolidOptions {
  /** Admit conservative emitter shapes (intersect parts, the gear, a spindle
   * torus) that the emitter rule refuses. The field stays sound over them —
   * only the pruned-equals-brute-force exactness and the look are lost —
   * so the look sheet's gear panel and the soundness tests build them as an
   * INSTRUMENT. Routing never passes it. A mesh stays refused either way
   * (its baked lattice is not a CPU-side shape SDF this module evaluates
   * against a kernel). */
  admitConservativeShapes?: boolean;
}

/** Whether the surface DE's displayed object is a finite condensation
 * solid this module describes (the module doc's refusal list). */
export function condensationSolidAdmission3(
  de: SurfaceDE,
  options: CondensationSolidOptions = {},
): CondensationSolidAdmission {
  const emitters = de.condensation?.emitters ?? [];
  if (emitters.length === 0)
    return { ok: false, reason: "no condensation emitters" };
  const band = de.condensation!.depthBand;
  if (band.maxDepth > CONDENSATION_SOLID_MAX_DEPTH)
    return {
      ok: false,
      reason: `the depth band must end at level ${CONDENSATION_SOLID_MAX_DEPTH} or below`,
    };
  if (de.chaos) return { ok: false, reason: "graph-directed selection" };
  if (de.schedule) return { ok: false, reason: "a hybrid schedule" };
  if (de.foldFinal) return { ok: false, reason: "a fold final lens" };
  if (de.final && !isIdentityFinal(de.final))
    return { ok: false, reason: "a final transform" };
  for (const emitter of emitters) {
    const refusal = condensationSolidShapeRefusal(emitter.shape, options);
    if (refusal) return { ok: false, reason: refusal };
  }
  for (const map of de.maps)
    if (map.foldKind !== SURFACE_FOLD_NONE)
      return { ok: false, reason: "a fold map" };
  for (const map of composedMaps(de))
    if (!(map.sigmaMax < 1))
      return { ok: false, reason: "a map that does not contract" };
  return { ok: true };
}

/** Why an emitter shape falls outside the exact-SDF vocabulary (module
 * doc's emitter rule), or `null` when it is admitted. Shared by both
 * dimensions: the 4D emitter is the same 3D shape on its flat. */
export function condensationSolidShapeRefusal(
  shape: ShapeSpec,
  options: CondensationSolidOptions = {},
): string | null {
  const exact = !options.admitConservativeShapes;
  for (const part of shape.parts) {
    const prim = part.primitive;
    if (prim.kind === "mesh") return "a mesh emitter shape";
    if (!exact) continue;
    if (part.combine !== "union") return "an intersect emitter part";
    switch (prim.kind) {
      case "sphere":
      case "box":
      case "capsule":
        break;
      case "torus":
        if (!(prim.minor <= prim.major)) return "a spindle torus emitter shape";
        break;
      case "gear":
        return "a gear emitter shape";
    }
  }
  return null;
}

function isIdentityFinal(final: {
  invM: number[];
  invT: Vec3;
  sigmaMin: number;
}): boolean {
  const eps = 1e-9;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (Math.abs(final.invM[r * 3 + c] - (r === c ? 1 : 0)) > eps)
        return false;
  return (
    final.invT.every((t) => Math.abs(t) <= eps) &&
    Math.abs(final.sigmaMin - 1) <= eps
  );
}

/** Every (base map, sector) edge with its composed inverse and sigmas. */
function composedMaps(de: SurfaceDE): CondensationSolidMap3[] {
  const out: CondensationSolidMap3[] = [];
  const order = de.symmetry.order;
  const step = (2 * Math.PI) / order;
  for (let k = 0; k < order; k++) {
    // The descent un-rotates the chain point by Rot_kᵀ before a map's
    // inverse (kaleidoscope copies rotate AFTER the base map).
    const unrotate =
      k === 0
        ? [1, 0, 0, 0, 1, 0, 0, 0, 1]
        : transpose3(symmetryRotation(de.symmetry.plane, step * k));
    for (const map of de.maps) {
      const postM = map.postInvM ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const postT = map.postInvT ?? [0, 0, 0];
      const linear = multiply3x3(map.invM, multiply3x3(postM, unrotate));
      const invT: Vec3 = [
        map.invM[0] * postT[0] +
          map.invM[1] * postT[1] +
          map.invM[2] * postT[2] +
          map.invT[0],
        map.invM[3] * postT[0] +
          map.invM[4] * postT[1] +
          map.invM[5] * postT[2] +
          map.invT[1],
        map.invM[6] * postT[0] +
          map.invM[7] * postT[1] +
          map.invM[8] * postT[2] +
          map.invT[2],
      ];
      // The inverse's singular values are the forward map's reciprocals.
      const inv = singularValues3(linear);
      out.push({
        invM: linear,
        invT,
        sigmaMin: 1 / inv.max,
        sigmaMax: 1 / inv.min,
        baseIndex: map.baseIndex,
      });
    }
  }
  return out;
}

function transpose3(m: readonly number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** The solid for an admitted surface DE; throws on a refused one. */
export function buildCondensationSolid3(
  de: SurfaceDE,
  options: CondensationSolidOptions = {},
): CondensationSolid3 {
  const admission = condensationSolidAdmission3(de, options);
  if (!admission.ok)
    throw new Error(`condensation solid refused: ${admission.reason}`);
  const condensation = de.condensation!;
  const maps = composedMaps(de);
  const center: Vec3 = [...de.boundCenter];
  let radius = 0;
  for (const emitter of condensation.emitters)
    radius = Math.max(
      radius,
      Math.hypot(
        emitter.center[0] - center[0],
        emitter.center[1] - center[1],
        emitter.center[2] - center[2],
      ) + emitter.radius,
    );
  for (const map of maps) {
    // f(c) solves invM·y + invT = c.
    const fwd = inverse3x3(map.invM);
    const u: Vec3 = [
      center[0] - map.invT[0],
      center[1] - map.invT[1],
      center[2] - map.invT[2],
    ];
    const fc: Vec3 = [
      fwd[0] * u[0] + fwd[1] * u[1] + fwd[2] * u[2],
      fwd[3] * u[0] + fwd[4] * u[1] + fwd[5] * u[2],
      fwd[6] * u[0] + fwd[7] * u[1] + fwd[8] * u[2],
    ];
    const reach = Math.hypot(
      fc[0] - center[0],
      fc[1] - center[1],
      fc[2] - center[2],
    );
    radius = Math.max(radius, reach / (1 - map.sigmaMax));
  }
  // Rounding in the fixed-point sums above must not leave a map's image a
  // hair outside; a relative pad keeps the invariance strict.
  radius *= 1 + 1e-9;
  let mapRatio = 1;
  for (const map of maps)
    mapRatio = Math.min(mapRatio, map.sigmaMin / map.sigmaMax);
  let emitterRatio = 1;
  for (const emitter of condensation.emitters) {
    const s = singularValues3(emitter.invM);
    // Forward σ_min/σ_max equals the inverse's σ_min/σ_max.
    emitterRatio = Math.min(emitterRatio, s.min / s.max);
  }
  return {
    maps,
    condensation,
    band: condensation.depthBand,
    center,
    radius,
    mapRatio,
    emitterRatio,
  };
}

/**
 * The signed field at `p` (module doc): the min over the band's word-tree
 * nodes of the scaled root term, branch-and-bounded against the invariant
 * ball. Negative exactly inside the solid.
 */
export function condensationSolidSignedDistance3(
  solid: CondensationSolid3,
  p: readonly number[],
  /** Optional tally: word-tree nodes visited, and root terms evaluated. */
  stats?: { nodes: number; terms: number },
): number {
  let best = Infinity;
  const { maps, band, center, radius } = solid;
  const visit = (q: Vec3, s: number, depth: number): void => {
    if (stats) stats.nodes++;
    if (depth >= band.minDepth) {
      if (stats) stats.terms++;
      const term =
        s *
        SHAPE_MARCH_SAFETY *
        condensationDistance3(solid.condensation, q[0], q[1], q[2]);
      if (term < best) best = term;
    }
    if (depth >= band.maxDepth) return;
    const below = band.maxDepth - (depth + 1);
    const ratio = Math.pow(solid.mapRatio, below) * solid.emitterRatio;
    for (const map of maps) {
      const m = map.invM;
      const child: Vec3 = [
        m[0] * q[0] + m[1] * q[1] + m[2] * q[2] + map.invT[0],
        m[3] * q[0] + m[4] * q[1] + m[5] * q[2] + map.invT[1],
        m[6] * q[0] + m[7] * q[1] + m[8] * q[2] + map.invT[2],
      ];
      const cs = s * map.sigmaMin;
      const delta =
        Math.hypot(
          child[0] - center[0],
          child[1] - center[1],
          child[2] - center[2],
        ) - radius;
      if (delta > 0) {
        const bound = SHAPE_MARCH_SAFETY * cs * delta * ratio;
        if (bound * (1 - PRUNE_SLACK) >= best) continue;
      }
      visit(child, cs, depth + 1);
    }
  };
  visit([p[0], p[1], p[2]], 1, 0);
  return best;
}

/** EXACT membership: some band node's point lies in an emitter shape. The
 * field's sign says the same; this search stops at the first member and
 * skips every subtree whose ball the point is outside. */
export function condensationSolidContains3(
  solid: CondensationSolid3,
  p: readonly number[],
): boolean {
  const { maps, band, center, radius } = solid;
  const visit = (q: Vec3, depth: number): boolean => {
    if (
      depth >= band.minDepth &&
      condensationDistance3(solid.condensation, q[0], q[1], q[2]) <= 0
    )
      return true;
    if (depth >= band.maxDepth) return false;
    for (const map of maps) {
      const m = map.invM;
      const child: Vec3 = [
        m[0] * q[0] + m[1] * q[1] + m[2] * q[2] + map.invT[0],
        m[3] * q[0] + m[4] * q[1] + m[5] * q[2] + map.invT[1],
        m[6] * q[0] + m[7] * q[1] + m[8] * q[2] + map.invT[2],
      ];
      if (
        Math.hypot(
          child[0] - center[0],
          child[1] - center[1],
          child[2] - center[2],
        ) > radius
      )
        continue;
      if (visit(child, depth + 1)) return true;
    }
    return false;
  };
  return visit([p[0], p[1], p[2]], 0);
}
