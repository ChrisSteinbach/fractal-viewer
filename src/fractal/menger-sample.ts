/**
 * The twisted mod-Menger carve family's Points sampler — the rejection
 * boundary sample of the construction's own carved surface, the
 * sphere-inversion family's boundary-sampler role one family over (a
 * present block replaces the chaos game as the cloud's subject, so the
 * explorer needs SOME draw of the set; the carve is not an IFS and has no
 * attractor to chaos-game). The decision and its figures are
 * `docs/twisted-menger-family.md`'s Points section.
 *
 * THE SAMPLER. Draw a uniform point in the construction's own box
 * (`[-1,1]³` / `[-1,1]⁴`), evaluate the certified carve DE
 * (`estimateMengerDistance`/`4`), and keep the point when it sits inside
 * the SHELL `|DE| <= MENGER_SAMPLE_SHELL` around the surface — the set
 * boundary is exactly where the DE vanishes (the box contributes its own
 * walls at every setting, so — unlike the escape chains — the family has
 * no empty-set hole for this to fall into). Per-point cost is one or two
 * dozen DE evaluations (measured acceptance in the harness sheet), each
 * `levels * ~30` flops, so the sampler is cheap against the chaos game's
 * own per-point cost; {@link MENGER_POINTS_MAX} caps the worst subject at
 * the sphere-inversion family's own two-seconds-of-worker-time class.
 *
 * THE COLOR SLOT is the winning carve level — the same per-level channel
 * the surface trap carries (`mengerTrap`), read through the sampler's own
 * chain so a point's level and its position can never disagree.
 * `transformIndices` carry the level index (one slot per level, NOT the
 * document's placeholder transforms — `generationCount`'s exact
 * convention), and "By Transform" colors read the level palette.
 *
 * THE 4D HALF samples the hyper-Menger's boundary IN R⁴ and hands the
 * points to the standard 4D projection path (the explorer's own rotor +
 * w-ramp machinery) — no slice of its own, the projection being the
 * display; the project-then-invert rule is a balloon concern and Points
 * never balloons the carve (the route refuses it).
 */
import { estimateMengerDistance, mengerTrap, type MengerDE } from "./menger-de";
import {
  estimateMengerDistance4,
  mengerTrap4,
  type MengerDE4,
} from "./menger-de-4d";
import type { Vec3, Vec4 } from "./types";
import type { Rng } from "./rng";

/** The boundary shell's half-width in box units: wider than a level-8
 * bar's own width (1/6561), narrow enough that the surface reads as a
 * surface rather than a fog. The harness sheet's acceptance figures are
 * measured against this value. */
export const MENGER_SAMPLE_SHELL = 0.012;

/** Cap samples one draw may reject before the draw gives up — the
 * sphere-inversion sampler's own bounded-draw rule; a subject that
 * rejects this hard has a measure-zero shell and draws nothing. */
export const MENGER_SAMPLE_CAP_ATTEMPTS = 4096;

/**
 * The most boundary samples one Points cloud draws, whatever the
 * document's point count asks — the sphere-inversion family's own cap,
 * the same two-seconds-of-worker-time class (the carve's per-draw cost
 * is comparable to one inversion walk).
 */
export const MENGER_POINTS_MAX = 500_000;

export interface MengerCloud3 {
  count: number;
  positions: Float32Array;
  /** The winning carve level per point — the color slot. */
  levels: Uint8Array;
}

export interface MengerCloud4 {
  count: number;
  positions: Float32Array;
  /** The fourth coordinate per point, in world w. */
  w: Float32Array;
  /** The winning carve level per point — the color slot. */
  levels: Uint8Array;
}

/** Sample the 3D construction's boundary. Deterministic in (de, count,
 * rng) — the chaos game's own reproducibility contract. */
export function sampleMengerCloud(
  de: MengerDE,
  count: number,
  rng: Rng,
): MengerCloud3 {
  const positions = new Float32Array(count * 3);
  const levels = new Uint8Array(count);
  let placed = 0;
  let rejects = 0;
  while (placed < count) {
    const p: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
    const d = estimateMengerDistance(de, p);
    if (-MENGER_SAMPLE_SHELL <= d && d <= MENGER_SAMPLE_SHELL) {
      positions[placed * 3] = p[0];
      positions[placed * 3 + 1] = p[1];
      positions[placed * 3 + 2] = p[2];
      levels[placed] = Math.round(mengerTrap(de, p) * (de.levels - 1));
      placed++;
      rejects = 0;
    } else if (++rejects > MENGER_SAMPLE_CAP_ATTEMPTS) {
      break;
    }
  }
  return { count: placed, positions, levels };
}

/** Sample the 4D construction's boundary, in R⁴ (module doc). */
export function sampleMengerCloud4(
  de: MengerDE4,
  count: number,
  rng: Rng,
): MengerCloud4 {
  const positions = new Float32Array(count * 3);
  const w = new Float32Array(count);
  const levels = new Uint8Array(count);
  let placed = 0;
  let rejects = 0;
  while (placed < count) {
    const p: Vec4 = [
      rng() * 2 - 1,
      rng() * 2 - 1,
      rng() * 2 - 1,
      rng() * 2 - 1,
    ];
    const d = estimateMengerDistance4(de, p);
    if (-MENGER_SAMPLE_SHELL <= d && d <= MENGER_SAMPLE_SHELL) {
      positions[placed * 3] = p[0];
      positions[placed * 3 + 1] = p[1];
      positions[placed * 3 + 2] = p[2];
      w[placed] = p[3];
      // The winning level index, read back through the oracle's own
      // fraction (round trips exactly: fraction = level/(levels-1)).
      levels[placed] =
        Math.round(mengerTrap4(de, p) * Math.max(de.levels - 1, 0)) % 256;
      placed++;
      rejects = 0;
    } else if (++rejects > MENGER_SAMPLE_CAP_ATTEMPTS) {
      break;
    }
  }
  return { count: placed, positions, w, levels };
}
