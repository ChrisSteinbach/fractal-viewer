/**
 * The twisted mod-Menger family's vocabulary — the authored block with its
 * carve-depth ceiling and its family defaults, resolved through the SHARED
 * twist vocabulary (`twist.ts`): the authored semantics, the validation
 * body and the matrix composition have ONE definition both families read
 * (the escape-time chain is the second), and only the Menger-specific
 * parts — the level count, the reference-construction defaults, the
 * dimension verdict — live here. Imported by both estimator twins
 * (`menger-de.ts`, `menger-de-4d.ts`) under the twin-file convention
 * (`escape-de-4d.ts`'s rule): what a construction IS has one definition
 * across both dimensions, and only the estimators' vector arithmetic is
 * duplicated.
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
 * twisted sponge and not something quieter. The rotation default is the
 * FAMILY's: the shared vocabulary's own neutral default is the identity,
 * and this family pre-fills its reference construction before resolving.
 */
import {
  resolveTwistFields,
  twistWIsNonTrivial,
  TWIST_AUTHORED_FIELDS,
} from "./twist";
import type { TwistAuthored, TwistConstruction } from "./twist";
import type { Vec3 } from "./types";

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
 * repo animates its `off` between them). The offset default is the shared
 * vocabulary's own neutral one (zero), stated here so the family's
 * "defaults are the reference construction" reads in one place.
 */
export const MENGER_TWIST_DEFAULTS = Object.freeze({
  levels: 4,
  rotation: Object.freeze([0, -0.9272952180016122, 0]),
  offset: Object.freeze([0, 0, 0]),
});

/** The authored form, as persisted — the SHARED twist block
 * (`twist.ts`'s `TwistAuthored`) plus this family's carve depth. Every
 * field optional; unknown keys refuse. The `w` extension mirrors
 * `Transform.w`'s convention: presence with a non-trivial value lifts the
 * construction to the 4D hyper-Menger and turns the scene's dimension
 * with it (`mengerTwistAuthoredDimension`). */
export interface MengerTwistAuthored extends TwistAuthored {
  /** Carve depth: an integer in `[1, MENGER_TWIST_MAX_LEVELS]`. */
  levels?: number;
}

/** Every field the authored form defines — the shared block's fields plus
 * `levels`. Any other key is REFUSED as unknown: a document written by a
 * newer version may name a field this version cannot read, and ignoring
 * it would render a different object than the document names. */
export const MENGER_TWIST_AUTHORED_FIELDS: readonly string[] = Object.freeze([
  ...TWIST_AUTHORED_FIELDS,
  "levels",
]);
export const MENGER_TWIST_W_FIELDS: readonly string[] = Object.freeze([
  "rotation",
  "offset",
]);

/** The resolved construction the estimator twins read — the shared twist
 * fields plus the family's level count and dimension verdict. The 3D
 * fields are always filled (defaults included); the w fields are filled
 * with the trivial twist when absent, so a consumer never branches on
 * presence — only {@link mengerTwistAuthoredDimension}'s verdict matters
 * for routing. */
export type MengerTwistConstruction = TwistConstruction & {
  dim: 3 | 4;
  levels: number;
};

export type MengerTwistResolution =
  | { ok: true; construction: MengerTwistConstruction }
  | { ok: false; reasons: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Whether the authored `w` extension is present and non-trivial — the
 * same presence-and-nonzero rule `affine4.ts`'s flatness tests use, so a
 * round-tripped `w: {}` or all-zero block stays 3D. The shared
 * vocabulary's own check, under this family's name. */
export function mengerTwistAuthoredDimension(
  authored: MengerTwistAuthored,
): 3 | 4 {
  return twistWIsNonTrivial(authored) ? 4 : 3;
}

/**
 * Expand the authored block into the resolved construction. Refuses,
 * never clamps: an out-of-range level count or a non-finite twist would
 * render a different object than the document names. Never mutates its
 * input. The twist fields resolve through the SHARED validation body
 * (`twist.ts`'s `resolveTwistFields`) with this family's extended field
 * list, and the family's reference-construction rotation default pre-fills
 * an absent one.
 */
export function resolveMengerTwist(
  authored: MengerTwistAuthored,
): MengerTwistResolution {
  if (!isPlainObject(authored)) {
    return { ok: false, reasons: ["the menger-twist block is not an object"] };
  }
  const reasons: string[] = [];

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

  const resolution = resolveTwistFields(authored, MENGER_TWIST_AUTHORED_FIELDS);
  if (!resolution.ok) {
    return { ok: false, reasons: [...reasons, ...resolution.reasons] };
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const twist = resolution.twist;
  return {
    ok: true,
    construction: {
      ...twist,
      rotation:
        authored.rotation === undefined
          ? ([...MENGER_TWIST_DEFAULTS.rotation] as Vec3)
          : twist.rotation,
      dim: mengerTwistAuthoredDimension(authored),
      levels,
    },
  };
}
