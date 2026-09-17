import { DIELECTRIC_ABSORPTION, DIELECTRIC_IOR } from "./surface-dielectric";
import { SURFACE_OPTICS_MODELS, type SurfaceOptics } from "./types";
import type { Vec3 } from "./types";

/**
 * The optical-model document vocabulary — `surface-pattern.ts`'s role one
 * material sibling over. The transport contract
 * (`docs/surface-dielectric-transport.md`) defines the dielectric model and
 * its ONE executable definition (`surface-dielectric.ts`); this module owns
 * the ONE "absent means classic" rule for the AUTHORED state that selects it,
 * so persistence, morphs, mutation and the material wire cannot re-derive
 * any of it.
 *
 * THE SELECTOR. `Transform.optics.model` — `"dielectric"` is the only
 * admitted model. Absence of the field is the classic state, byte-identically
 * to every document predating it: a legacy `finish.transmit` of .35 or .90
 * keeps rendering the thin-shell blend-toward-backdrop, and is NOT
 * reinterpreted as the dielectric model merely because a number is stored.
 * Opting in is the selector's own presence — a future "Glass"-style finish
 * bundle, when the panel task authors one, will SET this field through the
 * per-field write rule and never store the bundle's name.
 *
 * SCOPE. The optical material is PER-SLOT, keyed on the same
 * `baseIndex` slot list as finish and pattern (`surface-slots.ts`): one
 * transform's part of the attractor can be glass while another stays metal,
 * and the transport contract's boundary events already carry the backend's
 * `materialSlot` attribution to read it per hit. The optical normalization
 * radius BASE is SCENE-DERIVED, never authored: the session DE's
 * `visibleBoundingRadius` — the FULL unsliced radius in 4D, so the tint does
 * not pulse as the slice scrubs (the balloon ball's own rule). There is no
 * scene-wide authored optical state in this vocabulary.
 *
 * UNITS AND DEFAULTS. `scale` is the optical scale: a dimensionless
 * MULTIPLIER on the derived radius, not an absolute length, so it is
 * world-defined and stable under zoom, raster and rotor/slice motion. Absent
 * ⇒ 1 — exactly the qualified appearance (`DIELECTRIC_IOR`,
 * `DIELECTRIC_ABSORPTION`, the solid's own half extent). The resolver clamps
 * into {@link SURFACE_OPTICS_SCALE_FLOOR}..{@link SURFACE_OPTICS_SCALE_CEILING}:
 * below the floor the Beer tint saturates within 1% of the ball and reads
 * opaque; above the ceiling it is clear across the whole ball — both beyond
 * that are indistinguishable, and the clamp keeps the oracle's `radius > 0`
 * assertion satisfied for every resolved value.
 *
 * NOT AUTHORED (deliberately). IOR and the per-channel absorption ride the
 * qualified constants as defaults — the oracle takes them as parameters so
 * the qualified numbers ride in, and authoring them is a later, separately
 * reviewed decision. The restrained optical distortion IS in this vocabulary
 * now (one authored word: the virtual slab's thickness multiplier, absent ⇒
 * 0 = straight byte-identically; the transport contract's displaced rear
 * seam, qualified by the straight-vs-distorted panels), and the transport
 * lane's first reserved word carries it. Work and chunk budgets (processed
 * paths, interfaces, stack) stay OUT of material identity: they are the
 * runtime's, not the document's.
 *
 * FIDELITY SPLIT. As for finish and pattern: `persist.ts` encodes/decodes
 * for fidelity only (finite values survive the wire untouched, no clamp), and
 * this module alone owns the domain a resolved value is read through. A
 * document whose every optical field is absent-or-non-finite decodes to no
 * optics at all.
 */

/** The admitted optical models live on `types.ts` (`SURFACE_OPTICS_MODELS`,
 * the single source of truth); this module owns the resolver and the domain.
 * The scale band below is the one {@link SurfaceOptics} domain. */

/** Optical-scale domain: see the module doc's UNITS AND DEFAULTS. The
 * resolver clamps into this band; 1 (the qualified appearance) sits inside. */
export const SURFACE_OPTICS_SCALE_FLOOR = 0.01;
export const SURFACE_OPTICS_SCALE_CEILING = 100;

/**
 * Distortion domain: the virtual slab's thickness band as a multiplier of
 * the resolved optical radius. Zero is the STRAIGHT state (byte-identical —
 * the resolver's default), the ceiling keeps the lateral offset restrained
 * to a quarter of the optical ball (the displacement never exceeds the
 * authored slab — its smooth bound is tied to the thickness). The band is
 * qualified by the straight-vs-distorted panels; negative and non-finite
 * resolve to 0.
 */
export const SURFACE_OPTICS_DISTORTION_CEILING = 0.25;

/**
 * The per-slot optical material a backend consumes — the transport oracle's
 * own {@link import("./surface-dielectric").DielectricMaterial} shape by
 * construction (the type alias makes the two structurally ONE, so a backend
 * hands a resolved slot straight to `nextBoundary`'s material checks with no
 * adapter and no second material type to drift). `radius` is the RESOLVED
 * normalization radius: derived radius × the authored-or-default scale.
 */
export type ResolvedSurfaceOptics = {
  ior: number;
  absorption: Vec3;
  radius: number;
  /**
   * The resolved distortion: the authored-or-zero slab thickness multiplier
   * (the resolver's band above). Zero is the straight state, byte-identically.
   */
  distortion: number;
};

/**
 * Resolve one transform's optical state against the session's derived
 * optical radius — the ONE place the absent/unknown-means-classic rule is
 * written down. Total on the authored block: `undefined` when the field is
 * absent or the model is not in {@link SURFACE_OPTICS_MODELS} (a future
 * model id on an old binary means "no optics here", the same quiet fallback
 * the finish decoder's unknown-field rule gives); a non-finite `scale`
 * resolves to 1; an out-of-band finite `scale` clamps. The derived radius is
 * the one input this resolver does NOT synthesize: a non-finite or
 * non-positive value is a broken session, not an authoring choice, and
 * throws — the pattern calibration's own refusal shape. `ior`/`absorption`
 * always ride the qualified constants; `distortion` resolves through its
 * own band (absent/non-finite ⇒ 0 — the straight state byte-identically;
 * negative clamps to 0, past the ceiling clamps down — the resolver is the
 * ONE domain a resolved value is read through).
 */
export function resolveSurfaceOptics(
  optics: SurfaceOptics | undefined,
  derivedRadius: number,
): ResolvedSurfaceOptics | undefined {
  const model = optics?.model;
  if (model === undefined || !SURFACE_OPTICS_MODELS.some((m) => m === model)) {
    return undefined;
  }
  if (!Number.isFinite(derivedRadius) || !(derivedRadius > 0)) {
    throw new TypeError(
      "surface-optics: the derived optical radius must be finite and positive",
    );
  }
  const scale = Number.isFinite(optics?.scale)
    ? Math.min(
        SURFACE_OPTICS_SCALE_CEILING,
        Math.max(SURFACE_OPTICS_SCALE_FLOOR, optics?.scale as number),
      )
    : 1;
  const distortion = Number.isFinite(optics?.distortion)
    ? Math.min(
        SURFACE_OPTICS_DISTORTION_CEILING,
        Math.max(0, optics?.distortion as number),
      )
    : 0;
  return {
    ior: DIELECTRIC_IOR,
    absorption: [...DIELECTRIC_ABSORPTION] as Vec3,
    radius: derivedRadius * scale,
    distortion,
  };
}
