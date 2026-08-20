import type { SurfaceFinish } from "./types";
import { clamp } from "./vec";

/**
 * The MEANING of {@link SurfaceFinish} — `variations.ts`'s
 * {@link import("./variations").resolveFoldRadii} role, one feature over.
 * Pure, dependency-free: this module owns the ONE "absent means classic"
 * definition and the resolver's domain, so nothing else may re-derive
 * either.
 *
 * Classic values ARE today's hardcoded Blinn-Phong shading constants — the
 * formula Surface mode's tracers ran before this field existed — so
 * resolving an absent (or absent-field) finish reproduces that formula
 * exactly. That is the resolver/persist split: `persist.ts` encodes/decodes
 * for FIDELITY only (no coercion, no clamp — an out-of-domain but finite
 * authored value survives the wire untouched), and this module alone owns
 * the DOMAIN a resolved value is read through. {@link isClassicSurfaceFinish}
 * is what will let a later slice gate "does this document need the
 * parameterized shader path at all" the same way
 * `variations.ts`'s `isClassicFoldRadii` gates the fold branch's shared
 * classic entry.
 */

/** A finish's five fields, resolved: never absent, never non-finite, and
 * always in the domain {@link resolveSurfaceFinish} enforces. */
export interface ResolvedSurfaceFinish {
  specular: number;
  shininess: number;
  metalness: number;
  reflect: number;
  transmit: number;
}

/** The classic hardcoded values — today's Blinn-Phong formula, run
 * whenever a document authors no `finish` at all — shared so a caller can
 * compare a resolved finish against the default set by identity rather than
 * by re-typing five numbers. */
export const CLASSIC_SURFACE_FINISH: ResolvedSurfaceFinish = {
  specular: 0.4,
  shininess: 32,
  metalness: 0,
  reflect: 0,
  transmit: 0,
};

/**
 * Smallest legal `shininess`: strictly above 0, `pow`'s domain — GLSL
 * `pow(0.0, 0.0)` is undefined, and a zero-or-negative exponent breaks the
 * highlight's own semantics (it should narrow monotonically as the exponent
 * grows, never invert). A FLOOR rather than a fallback to the classic 32 —
 * unlike a non-finite input, an authored near-zero value is a deliberate
 * "almost matte" request and should read as one, not snap back to the
 * default highlight.
 */
export const SURFACE_FINISH_SHININESS_FLOOR = 0.01;

/**
 * A transform's finish, with absent and out-of-domain values resolved — THE
 * ONE PLACE the "absent means classic" rule from {@link SurfaceFinish} is
 * written down. Total: every input, including `undefined` itself, resolves
 * to a finite, in-domain value; this function never throws.
 *
 * The domain it enforces, field by field:
 * - Each field absent OR non-finite resolves to its
 *   {@link CLASSIC_SURFACE_FINISH} value — `persist.ts` already drops
 *   non-finite values on decode, but the resolver stays total on its own
 *   input regardless, exactly as `variations.ts`'s `resolveFoldRadii` does
 *   for the fold's three lengths.
 * - `specular` clamps to `>= 0` only — no ceiling; an overdriven highlight
 *   past the classic 0.4 is legal authoring.
 * - `shininess` floors at {@link SURFACE_FINISH_SHININESS_FLOOR}, strictly
 *   above zero, and is otherwise unbounded above.
 * - `metalness`/`reflect`/`transmit` clamp into `[0, 1]`, their own authored
 *   span (see each field's doc on {@link SurfaceFinish}).
 */
export function resolveSurfaceFinish(
  finish: SurfaceFinish | undefined,
): ResolvedSurfaceFinish {
  const specular = Number.isFinite(finish?.specular)
    ? Math.max(0, finish?.specular as number)
    : CLASSIC_SURFACE_FINISH.specular;
  const shininess = Number.isFinite(finish?.shininess)
    ? Math.max(SURFACE_FINISH_SHININESS_FLOOR, finish?.shininess as number)
    : CLASSIC_SURFACE_FINISH.shininess;
  const metalness = Number.isFinite(finish?.metalness)
    ? clamp(finish?.metalness as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.metalness;
  const reflect = Number.isFinite(finish?.reflect)
    ? clamp(finish?.reflect as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.reflect;
  const transmit = Number.isFinite(finish?.transmit)
    ? clamp(finish?.transmit as number, 0, 1)
    : CLASSIC_SURFACE_FINISH.transmit;
  return { specular, shininess, metalness, reflect, transmit };
}

/**
 * Are these the classic values — i.e. does this finish shade exactly as it
 * did before the field existed? Resolves `finish` and compares every field
 * against {@link CLASSIC_SURFACE_FINISH}, so this is true when `finish` is
 * absent (resolving it produces the classic set by definition), when every
 * present field was explicitly authored at its own classic value, and when
 * a present field is non-finite (it resolves classic too) — false only when
 * some field genuinely RESOLVES away from classic. This predicate is what
 * will drive a later slice's shader-compile gate: a classic-resolving
 * document must compile literally today's program text, mirroring
 * `variations.ts`'s `isClassicFoldRadii` one feature over.
 */
export function isClassicSurfaceFinish(
  finish: SurfaceFinish | undefined,
): boolean {
  const r = resolveSurfaceFinish(finish);
  return (
    r.specular === CLASSIC_SURFACE_FINISH.specular &&
    r.shininess === CLASSIC_SURFACE_FINISH.shininess &&
    r.metalness === CLASSIC_SURFACE_FINISH.metalness &&
    r.reflect === CLASSIC_SURFACE_FINISH.reflect &&
    r.transmit === CLASSIC_SURFACE_FINISH.transmit
  );
}
