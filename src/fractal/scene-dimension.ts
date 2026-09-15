/**
 * The SCENE's dimensionality: the one derivation that decides whether a
 * document's Surface subject — and the 4D rotor/slice view that poses it —
 * is 3D or native 4D.
 *
 * Two subjects exist. Absent a sphere-inversion block, the subject is the
 * transform system and its dimensionality is `affine4.ts`'s
 * `systemPartsAreNonFlat` (the maps, the enabled final lens and the
 * kaleidoscope). A present block (`sphere-inversion.ts`'s authored form)
 * REPLACES the transform system as the Surface subject, and its
 * arrangement's registry dimension decides — the block's own dimension, not
 * the preserved transforms'. A block whose arrangement id names no registry
 * entry (absent, unknown, not a string) names no dimension; the scene then
 * keeps the transform system's, since the block routes nowhere and its
 * refusal note says why. A block refused for any OTHER reason still names its
 * dimension (`sphereInversionAuthoredDimension` reads only the arrangement),
 * so repairing that reason never flips the scene.
 *
 * WHAT DOES NOT ROUTE THROUGH HERE, BY DECISION: the IFS renderers' engine
 * choice (the Points chaos game, the Flame and Solid workers, their edit
 * guards). Until the family has a Points/Flame/Solid representation, those
 * modes draw the PRESERVED transforms, and their engine must follow the
 * transforms' own flatness — the 3D engine cannot run a non-flat system
 * (`chaos-game.ts`'s `symmetryRotation` throws on a w-plane). `state.ts`'s
 * `displayedIsNonFlat` is the panel's bridge: the scene's dimension while
 * Surface shows the subject, the transforms' elsewhere.
 */
import { systemPartsAreNonFlat } from "./affine4";
import { sphereInversionAuthoredDimension } from "./sphere-inversion";
import type { SphereInversionAuthored } from "./sphere-inversion";
import type { SymmetryParams, Transform } from "./types";

/** Whether the scene's Surface subject is native 4D (module doc). */
export function scenePartsAreNonFlat(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  sphereInversion: SphereInversionAuthored | null | undefined,
): boolean {
  if (sphereInversion !== null && sphereInversion !== undefined) {
    const dim = sphereInversionAuthoredDimension(sphereInversion);
    if (dim !== null) return dim === 4;
  }
  return systemPartsAreNonFlat(transforms, finalTransform, symmetry);
}
