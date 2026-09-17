import {
  CLASSIC_SURFACE_FINISH,
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
  type ResolvedSurfaceFinish,
} from "./surface-finish";
import {
  resolveSurfaceOptics,
  type ResolvedSurfaceOptics,
} from "./surface-optics";
import {
  SURFACE_PATTERN_AXIS_WIRE_ID,
  SURFACE_PATTERN_KIND_WIRE_ID,
  resolveSurfacePattern,
  surfacePatternAxisFromWireId,
  surfacePatternKindFromWireId,
  type ResolvedSurfacePattern,
  type SurfaceNativeCalibration,
  type SurfacePattern,
} from "./surface-pattern";
import type { SurfaceFinish, SurfaceOptics } from "./types";

/** One resolved per-transform material. Finish controls lighting response;
 * pattern controls albedo; optics selects the transport contract's dielectric
 * model for this slot (absent = classic, the zero-transmission rule).
 * Keeping the siblings together here makes this module the sole authority for
 * their shared A/B GPU lanes — and, below, for the optical transport lanes
 * appended beside them. */
export interface ResolvedSurfaceMaterial {
  readonly finish: ResolvedSurfaceFinish;
  readonly pattern: ResolvedSurfacePattern;
  /** Present exactly when this slot's transform authors an admitted optical
   * model and the session supplied a usable derived radius; the resolved
   * value is the oracle's own material shape. Absent = classic shading for
   * this slot, byte-identically. */
  readonly optics?: ResolvedSurfaceOptics;
}

/** A session's material wire. `slots` exists only when at least one of the
 * three independent gates is live; callers use `null` for the exact classic,
 * unpatterned, unopticked stride-1 route. */
interface SurfaceMaterialSlotsBase {
  readonly slots: readonly ResolvedSurfaceMaterial[];
  /** The optical-model compile gate: true exactly when some slot resolved an
   * admitted optical model. Dormant until a transport backend consumes it —
   * every current core routes and renders an optics-authored session exactly
   * as before (the capability matrix in
   * `docs/surface-dielectric-transport.md`) — but the gate is real state
   * already, so the renderers' existing finish/pattern keying cannot be
   * fooled into treating an optics-only wire as classic. */
  readonly optics: boolean;
}

/** Finish-only sessions retain the legacy memo/packing shape and carry no
 * irrelevant calibration. */
export interface SurfaceFinishMaterialSlots extends SurfaceMaterialSlotsBase {
  readonly finish: true;
  readonly pattern: false;
}

/** A patterned session always carries the one calibration quartet owned by
 * its built DE. Keeping it on the session object (never in each slot) makes it
 * impossible to compile a pattern gate without the calibration its shader
 * will consume. */
export interface SurfacePatternMaterialSlots extends SurfaceMaterialSlotsBase {
  readonly finish: boolean;
  readonly pattern: true;
  readonly patternCalibration: SurfaceNativeCalibration;
}

/** An optics-only session: no finish or pattern gate is live, but the slots
 * must still reach the spec and the force-frame key. No calibration exists
 * (optics has no per-DE quartet — its base radius is the session's derived
 * optical radius, passed at resolution). */
export interface SurfaceOpticsMaterialSlots extends SurfaceMaterialSlotsBase {
  readonly finish: false;
  readonly pattern: false;
  readonly optics: true;
}

export type SurfaceMaterialSlots =
  | SurfaceFinishMaterialSlots
  | SurfacePatternMaterialSlots
  | SurfaceOpticsMaterialSlots;

export interface SurfaceMaterialLanes {
  readonly a: [number, number, number, number];
  readonly b: [number, number, number, number];
}

/**
 * The material wire's strength quantum. Persistence writes finite pattern
 * numerics with four decimal places, so this is exact for every canonical
 * document value and for any coarser future UI step (the UI bead must choose
 * a step on this grid). Morphs and mutation may produce values between grid
 * points; the GPU wire rounds those with a maximum error of 0.00005.
 *
 * This quantization is necessary, not incidental: one float cannot encode
 * nine family/axis identities plus every float32 in [0, 1] bijectively. The
 * compact wire is therefore deliberately exact over the canonical authored
 * domain rather than pretending to preserve the much larger unquantized live
 * float32 domain.
 */
export const SURFACE_PATTERN_WIRE_STRENGTH_QUANTUM = 0.0001;
export const SURFACE_PATTERN_WIRE_STRENGTH_STEPS = 10_000;

/** Power-of-two fields keep family/axis extraction exact in float32. The
 * strength field occupies 0..10000, below the 16384 axis radix; every valid
 * code is an integer below 2^18 and is therefore exactly representable by an
 * IEEE-754 float32. Zero is reserved for pattern none so finished,
 * unpatterned B.zw stays byte-identical to the pre-pattern wire. */
export const SURFACE_PATTERN_WIRE_AXIS_RADIX = 16_384;
export const SURFACE_PATTERN_WIRE_KIND_RADIX = 65_536;

export const CLASSIC_SURFACE_MATERIAL: ResolvedSurfaceMaterial = {
  finish: CLASSIC_SURFACE_FINISH,
  pattern: { kind: "none", axis: "y", scale: 1, strength: 0 },
};

/**
 * Resolve one slot's full material. `optics` is passed through
 * `resolveSurfaceOptics` against the CALLER's derived radius — the session's
 * `visibleBoundingRadius` (full, unsliced in 4D), never re-derived here, so
 * every slot of a session normalizes against the same base. `undefined`
 * optics, or optics whose model is not admitted, resolves to no optics at
 * all; a non-finite/non-positive derived radius throws only when some slot
 * actually authors an admitted model.
 */
export function resolveSurfaceMaterial(
  finish: SurfaceFinish | undefined,
  pattern: SurfacePattern | undefined,
  optics?: SurfaceOptics,
  derivedRadius?: number,
): ResolvedSurfaceMaterial {
  const resolvedOptics =
    optics === undefined
      ? undefined
      : resolveSurfaceOptics(optics, derivedRadius as number);
  if (resolvedOptics === undefined) {
    return {
      finish: resolveSurfaceFinish(finish),
      pattern: resolveSurfacePattern(pattern),
    };
  }
  return {
    finish: resolveSurfaceFinish(finish),
    pattern: resolveSurfacePattern(pattern),
    optics: resolvedOptics,
  };
}

export function surfaceMaterialUsesFinish(
  material: ResolvedSurfaceMaterial,
): boolean {
  return !isClassicSurfaceFinish(material.finish);
}

export function surfaceMaterialUsesPattern(
  material: ResolvedSurfaceMaterial,
): boolean {
  return material.pattern.kind !== "none";
}

/** The optical-model gate: this slot's transform authors an admitted optical
 * model. The zero-transmission rule's document-side predicate — no slot
 * resolves optics, no session constructs a transport scene. */
export function surfaceMaterialUsesOptics(
  material: ResolvedSurfaceMaterial,
): boolean {
  return material.optics !== undefined;
}

/**
 * Whether the shared surface shade pass can observe a soft-shadow sample.
 *
 * The parameterized finish formula has exactly two shadow-dependent terms:
 * diffuse is multiplied by `(1 - ambient) * (1 - metalness)`, and the
 * specular lobe is multiplied by each slot's resolved `specular`. Returning
 * false only when both coefficients are literal zero in every reachable slot
 * lets both renderers set their existing shadow-step budget to zero without
 * changing a pixel. Classic or pattern-only materials deliberately keep the
 * old budget because their fixed-lighting path still has a specular lobe.
 */
export function surfaceMaterialsNeedShadow(
  ambient: number,
  materials: SurfaceMaterialSlots | null,
): boolean {
  if (materials?.finish !== true) return true;
  return materials.slots.some(
    (material) =>
      material.finish.specular !== 0 ||
      (ambient !== 1 && material.finish.metalness !== 1),
  );
}

/**
 * Whether object shading can observe ambient-occlusion probes. AO appears
 * only in the diffuse body's `ambient * (1 - metalness)` coefficient. The
 * fixed path may therefore omit it only at ambient 0; the parameterized path
 * may also omit it when every reachable slot is literally pure metal.
 */
export function surfaceMaterialsNeedAo(
  ambient: number,
  materials: SurfaceMaterialSlots | null,
): boolean {
  if (ambient === 0) return false;
  return (
    materials?.finish !== true ||
    materials.slots.some((material) => material.finish.metalness !== 1)
  );
}

/** Encode family + axis + the canonical four-decimal strength quantum into
 * B.z using arithmetic that stays integer-exact after a Float32Array upload.
 * The shader twins decode with floor/subtraction and divide the recovered
 * strength integer by 10000.0 (division, not multiplication by a pre-rounded
 * 0.0001 literal, so both dialects reach the correctly rounded float32). */
export function encodeSurfacePatternConfig(
  pattern: ResolvedSurfacePattern,
): number {
  if (pattern.kind === "none") return 0;
  const kind = SURFACE_PATTERN_KIND_WIRE_ID[pattern.kind];
  const axis = SURFACE_PATTERN_AXIS_WIRE_ID[pattern.axis];
  const strength = Number.isFinite(pattern.strength)
    ? Math.max(0, Math.min(1, pattern.strength))
    : 0;
  const strengthQ = Math.round(strength * SURFACE_PATTERN_WIRE_STRENGTH_STEPS);
  return Math.fround(
    kind * SURFACE_PATTERN_WIRE_KIND_RADIX +
      axis * SURFACE_PATTERN_WIRE_AXIS_RADIX +
      strengthQ,
  );
}

/** Host oracle for the GLSL/WGSL arithmetic. Invalid/non-canonical words
 * resolve to none, matching the document resolver's total fallback. `scale`
 * is B.w and deliberately does not participate in the compact code. */
export function decodeSurfacePatternConfig(
  config: number,
  scale: number,
): ResolvedSurfacePattern {
  const word = Math.fround(config);
  if (!Number.isFinite(word) || word === 0 || word !== Math.floor(word)) {
    return CLASSIC_SURFACE_MATERIAL.pattern;
  }
  const kindId = Math.floor(word / SURFACE_PATTERN_WIRE_KIND_RADIX);
  const kindBase = kindId * SURFACE_PATTERN_WIRE_KIND_RADIX;
  const axisId = Math.floor(
    (word - kindBase) / SURFACE_PATTERN_WIRE_AXIS_RADIX,
  );
  const strengthQ = word - kindBase - axisId * SURFACE_PATTERN_WIRE_AXIS_RADIX;
  const kind = surfacePatternKindFromWireId(kindId);
  if (
    kind === "none" ||
    axisId < 0 ||
    axisId > 2 ||
    strengthQ < 0 ||
    strengthQ > SURFACE_PATTERN_WIRE_STRENGTH_STEPS
  ) {
    return CLASSIC_SURFACE_MATERIAL.pattern;
  }
  return {
    kind,
    axis: surfacePatternAxisFromWireId(axisId),
    scale: Number.isFinite(scale) ? scale : 1,
    strength: strengthQ / SURFACE_PATTERN_WIRE_STRENGTH_STEPS,
  };
}

/** The ONE A/B lane authority shared by both GLSL tracers and WGSL
 * shadeMaps: A=(specular, shininess, metalness, reflect),
 * B=(transmit, reflectionTint, patternConfig, scale). Pattern none writes
 * literal zeros to B.zw, preserving the old finish-only bytes. */
export function surfaceMaterialLanes(
  material: ResolvedSurfaceMaterial,
): SurfaceMaterialLanes {
  const { finish, pattern } = material;
  const patterned = pattern.kind !== "none";
  return {
    a: [finish.specular, finish.shininess, finish.metalness, finish.reflect],
    b: [
      finish.transmit,
      finish.reflectionTint,
      patterned ? encodeSurfacePatternConfig(pattern) : 0,
      patterned ? pattern.scale : 0,
    ],
  };
}

/**
 * The OPTICAL transport lanes for one slot — the packed form of the slot's
 * resolved dielectric material, the data the transport backends read per
 * boundary event's `materialSlot` attribution. Frozen NOW (the persistence
 * task) so both backends adopt one layout and no offset ever moves: the
 * lanes ride a dedicated append-only storage buffer (`opticsMaps`, TWO vec4s
 * per slot, laid out exactly as here) that arrives with the first backend —
 * NOT inside `shadeMaps`, whose stride stays keyed on finish|pattern and
 * whose bytes this feature never touches.
 *
 * Lane 0 = (ior, radius, absorption.r, absorption.g); lane 1 =
 * (absorption.b, distortion, reserved, reserved). The distortion word is
 * the restrained virtual slab's thickness multiplier (zero = the straight
 * state byte-identically); the two remaining reserved words belong to
 * future approved fields — appends inside the frozen stride, never a
 * relayout. `null` when the slot resolves no optics: the whole buffer is
 * then absent (zero-stride pad, like the maps packers), the classic
 * route's exact bytes.
 */
export function surfaceMaterialOpticsLanes(
  material: ResolvedSurfaceMaterial,
): [[number, number, number, number], [number, number, number, number]] | null {
  const optics = material.optics;
  if (!optics) return null;
  return [
    [optics.ior, optics.radius, optics.absorption[0], optics.absorption[1]],
    [optics.absorption[2], optics.distortion, 0, 0],
  ];
}
