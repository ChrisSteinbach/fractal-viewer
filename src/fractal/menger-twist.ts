/**
 * The twisted mod-Menger family's ONE shared vocabulary, imported by both
 * estimator twins (`menger-de.ts`, `menger-de-4d.ts`) under the twin-file
 * convention (`escape-de-4d.ts`'s rule): what a construction IS has one
 * definition across both dimensions, and only the estimators' vector
 * arithmetic is duplicated.
 *
 * THE OBJECT. The classic mod-based Menger carve SDF — a box with the
 * three axis bars removed at every level of a 3-by recursion — with a
 * fixed rigid "twist" applied to the QUERY POINT between carve levels:
 * at each level the coordinate is first mapped `q <- R(q + b)` (a fixed
 * rotation about the origin and a fixed offset), then the level's
 * sawtooth fold and bar carve read the TWISTED coordinate. The
 * construction — and its README image "Menger Sponge with rotation
 * applied to point p" — is KentaYoshii/Raymarcher's `sdMengerSponge`
 * (`resources/raymarch.frag`), whose `ma` is a constant ~53.13°
 * rotation about Y and whose animated `off` is this block's offset.
 *
 * NOT AN IFS, and no per-map rotation is a substitute (the
 * `twistedSponge` presets carry that verdict): the level-m carve pattern
 * is the standard pattern rotated by the FULL accumulated `R^m`, with
 * every rotation sitting outside the child compositions, and since `R`
 * does not commute with the child translations no finite composition of
 * per-map transforms closes over the set. The family renders only
 * through its own single-chain estimator.
 *
 * SOUNDNESS. Every carve term is measured in the twisted frame, but
 * `q <- R(q + b)` is an isometry of R^n, so each level's term is the true
 * world distance from `p` to the level-m removed pattern (whose open
 * interior the set avoids) — the running max over levels is therefore a
 * genuine lower bound on the distance to the set at EVERY twist, and the
 * term the untwisted construction is known exact for keeps that exactness
 * level by level. The estimator twins carry the argument's arithmetic;
 * `menger-de.test.ts`/`menger-de-4d.test.ts` pin it against membership.
 *
 * THE BLOCK REPLACES THE TRANSFORM SYSTEM as the scene's subject, exactly
 * per the `sphereInversion` precedent (`scene-dimension.ts`): the
 * document's transforms become a flat placeholder, and the block's own
 * `w` extension decides the scene's dimension — absent or trivial means
 * the 3D sponge, a non-trivial `w` rotation or offset means the 4D
 * hyper-Menger (the same rule one axis up: cells with two or more middle
 * coordinates among four are removed, the 48-survivor rule
 * `hyperMengerSpongeTransforms` already encodes for the IFS).
 *
 * RESOLVER DISCIPLINE is the sphere-inversion one: out-of-domain values
 * and unknown keys are REFUSED with reasons, never clamped, and the
 * resolver never mutates its input, so a caller can keep the authored
 * block byte for byte and show the refusal beside it. Defaults fill
 * absent fields: the repo's own construction (4 levels, the ~53.13° Y
 * rotation, no offset — the pure twist), so an empty block names THE
 * twisted sponge and not something quieter.
 */
import type { Rotation4, Vec3 } from "./types";

/**
 * Carve-depth ceiling. Each level triples the lattice; 8 leaves every
 * per-eval cost trivial and the eighth-level bars far below any marcher's
 * pixel footprint. The repo's shader runs 4 and its README image is a
 * 4-level frame; deeper levels are authored, not defaulted.
 */
export const MENGER_TWIST_MAX_LEVELS = 8;

/**
 * The default twist: KentaYoshii/Raymarcher's `ma` matrix. GLSL fills a
 * `mat3` column-major, so their
 * `mat3(0.60,0.00,0.80, 0.00,1.00,0.00, -0.80,0.00,0.60)` is the rotation
 * taking `(1,0,0)` to `(0.60, 0, 0.80)` — a `-53.13°` rotation about Y in
 * our Euler-XYZ convention, exact to the matrix's two decimal places
 * (`atan2(0.8, 0.6)`). The animated offset stays OUT of the default: the
 * pure twist is the construction, and richer offsets are authored (the
 * repo animates its `off` between them).
 */
export const MENGER_TWIST_DEFAULTS = Object.freeze({
  levels: 4,
  rotation: Object.freeze([0, -0.9272952180016122, 0]),
  offset: Object.freeze([0, 0, 0]),
});

/** The authored form, as persisted. Every field optional; unknown keys
 * refuse. The `w` extension mirrors `Transform.w`'s convention: presence
 * with a non-trivial value lifts the construction to the 4D hyper-Menger
 * and turns the scene's dimension with it (`mengerTwistAuthoredDimension`). */
export interface MengerTwistAuthored {
  /** Carve depth: an integer in `[1, MENGER_TWIST_MAX_LEVELS]`. */
  levels?: number;
  /** The twist's 3D Euler angles in radians (XYZ order, `affine.ts`'s
   * convention), applied at EVERY level. */
  rotation?: Vec3;
  /** The per-level offset added BEFORE the rotation — the repo's scalar
   * `off` broadcast to all three axes is `offset = [k, k, k]`. */
  offset?: Vec3;
  /** The 4D lift: plane rotations composed after the 3D Euler part and a
   * fourth offset component. Any non-trivial value makes the construction
   * the 4D hyper-Menger. */
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
export const MENGER_TWIST_AUTHORED_FIELDS: readonly string[] = Object.freeze([
  "levels",
  "rotation",
  "offset",
  "w",
]);
export const MENGER_TWIST_W_FIELDS: readonly string[] = Object.freeze([
  "rotation",
  "offset",
]);

/** The resolved construction the estimator twins read. The 3D fields are
 * always filled (defaults included); the w fields are filled with the
 * trivial twist when absent, so a consumer never branches on presence —
 * only {@link mengerTwistAuthoredDimension}'s verdict matters for
 * routing. */
export interface MengerTwistConstruction {
  dim: 3 | 4;
  levels: number;
  rotation: Vec3;
  offset: Vec3;
  rotation4: Rotation4;
  offsetW: number;
}

export type MengerTwistResolution =
  | { ok: true; construction: MengerTwistConstruction }
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

/** Whether the authored `w` extension is present and non-trivial — the
 * same presence-and-nonzero rule `affine4.ts`'s flatness tests use, so a
 * round-tripped `w: {}` or all-zero block stays 3D. */
export function mengerTwistAuthoredDimension(
  authored: MengerTwistAuthored,
): 3 | 4 {
  const w = authored.w;
  if (!isPlainObject(w)) return 3;
  const rotation: unknown = w.rotation;
  if (isPlainObject(rotation)) {
    for (const angle of Object.values(rotation)) {
      if (typeof angle === "number" && Number.isFinite(angle) && angle !== 0) {
        return 4;
      }
    }
  }
  const offset = w.offset;
  if (typeof offset === "number" && Number.isFinite(offset) && offset !== 0) {
    return 4;
  }
  return 3;
}

/**
 * Expand the authored block into the resolved construction. Refuses, never
 * clamps: an out-of-range level count or a non-finite twist would render a
 * different object than the document names. Never mutates its input.
 */
export function resolveMengerTwist(
  authored: MengerTwistAuthored,
): MengerTwistResolution {
  // The plain-object check runs on an `unknown` COPY (the sphere-inversion
  // resolver's trick): narrowing the typed parameter itself would intersect
  // it with `Record<string, unknown>` and collapse the tuple-typed fields
  // to `{} | null` at every spread below.
  const block: unknown = authored;
  if (!isPlainObject(block)) {
    return { ok: false, reasons: ["the menger-twist block is not an object"] };
  }
  const reasons: string[] = [];
  for (const key of Object.keys(authored)) {
    if (!MENGER_TWIST_AUTHORED_FIELDS.includes(key)) {
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
        if (!MENGER_TWIST_W_FIELDS.includes(key)) {
          reasons.push(
            `unknown w field "${key}" (not readable by this version)`,
          );
        }
      }
    }
  }

  let levels: number = MENGER_TWIST_DEFAULTS.levels;
  if (authored.levels !== undefined) {
    const v = authored.levels;
    if (typeof v !== "number" || !Number.isInteger(v)) {
      reasons.push("levels is not an integer");
    } else if (v < 1 || v > MENGER_TWIST_MAX_LEVELS) {
      reasons.push(`levels ${v} is outside [1, ${MENGER_TWIST_MAX_LEVELS}]`);
    } else {
      levels = v;
    }
  }

  let rotation: Vec3 = [...MENGER_TWIST_DEFAULTS.rotation] as Vec3;
  if (authored.rotation !== undefined) {
    if (isFiniteVector(authored.rotation, 3)) {
      rotation = [...authored.rotation] as Vec3;
    } else {
      reasons.push("rotation is not three finite numbers");
    }
  }

  let offset: Vec3 = [...MENGER_TWIST_DEFAULTS.offset] as Vec3;
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
  return {
    ok: true,
    construction: {
      dim: mengerTwistAuthoredDimension(authored),
      levels,
      rotation,
      offset,
      rotation4,
      offsetW,
    },
  };
}
