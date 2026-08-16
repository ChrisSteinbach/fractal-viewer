/**
 * How big is a rendered set, measured the one way that works (fr-azjk).
 *
 * Every sheet in the escape-time family wants the same two numbers: what
 * fraction of a ball a set fills, and how far out it reaches. Four harnesses
 * each grew their own copy of that measurement, and all four copies were
 * wrong in the same two ways. This module is the ONE definition they now
 * share, and it exists as a module rather than as a fifth copy because the
 * two defects are not obvious enough to be re-derived by whoever writes the
 * fifth sheet.
 *
 * DEFECT 1 — A REGULAR GRID DOES NOT MEASURE A FOLD SET'S VOLUME. A fold's
 * structure sits on the fold's own walls (`±1`, `±2`, the box limit and its
 * images), and a grid over `[-4, 4]` whose spacing divides those lands a
 * disproportionate share of its points exactly on them: the aligned
 * resolutions are exactly `n - 1` in {8, 16, 24, 32, 40, 48}. Measured on
 * `mandelboxClassic`, `n = 23..49` reads 4.54 / 9.33 / 3.44 / 4.63 / 3.60 /
 * 7.96 / 5.98 / 5.61% — a 2.72x spread with no convergence, every aligned
 * resolution high — where the sampler below reads 3.540 / 3.548 / 3.568% at
 * 4k / 64k / 128k. THIN sets only (a 22%-fill chain reads 22.4-22.9% at every
 * `n`), which is exactly why it is easy to miss: it bites only the rows a
 * blank-frame question is ever about.
 *
 * DEFECT 2, and it is the larger — A DISTANCE THRESHOLD IS NOT A MEMBERSHIP
 * ORACLE, IN EITHER DIRECTION. `de(p) < eps` asks "is the estimate small".
 * `escape-de.ts`'s {@link escapeSetContains} doc gives one direction: `|v|/dr`
 * goes small for a near-boundary ESCAPER too, whose `dr` has run away just as
 * far. The other direction is the one that actually bit: an orbit that floors
 * `dr` rarely (the rejected per-PASS chaining arm) keeps `dr` near 1 and
 * returns O(1) distances at points whose orbits never leave the ball — those
 * points ARE members and a threshold counts every one of them out. That is
 * what manufactured a phantom collapse in the record: 0.47% at one pre-scale
 * was a set filling 98% of its own bailout ball.
 *
 * So: SEEDED UNIFORM SAMPLE, MEMBERSHIP ORACLE. The caller supplies the
 * oracle, which is what lets one function serve the shipped orbit
 * (`escapeSetContains`), a harness-local prototype orbit, and a retired form
 * kept executable — one instrument, so two rows of a table differ by their
 * ORBIT and by nothing else.
 *
 * `scripts/hybrid-chain.harness.ts` carries the executable record: an `it()`
 * that measures both failure modes rather than asserting them, including the
 * aliased grid it replaced.
 *
 * NOT A VISIBILITY PREDICATE. Fill is VOLUME, and an escape-time set is
 * frequently a thin fractal with a large surface and no measurable volume —
 * the shipped `mandelboxRings` reads 0.000% here while drawing 44.9% of its
 * rays. `probeEscapeFill`'s doc carries the full warning; it applies verbatim
 * to everything below.
 */
import { mulberry32 } from "../src/fractal/rng";
import type { Vec3 } from "./de-preview";

/** Sample count the sheets measure at. Large because the thin rows are the
 * interesting ones: at 0.3% fill this is still ~400 hits, so two rows an
 * order of magnitude apart cannot be sampling noise. The sampler has plainly
 * converged well below it (three digits stable from 4k to 128k), so this is
 * headroom rather than a requirement. */
export const SET_SAMPLE_POINTS = 131072;

/** Fixed seed, so a given system always reports the same figure — the
 * `ESCAPE_PROBE_SEED` / `surface-de.ts` `PROBE_SEED` discipline, and the
 * same value `probeEscapeFill` uses so a sheet's column and the module's own
 * probe are literally one measurement. */
export const SET_SAMPLE_SEED = 0x5eed_e5ca;

export interface SetExtent {
  /** Percent of the ball of radius `fillRadius` whose points are MEMBERS. */
  fillPct: number;
  /** Largest radius at which a member was found, in world units. Sampled
   * over `scanRadius`, so a set that outgrew the radius it is supposed to sit
   * inside reads as reach rather than clipping silently against it. */
  reachAbs: number;
  /** Samples that landed inside `fillRadius` — the denominator behind
   * `fillPct`, worth printing when `scanRadius` is much larger. */
  fillSamples: number;
}

export interface SetExtentOpts {
  /** Ball the FILL fraction is taken over. */
  fillRadius: number;
  /** Ball the sample is drawn from; defaults to `fillRadius`. Larger when
   * the question is whether the set escapes its own bound — note that only
   * `(fillRadius / scanRadius)³` of the points then reach the fill ball. */
  scanRadius?: number;
  points?: number;
  seed?: number;
}

/**
 * Fill and reach of the set `member` describes.
 *
 * TWO DRAWS, because they are two questions that want opposite sampling.
 * FILL is volume-uniform — it has to be, since a volume fraction estimated
 * off a non-uniform sample is not a volume fraction, and this draw is
 * `probeEscapeFill`'s term for term so the two are the SAME measurement at
 * the same point count. REACH takes the furthest member EITHER that draw or
 * a {@link sampleSetReach} shell walk finds, because the two have opposite
 * blind spots and a maximum is what is wanted.
 *
 * REACH IS A FRAMING QUANTITY, NOT A PROPERTY OF THE OBJECT, and no budget
 * makes it one: a fractal has structure below any sampling density, so
 * "where does it end" is answered at the density you paid for. Read it as
 * "the outermost radius at which the set has presence this instrument can
 * see", disclose the budget, and leave the margin the callers apply.
 *
 * That distinction matters more than it sounds, because reach is what a
 * sheet FITS ITS MARCHING BALL to and the fitted ball is the panel's
 * framing. An inflated reach draws the object SMALLER — which manufactures
 * sub-pixel speckle a correctly-framed panel resolves, and fr-azjk measured
 * exactly that happening in `chain-speckle.harness.ts`, where the old
 * threshold-on-a-grid reach counted a halo of near-boundary ESCAPERS as
 * part of the object.
 */
export function sampleSetExtent(
  member: (p: Vec3) => boolean,
  opts: SetExtentOpts,
): SetExtent {
  const fillRadius = opts.fillRadius;
  const scanRadius = opts.scanRadius ?? fillRadius;
  const points = opts.points ?? SET_SAMPLE_POINTS;
  const seed = opts.seed ?? SET_SAMPLE_SEED;

  const rng = mulberry32(seed);
  let fillSamples = 0;
  let inside = 0;
  let drawReach = 0;
  for (let i = 0; i < points; i++) {
    // Uniform in the ball: cbrt for the radius, cos-uniform for the polar
    // angle — `probeEscapeFill`'s own draw, term for term.
    const u = Math.cbrt(rng()) * scanRadius;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const inFillBall = u <= fillRadius;
    if (inFillBall) fillSamples++;
    if (!member([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct])) {
      continue;
    }
    if (inFillBall) inside++;
    if (u > drawReach) drawReach = u;
  }

  return {
    fillPct: fillSamples > 0 ? (100 * inside) / fillSamples : 0,
    // The FURTHER of the two draws (module doc). Both are lower bounds on
    // where the set ends and their biases are opposite — the ball draw is
    // densest in the outermost shells, where the volume is, and blind close
    // in; the shell walk is uniform in shell and blind to nothing but low
    // density. Taking the max is the better lower bound and costs a
    // comparison, and the disagreement between them is itself the honest
    // width of the answer (measured: 2.60 against 3.06 on the shipped
    // single Mandelbox, whose outer dust sits right at both budgets' floor).
    reachAbs: Math.max(
      drawReach,
      sampleSetReach(
        member,
        scanRadius,
        SET_REACH_SHELLS,
        SET_REACH_SHELL_POINTS,
        seed ^ 0x9e37_79b9,
      ),
    ),
    fillSamples,
  };
}

/** Shells {@link sampleSetReach} divides the radius into, and samples it
 * spends on each. The product is one {@link SET_SAMPLE_POINTS} budget, but a
 * walk that stops at the outermost occupied shell pays only for the empty
 * ones above it — which is why the shell count can be this generous. */
export const SET_REACH_SHELLS = 256;
export const SET_REACH_SHELL_POINTS = 512;

/**
 * How far out the set goes: the largest radius at which a member was found.
 *
 * A SHELL WALK, from the OUTSIDE IN, stopping at the first shell that holds
 * a member — not a draw from the ball, because the two questions want
 * opposite sampling. Fill wants points where the VOLUME is; reach wants them
 * where the outermost STRUCTURE is, and a ball draw of any kind spends
 * almost its whole budget inside a set it has already found. This gives
 * every shell the same 512 chances however deep it sits, resolves the answer
 * to `radius / 256`, and typically costs a fraction of a full draw because
 * the walk ends at the first hit.
 *
 * ITS ONE BLIND SPOT, stated because reach is what a marching ball is fitted
 * to: a shell whose member density is below ~1/512 can be stepped past, so a
 * dust thinner than that reads as absent and the fit comes in tighter than
 * the object. The `* 1.06` every caller applies is the margin against it.
 */
export function sampleSetReach(
  member: (p: Vec3) => boolean,
  radius: number,
  shells = SET_REACH_SHELLS,
  shellPoints = SET_REACH_SHELL_POINTS,
  seed = SET_SAMPLE_SEED,
): number {
  const rng = mulberry32(seed);
  for (let s = shells - 1; s >= 0; s--) {
    const lo = (radius * s) / shells;
    const hi = (radius * (s + 1)) / shells;
    let best = 0;
    for (let i = 0; i < shellPoints; i++) {
      // Volume-uniform WITHIN the shell, so a hit's radius is an unbiased
      // read of where in the shell the set is, not a bias toward its floor.
      const u = Math.cbrt(lo ** 3 + rng() * (hi ** 3 - lo ** 3));
      const ct = 2 * rng() - 1;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = 2 * Math.PI * rng();
      if (
        u > best &&
        member([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct])
      ) {
        best = u;
      }
    }
    if (best > 0) return best;
  }
  return 0;
}

/** {@link sampleSetExtent}'s fill alone, for the columns that never ask how
 * far a set reaches. */
export function sampleSetFill(
  member: (p: Vec3) => boolean,
  opts: Omit<SetExtentOpts, "scanRadius">,
): number {
  return sampleSetExtent(member, opts).fillPct;
}
