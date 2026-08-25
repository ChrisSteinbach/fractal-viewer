/** CPU-side condensation shape terms shared by the 3D and 4D surface DEs. */
import { SHAPE_MARCH_SAFETY, shapeSdf } from "./shapes";
import type { ShapeSpec } from "./shapes";

/** Inclusive word-depth band. Root is 0; ordinary-map children are 1. */
export interface CondensationDepthBand {
  minDepth?: number;
  maxDepth?: number;
}

export interface ResolvedCondensationDepthBand {
  minDepth: number;
  maxDepth: number;
}

export function resolveCondensationDepthBand(
  band?: CondensationDepthBand,
): ResolvedCondensationDepthBand {
  const minDepth =
    Number.isFinite(band?.minDepth) && (band?.minDepth as number) > 0
      ? Math.floor(band?.minDepth as number)
      : 0;
  const maxDepth = Number.isFinite(band?.maxDepth)
    ? Math.max(0, Math.floor(band?.maxDepth as number))
    : Number.MAX_SAFE_INTEGER;
  return minDepth <= maxDepth
    ? { minDepth, maxDepth }
    : { minDepth: maxDepth, maxDepth: minDepth };
}

export function condensationDepthEnabled(
  band: ResolvedCondensationDepthBand,
  depth: number,
): boolean {
  return depth >= band.minDepth && depth <= band.maxDepth;
}

/** Whether a strict descendant of `depth` can still contain an enabled C0. */
export function condensationHasFutureDepth(
  band: ResolvedCondensationDepthBand,
  depth: number,
): boolean {
  return Math.max(depth + 1, band.minDepth) <= band.maxDepth;
}

interface CondensationEmitterBase {
  shape: ShapeSpec;
  /** Input transform index, retained although emitters are not maps. */
  baseIndex: number;
  /** Material attribution; every symmetry copy keeps its base shade. */
  shadeIndex: number;
  sigmaMin: number;
  center: number[];
  /** Conservative forward-image radius about `center`. */
  radius: number;
}

export interface CondensationEmitter3 extends CondensationEmitterBase {
  invM: number[];
  invT: [number, number, number];
  center: [number, number, number];
}

export interface CondensationDE3 {
  emitters: CondensationEmitter3[];
  depthBand: ResolvedCondensationDepthBand;
}

/** C0's 3D union distance: inverse shape SDF times emitter sigma-min. */
export function condensationDistance3(
  de: CondensationDE3,
  x: number,
  y: number,
  z: number,
): number {
  let best = Infinity;
  for (const emitter of de.emitters) {
    const m = emitter.invM;
    const t = emitter.invT;
    const qx = m[0] * x + m[1] * y + m[2] * z + t[0];
    const qy = m[3] * x + m[4] * y + m[5] * z + t[1];
    const qz = m[6] * x + m[7] * y + m[8] * z + t[2];
    const d = emitter.sigmaMin * shapeSdf(emitter.shape, qx, qy, qz);
    if (d < best) best = d;
  }
  return best;
}

export function condensationTerm3(
  de: CondensationDE3,
  depth: number,
  sigmaAcc: number,
  x: number,
  y: number,
  z: number,
): number {
  return condensationDepthEnabled(de.depthBand, depth)
    ? sigmaAcc * SHAPE_MARCH_SAFETY * condensationDistance3(de, x, y, z)
    : Infinity;
}

/** Conservative C0 radius about an arbitrary center. */
export function condensationBoundingRadius3(
  de: CondensationDE3,
  center: readonly [number, number, number] = [0, 0, 0],
): number {
  let radius = 0;
  for (const emitter of de.emitters) {
    radius = Math.max(
      radius,
      Math.hypot(
        emitter.center[0] - center[0],
        emitter.center[1] - center[1],
        emitter.center[2] - center[2],
      ) + emitter.radius,
    );
  }
  return radius;
}

export interface CondensationEmitter4 extends CondensationEmitterBase {
  invM: number[];
  invT: [number, number, number, number];
  center: [number, number, number, number];
}

export interface CondensationDE4 {
  emitters: CondensationEmitter4[];
  depthBand: ResolvedCondensationDepthBand;
}

/**
 * C0's 4D union distance. The authored solid is embedded at local w=0, so
 * the local distance is hypot(max(sdShape(xyz), 0), w), not an extrusion.
 */
export function condensationDistance4(
  de: CondensationDE4,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  let best = Infinity;
  for (const emitter of de.emitters) {
    const m = emitter.invM;
    const t = emitter.invT;
    const qx = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
    const qy = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
    const qz = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
    const qw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];
    const sd = shapeSdf(emitter.shape, qx, qy, qz);
    const d = emitter.sigmaMin * Math.hypot(Math.max(sd, 0), qw);
    if (d < best) best = d;
  }
  return best;
}

export function condensationTerm4(
  de: CondensationDE4,
  depth: number,
  sigmaAcc: number,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  return condensationDepthEnabled(de.depthBand, depth)
    ? sigmaAcc * SHAPE_MARCH_SAFETY * condensationDistance4(de, x, y, z, w)
    : Infinity;
}

export function condensationBoundingRadius4(de: CondensationDE4): number {
  let radius = 0;
  for (const emitter of de.emitters) {
    radius = Math.max(radius, Math.hypot(...emitter.center) + emitter.radius);
  }
  return radius;
}
