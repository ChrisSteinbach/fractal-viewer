/**
 * THE GENERAL CURVED SOLID, 4D: `condensation-solid.ts` one dimension up.
 *
 * A 4D condensation emitter is a 3D shape embedded at its local `w = 0`, a
 * FLAT piece of 4D. A 3D slice meets a flat piece in a set of zero volume
 * unless the flat lies IN the slice, so the only slices that hold a solid
 * for glass are the CANONICAL POSE the emitter-only closed-solid backend
 * already admits (`surface-optics-backend.ts`), widened here from the root
 * to every node of the band's word tree.
 *
 * THE FIELD is the 3D search with the transport's 4D root term at every
 * node: `s · SHAPE_MARCH_SAFETY · condensationSignedDistance4(q)`, the
 * intrinsic solid plus the flat's distance as a penalty
 * (`σ_min(e)·sd + |local w|`, the emitter-only backend's own 4D form). It is
 * min over the band's nodes, branch-and-bounded against one invariant 4D
 * ball, and imports every constant, the depth ceiling and the emitter rule
 * from its 3D twin: what the solid IS has one definition across both
 * dimensions.
 *
 * WHERE IT IS EXACT, AND WHERE IT IS NOT. In the canonical pose
 * ({@link condensationSolidPoseAdmission4}) every map is w-untouched and
 * fixes the slice's `w0`, and every emitter's flat lies in the slice. Then
 * every node's point keeps `w = w0`, every emitter's local `w` is exactly
 * zero, the penalty vanishes identically, and the field on the slice is
 * term for term the 3D field of the document's 3D restriction: signed,
 * certified in both directions, exact sign, and the pruned field equals
 * the brute-force union (the tests pin both, against the 3D module and
 * against an independent 4D walk). OFF the pose the penalty form is a
 * lens-shaped slab around each flat, neither a lower bound nor an exact
 * sign, and a pruned subtree may hold a lens term the brute-force union
 * would keep. That is the emitter-only backend's own off-pose state, and
 * the transport answers it the same way: its failures are honest refusals
 * (unresolved work), never an invented interior. The pose is LIVE state,
 * so the admission is read at session entry and the panel's
 * slice-coupling note discloses the rest, exactly as for C0.
 *
 * THE PRUNE'S EMITTER RATIO is `σ_min/σ_max` of the 4D emitter affines.
 * With the lift's derived w scale (the mean of the xyz scales, which lies
 * between their min and max) that is the 3D ratio; a native w scale
 * outside that range only lowers it, which prunes less and never more.
 */
import { multiply4x4 } from "./affine4";
import {
  condensationSignedDistance4,
  type CondensationDE4,
  type ResolvedCondensationDepthBand,
} from "./condensation-de";
import {
  CONDENSATION_SOLID_MAX_DEPTH,
  condensationSolidShapeRefusal,
  type CondensationSolidAdmission,
  type CondensationSolidOptions,
} from "./condensation-solid";
import { SHAPE_MARCH_SAFETY } from "./shapes";
import { SURFACE_FOLD_NONE } from "./surface-de";
import { inverse4, singularValues4, type SurfaceDE4 } from "./surface-de-4d";
import type { Vec4 } from "./types";

/** Relative slack on the prune threshold (the 3D twin's value). */
const PRUNE_SLACK = 1e-12;

/** Epsilon for the pose's w-coupling checks: a composed rotation whose
 * planes avoid w carries exact zeros in the w row and column, and any
 * coupling leaves entries at least ~sin(angle) — the emitter-only
 * backend's `W_COUPLE_EPS`, for the same reason. */
const W_COUPLE_EPS = 1e-9;

/** One word-tree edge, the 3D twin's `CondensationSolidMap3` in 4x4. */
export interface CondensationSolidMap4 {
  /** Row-major 4x4 inverse: `inv(M) · inv(P) · stepBack^k`. */
  invM: number[];
  invT: Vec4;
  sigmaMin: number;
  sigmaMax: number;
  baseIndex: number;
}

export interface CondensationSolid4 {
  maps: CondensationSolidMap4[];
  condensation: CondensationDE4;
  band: ResolvedCondensationDepthBand;
  /** The invariant ball, about the ORIGIN: the 4D descent is origin
   * anchored and never adopted 3D's probe-fit centre. */
  center: Vec4;
  radius: number;
  mapRatio: number;
  emitterRatio: number;
}

/** A 4D session's pose at entry: the rotor (row-major 4x4), the world slice
 * position and the slab half-extent — `Surface4OpticsPose`'s fields. */
export interface CondensationSolidPose4 {
  rotor: readonly number[];
  w0: number;
  sliceHalfW: number;
}

/** Whether the 4D surface DE's displayed object is a finite condensation
 * solid this module describes — the 3D twin's refusal list, word for word.
 * The POSE is a separate question ({@link condensationSolidPoseAdmission4}),
 * because it is live session state and the composition is not. */
export function condensationSolidAdmission4(
  de: SurfaceDE4,
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
  if (de.final && !isIdentityFinal4(de.final))
    return { ok: false, reason: "a final transform" };
  for (const emitter of emitters) {
    const refusal = condensationSolidShapeRefusal(emitter.shape, options);
    if (refusal) return { ok: false, reason: refusal };
  }
  for (const map of de.maps)
    if (map.foldKind !== SURFACE_FOLD_NONE)
      return { ok: false, reason: "a fold map" };
  for (const map of composedMaps4(de))
    if (!(map.sigmaMax < 1))
      return { ok: false, reason: "a map that does not contract" };
  return { ok: true };
}

/**
 * THE CANONICAL POSE, the only one whose slice holds the solid (module
 * doc): zero slab; a w-preserving rotor; every composed map (kaleidoscope
 * copies and posts included) w-untouched and fixing `w0`, so every node
 * of the word tree keeps its point on the slice; and every emitter's flat
 * IN the slice. The lift of a 3D document at `w0 = 0` satisfies it.
 */
export function condensationSolidPoseAdmission4(
  solid: CondensationSolid4,
  pose: CondensationSolidPose4,
): CondensationSolidAdmission {
  if (pose.sliceHalfW !== 0)
    return { ok: false, reason: "a slice with thickness" };
  if (!rotorPreservesW(pose.rotor))
    return { ok: false, reason: "a rotor that turns w" };
  const w0 = pose.w0;
  const tol = W_COUPLE_EPS * (1 + Math.abs(w0));
  for (const map of solid.maps) {
    if (!wUntouched(map.invM))
      return { ok: false, reason: "a map that mixes w" };
    if (Math.abs(map.invM[15] * w0 + map.invT[3] - w0) > tol)
      return { ok: false, reason: "a map that moves the slice" };
  }
  for (const emitter of solid.condensation.emitters) {
    if (!wUntouched(emitter.invM))
      return { ok: false, reason: "an emitter that mixes w" };
    if (Math.abs(emitter.invM[15] * w0 + emitter.invT[3]) > tol)
      return { ok: false, reason: "an emitter off the slice" };
  }
  return { ok: true };
}

function wCoupling(m: readonly number[]): number {
  return (
    Math.abs(m[3]) +
    Math.abs(m[7]) +
    Math.abs(m[11]) +
    Math.abs(m[12]) +
    Math.abs(m[13]) +
    Math.abs(m[14])
  );
}

function rotorPreservesW(m: readonly number[]): boolean {
  return (
    m.length === 16 &&
    wCoupling(m) <= W_COUPLE_EPS &&
    Math.abs(Math.abs(m[15]) - 1) <= 1e-6
  );
}

function wUntouched(m: readonly number[]): boolean {
  return wCoupling(m) <= W_COUPLE_EPS && Math.abs(m[15]) > W_COUPLE_EPS;
}

function isIdentityFinal4(final: {
  invM: number[];
  invT: Vec4;
  sigmaMin: number;
}): boolean {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (Math.abs(final.invM[r * 4 + c] - (r === c ? 1 : 0)) > W_COUPLE_EPS)
        return false;
  return (
    final.invT.every((t) => Math.abs(t) <= W_COUPLE_EPS) &&
    Math.abs(final.sigmaMin - 1) <= W_COUPLE_EPS
  );
}

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Every (base map, sector) edge: the 4D descent un-rotates by
 * `stepBack` once per sector before a map's un-post and inverse. */
function composedMaps4(de: SurfaceDE4): CondensationSolidMap4[] {
  const out: CondensationSolidMap4[] = [];
  let unrotate = IDENTITY4;
  for (let k = 0; k < de.symmetry.order; k++) {
    if (k > 0) unrotate = multiply4x4(de.symmetry.stepBack, unrotate);
    for (const map of de.maps) {
      const postM = map.postInvM ?? IDENTITY4;
      const postT = map.postInvT ?? [0, 0, 0, 0];
      const linear = multiply4x4(map.invM, multiply4x4(postM, unrotate));
      const invT = [0, 1, 2, 3].map(
        (r) =>
          map.invM[r * 4] * postT[0] +
          map.invM[r * 4 + 1] * postT[1] +
          map.invM[r * 4 + 2] * postT[2] +
          map.invM[r * 4 + 3] * postT[3] +
          map.invT[r],
      ) as Vec4;
      const inv = singularValues4(linear);
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

function apply4(m: readonly number[], t: readonly number[], q: Vec4): Vec4 {
  return [
    m[0] * q[0] + m[1] * q[1] + m[2] * q[2] + m[3] * q[3] + t[0],
    m[4] * q[0] + m[5] * q[1] + m[6] * q[2] + m[7] * q[3] + t[1],
    m[8] * q[0] + m[9] * q[1] + m[10] * q[2] + m[11] * q[3] + t[2],
    m[12] * q[0] + m[13] * q[1] + m[14] * q[2] + m[15] * q[3] + t[3],
  ];
}

/** The solid for an admitted 4D surface DE; throws on a refused one. */
export function buildCondensationSolid4(
  de: SurfaceDE4,
  options: CondensationSolidOptions = {},
): CondensationSolid4 {
  const admission = condensationSolidAdmission4(de, options);
  if (!admission.ok)
    throw new Error(`condensation solid refused: ${admission.reason}`);
  const condensation = de.condensation!;
  const maps = composedMaps4(de);
  const center: Vec4 = [0, 0, 0, 0];
  let radius = 0;
  for (const emitter of condensation.emitters)
    radius = Math.max(radius, Math.hypot(...emitter.center) + emitter.radius);
  for (const map of maps) {
    // f(0) solves invM·y + invT = 0.
    const fc = apply4(
      inverse4(map.invM),
      [0, 0, 0, 0],
      [-map.invT[0], -map.invT[1], -map.invT[2], -map.invT[3]],
    );
    radius = Math.max(radius, Math.hypot(...fc) / (1 - map.sigmaMax));
  }
  radius *= 1 + 1e-9;
  let mapRatio = 1;
  for (const map of maps)
    mapRatio = Math.min(mapRatio, map.sigmaMin / map.sigmaMax);
  let emitterRatio = 1;
  for (const emitter of condensation.emitters) {
    const s = singularValues4(emitter.invM);
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

/** The field at `p` (module doc): the 3D twin's search over the 4D penalty
 * term. Signed and exact on the slice in the canonical pose. */
export function condensationSolidSignedDistance4(
  solid: CondensationSolid4,
  p: readonly number[],
  stats?: { nodes: number; terms: number },
): number {
  let best = Infinity;
  const { maps, band, radius } = solid;
  const visit = (q: Vec4, s: number, depth: number): void => {
    if (stats) stats.nodes++;
    if (depth >= band.minDepth) {
      if (stats) stats.terms++;
      const term =
        s *
        SHAPE_MARCH_SAFETY *
        condensationSignedDistance4(solid.condensation, q[0], q[1], q[2], q[3]);
      if (term < best) best = term;
    }
    if (depth >= band.maxDepth) return;
    const below = band.maxDepth - (depth + 1);
    const ratio = Math.pow(solid.mapRatio, below) * solid.emitterRatio;
    for (const map of maps) {
      const child = apply4(map.invM, map.invT, q);
      const cs = s * map.sigmaMin;
      const delta = Math.hypot(...child) - radius;
      if (delta > 0) {
        const bound = SHAPE_MARCH_SAFETY * cs * delta * ratio;
        if (bound * (1 - PRUNE_SLACK) >= best) continue;
      }
      visit(child, cs, depth + 1);
    }
  };
  visit([p[0], p[1], p[2], p[3]], 1, 0);
  return best;
}

/** Membership as the field's sign reads it: some band node's penalty term
 * is `<= 0`. In the canonical pose on the slice that is EXACT membership
 * in the displayed solid (the 3D twin's `condensationSolidContains3`). */
export function condensationSolidContains4(
  solid: CondensationSolid4,
  p: readonly number[],
): boolean {
  const { maps, band, radius } = solid;
  const visit = (q: Vec4, depth: number): boolean => {
    if (
      depth >= band.minDepth &&
      condensationSignedDistance4(solid.condensation, q[0], q[1], q[2], q[3]) <=
        0
    )
      return true;
    if (depth >= band.maxDepth) return false;
    for (const map of maps) {
      const child = apply4(map.invM, map.invT, q);
      if (Math.hypot(...child) > radius) continue;
      if (visit(child, depth + 1)) return true;
    }
    return false;
  };
  return visit([p[0], p[1], p[2], p[3]], 0);
}
