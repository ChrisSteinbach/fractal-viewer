import { shapeMeshIds } from "../fractal/shapes";
import { transformHasEmitter, systemHasChaos } from "../fractal/chaos-game";
import { composeAffine, isIdentityAffine } from "../fractal/affine";
import {
  SPHERE_INVERSION_DEFAULTS,
  sphereInversionAuthorsOptics,
} from "../fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "../fractal/sphere-inversion";
import type { Transform } from "../fractal/types";
import type { SurfaceDE } from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";

/**
 * The app-side decision for the optical transport's boundary backend —
 * `surface-compute.ts`'s `opticsBackend` create option and the GLSL twins'
 * `surfaceFragmentFor`/`surface4FragmentFor` backend parameter, ONE answer
 * for every engine and both dimensions.
 *
 * The backends' codegen refusals (the kernel's and both resolvers' identical
 * lists) police compositions the signed field cannot follow, but they throw
 * at compile time — a caller that passed `closedSolid` for an unqualified
 * session would fail the whole renderer create and fall back or exit, not
 * render classic. This predicate is the same refusal list evaluated BEFORE
 * the create, so routing can select the resolving backend only where the
 * qualified composition holds and keep the estimator backend — the disclosed
 * vacuous state — everywhere else. It mirrors the codegen's own checks term
 * for term; when the two disagree, the codegen throw is the backstop and
 * this predicate is the bug.
 *
 * THE QUALIFIED SHAPE. The closed-solid field is the condensation union at
 * the root (`docs/surface-dielectric-transport.md`'s closed-solid section),
 * so the backend resolves only where the DISPLAYED object is exactly that
 * union: emitter-only C0 (no recursive maps — with maps the field describes
 * only the root term, and every path through the IFS part refuses
 * `state-mismatch`), no graph-directed selection, no hybrid schedule, no
 * fold-final lens, no tiling, no balloon, and no mesh-bearing emitter shape
 * (the mesh lattice's interior band is not a certified stepping bound).
 *
 * THE 4D POSE ADMISSION. The 4D field is the intrinsic solid plus the
 * shape flat's distance as a penalty (`sigmaMin·sd + |local w|`): exact —
 * the penalty vanishing identically — only where the displayed slice
 * CARRIES every member's flat, the canonical composition. The routing
 * therefore admits the backend in 4D only for a session whose pose at
 * entry satisfies it exactly: zero slab thickness, a w-preserving rotor,
 * and w-untouched member poses whose flat lies IN the slice — members at
 * one common world `w` with the slice on it (w0 = that value), the
 * w0 = 0 lift included. The rotor/slice are LIVE per-frame state —
 * scrubbing the slice or turning a w-plane rotor mid-session moves the
 * displayed object off the composition the field describes, and the
 * transport degrades to its own honest refusals (unresolved work, never
 * an invented interior); the panel's optics restriction note discloses
 * that coupling. The 3D arm has no pose and admits on the static
 * composition alone.
 */

/** The optical transport's boundary backend — `surface-dielectric-transport.md`'s
 * `opticsBackend` vocabulary, the same string both engines' create/codegen
 * options take. `"finiteSolid"` is COMPUTE-ONLY (the finite cores have no
 * fragment mirror, the escape4 verdict one family over): the GLSL material
 * stamp must never receive it — the finite session exits with a toast on a
 * compute loss rather than falling back to a WebGL tracer that would draw
 * the attractor. `"sphereInversion"` is COMPUTE-ONLY for the same reason
 * ({@link sphereInversionGlassAdmission}): the family's 3D fragment arm draws
 * the set opaque, so a glass session never falls back to it. */
export type SurfaceOpticsBackend =
  "estimator" | "closedSolid" | "finiteSolid" | "sphereInversion";

/** A 4D session's pose at entry — `SurfaceGpu4View`'s own three fields, the
 * values the app packs into every frame's params (the rotor row-major 4x4,
 * the world slice position, the slab half-extent). */
export interface Surface4OpticsPose {
  rotor: readonly number[];
  w0: number;
  sliceHalfW: number;
}

/** Epsilon for the w-coupling checks: a composed rotation matrix whose
 * planes avoid w carries exact zeros in the w row/column; any coupling
 * (an xw/yw/zw turn, a w shear) leaves entries at least ~sin(angle) —
 * no rounding regime sits between. */
const W_COUPLE_EPS = 1e-9;

/** Is the row-major 4x4 `m` w-preserving: w maps to ±w and nothing feeds
 * into w — the composed rotor's planes both avoid the w axis. */
function rotorPreservesW(m: readonly number[]): boolean {
  if (m.length !== 16) return false;
  // Column 3 (rows 0..2) and row 3 (columns 0..2) must vanish; the w
  // diagonal must be unit magnitude.
  const coupling =
    Math.abs(m[3]) +
    Math.abs(m[7]) +
    Math.abs(m[11]) +
    Math.abs(m[12]) +
    Math.abs(m[13]) +
    Math.abs(m[14]);
  return coupling <= W_COUPLE_EPS && Math.abs(Math.abs(m[15]) - 1) <= 1e-6;
}

/** Is the row-major 4x4 inverse member map w-untouched: no xyz↔w mixing,
 * so a member's flat {local w = 0} lifts to a hyperplane parallel to the
 * displayed one. The w diagonal (any nonzero w scale) is allowed — the
 * penalty form reads local w = 0 on the flat regardless of its scale. */
function memberMapPreservesW(m: readonly number[]): boolean {
  if (m.length !== 16) return false;
  const coupling =
    Math.abs(m[3]) +
    Math.abs(m[7]) +
    Math.abs(m[11]) +
    Math.abs(m[12]) +
    Math.abs(m[13]) +
    Math.abs(m[14]);
  return coupling <= W_COUPLE_EPS && Math.abs(m[15]) > W_COUPLE_EPS;
}

/** Does the displayed slice carry this member's flat? For a w-untouched
 * inverse map, the member's local w on the slice reduces to
 * `invM[15]·w0 + invT[3]` — a constant, the signed w distance from the
 * slice hyperplane to the flat (scaled by the member's inverse w scale).
 * The penalty form vanishes identically on the whole slice exactly when
 * this is zero, which is the canonical composition's own statement; the
 * epsilon is far below the transport's crossing scale for any
 * admissible radius, so the residue cannot optically matter. */
function memberFlatInSlice(
  invM: readonly number[],
  invT: readonly number[],
  w0: number,
): boolean {
  return Math.abs(invM[15] * w0 + invT[3]) <= W_COUPLE_EPS * (1 + Math.abs(w0));
}

/** Does this final transform's prologue apply nothing? The descents warp
 * the query by the final's inverse before the condensation term, so a
 * PRESENT final makes the displayed object not-the-union — unless it is
 * the value-exact identity (an enabled lens nobody moved: the UI mints
 * one at the identity, and refusing it would strip the glass from a
 * scene that is optically exact). Identity means invM is the identity to
 * rounding, the translation zero, and the sigma scale one. */
function finalIsIdentity(final: {
  invM: readonly number[];
  invT: readonly number[];
  sigmaMin: number;
}): boolean {
  const n = final.invM.length === 16 ? 4 : final.invM.length === 9 ? 3 : 0;
  if (n === 0) return false;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const target = r === c ? 1 : 0;
      if (Math.abs(final.invM[r * n + c] - target) > W_COUPLE_EPS) {
        return false;
      }
    }
  }
  for (const t of final.invT) {
    if (Math.abs(t) > W_COUPLE_EPS) return false;
  }
  return Math.abs(final.sigmaMin - 1) <= W_COUPLE_EPS;
}

/**
 * Whether this session's composition admits the closed-solid backend.
 * Mirrors the codegen refusal list (both engines, both dimensions) plus the
 * two qualifications the codegen cannot see: the emitter-only shape of the
 * signed field, and — `pose4` given — the canonical 4D pose. Pure, so the
 * routing decision is testable without a device.
 */
export function surfaceClosedSolidAdmitted(
  de: SurfaceDE | SurfaceDE4,
  composition: { balloon?: boolean; tiling?: boolean },
  pose4?: Surface4OpticsPose | null,
): boolean {
  // The signed field IS the condensation union — no emitters, no field.
  const emitters = de.condensation?.emitters ?? [];
  if (emitters.length === 0) return false;
  // Emitter-only C0: with maps the displayed union includes the recursive
  // IFS part the root term does not describe.
  if (de.maps.length > 0) return false;
  // The codegen's own composition refusals.
  if (de.chaos) return false;
  if (de.schedule) return false;
  if (de.foldFinal) return false;
  // A plain-affine FINAL transform warps the query before the descent's
  // condensation term (the prologue both descents apply), and the signed
  // field is the bare root term — a final-transform session's displayed
  // object is not the union the field describes, so the backend refuses
  // it exactly like the fold-final lens above. The value-exact IDENTITY
  // final (an enabled lens nobody moved) applies nothing and admits.
  if (de.final && !finalIsIdentity(de.final)) return false;
  if (composition.tiling) return false;
  if (composition.balloon) return false;
  // Mesh-bearing emitter shapes refuse (the mesh lattice's interior band
  // is not a certified stepping bound).
  for (const emitter of emitters) {
    if (shapeMeshIds(emitter.shape).length > 0) return false;
  }
  // The 4D canonical-pose admission: exact where the displayed slice
  // carries every flat.
  if (pose4) {
    if (pose4.sliceHalfW !== 0) return false;
    if (!rotorPreservesW(pose4.rotor)) return false;
    for (const emitter of emitters) {
      if (!memberMapPreservesW(emitter.invM)) return false;
      if (!memberFlatInSlice(emitter.invM, emitter.invT, pose4.w0)) {
        return false;
      }
    }
  }
  return true;
}

/** Which side of the transmission boundary a document sits on, as the
 * panel's optics note states it BEFORE any Surface session exists —
 * {@link surfaceClosedSolidAdmitted}'s composition terms evaluated at the
 * DOCUMENT level (the session predicate stays the authority at entry; this
 * is its authoring-time voice, and a disagreement between the two is a bug
 * in this mirror). `"finite-cells"` is the finiteSolid route's backend by
 * construction; `"closed-solid"` is the emitter-only C0 family, with
 * `sliceCoupled` naming the 4D route's live-pose coupling the document
 * cannot prove (the saved pose passes at entry, but scrubbing the slice or
 * turning a w-plane rotor mid-session moves the object off the composition
 * the field describes). Everything else — forward routes, sphere
 * inversion's replaced subject, mixed maps and emitters, and every
 * composition refusal — keeps the classic finish, the estimator backend's
 * disclosed vacuous state on IFS geometry. */
export type SurfaceOpticsOutlook =
  | { resolves: "finite-cells" }
  | { resolves: "closed-solid"; sliceCoupled: boolean }
  | { resolves: false };

/** The document facts the outlook reads — all scene state, no session. */
export interface SurfaceOpticsDocumentView {
  transforms: readonly Transform[];
  finalTransform: Transform | null | undefined;
  schedulePresent: boolean;
  tilingPresent: boolean;
  balloonOn: boolean;
}

export function surfaceOpticsOutlook(
  routeKind: string | null,
  view: SurfaceOpticsDocumentView,
): SurfaceOpticsOutlook {
  if (routeKind === "finiteSolid" || routeKind === "finiteSolid4") {
    return { resolves: "finite-cells" };
  }
  if (routeKind !== "ifs" && routeKind !== "ifs4") {
    return { resolves: false };
  }
  // The closed-solid family's document terms, mirroring
  // surfaceClosedSolidAdmitted term for term: the codegen refusals first,
  // then the emitter-only C0 shape of the signed field.
  if (view.schedulePresent) return { resolves: false };
  if (systemHasChaos(view.transforms)) return { resolves: false };
  if (view.tilingPresent) return { resolves: false };
  if (view.balloonOn) return { resolves: false };
  const active = view.transforms.filter((t) => (t.weight ?? 1) > 0);
  if (active.length === 0) return { resolves: false };
  if (active.some((t) => !transformHasEmitter(t))) return { resolves: false };
  // Mesh-bearing emitter shapes refuse (the mesh lattice's interior band
  // is not a certified stepping bound — the DE-level predicate's own term).
  for (const emitter of active) {
    if (emitter.emitter && shapeMeshIds(emitter.emitter).length > 0) {
      return { resolves: false };
    }
  }
  // A final the descent warps the query by is the DE-level predicate's
  // `de.final` refusal; the exact identity (the enabled lens nobody moved)
  // admits. Any authored variation or live post makes the final a real
  // warp, so the mirror refuses it — conservative in the direction that
  // never promises resolution the session would not deliver.
  const final = view.finalTransform;
  if (final) {
    if ((final.variations?.length ?? 0) > 0) return { resolves: false };
    if (final.post !== undefined && !isIdentityAffine(final.post)) {
      return { resolves: false };
    }
    if (!isIdentityAffine(composeAffine(final))) return { resolves: false };
  }
  return { resolves: "closed-solid", sliceCoupled: routeKind === "ifs4" };
}

// ------------------------------------------------ the sphere-inversion arm

/** The seed kinds whose glass the look gate RENDERED (the pearls are balls,
 * the lace is a shell). The signed field is sound for a cut shell too — its
 * argument never reads the seed kind — but no glass panel of one was ever
 * reviewed, and admission is a look decision as well as a soundness one. */
export const SPHERE_INVERSION_GLASS_SEED_KINDS: readonly string[] =
  Object.freeze(["ball", "shell"]);

/** The deepest depth the look gate swept (1–8): 1–3 clean glass, 4 speckle,
 * 6–8 lace, every one resolving. Deeper is unreviewed and costlier. */
export const SPHERE_INVERSION_GLASS_MAX_DEPTH = 8;

/** Why a sphere-inversion block that authors glass renders opaque instead,
 * or `null` when it resolves (and `undefined` when it authors no glass). */
export type SphereInversionGlassAdmission =
  { admitted: true } | { admitted: false; reason: string };

/**
 * THE ROUTING ADMISSION for the sphere-inversion glass backend — the ONE
 * decision both the session door (main.ts, once per start) and the panel's
 * restriction note read, so they cannot disagree. `undefined` when the block
 * authors no optical material (the classic route; nothing to admit).
 *
 * The family's own conditions, NOT the condensation backend's:
 *
 *   - Seed kind and depth: the band the look gate reviewed
 *     ({@link SPHERE_INVERSION_GLASS_SEED_KINDS},
 *     {@link SPHERE_INVERSION_GLASS_MAX_DEPTH}) and nothing wider.
 *     The ARRANGEMENT is not restricted for the look — the field's
 *     soundness argument never reads it, the signed tests span
 *     oct6/cube8/ico12 and cell24/cross8/tess16, and the look is set by
 *     seed and depth (pearls versus lace). Nor is its generator COUNT any
 *     more: a single workgroup of 600-cell glass trace once outran the
 *     watchdog, and the transport's same-trace continuation
 *     (`SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS` processed paths per
 *     submission) bounds every submission instead, measured on the
 *     registry's largest arrangement (docs/sphere-inversion-family.md).
 *   - Compute: the backend is compute-only in both dimensions, so a missing
 *     adapter refuses glass (the gate refuses the SESSION — see
 *     `surface-eligibility.ts` — rather than silently rendering opaque).
 *   - The family's existing refusals (tiling, balloon, shape trap, slab)
 *     ride through unchanged: they refuse the whole session upstream, so a
 *     session that reaches this predicate already has none of them.
 *   - Dormant capabilities (kaleidoscope above order 1, the final lens) are
 *     NOT read by this subject, so they cannot move the solid the field
 *     describes and need no term here.
 *
 * 4D: NO POSE ADMISSION, and the verdict is stated rather than implied. The
 * object is intrinsically 4D and the slice cuts it; the field lifts the
 * displayed point through the live rotor/slice every query, exactly as the
 * primary march does, and a slice's clearance is at least the 4D clearance.
 * So scrubbing the slice or turning the rotor mid-session moves the
 * displayed object AND the field together — unlike the closed-solid
 * backend's flat penalty, nothing decouples. Zero slab thickness is the one
 * pose condition, and the family already holds it for every session.
 */
export function sphereInversionGlassAdmission(
  authored: SphereInversionAuthored,
  construction: Pick<SphereInversionConstruction, "depth">,
  computeAvailable: boolean,
): SphereInversionGlassAdmission | undefined {
  if (!sphereInversionAuthorsOptics(authored)) return undefined;
  if (!computeAvailable) {
    return {
      admitted: false,
      reason: "glass needs WebGPU compute, which is unavailable here",
    };
  }
  const kind = authored.seed?.kind ?? SPHERE_INVERSION_DEFAULTS.seedKind;
  if (!SPHERE_INVERSION_GLASS_SEED_KINDS.includes(kind)) {
    return {
      admitted: false,
      reason: "glass is available for ball and shell seeds",
    };
  }
  if (construction.depth > SPHERE_INVERSION_GLASS_MAX_DEPTH) {
    return {
      admitted: false,
      reason: `glass is available up to depth ${SPHERE_INVERSION_GLASS_MAX_DEPTH}`,
    };
  }
  return { admitted: true };
}
