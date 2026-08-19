/**
 * Shared measurement profiles for the surface-DE harnesses.
 *
 * `countingDE` (the machine-independent inverse-map-VISIT counter) and the
 * four pure-fold system factories (`foldBoxfoldPair`,
 * `foldBoxfoldNegPlusAffine`, `foldSpherefoldPair`, `foldMandelboxPair`)
 * were born in `surface-beam.harness.ts`'s pure-fold section (4). They are
 * extracted here VERBATIM — not reimplemented — so `surface-grid-cost.
 * harness.ts` can reuse the IDENTICAL frozen profiles instead of
 * drifting a second copy: a harness comparing costs across two files is
 * only meaningful if both measure the same systems with the same counter.
 * `countingDEFine` (a follow-up to EXPERIMENT 2's cost split) is
 * `countingDE`'s
 * element-granularity twin, added later, purely additively — `countingDE`
 * itself is untouched, so every existing caller's numbers are unaffected;
 * see its own doc for why per-visit counting is too coarse for the
 * branch-and-bound work.
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
  // Spread first, then re-define invM as the counting getter (later literal
  // members win): every data field — INCLUDING ones added to SurfaceDEMap
  // after this file was written — passes through untouched. An explicit
  // field list here once silently dropped the branch-and-bound's new bound
  // fields (scripts/ sits outside the root tsconfig's include, so tsc never
  // caught it) and fed `undefined` into the descent.
  const maps = de.maps.map((m): SurfaceDEMap => ({
    ...m,
    get invM() {
      counter.n++;
      return m.invM;
    },
  }));
  return { de: { ...de, maps, beamWidth }, counter };
}

/** Wrap a plain 3x3 `invM` array so every NUMERIC-INDEX element read
 * (`im[0]` through `im[8]`) bumps `counter.n` — the element-granularity
 * twin of {@link countingDE}'s per-VISIT counter, for measuring work that
 * counter cannot see (a follow-up to EXPERIMENT 2's cost split, for the
 * branch-and-bound work).
 *
 * Must wrap the ARRAY the getter returns, not (only) the map object:
 * `descendFold` (`surface-de.ts`) hoists `const im = map.invM` ONCE per
 * (chain, sector, map) VISIT and then indexes `im[0]..im[8]` once per
 * BRANCH TRANSFORM inside that visit — up to 81 times for a mandelbox map,
 * confirmed against `descendFold`'s own body (`ix = im[0]*cx + im[1]*cy +
 * im[2]*cz + it[0]; ...`, one triple of reads per axis, three axes, once
 * per branch). A property-read counter on `invM` sees only the one hoist;
 * a future branch-and-bound prune (moving the floor-vs-best test AHEAD of
 * this transform, brief §3.1) would skip transforms WITHIN a visit without
 * changing the visit count at all, so only an element-level counter can see
 * it move. Non-numeric access (`.length`, iteration, `Symbol.iterator`,
 * etc.) passes through uncounted via `Reflect.get` — the estimators never
 * touch `invM` that way, but a `get`-only Proxy handler is safe regardless:
 * every other internal method falls back to the target by spec. */
function wrapInvMElementCounter(
  invM: number[],
  counter: { n: number },
): number[] {
  return new Proxy(invM, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        counter.n++;
      }
      // A Proxy `get` trap must pass through EVERY property read (numeric
      // elements, `.length`, `.map`, `Symbol.iterator`, ...), so its return
      // is `any` by the lib's own ProxyHandler.get signature -- no narrower
      // honest type exists to assert here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * {@link countingDE}'s element-granularity twin: both the visit counter AND
 * the fine element counter off ONE march, so callers needing the fine
 * number don't pay for a second run of the system (the visit counter rides
 * along for a direct cross-check against {@link countingDE}'s own numbers —
 * it increments identically, since the property getter below still bumps
 * it exactly once per `invM` read, before returning the proxied array).
 *
 * One Proxy per map, built ONCE (not per visit): so identity-sensitive code
 * sees the SAME `invM` reference on every read, matching production (where
 * `map.invM` is a fixed array every visit reads), and so the Proxy's own
 * construction cost is paid once per system rather than once per visit.
 *
 * `fineCounter.n / 9` is "transforms applied": every full inverse-affine
 * application — the affine ladder's single child, or one of a fold
 * branch's candidates — reads all nine `im[i]` elements exactly once (see
 * {@link wrapInvMElementCounter}'s doc for the confirmed line citation), so
 * dividing by 9 recovers a transform count directly comparable across the
 * affine and fold paths, and finer than {@link countingDE}'s per-visit
 * "apps".
 */
export function countingDEFine(
  de: SurfaceDE,
  beamWidth: 1 | 2 | 3 | 4,
): {
  de: SurfaceDE;
  counter: { n: number };
  fineCounter: { n: number };
} {
  const counter = { n: 0 };
  const fineCounter = { n: 0 };
  // Spread-then-override, exactly like countingDE above (and for the same
  // hard-won reason — see its comment): only invM is replaced, every
  // other field flows through as the production build made it.
  const maps = de.maps.map((m): SurfaceDEMap => {
    const proxiedInvM = wrapInvMElementCounter(m.invM, fineCounter);
    return {
      ...m,
      get invM() {
        counter.n++;
        return proxiedInvM;
      },
    };
  });
  return { de: { ...de, maps, beamWidth }, counter, fineCounter };
}

// -----------------------------------------------------------------------
// PURE-FOLD SYSTEMS. Every map below carries exactly ONE active
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
