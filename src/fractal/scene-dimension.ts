/**
 * The SCENE's dimensionality: the one derivation that decides whether a
 * document's Surface subject — and the 4D rotor/slice view that poses it —
 * is 3D or native 4D.
 *
 * Three subjects exist. Absent a subject block, the subject is the
 * transform system and its dimensionality is `affine4.ts`'s
 * `systemPartsAreNonFlat` (the maps, the enabled final lens and the
 * kaleidoscope). A present sphere-inversion block (`sphere-inversion.ts`'s
 * authored form) REPLACES the transform system as the Surface subject, and
 * its arrangement's registry dimension decides — the block's own dimension,
 * not the preserved transforms'. A block whose arrangement id names no
 * registry entry (absent, unknown, not a string) names no dimension; the
 * scene then keeps the transform system's, since the block routes nowhere
 * and its refusal note says why. A block refused for any OTHER reason still
 * names its dimension (`sphereInversionAuthoredDimension` reads only the
 * arrangement), so repairing that reason never flips the scene. A present
 * Menger-carve block (`menger-twist.ts`'s authored form) is the second
 * subject block, checked AFTER the sphere-inversion one (the derivation's
 * shipped precedence order): its own `w` extension decides
 * (`mengerTwistAuthoredDimension`), refused blocks included, for the same
 * repair-never-flips reason. A present sphairahedron block
 * (`sphairahedron.ts`'s authored form) is the third, checked after both —
 * the same order `deriveSurfaceEligibility` branches in — and its family
 * field decides (`sphairahedronAuthoredDimension`), refused blocks
 * included, for the same reason.
 *
 * Points routes through here too: a present sphere-inversion block replaces
 * the chaos game with `sphere-inversion-sample.ts`'s exact boundary
 * sampler, so the Points request's `fourD` is the block's dimension. (A
 * Menger block currently leaves Points on the transforms' chaos game — the
 * carve family's Points decision is disclosed beside its panel section.)
 *
 * WHAT DOES NOT ROUTE THROUGH HERE, BY DECISION: the Flame and Solid workers
 * and the transform edit guards. Flame and Solid REFUSE a document carrying a
 * block (no representation draws the same set), and the transform system the
 * guards protect is preserved but not drawn, so their engines keep following
 * the transforms' own flatness — the 3D engine cannot run a non-flat system
 * (`chaos-game.ts`'s `symmetryRotation` throws on a w-plane). `state.ts`'s
 * `displayedIsNonFlat` is the panel's bridge: the scene's dimension in Surface
 * and Points, the transforms' in Flame and Solid.
 */
import { systemPartsAreNonFlat } from "./affine4";
import { sphereInversionAuthoredDimension } from "./sphere-inversion";
import type { SphereInversionAuthored } from "./sphere-inversion";
import {
  mengerTwistAuthoredDimension,
  type MengerTwistAuthored,
} from "./menger-twist";
import {
  sphairahedronAuthoredDimension,
  type SphairahedronAuthored,
} from "./sphairahedron";
import type { SymmetryParams, Transform } from "./types";

/**
 * The Menger-carve block's dimension verdict for the SCENE derivation, or
 * null when the value names no block at all (absent, or not the plain
 * object the authored form is — garbage rides decode's drop, but the
 * crossover's verbatim carriers make the guard cheap). A present block
 * REPLACES the transform system as the subject, so its own `w` extension
 * decides the scene's dimension exactly as a sphere-inversion block's
 * arrangement registry does — including a REFUSED block, whose dimension
 * is still named by its w fields so repairing the refusal never flips the
 * scene.
 */
function mengerTwistSceneDimension(
  mengerTwist: MengerTwistAuthored | null | undefined,
): 3 | 4 | null {
  if (
    typeof mengerTwist !== "object" ||
    mengerTwist === null ||
    Array.isArray(mengerTwist)
  ) {
    return null;
  }
  return mengerTwistAuthoredDimension(mengerTwist);
}

/**
 * The sphairahedron block's dimension verdict for the SCENE derivation, or
 * null when the value names no block at all — the Menger helper's shape one
 * family over, reading only the family field.
 */
function sphairahedronSceneDimension(
  sphairahedron: SphairahedronAuthored | null | undefined,
): 3 | 4 | null {
  if (
    typeof sphairahedron !== "object" ||
    sphairahedron === null ||
    Array.isArray(sphairahedron)
  ) {
    return null;
  }
  return sphairahedronAuthoredDimension(sphairahedron);
}

/** Whether the scene's Surface subject is native 4D (module doc). */
export function scenePartsAreNonFlat(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  sphereInversion: SphereInversionAuthored | null | undefined,
  mengerTwist?: MengerTwistAuthored | null,
  sphairahedron?: SphairahedronAuthored | null,
): boolean {
  if (sphereInversion !== null && sphereInversion !== undefined) {
    const dim = sphereInversionAuthoredDimension(sphereInversion);
    if (dim !== null) return dim === 4;
  }
  if (mengerTwist !== null && mengerTwist !== undefined) {
    const dim = mengerTwistSceneDimension(mengerTwist);
    if (dim !== null) return dim === 4;
  }
  if (sphairahedron !== null && sphairahedron !== undefined) {
    const dim = sphairahedronSceneDimension(sphairahedron);
    if (dim !== null) return dim === 4;
  }
  return systemPartsAreNonFlat(transforms, finalTransform, symmetry);
}
