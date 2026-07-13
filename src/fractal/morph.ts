/**
 * Pure interpolation between two IFS systems — the dependency-free core of
 * the system-morphing feature (fr-idze): when a replace-load (preset /
 * Surprise Me / gallery) swaps in a new attractor, a follow-up driver tweens
 * through this module's {@link lerpSystem} instead of snapping straight to
 * the target. A {@link MorphSystem} is the attractor-SHAPING subset of a
 * generation request — transforms, the optional final-transform lens, and
 * kaleidoscope symmetry — deliberately excluding point count, colors, and
 * palettes: the app adopts the target's instantly, so only the geometry that
 * actually shapes the attractor morphs.
 *
 * `t <= 0` and `t >= 1` return `a`/`b` BY REFERENCE — byte-identical to a
 * plain load of that endpoint, no synthesized defaults materialized. A
 * follow-up driver's final sample relies on this: it must be `=== to`. Every
 * intermediate (`0 < t < 1`) is a freshly built system.
 *
 * A handful of decisions make the interpolation feel intentional rather than
 * mechanical:
 * - Rotation lerps through the NEAREST turn ({@link nearestAngle}), not raw
 *   numeric distance: 350° -> 10° morphs as a +20° turn through 360°, never
 *   backward through -340°.
 * - A transform-count mismatch pads the shorter side with phantom copies of
 *   the longer side's surplus maps at resolved weight 0 (same geometry, only
 *   the weight is forced), so extra maps fade in/out in place instead of
 *   sliding in from the origin. This relies on {@link lerp}'s
 *   `a + (b - a) * t` form, which returns the shared value EXACTLY when both
 *   sides are equal — the padded geometry stays bit-pinned across the whole
 *   morph.
 * - Flat <-> 4D morphs stay continuous: an absent `w.scale` derives from the
 *   endpoint's own mean spatial contraction (`affine4.ts`'s
 *   `meanContraction`, the same formula `toTransform4` itself falls back
 *   to), and a pair only grows a `w` block when `isFlatTransform` calls at
 *   least one side genuinely non-flat — a flat-flat pair stays w-less so it
 *   never flips `systemIsFlat` mid-morph for no visual gain.
 * - Negative scale lerps straight through zero on purpose: the momentary
 *   planar collapse is the correct mirror fold-through, not a case to dodge.
 * - `symmetry` cannot interpolate (kaleidoscope order/axis are discrete), so
 *   it snaps from `a`'s to `b`'s at the morph's midpoint.
 */
import { isFlatTransform, meanContraction } from "./affine4";
import type {
  SymmetryParams,
  Transform,
  Variation,
  VariationType,
  Vec3,
  WExtension,
} from "./types";

/**
 * The attractor-shaping subset of a generation request that a morph
 * interpolates: the base maps, the optional final-transform lens, and
 * kaleidoscope symmetry. Point count, colors, and palettes are deliberately
 * NOT here — the app adopts the target's instantly rather than tweening
 * them, so a morph only animates the geometry that actually shapes the
 * attractor.
 */
export interface MorphSystem {
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
}

/** The three w-mixing planes shared by {@link WExtension}'s `rotation` and
 * `shear` sub-objects (both `Pick<Rotation4 | Shear4, "xw" | "yw" | "zw">`,
 * structurally identical) — one shape lets {@link lerpWPlanes} serve both. */
type WPlanes = { xw?: number; yw?: number; zw?: number };

const ZERO_VEC3: Vec3 = [0, 0, 0];
const TWO_PI = Math.PI * 2;

/** `a + (b - a) * t`, not `(1 - t) * a + t * b`: when `a === b` this form
 * returns that value EXACTLY (`x + 0 * t === x`), which the surplus-map
 * padding and flat-pair geometry pinning both rely on to stay bit-exact
 * across the whole morph. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shift `angle` by a multiple of 2π so it lands within π of `reference` —
 * the nearest representative of the same rotation, so a component never
 * lerps the "long way around" (350° -> 10° turns +20° through 360°, not
 * -340°). */
function nearestAngle(reference: number, angle: number): number {
  let delta = (angle - reference) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return reference + delta;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Euler-XYZ rotation lerp: each component goes through {@link nearestAngle}
 * before the numeric lerp, so the turn is always the short way around. */
function lerpRotation(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    lerp(a[0], nearestAngle(a[0], b[0]), t),
    lerp(a[1], nearestAngle(a[1], b[1]), t),
    lerp(a[2], nearestAngle(a[2], b[2]), t),
  ];
}

/** Absent-means-`fallback` scalar lerp, shared by every optional numeric
 * field (`weight`, `w.position`, each w-mixing plane): absent on both sides
 * stays absent, otherwise both sides resolve through `fallback` and lerp. */
function lerpOptional(
  a: number | undefined,
  b: number | undefined,
  fallback: number,
  t: number,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return lerp(a ?? fallback, b ?? fallback, t);
}

/** {@link lerpOptional}'s Vec3 shape, for `Transform.shear` (absent ⇒
 * `[0,0,0]`). */
function lerpOptionalVec3(
  a: Vec3 | undefined,
  b: Vec3 | undefined,
  t: number,
): Vec3 | undefined {
  if (a === undefined && b === undefined) return undefined;
  return lerpVec3(a ?? ZERO_VEC3, b ?? ZERO_VEC3, t);
}

/** {@link WExtension.rotation}/`.shear`'s shared shape: each plane absent ⇒
 * 0, emitted UNLESS absent on both sides, and the whole sub-object omitted
 * when nothing gets emitted. */
function lerpWPlanes(
  a: WPlanes | undefined,
  b: WPlanes | undefined,
  t: number,
): WPlanes | undefined {
  const result: WPlanes = {};
  const xw = lerpOptional(a?.xw, b?.xw, 0, t);
  if (xw !== undefined) result.xw = xw;
  const yw = lerpOptional(a?.yw, b?.yw, 0, t);
  if (yw !== undefined) result.yw = yw;
  const zw = lerpOptional(a?.zw, b?.zw, 0, t);
  if (zw !== undefined) result.zw = zw;
  return Object.keys(result).length === 0 ? undefined : result;
}

/** Sum a variation list into a type -> weight map (duplicate types add) —
 * the shape {@link lerpVariations} unions across both sides. Absent/empty ⇒
 * an empty map, matching that both mean "no variations". */
function variationWeights(
  variations: Variation[] | undefined,
): Map<VariationType, number> {
  const weights = new Map<VariationType, number>();
  if (!variations) return weights;
  for (const v of variations) {
    weights.set(v.type, (weights.get(v.type) ?? 0) + v.weight);
  }
  return weights;
}

/** Union the two sides' variation types (a type missing on one side resolves
 * to weight 0 there) and lerp each type's weight — weights are free
 * strengths, never renormalized. Deterministic order: `a`'s types in `a`'s
 * order, then `b`'s remaining types in `b`'s order. `undefined` when the
 * union is empty. */
function lerpVariations(
  a: Variation[] | undefined,
  b: Variation[] | undefined,
  t: number,
): Variation[] | undefined {
  const aWeights = variationWeights(a);
  const bWeights = variationWeights(b);
  if (aWeights.size === 0 && bWeights.size === 0) return undefined;

  const order: VariationType[] = [...aWeights.keys()];
  for (const type of bWeights.keys()) {
    if (!aWeights.has(type)) order.push(type);
  }
  return order.map((type) => ({
    type,
    weight: lerp(aWeights.get(type) ?? 0, bWeights.get(type) ?? 0, t),
  }));
}

/**
 * `Transform.w` for a pair: `undefined` unless {@link isFlatTransform} calls
 * at least one side genuinely non-flat (a flat-flat pair would otherwise
 * flip `systemIsFlat` mid-morph for no visual gain — see the module
 * header). Otherwise every field lerps with its documented absent-default
 * EXCEPT `scale`, which is always emitted, resolving an absent side to that
 * side's OWN mean spatial contraction ({@link meanContraction} of its
 * unlerped 3D `scale`) rather than `1` — the same derivation `toTransform4`
 * itself uses, so a w-less side morphs exactly as if it had been lifted all
 * along.
 */
function lerpW(a: Transform, b: Transform, t: number): WExtension | undefined {
  if (isFlatTransform(a) && isFlatTransform(b)) return undefined;

  const result: WExtension = {
    scale: lerp(
      a.w?.scale ?? meanContraction(a.scale),
      b.w?.scale ?? meanContraction(b.scale),
      t,
    ),
  };

  const position = lerpOptional(a.w?.position, b.w?.position, 0, t);
  if (position !== undefined) result.position = position;

  const rotation = lerpWPlanes(a.w?.rotation, b.w?.rotation, t);
  if (rotation !== undefined) result.rotation = rotation;

  const shear = lerpWPlanes(a.w?.shear, b.w?.shear, t);
  if (shear !== undefined) result.shear = shear;

  return result;
}

/** Lerp one paired transform, field by field, assigning `id` from the pair's
 * position rather than either side's own id (mid-morph ids are
 * display-only — see the module header). */
function lerpTransformPair(
  a: Transform,
  b: Transform,
  t: number,
  id: number,
): Transform {
  const result: Transform = {
    id,
    position: lerpVec3(a.position, b.position, t),
    rotation: lerpRotation(a.rotation, b.rotation, t),
    scale: lerpVec3(a.scale, b.scale, t),
  };

  const shear = lerpOptionalVec3(a.shear, b.shear, t);
  if (shear !== undefined) result.shear = shear;

  const weight = lerpOptional(a.weight, b.weight, 1, t);
  if (weight !== undefined) result.weight = weight;

  const variations = lerpVariations(a.variations, b.variations, t);
  if (variations !== undefined) result.variations = variations;

  const w = lerpW(a, b, t);
  if (w !== undefined) result.w = w;

  return result;
}

/** A copy of `t` at resolved weight 0 — the padding a shorter `transforms`
 * side gets for the longer side's surplus maps (see the module header): same
 * geometry (position/rotation/scale/shear/variations/w unchanged), so
 * {@link lerpTransformPair} lerps it against the genuine `t` bit-exactly,
 * and only the weight animates 0 <-> `t`'s own resolved weight. */
function phantomTransform(t: Transform): Transform {
  return { ...t, weight: 0 };
}

/** Pair `a`/`b`'s transforms by index, padding the shorter side with
 * {@link phantomTransform} copies of the longer side's surplus maps, and
 * lerp each pair. */
function lerpTransforms(
  a: Transform[],
  b: Transform[],
  t: number,
): Transform[] {
  const length = Math.max(a.length, b.length);
  const result: Transform[] = [];
  for (let i = 0; i < length; i++) {
    const left = i < a.length ? a[i] : phantomTransform(b[i]);
    const right = i < b.length ? b[i] : phantomTransform(a[i]);
    result.push(lerpTransformPair(left, right, t, i));
  }
  return result;
}

/** The identity affine map, used as the missing side's endpoint when only
 * one system carries a final-transform lens (see {@link
 * lerpFinalTransform}). */
function identityTransform(id: number): Transform {
  return { id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

/**
 * `finalTransform` for a morph: both null stays null; when only one side has
 * a lens, the other's endpoint is the identity map (carrying the present
 * side's id) so the lens fades in/out through {@link lerpTransformPair}'s
 * ordinary field rules; when both have one, they lerp directly with `b`'s
 * id.
 */
function lerpFinalTransform(
  a: Transform | null,
  b: Transform | null,
  t: number,
): Transform | null {
  if (a === null) {
    return b === null
      ? null
      : lerpTransformPair(identityTransform(b.id), b, t, b.id);
  }
  if (b === null) {
    return lerpTransformPair(a, identityTransform(a.id), t, a.id);
  }
  return lerpTransformPair(a, b, t, b.id);
}

/**
 * Interpolate between two {@link MorphSystem}s at `t`. `t <= 0` returns `a`
 * and `t >= 1` returns `b`, both BY REFERENCE (see the module header for why
 * that exactness matters). Every intermediate is a freshly built system —
 * `a`/`b` are never mutated. See the module header for the field-by-field
 * rules: nearest-angle rotation, surplus-map padding, flat/4D continuity,
 * negative-scale fold-through, and the symmetry snap.
 */
export function lerpSystem(
  a: MorphSystem,
  b: MorphSystem,
  t: number,
): MorphSystem {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    transforms: lerpTransforms(a.transforms, b.transforms, t),
    finalTransform: lerpFinalTransform(a.finalTransform, b.finalTransform, t),
    symmetry: t < 0.5 ? a.symmetry : b.symmetry,
  };
}
