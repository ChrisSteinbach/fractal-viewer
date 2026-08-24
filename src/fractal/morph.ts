/**
 * Pure interpolation between two IFS systems — the dependency-free core of
 * the system-morphing feature: when a replace-load (preset /
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
 * - `symmetry`'s order/plane/twist are discrete and cannot interpolate, but its
 *   VISUAL WEIGHT can: when the two sides' kaleidoscopes differ —
 *   the identity tuple is (order, plane, twist), see {@link lerpSymmetry} —
 *   `a`'s fades out over the first half (`blend` 1 -> 0, see
 *   `SymmetryParams.blend`) and `b`'s fades in over the second — continuous
 *   at the midpoint, where both ends sit at blend 0 (bit-identical to order
 *   1, per `prepareChaosGame`). A matching pair stays untouched and an
 *   order-1 side needs no fade (it has no copies) — both ride by reference.
 * - The fold's three lengths (`Variation.minRadius`/`fixedRadius`/
 *   `boxLimit`) lerp like any other absent-means-default optional number
 *   ({@link lerpOptional}), but the default they resolve an absent side
 *   through is the CLASSIC length (`variations.ts`'s `SPHERE_FOLD_MIN_RADIUS`/
 *   `SPHERE_FOLD_FIXED_RADIUS`/`BOX_FOLD_LIMIT`), never a synthesized 0 — so
 *   `minRadius: 0.3` against an absent side morphs 0.3 -> 0.5, not 0.3 -> 0.
 *   Both sides absent stays absent, keeping an unparameterized morph
 *   byte-identical to before those fields existed.
 * - `Transform.finish` (the optional per-transform surface shading — see
 *   `types.ts`'s {@link SurfaceFinish}) lerps the identical way, one field
 *   family over: each of its six fields goes through {@link lerpOptional}
 *   with ITS OWN classic value (`surface-finish.ts`'s
 *   `CLASSIC_SURFACE_FINISH`) as the absent side's fallback, so
 *   `metalness: 1` against a side that omits it (the field OR the whole
 *   `finish` object) morphs 1 -> 0, never toward a synthesized hole, and a
 *   field absent on both sides stays absent. Both `finish` objects absent
 *   stays absent, keeping an unparameterized morph byte-identical to before
 *   the field existed.
 * - `Transform.chaos` (graph-directed selection rows) lerps entrywise with
 *   the absent side reading all-1s at the other side's length, and an
 *   all-1s result is dropped — see {@link lerpChaos}. A transform-count
 *   mismatch needs no extra rule: the phantom padding copies the surplus
 *   map's row verbatim (like every other metadata field), and rows shorter
 *   than the paired side's pad with 1s inside the entry lerp.
 * - `Transform.emitter` (the condensation shape) lerps NUMERICALLY only
 *   when both sides carry STRUCTURALLY EQUAL specs — same part count,
 *   same per-part primitive kind and combine op, same gear tooth count (a
 *   discrete sector count, `symmetry.order`'s treatment) — in which case
 *   each part's numeric shape params and pose lerp (the transform's own
 *   TRS, the shape's pose, already lerps as affine fields). ANY OTHER
 *   pair — one-sided, or structurally mismatched — POPS to the TARGET
 *   side's spec (or absence) from the morph's first intermediate, the
 *   scheduled-hybrid block's placement: there is no meaningful midpoint
 *   between two different shapes, and the slot-per-slot pairing
 *   {@link lerpTransformPair} is built on has no room to split one slot
 *   into two fading transforms. A transform-COUNT mismatch still fades an
 *   emitter map by weight for free — the phantom padding copies the
 *   surplus map, emitter included, and only its weight animates. See
 *   {@link lerpEmitter}; endpoints stay exact by {@link lerpSystem}'s
 *   by-reference returns.
 */
import { isFlatTransform, meanContraction } from "./affine4";
import { DEFAULT_COLOR_SPEED, derivedColorIndex } from "./chaos-game";
import type { ShapePart, ShapePose, ShapeSpec } from "./shapes";
import { CLASSIC_SURFACE_FINISH } from "./surface-finish";
import {
  PATTERN_DEFAULT_SCALE,
  resolveSurfacePattern,
} from "./surface-pattern";
import type {
  SurfaceFinish,
  SurfacePattern,
  SymmetryParams,
  Transform,
  Variation,
  VariationType,
  Vec3,
  WExtension,
} from "./types";
import {
  BOX_FOLD_LIMIT,
  SPHERE_FOLD_FIXED_RADIUS,
  SPHERE_FOLD_MIN_RADIUS,
} from "./variations";

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
 * field (`weight`, `colorSpeed`, `w.position`, each w-mixing plane) — plus
 * `colorIndex`, whose `fallback` is `derivedColorIndex(i, n)`
 * rather than a constant (see {@link lerpTransforms}): absent on both sides
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

/** One type's pooled data: the summed weight plus whichever fold lengths
 * its entries carried — the shape {@link lerpVariations} unions
 * across both sides. */
type VariationInfo = {
  weight: number;
  minRadius?: number;
  fixedRadius?: number;
  boxLimit?: number;
};

/** Sum a variation list into a type -> {@link VariationInfo} map (duplicate
 * types add their weights; a later same-type entry's fold lengths win — the
 * shared invariant every producer upholds is AT MOST ONE ENTRY PER TYPE, see
 * `types.ts`'s {@link Variation}, so this tie-break only ever matters for
 * hand-crafted input) — the shape {@link lerpVariations} unions across both
 * sides. Absent/empty ⇒ an empty map, matching that both mean "no
 * variations". */
function variationInfo(
  variations: Variation[] | undefined,
): Map<VariationType, VariationInfo> {
  const info = new Map<VariationType, VariationInfo>();
  if (!variations) return info;
  for (const v of variations) {
    const existing = info.get(v.type);
    if (existing === undefined) {
      info.set(v.type, {
        weight: v.weight,
        minRadius: v.minRadius,
        fixedRadius: v.fixedRadius,
        boxLimit: v.boxLimit,
      });
      continue;
    }
    existing.weight += v.weight;
    if (v.minRadius !== undefined) existing.minRadius = v.minRadius;
    if (v.fixedRadius !== undefined) existing.fixedRadius = v.fixedRadius;
    if (v.boxLimit !== undefined) existing.boxLimit = v.boxLimit;
  }
  return info;
}

/** Union the two sides' variation types (a type missing on one side resolves
 * to weight 0 there) and lerp each type's weight — weights are free
 * strengths, never renormalized — alongside its fold lengths, each
 * through {@link lerpOptional} with the CLASSIC length as the fallback
 * (`SPHERE_FOLD_MIN_RADIUS`/`SPHERE_FOLD_FIXED_RADIUS`/`BOX_FOLD_LIMIT` —
 * `variations.ts`'s own constants, never re-typed here as a magic number). A
 * type missing entirely on one side resolves through that same fallback
 * exactly as an absent field on a present entry would — `minRadius: 0.3`
 * against no entry at all morphs 0.3 -> 0.5 exactly as it would against an
 * entry that merely omits `minRadius`. Deterministic order: `a`'s types in
 * `a`'s order, then `b`'s remaining types in `b`'s order. `undefined` when
 * the union is empty.
 *
 * Keying the union by TYPE (rather than concatenating the two lists) is also
 * what bounds a sample's blend LENGTH at the type vocabulary's own size, so
 * even a fully disjoint pair stays inside the GPU flame Slot's fixed
 * variation lanes — `flame-gpu.ts`'s `MAX_SLOT_VARIATIONS`, whose packer
 * throws past them. */
function lerpVariations(
  a: Variation[] | undefined,
  b: Variation[] | undefined,
  t: number,
): Variation[] | undefined {
  const aInfo = variationInfo(a);
  const bInfo = variationInfo(b);
  if (aInfo.size === 0 && bInfo.size === 0) return undefined;

  const order: VariationType[] = [...aInfo.keys()];
  for (const type of bInfo.keys()) {
    if (!aInfo.has(type)) order.push(type);
  }
  return order.map((type) => {
    const av = aInfo.get(type);
    const bv = bInfo.get(type);
    const result: Variation = {
      type,
      weight: lerp(av?.weight ?? 0, bv?.weight ?? 0, t),
    };
    const minRadius = lerpOptional(
      av?.minRadius,
      bv?.minRadius,
      SPHERE_FOLD_MIN_RADIUS,
      t,
    );
    if (minRadius !== undefined) result.minRadius = minRadius;
    const fixedRadius = lerpOptional(
      av?.fixedRadius,
      bv?.fixedRadius,
      SPHERE_FOLD_FIXED_RADIUS,
      t,
    );
    if (fixedRadius !== undefined) result.fixedRadius = fixedRadius;
    const boxLimit = lerpOptional(
      av?.boxLimit,
      bv?.boxLimit,
      BOX_FOLD_LIMIT,
      t,
    );
    if (boxLimit !== undefined) result.boxLimit = boxLimit;
    return result;
  });
}

/**
 * `Transform.chaos` for a pair: entrywise lerp, the absent side reading
 * ALL-1s at the other side's length (1 is the field's absent-means default —
 * see `types.ts`'s {@link Transform.chaos} — so a row fades toward "no
 * constraint", never toward a synthesized 0 that would starve maps out of
 * selection mid-morph; the fold lengths' classic-fallback rule applied to
 * selection). Two present rows of different lengths pad the shorter with 1s
 * the same way. An all-1s RESULT is ABSENT — `lerp(1, 1, t)` is exactly 1
 * (the `a + (b - a) * t` form), so a trivial-vs-absent pair emits nothing at
 * every `t` and an unauthored morph stays byte-identical to before the field
 * existed; the endpoints themselves are exact by {@link lerpSystem}'s
 * by-reference returns.
 */
function lerpChaos(
  a: number[] | undefined,
  b: number[] | undefined,
  t: number,
): number[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  const length = Math.max(a?.length ?? 0, b?.length ?? 0);
  const result = new Array<number>(length);
  let trivial = true;
  for (let j = 0; j < length; j++) {
    const value = lerp(a?.[j] ?? 1, b?.[j] ?? 1, t);
    result[j] = value;
    if (value !== 1) trivial = false;
  }
  return trivial ? undefined : result;
}

/**
 * Whether two emitter specs are the SAME SHAPE, structurally — the identity
 * {@link lerpEmitter} keys its numeric-lerp arm on: equal part counts, and
 * per part an equal primitive `kind`, an equal `combine` op, and (for
 * gears) an equal `teeth` count — a discrete sector count that cannot
 * interpolate, exactly like `symmetry.order` (a fractional tooth count
 * would round through `resolveGearTeeth` into mid-morph pops). Pose
 * PRESENCE deliberately does not join the identity: an absent pose field
 * is the identity value, so it lerps numerically through its fallback like
 * any optional field.
 */
function emitterStructurallyEqual(a: ShapeSpec, b: ShapeSpec): boolean {
  if (a.parts.length !== b.parts.length) return false;
  for (let i = 0; i < a.parts.length; i++) {
    const pa = a.parts[i];
    const pb = b.parts[i];
    if (pa.combine !== pb.combine) return false;
    if (pa.primitive.kind !== pb.primitive.kind) return false;
    if (
      pa.primitive.kind === "gear" &&
      pb.primitive.kind === "gear" &&
      pa.primitive.teeth !== pb.primitive.teeth
    ) {
      return false;
    }
  }
  return true;
}

/** A shape part's pose for a structurally-equal pair: `offset` through the
 * zero fallback ({@link lerpOptionalVec3}), `rotate` through the
 * nearest-turn Euler lerp with the zero fallback (emitted when either side
 * has one), `scale` through the identity fallback 1 ({@link lerpOptional});
 * absent-on-both fields stay absent, and an all-absent pose stays absent. */
function lerpShapePose(
  a: ShapePose | undefined,
  b: ShapePose | undefined,
  t: number,
): ShapePose | undefined {
  if (a === undefined && b === undefined) return undefined;
  const result: ShapePose = {};
  const offset = lerpOptionalVec3(a?.offset, b?.offset, t);
  if (offset !== undefined) result.offset = offset;
  if (a?.rotate !== undefined || b?.rotate !== undefined) {
    result.rotate = lerpRotation(
      a?.rotate ?? ZERO_VEC3,
      b?.rotate ?? ZERO_VEC3,
      t,
    );
  }
  const scale = lerpOptional(a?.scale, b?.scale, 1, t);
  if (scale !== undefined) result.scale = scale;
  return Object.keys(result).length === 0 ? undefined : result;
}

/** One structurally-equal part pair: every numeric shape param lerps
 * ({@link lerp} — same-kind established by
 * {@link emitterStructurallyEqual}, which is what makes the casts below
 * sound), the pose through {@link lerpShapePose}. */
function lerpEmitterPart(a: ShapePart, b: ShapePart, t: number): ShapePart {
  const pa = a.primitive;
  const pb = b.primitive;
  let primitive: ShapePart["primitive"];
  switch (pa.kind) {
    case "sphere": {
      const q = pb as Extract<ShapePart["primitive"], { kind: "sphere" }>;
      primitive = { kind: "sphere", radius: lerp(pa.radius, q.radius, t) };
      break;
    }
    case "box": {
      const q = pb as Extract<ShapePart["primitive"], { kind: "box" }>;
      primitive = { kind: "box", half: lerpVec3(pa.half, q.half, t) };
      break;
    }
    case "torus": {
      const q = pb as Extract<ShapePart["primitive"], { kind: "torus" }>;
      primitive = {
        kind: "torus",
        major: lerp(pa.major, q.major, t),
        minor: lerp(pa.minor, q.minor, t),
      };
      break;
    }
    case "capsule": {
      const q = pb as Extract<ShapePart["primitive"], { kind: "capsule" }>;
      primitive = {
        kind: "capsule",
        a: lerpVec3(pa.a, q.a, t),
        b: lerpVec3(pa.b, q.b, t),
        radius: lerp(pa.radius, q.radius, t),
      };
      break;
    }
    case "gear": {
      const q = pb as Extract<ShapePart["primitive"], { kind: "gear" }>;
      primitive = {
        kind: "gear",
        // Equal by the structural identity — carried, never lerped.
        teeth: pa.teeth,
        radius: lerp(pa.radius, q.radius, t),
        tooth: [
          lerp(pa.tooth[0], q.tooth[0], t),
          lerp(pa.tooth[1], q.tooth[1], t),
        ],
        // `hole` 0 means NO bore (shapes.ts) — still a plain numeric lerp:
        // the term fades in continuously as the value leaves 0.
        hole: lerp(pa.hole, q.hole, t),
        halfHeight: lerp(pa.halfHeight, q.halfHeight, t),
      };
      break;
    }
  }
  const part: ShapePart = { primitive, combine: a.combine };
  const pose = lerpShapePose(a.pose, b.pose, t);
  if (pose !== undefined) part.pose = pose;
  return part;
}

/**
 * `Transform.emitter` for a pair (see the module header's bullet): both
 * absent stays absent; both present AND structurally equal
 * ({@link emitterStructurallyEqual}) lerps every numeric shape param and
 * pose field ({@link lerpEmitterPart} — the transform's own TRS, the
 * shape's pose, already lerps as ordinary affine fields); ANY other pair —
 * one-sided or structurally mismatched — POPS to the TARGET side `b`'s
 * spec (or absence) from the first intermediate, the scheduled-hybrid
 * block's placement (there is no meaningful midpoint between two different
 * shapes, and the slot pairing has no room to split one slot in two). The
 * popped spec rides BY REFERENCE — intermediates are consumed, never
 * mutated, and the endpoints are exact via {@link lerpSystem}'s
 * by-reference returns regardless.
 */
function lerpEmitter(
  a: ShapeSpec | undefined,
  b: ShapeSpec | undefined,
  t: number,
): ShapeSpec | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || b === undefined || !emitterStructurallyEqual(a, b)) {
    return b;
  }
  return {
    parts: a.parts.map((part, i) => lerpEmitterPart(part, b.parts[i], t)),
  };
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

/**
 * `Transform.finish` for a pair: each of the six fields lerps
 * INDEPENDENTLY through {@link lerpOptional}, with that field's OWN
 * `CLASSIC_SURFACE_FINISH` value (`surface-finish.ts`) as the absent side's
 * fallback — `metalness: 1` against a side that omits `finish` entirely, or
 * that carries a `finish` but omits `metalness`, morphs 1 -> 0 either way,
 * never toward a synthesized hole. Same "build then drop if empty" shape as
 * {@link lerpWPlanes} rather than {@link lerpW}'s flatness-gated shape (a
 * finish has no cross-field identity predicate to key an early return on):
 * `undefined` whenever nothing in the built object survives, which is
 * exactly when every field was absent on BOTH sides — including when both
 * `a`/`b` themselves have no `finish` at all.
 */
function lerpFinish(
  a: SurfaceFinish | undefined,
  b: SurfaceFinish | undefined,
  t: number,
): SurfaceFinish | undefined {
  const result: SurfaceFinish = {};
  const specular = lerpOptional(
    a?.specular,
    b?.specular,
    CLASSIC_SURFACE_FINISH.specular,
    t,
  );
  if (specular !== undefined) result.specular = specular;
  const shininess = lerpOptional(
    a?.shininess,
    b?.shininess,
    CLASSIC_SURFACE_FINISH.shininess,
    t,
  );
  if (shininess !== undefined) result.shininess = shininess;
  const metalness = lerpOptional(
    a?.metalness,
    b?.metalness,
    CLASSIC_SURFACE_FINISH.metalness,
    t,
  );
  if (metalness !== undefined) result.metalness = metalness;
  const reflect = lerpOptional(
    a?.reflect,
    b?.reflect,
    CLASSIC_SURFACE_FINISH.reflect,
    t,
  );
  if (reflect !== undefined) result.reflect = reflect;
  const transmit = lerpOptional(
    a?.transmit,
    b?.transmit,
    CLASSIC_SURFACE_FINISH.transmit,
    t,
  );
  if (transmit !== undefined) result.transmit = transmit;
  const reflectionTint = lerpOptional(
    a?.reflectionTint,
    b?.reflectionTint,
    CLASSIC_SURFACE_FINISH.reflectionTint,
    t,
  );
  if (reflectionTint !== undefined) result.reflectionTint = reflectionTint;
  return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Pattern morphing keeps discrete family/orientation changes invisible by
 * crossing strength through zero. Absence is the sole `none` state. Numeric
 * leaves interpolate through their core defaults and stay sparse when both
 * sides omit them; the outer endpoint fast paths still return authored
 * systems by reference.
 */
function lerpSurfacePattern(
  a: SurfacePattern | undefined,
  b: SurfacePattern | undefined,
  t: number,
): SurfacePattern | undefined {
  if (a === b) return a;
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) {
    const resolved = resolveSurfacePattern(b);
    return { ...b!, strength: resolved.strength * t };
  }
  if (b === undefined) {
    const resolved = resolveSurfacePattern(a);
    return { ...a, strength: resolved.strength * (1 - t) };
  }

  const ra = resolveSurfacePattern(a);
  const rb = resolveSurfacePattern(b);
  const sameIdentity = a.kind === b.kind && ra.axis === rb.axis;
  if (sameIdentity) {
    const result: SurfacePattern = { kind: a.kind, axis: a.axis };
    const scale = lerpOptional(
      a.scale,
      b.scale,
      PATTERN_DEFAULT_SCALE[a.kind],
      t,
    );
    if (scale !== undefined) result.scale = scale;
    const strength = lerpOptional(a.strength, b.strength, 1, t);
    if (strength !== undefined) result.strength = strength;
    return result;
  }

  const selected = t < 0.5 ? a : b;
  const strength =
    t < 0.5 ? ra.strength * (1 - 2 * t) : rb.strength * (2 * t - 1);
  return {
    ...selected,
    scale: lerp(ra.scale, rb.scale, t),
    strength,
  };
}

/** Lerp one paired transform, field by field, assigning `id` from the pair's
 * position rather than either side's own id (mid-morph ids are
 * display-only — see the module header). `colorIndexFallback` is the
 * absent-side default for `colorIndex` — passed in rather than
 * derived here, since it depends on the pair's INDEX and the system's map
 * COUNT, neither of which this function knows; see {@link lerpTransforms}
 * and {@link lerpFinalTransform} for the two callers' fallback choices. */
function lerpTransformPair(
  a: Transform,
  b: Transform,
  t: number,
  id: number,
  colorIndexFallback: number,
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

  const colorIndex = lerpOptional(
    a.colorIndex,
    b.colorIndex,
    colorIndexFallback,
    t,
  );
  if (colorIndex !== undefined) result.colorIndex = colorIndex;

  const colorSpeed = lerpOptional(
    a.colorSpeed,
    b.colorSpeed,
    DEFAULT_COLOR_SPEED,
    t,
  );
  if (colorSpeed !== undefined) result.colorSpeed = colorSpeed;

  const variations = lerpVariations(a.variations, b.variations, t);
  if (variations !== undefined) result.variations = variations;

  const chaos = lerpChaos(a.chaos, b.chaos, t);
  if (chaos !== undefined) result.chaos = chaos;

  const emitter = lerpEmitter(a.emitter, b.emitter, t);
  if (emitter !== undefined) result.emitter = emitter;

  const w = lerpW(a, b, t);
  if (w !== undefined) result.w = w;

  const finish = lerpFinish(a.finish, b.finish, t);
  if (finish !== undefined) result.finish = finish;

  const surfacePattern = lerpSurfacePattern(
    a.surfacePattern,
    b.surfacePattern,
    t,
  );
  if (surfacePattern !== undefined) result.surfacePattern = surfacePattern;

  return result;
}

/** A copy of `t` at resolved weight 0 — the padding a shorter `transforms`
 * side gets for the longer side's surplus maps (see the module header): same
 * geometry and material metadata (position/rotation/scale/shear/variations/
 * w/finish/surfacePattern unchanged), so
 * {@link lerpTransformPair} lerps it against the genuine `t` bit-exactly,
 * and only the weight animates 0 <-> `t`'s own resolved weight. */
function phantomTransform(t: Transform): Transform {
  return { ...t, weight: 0 };
}

/** Pair `a`/`b`'s transforms by index, padding the shorter side with
 * {@link phantomTransform} copies of the longer side's surplus maps, and
 * lerp each pair. Each pair's `colorIndex` fallback is
 * `derivedColorIndex(i, length)` — the PAIRED length (after phantom
 * padding), used for BOTH sides of the pair, never either side's own
 * (possibly shorter) `transforms.length`. Two reasons: a
 * {@link phantomTransform} is a copy of the OTHER side's own map, so both
 * sides of a phantom pair must resolve through the SAME fallback or the
 * padding stops lerping "bit-exactly, only the weight animating" — its
 * documented contract; and each side's own count would place a surplus
 * index outside its own `[0, 1]` spread entirely (e.g. index 3 of a 2-map
 * system). This only ever shapes a MID-morph sample — {@link lerpSystem}
 * returns `a`/`b` by reference at the endpoints, so a rendered system's own
 * authored or derived colors are never touched by this choice. */
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
    result.push(
      lerpTransformPair(left, right, t, i, derivedColorIndex(i, length)),
    );
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
 * `symmetry` for a morph: two kaleidoscopes are the SAME exactly
 * when the identity tuple (order, plane, twist) matches — `blend`
 * deliberately ignored, it's a morph artifact, not an identity — and a
 * matching pair rides through untouched; a differing pair CROSSFADES — the
 * departing kaleidoscope's rotated copies thin to nothing over the first
 * half (`blend`: own strength -> 0), the arriving one's grow from nothing
 * over the second (0 -> own strength) — so the midpoint is continuous: both
 * ends sit at blend 0, which `prepareChaosGame` renders bit-identically to
 * order 1. An order-1 side has no copies to fade, so it rides by reference;
 * each side's own strength resolves through `blend ?? 1`, which is what lets
 * a CHAINED morph (morph-tween.ts) depart from a mid-fade sample without its
 * kaleidoscope popping back to full first.
 *
 * `twist` rides each side's own branch untouched, NEVER
 * interpolated — a crossfade fades one kaleidoscope OUT and the other IN, so
 * each half is still that side's own group, twist included (an interpolated
 * twist would sweep the copies through rotations that belong to neither
 * side's group). It joins the identity comparison for the same reason
 * `plane` does: two kaleidoscopes of equal order that turn differently are
 * not the same kaleidoscope. Flatness plays no part here (the old non-flat
 * skip died when the 4D pipeline learned to render a kaleidoscope): a 4D
 * sample renders its kaleidoscope like any other, so the crossfade is always
 * worth computing.
 */
function lerpSymmetry(
  a: SymmetryParams,
  b: SymmetryParams,
  t: number,
): SymmetryParams {
  if (
    a.order === b.order &&
    a.plane === b.plane &&
    (a.twist ?? 0) === (b.twist ?? 0)
  ) {
    return t < 0.5 ? a : b;
  }
  if (t < 0.5) {
    if (a.order === 1) return a;
    return {
      order: a.order,
      plane: a.plane,
      // Absent stays absent (never an explicit `undefined`), so a plain
      // simple-rotation sample is the same object shape it always was.
      ...(a.twist ? { twist: a.twist } : {}),
      blend: (a.blend ?? 1) * (1 - 2 * t),
    };
  }
  if (b.order === 1) return b;
  return {
    order: b.order,
    plane: b.plane,
    ...(b.twist ? { twist: b.twist } : {}),
    blend: (b.blend ?? 1) * (2 * t - 1),
  };
}

/**
 * `finalTransform` for a morph: both null stays null; when only one side has
 * a lens, the other's endpoint is the identity map (carrying the present
 * side's id) so the lens fades in/out through {@link lerpTransformPair}'s
 * ordinary field rules; when both have one, they lerp directly with `b`'s
 * id. The final transform is never picked by the chaos game — it only bends
 * a point at plot time — so its `colorIndex`/`colorSpeed` pair is inert;
 * the lone-map fallback `derivedColorIndex(0, 1)` (`0.5`) is passed purely
 * to satisfy {@link lerpTransformPair}'s signature, not because any renderer
 * reads it.
 */
function lerpFinalTransform(
  a: Transform | null,
  b: Transform | null,
  t: number,
): Transform | null {
  const colorIndexFallback = derivedColorIndex(0, 1);
  if (a === null) {
    return b === null
      ? null
      : lerpTransformPair(
          identityTransform(b.id),
          b,
          t,
          b.id,
          colorIndexFallback,
        );
  }
  if (b === null) {
    return lerpTransformPair(
      a,
      identityTransform(a.id),
      t,
      a.id,
      colorIndexFallback,
    );
  }
  return lerpTransformPair(a, b, t, b.id, colorIndexFallback);
}

/**
 * Interpolate between two {@link MorphSystem}s at `t`. `t <= 0` returns `a`
 * and `t >= 1` returns `b`, both BY REFERENCE (see the module header for why
 * that exactness matters). Every intermediate is a freshly built system —
 * `a`/`b` are never mutated. See the module header for the field-by-field
 * rules: nearest-angle rotation, surplus-map padding, flat/4D continuity,
 * negative-scale fold-through, and the symmetry crossfade.
 */
export function lerpSystem(
  a: MorphSystem,
  b: MorphSystem,
  t: number,
): MorphSystem {
  if (t <= 0) return a;
  if (t >= 1) return b;
  // No flatness is derived here (that would be circular: flatness consumes
  // symmetry via `symmetryIsNonFlat`) — symmetry is simply computed, and any
  // caller that wants the SAMPLE's flatness derives it
  // from the finished parts + symmetry, exactly as for an authored system.
  return {
    transforms: lerpTransforms(a.transforms, b.transforms, t),
    finalTransform: lerpFinalTransform(a.finalTransform, b.finalTransform, t),
    symmetry: lerpSymmetry(a.symmetry, b.symmetry, t),
  };
}
