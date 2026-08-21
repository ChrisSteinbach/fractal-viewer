import type { Vec3, Vec4 } from "./types";

/**
 * Camera-independent source coordinates for patterned surface materials.
 *
 * A rendered hit can pass through three independent remaps before shading:
 * a 3D balloon inversion, a 4D view rotor/slice lift, and a final-transform
 * lens. Pattern macrostructure belongs to the RAW attractor, so the contract
 * reverses those remaps in exactly that order:
 *
 *   visible hit -> balloon source query -> inverse 4D view -> final inverse
 *
 * A fold final is multivalued. Its distance-estimator wrapper must supply the
 * winning branch's already-resolved source hit (`foldFinalSourceHit`) rather
 * than pretending the fold has one matrix inverse. The later GLSL/WGSL beads
 * compile these helpers' arithmetic only for pattern-enabled shade variants;
 * unpatterned shader source therefore remains byte-identical.
 *
 * ## Frozen host/shader field names
 *
 * - Host builders expose `patternCalibration` on `SurfaceDE`, `SurfaceDE4`,
 *   `EscapeDE`, `BulbDE`, and `EscapeDE4`. Its four fields are documented by
 *   `SurfaceNativeCalibration` in `surface-pattern.ts`.
 * - Pattern-enabled 3D GLSL calls the raw point `sourceHit`; 4D GLSL and the
 *   shared WGSL hit-info call the raw four-vector `source4`. These fields are
 *   shading extras only and never participate in distance evaluation.
 * - GLSL packs calibration as `uPatternNativeCalibration`; WGSL uses
 *   `shade.patternNativeCalibration`. In both dialects the vec4 order is
 *   `(ringsLow, ringsInvSpan, sheetsLow, sheetsInvSpan)`.
 * - 3D normalization reuses `uBoundCenter`/`uBoundingRadius`. Escape and bulb
 *   reset the shared center to zero. 4D normalization reuses the raw
 *   `uBoundingRadius`/`params.boundingRadius` and an implicit zero center.
 * - 4D reconstruction reuses `uInvRotor`, `uW0`, `uSliceHalfW`, and hit-info
 *   `sStar` (WGSL: `rotorInvR*`, `w0`, `sliceHalfW`, `sStar`). No duplicate
 *   camera, center, radius, or final-lens field is introduced.
 */

export type SurfacePatternFamily3 =
  "affine" | "fold" | "lens" | "escape" | "bulb";
export type SurfacePatternFamily4 = "affine4" | "fold4" | "escape4";

export interface PatternAffineInverse3 {
  /** Row-major inverse linear part of the authored final transform. */
  invM: readonly number[];
  /** Inverse translation `-invM * t`. */
  invT: Vec3;
}

export interface PatternAffineInverse4 {
  /** Row-major inverse linear part of the authored 4D final transform. */
  invM: readonly number[];
  /** Inverse translation `-invM * t`. */
  invT: Vec4;
}

export interface SurfacePatternSource3Input {
  family: SurfacePatternFamily3;
  /** Accepted marched hit in the renderer's ordinary 3D world frame. */
  visibleHit: Vec3;
  /**
   * Balloon only: the winning union term's query before sphere inversion.
   * A strict distance tie omits this field and therefore stays on the plain
   * fractal term, matching the existing `dS < dF` convention.
   */
  balloonSourceHit?: Vec3;
  /** Affine final-transform inverse, absent on an unlensed source. */
  affineFinal?: PatternAffineInverse3;
  /**
   * Pure-fold final only: the lens argmin wrapper's winning raw source hit.
   * It already includes balloon routing and takes precedence over the affine
   * path because a fold inverse is a branch set, never one matrix.
   */
  foldFinalSourceHit?: Vec3;
}

export interface SurfacePatternSource4Input {
  family: SurfacePatternFamily4;
  /** Accepted marched hit in the projected/view 3D frame. */
  visibleHit: Vec3;
  /** Balloon winner's pre-inversion 3D query, when the shell term won. */
  balloonSourceHit?: Vec3;
  /**
   * Row-major inverse view rotor (the transpose of the attractor-to-view
   * pose rotor), matching `uInvRotor` and the packed `rotorInvR*` rows.
   */
  inverseRotor: readonly number[];
  /** Center of the live view slice in view-frame w. */
  w0: number;
  /** Winning place in [-1, 1] along the descended slice segment. */
  sStar: number;
  /** Half-width of that segment in literal view-frame w units. */
  sliceHalfW: number;
  /** Affine 4D final-transform inverse, absent on an unlensed source. */
  affineFinal?: PatternAffineInverse4;
  /** Pure-fold final only: the lens wrapper's winning branch tuple. */
  foldFinalSource?: {
    /** Winning branch centre after the fold-final inverse. */
    bestQ: Vec4;
    /** Winning branch half-extent after that inverse (zero without a slab). */
    bestExt: Vec4;
  };
}

function applyInverse3(inverse: PatternAffineInverse3, p: Vec3): Vec3 {
  const m = inverse.invM;
  const t = inverse.invT;
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + t[0],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + t[1],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + t[2],
  ];
}

function applyInverse4(inverse: PatternAffineInverse4, p: Vec4): Vec4 {
  const m = inverse.invM;
  const t = inverse.invT;
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3] * p[3] + t[0],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7] * p[3] + t[1],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11] * p[3] + t[2],
    m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15] * p[3] + t[3],
  ];
}

function applyMatrix4(m: readonly number[], p: Vec4): Vec4 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3] * p[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7] * p[3],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11] * p[3],
    m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15] * p[3],
  ];
}

/** Resolve the raw-attractor source of a 3D hit. */
export function surfacePatternSourceHit3(
  input: SurfacePatternSource3Input,
): Vec3 {
  if (input.foldFinalSourceHit) return [...input.foldFinalSourceHit];
  const query = input.balloonSourceHit ?? input.visibleHit;
  return input.affineFinal
    ? applyInverse3(input.affineFinal, query)
    : [...query];
}

/** The hit's own view-frame w, not merely the slice center. */
export function surfacePatternHitW(
  w0: number,
  sStar: number,
  sliceHalfW: number,
): number {
  return w0 + sStar * sliceHalfW;
}

/**
 * Resolve the raw-attractor source of a 4D hit. `hitW` is inserted BEFORE
 * the inverse rotor; doing it afterward screen-locks any w-mixing pose.
 */
export function surfacePatternSourceHit4(
  input: SurfacePatternSource4Input,
): Vec4 {
  if (input.foldFinalSource) {
    const { bestQ, bestExt } = input.foldFinalSource;
    return [
      bestQ[0] + input.sStar * bestExt[0],
      bestQ[1] + input.sStar * bestExt[1],
      bestQ[2] + input.sStar * bestExt[2],
      bestQ[3] + input.sStar * bestExt[3],
    ];
  }
  const p = input.balloonSourceHit ?? input.visibleHit;
  const hitW = surfacePatternHitW(input.w0, input.sStar, input.sliceHalfW);
  const lifted = applyMatrix4(input.inverseRotor, [p[0], p[1], p[2], hitW]);
  return input.affineFinal ? applyInverse4(input.affineFinal, lifted) : lifted;
}

function validRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius > 0;
}

/**
 * Normalize a raw 3D source against the existing pre-final enclosing ball.
 * Escape and bulb callers use the origin for `boundCenter`; IFS callers
 * reuse `SurfaceDE.boundCenter`. Invalid radii resolve to a finite disabled
 * coordinate rather than introducing NaN into a shader lane.
 */
export function normalizeSurfacePatternSource3(
  sourceHit: Vec3,
  boundCenter: Vec3,
  boundingRadius: number,
): Vec3 {
  if (!validRadius(boundingRadius)) return [0, 0, 0];
  return [
    (sourceHit[0] - boundCenter[0]) / boundingRadius,
    (sourceHit[1] - boundCenter[1]) / boundingRadius,
    (sourceHit[2] - boundCenter[2]) / boundingRadius,
  ];
}

/**
 * Normalize a raw 4D source for the V1 x/y/z-authored pattern axes. The w
 * component still influences xyz through the inverse rotor/final transform;
 * it is merely not exposed as a fourth authoring axis. Current IFS4, fold4,
 * and escape4 bounds are origin-anchored. The API omits a center deliberately
 * so the CPU oracle cannot drift from the frozen shader contract: divide by
 * the RAW `boundingRadius`, never the live slice radius, visible radius, or
 * `radiusBand.center`.
 */
export function normalizeSurfacePatternSource4(
  sourceHit: Vec4,
  boundingRadius: number,
): Vec3 {
  if (!validRadius(boundingRadius)) return [0, 0, 0];
  return [
    sourceHit[0] / boundingRadius,
    sourceHit[1] / boundingRadius,
    sourceHit[2] / boundingRadius,
  ];
}
