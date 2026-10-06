/**
 * The rigid twist's ONE shared vocabulary — the authored block, its
 * resolver, and its matrix composition — imported by every family that
 * applies a fixed rigid twist between applications of its own recurrence.
 * Two consumers today: the twisted mod-Menger carve
 * (`menger-twist.ts`/`menger-de.ts`/`menger-de-4d.ts`, which applies it to
 * the carved coordinate at every level) and the escape-time chain
 * (`escape-de.ts`/`escape-de-4d.ts`, which applies it to the orbit point at
 * every link). ONE authored semantics, one resolved form, one composition
 * per dimension — two consumers is how a 3D system and its 4D lift, or two
 * families, end up rendering different objects from one document.
 *
 * THE SEMANTICS (the construction both families name): at each application
 * site the consumer's point is first mapped `q <- R(q + off)` — the offset
 * added BEFORE the rotation — and the family's own recurrence then reads
 * the twisted coordinate. "Rotation applied to the point" is the whole
 * content; each family decides what the sites are (carve levels, orbit
 * links) and what the recurrence is. Because `q <- R(q + off)` is an
 * ISOMETRY of R^n for every authored rotation and offset, every family's
 * soundness argument reduces to its untwisted one plus "the isometry
 * preserves the bound" — the property the certification tests pin.
 *
 * THE 4D LIFT is the Menger family's, shared rather than re-derived: the
 * authored 3D Euler rotation is embedded (upper-left block, `w` row/column
 * identity), the `w` plane rotations compose AFTER it
 * (`multiply4x4(planes, euler4)` — `affine4.ts`'s convention, so the
 * embedded upper-left 3x3 of the 4D matrix reproduces the 3D matrix when
 * the planes are trivial), and the offset gains its fourth component
 * `offW`. A consumer that cannot apply the `w` extension (a 3D-only
 * recurrence) must REFUSE a non-trivial one rather than drop it — a
 * dropped extension renders a different object than the document names.
 *
 * RESOLVER DISCIPLINE is the sphere-inversion one, inherited from the
 * Menger block this vocabulary was generalized from: out-of-domain values
 * and unknown keys are REFUSED with reasons, never clamped, and the
 * resolver never mutates its input, so a caller can keep the authored
 * block byte for byte and show the refusal beside it. Absent fields fill
 * with the NEUTRAL twist (identity rotation, zero offset, no planes) —
 * a family that wants richer defaults pre-fills them before resolving
 * (the Menger block's reference-construction default is exactly that).
 */
import { rotationMatrixXYZ } from "./affine";
import { multiply4x4, rotationMatrix4 } from "./affine4";
import type { Rotation4, Vec3, Vec4 } from "./types";

/**
 * The authored twist, as persisted. Every field optional; unknown keys
 * refuse. The `w` extension mirrors `Transform.w`'s convention: presence
 * with a non-trivial value is the twist's extra SO(4) degrees of freedom
 * and a fourth offset component, meaningful only to consumers whose
 * recurrence spans the fourth axis.
 */
export interface TwistAuthored {
  /** The twist's 3D Euler angles in radians (XYZ order, `affine.ts`'s
   * convention), applied at EVERY application site. */
  rotation?: Vec3;
  /** The per-site offset added BEFORE the rotation. */
  offset?: Vec3;
  /** The 4D lift: plane rotations composed after the 3D Euler part and a
   * fourth offset component. */
  w?: {
    /** Plane rotations (`affine4.ts`'s convention) — the twist's extra
     * SO(4) degrees of freedom. */
    rotation?: Rotation4;
    /** The fourth offset component. */
    offset?: number;
  };
}

/** Every field the authored form defines, top level and w. Any other key
 * is REFUSED as unknown: a document written by a newer version may name a
 * field this version cannot read, and ignoring it would render a
 * different object than the document names. */
export const TWIST_AUTHORED_FIELDS: readonly string[] = Object.freeze([
  "rotation",
  "offset",
  "w",
]);
export const TWIST_W_FIELDS: readonly string[] = Object.freeze([
  "rotation",
  "offset",
]);

/** The resolved twist the consumers read — every field filled (the neutral
 * twist when absent), so a consumer never branches on presence. */
export interface TwistConstruction {
  rotation: Vec3;
  offset: Vec3;
  rotation4: Rotation4;
  offsetW: number;
}

export type TwistResolution =
  | { ok: true; construction: TwistConstruction }
  | { ok: false; reasons: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteVector(v: unknown, n: number): boolean {
  return (
    Array.isArray(v) &&
    v.length === n &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/**
 * Whether the authored `w` extension is present and non-trivial — the
 * same presence-and-nonzero rule `affine4.ts`'s flatness tests use, so a
 * round-tripped `w: {}` or all-zero block is trivial. A consumer whose
 * recurrence cannot carry the fourth axis refuses on this.
 */
export function twistWIsNonTrivial(authored: TwistAuthored): boolean {
  const w = authored.w;
  if (!isPlainObject(w)) return false;
  const rotation: unknown = w.rotation;
  if (isPlainObject(rotation)) {
    for (const angle of Object.values(rotation)) {
      if (typeof angle === "number" && Number.isFinite(angle) && angle !== 0) {
        return true;
      }
    }
  }
  const offset = w.offset;
  if (typeof offset === "number" && Number.isFinite(offset) && offset !== 0) {
    return true;
  }
  return false;
}

/** Whether the resolved twist is the neutral one — identity rotation, zero
 * offset, no plane angles. A consumer treats this exactly as absence (its
 * per-site application is the identity, value-exactly), which is what
 * lets an authored-then-zeroed block collapse back to off. */
export function twistIsTrivial(construction: TwistConstruction): boolean {
  const rot4 = construction.rotation4;
  for (const angle of Object.values(rot4)) {
    if (typeof angle === "number" && angle !== 0) return false;
  }
  return (
    construction.rotation[0] === 0 &&
    construction.rotation[1] === 0 &&
    construction.rotation[2] === 0 &&
    construction.offset[0] === 0 &&
    construction.offset[1] === 0 &&
    construction.offset[2] === 0 &&
    construction.offsetW === 0
  );
}

/**
 * The validation body every family resolver shares — ONE authored
 * semantics parameterized only by which top-level fields the family's
 * block adds (the Menger adds `levels`). Refuses, never clamps: a
 * non-finite angle or an unknown key would render a different object than
 * the document names. Never mutates its input. The `w` vocabulary is the
 * same for every family, so only the top-level list is parameterized.
 */
export function resolveTwistFields(
  authored: TwistAuthored,
  topFields: readonly string[],
): { ok: true; twist: TwistConstruction } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  for (const key of Object.keys(authored)) {
    if (!topFields.includes(key)) {
      reasons.push(`unknown field "${key}" (not readable by this version)`);
    }
  }
  const rawW: unknown = authored.w;
  let wObject: Record<string, unknown> | undefined;
  if (rawW !== undefined) {
    if (!isPlainObject(rawW)) {
      reasons.push("w is not an object");
    } else {
      wObject = rawW;
      for (const key of Object.keys(rawW)) {
        if (!TWIST_W_FIELDS.includes(key)) {
          reasons.push(
            `unknown w field "${key}" (not readable by this version)`,
          );
        }
      }
    }
  }

  let rotation: Vec3 = [0, 0, 0];
  if (authored.rotation !== undefined) {
    if (isFiniteVector(authored.rotation, 3)) {
      rotation = [...authored.rotation] as Vec3;
    } else {
      reasons.push("rotation is not three finite numbers");
    }
  }

  let offset: Vec3 = [0, 0, 0];
  if (authored.offset !== undefined) {
    if (isFiniteVector(authored.offset, 3)) {
      offset = [...authored.offset] as Vec3;
    } else {
      reasons.push("offset is not three finite numbers");
    }
  }

  const rotation4: Rotation4 = {};
  let offsetW = 0;
  if (wObject !== undefined) {
    const rawWRot: unknown = wObject.rotation;
    if (rawWRot !== undefined) {
      if (!isPlainObject(rawWRot)) {
        reasons.push("w.rotation is not an object");
      } else {
        for (const plane of ["xy", "xz", "yz", "xw", "yw", "zw"] as const) {
          const angle: unknown = rawWRot[plane];
          if (angle === undefined) continue;
          if (typeof angle !== "number" || !Number.isFinite(angle)) {
            reasons.push(`w.rotation.${plane} is not a finite number`);
          } else {
            rotation4[plane] = angle;
          }
        }
        for (const key of Object.keys(rawWRot)) {
          if (!["xy", "xz", "yz", "xw", "yw", "zw"].includes(key)) {
            reasons.push(`unknown w.rotation plane "${key}"`);
          }
        }
      }
    }
    const rawWOff: unknown = wObject.offset;
    if (rawWOff !== undefined) {
      if (typeof rawWOff !== "number" || !Number.isFinite(rawWOff)) {
        reasons.push("w.offset is not a finite number");
      } else {
        offsetW = rawWOff;
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, twist: { rotation, offset, rotation4, offsetW } };
}

/**
 * Expand the authored block into the resolved twist. Refuses, never
 * clamps: a non-finite angle or an unknown key would render a different
 * object than the document names. Never mutates its input.
 */
export function resolveTwist(authored: TwistAuthored): TwistResolution {
  // The plain-object check runs on an `unknown` COPY (the sphere-inversion
  // resolver's trick): narrowing the typed parameter itself would intersect
  // it with `Record<string, unknown>` and collapse the tuple-typed fields
  // to `{} | null` at every spread below.
  if (!isPlainObject(authored)) {
    return { ok: false, reasons: ["the twist block is not an object"] };
  }
  const resolution = resolveTwistFields(authored, TWIST_AUTHORED_FIELDS);
  return resolution.ok
    ? { ok: true, construction: resolution.twist }
    : resolution;
}

/** The 3D twist's pre-composed wire: the row-major 3×3 the site map
 * applies and the offset in `q <- R q + b` form (`b = R·off`), so the
 * per-site work is one 9-term matrix and one add. */
export interface TwistMatrices3 {
  m: number[];
  b: Vec3;
}

export function twistMatrices3(
  construction: TwistConstruction,
): TwistMatrices3 {
  const m = rotationMatrixXYZ(
    construction.rotation[0],
    construction.rotation[1],
    construction.rotation[2],
  );
  const off = construction.offset;
  const b: Vec3 = [
    m[0] * off[0] + m[1] * off[1] + m[2] * off[2],
    m[3] * off[0] + m[4] * off[1] + m[5] * off[2],
    m[6] * off[0] + m[7] * off[1] + m[8] * off[2],
  ];
  return { m, b };
}

/** The 4D twist's pre-composed wire: the row-major 4×4 (the 3D Euler
 * rotation embedded, the authored w-plane rotations composed after it) and
 * the offset in `q <- R q + b` form over `[off, offW]`. */
export interface TwistMatrices4 {
  m: number[];
  b: Vec4;
}

export function twistMatrices4(
  construction: TwistConstruction,
): TwistMatrices4 {
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
  const m = multiply4x4(rotationMatrix4(construction.rotation4), euler4);
  const off4: Vec4 = [
    construction.offset[0],
    construction.offset[1],
    construction.offset[2],
    construction.offsetW,
  ];
  const b: Vec4 = [
    m[0] * off4[0] + m[1] * off4[1] + m[2] * off4[2] + m[3] * off4[3],
    m[4] * off4[0] + m[5] * off4[1] + m[6] * off4[2] + m[7] * off4[3],
    m[8] * off4[0] + m[9] * off4[1] + m[10] * off4[2] + m[11] * off4[3],
    m[12] * off4[0] + m[13] * off4[1] + m[14] * off4[2] + m[15] * off4[3],
  ];
  return { m, b };
}
