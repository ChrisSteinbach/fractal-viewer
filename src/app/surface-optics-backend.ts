import { shapeMeshIds } from "../fractal/shapes";
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
 * options take. */
export type SurfaceOpticsBackend = "estimator" | "closedSolid";

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
  // it exactly like the fold-final lens above.
  if (de.final) return false;
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

/**
 * The routing answer: `"closedSolid"` when the session's optics wire is
 * live and the composition admits the backend, `"estimator"` otherwise —
 * the absent path's meaning, byte-identically. `materials?.optics` is the
 * wire gate this decision sits behind; without it nothing consumes a
 * backend and the answer is inert.
 */
export function surfaceOpticsBackend(
  materials: { optics: boolean } | null | undefined,
  de: SurfaceDE | SurfaceDE4,
  composition: { balloon?: boolean; tiling?: boolean },
  pose4?: Surface4OpticsPose | null,
): SurfaceOpticsBackend {
  if (!materials?.optics) return "estimator";
  return surfaceClosedSolidAdmitted(de, composition, pose4)
    ? "closedSolid"
    : "estimator";
}
