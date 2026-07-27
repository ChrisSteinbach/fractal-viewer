/**
 * Shared measurement profiles for the surface-DE harnesses.
 *
 * `countingDE` (the machine-independent inverse-map-visit counter) and the
 * four pure-fold system factories (`foldBoxfoldPair`,
 * `foldBoxfoldNegPlusAffine`, `foldSpherefoldPair`, `foldMandelboxPair`)
 * were born in `surface-beam.harness.ts`'s fr-5rvk section (4). They are
 * extracted here VERBATIM — not reimplemented — so `surface-grid-cost.
 * harness.ts` (fr-aj4w) can reuse the IDENTICAL frozen profiles instead of
 * drifting a second copy: a harness comparing costs across two files is
 * only meaningful if both measure the same systems with the same counter.
 *
 * This file is deliberately not named `*.harness.ts`: it carries no
 * `describe`/`it` blocks of its own, so importing it (from either harness,
 * or from a `src/fractal/*.test.ts` regression test) never registers extra
 * suites and never pulls the harness config's 900s timeout into a normal
 * `npm test` run.
 */
import type { SurfaceDE, SurfaceDEMap } from "../src/fractal/surface-de";
import type { Transform } from "../src/fractal/types";

/** Wrap a DE's maps so every `invM` read (one per inverse-affine
 * application in the estimators) bumps a counter — cost measured on the
 * SHIPPED estimator, not a copy. */
export function countingDE(
  de: SurfaceDE,
  beamWidth: 1 | 2 | 3 | 4,
): {
  de: SurfaceDE;
  counter: { n: number };
} {
  const counter = { n: 0 };
  const maps = de.maps.map((m): SurfaceDEMap => ({
    invT: m.invT,
    sigmaMin: m.sigmaMin,
    foldKind: m.foldKind,
    foldInvW: m.foldInvW,
    foldSigma: m.foldSigma,
    baseIndex: m.baseIndex,
    get invM() {
      counter.n++;
      return m.invM;
    },
  }));
  return { de: { ...de, maps, beamWidth }, counter };
}

// -----------------------------------------------------------------------
// fr-5rvk: PURE-FOLD SYSTEMS. Every map below carries exactly ONE active
// fold-family variation and nothing else, which is what makes it a genuine
// composition `T = w.V(M p + t)` the descent can decompose into branches
// (a BLENDED list is a weighted sum — no branch decomposition exists, so
// blends stay ineligible; the shipped `mandelboxLattice` preset is one).
// Profiles chosen to cover the three branch counts and both weight signs:
// isometric boxfold branches (27), the spherefold's query-dependent mid
// inversion (3), the mandelbox composite (81), a negative fold weight, a
// fold-plus-plain-affine mix, and a kaleidoscope-swept fold pair.
// -----------------------------------------------------------------------

/** Both maps pure `boxfold`: 27 branches each, every one a reflection +
 * translation isometry (sigma_c = 1). Mirrors the surface-de test suite's
 * `pureBoxfoldPair`. */
export function foldBoxfoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** A NEGATIVE-weight boxfold map beside a plain affine map: exercises the
 * `dist(q, w.X) = |w|.dist(q/w, X)` sign absorption (both folds are odd)
 * and the mixed frontier, where fold branches and single affine children
 * compete in the same candidate stream. */
export function foldBoxfoldNegPlusAffine(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, 0, 0.2],
      rotation: [0.1, 0, 0.4],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: -0.8 }],
    },
    {
      id: 1,
      position: [-0.4, 0.3, -0.1],
      rotation: [0.2, 0.3, 0],
      scale: [0.4, 0.4, 0.4],
    },
  ];
}

/** Both maps pure `spherefold`: only 3 branches, but one of them is the
 * unit-sphere inversion whose escape-defeating expansion is what the region
 * floors exist to tame — the hardest void-false-hit profile in the set. */
export function foldSpherefoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0.2, -0.1],
      rotation: [0.4, 0.1, 0.2],
      scale: [0.24, 0.24, 0.24],
      variations: [{ type: "spherefold", weight: 0.9 }],
    },
    {
      id: 1,
      position: [-0.3, -0.4, 0.25],
      rotation: [0, 0.6, 0.3],
      scale: [0.2, 0.2, 0.2],
      variations: [{ type: "spherefold", weight: 1.1 }],
    },
  ];
}

/** Both maps pure `mandelbox` (`sphereFold . boxFold`): the widest branch
 * count in the family, 81 per map — the frontier's cost worst case. */
export function foldMandelboxPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.45, 0.25, 0.1],
      rotation: [0.2, 0.4, 0],
      scale: [0.2, 0.2, 0.2],
      variations: [{ type: "mandelbox", weight: 1.1 }],
    },
    {
      id: 1,
      position: [-0.4, -0.15, -0.3],
      rotation: [0.5, 0, 0.25],
      scale: [0.22, 0.22, 0.22],
      variations: [{ type: "mandelbox", weight: 0.9 }],
    },
  ];
}
