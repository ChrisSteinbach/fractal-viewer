/**
 * The sphere-inversion family's 3D CPU estimator: the TRANSPORTED CERTIFIED
 * BOUND on the Euclidean distance to the depth-D seed orbit `O_D`, the
 * oracle every later shader mirror is pinned to. The construction and its
 * vocabulary live in `sphere-inversion.ts`; `sphere-inversion-de-4d.ts` is
 * this file one dimension up, duplicating only the arithmetic. The written
 * argument and the measurements are in `docs/sphere-inversion-family.md`.
 *
 * THE FOLD. While the query lies in some OPEN generator ball other than the
 * one it just left and fewer than `D` inversions are spent, invert through
 * it (lowest index first, which matters only on a tangency point). Three
 * outcomes: DOMAIN (the query reached `F`), EXHAUSTED (budget spent inside a
 * ball), POLE (within `SPHERE_INVERSION_POLE_FLOOR · r` of a centre).
 *
 * THE BOUND. In folded coordinates after `k` inversions with last generator
 * `p` and budget `m = D − k` left, the image of `O_D` is covered by `K ∩ F`,
 * the one-step copies `I_j(K ∩ F)` and the depth-2 balls `I_j(B_l)` (the
 * tile identity), with the budget deciding which terms may hold anything:
 * the parent `p`'s ball always counts; another ball needs `m >= 1` for its
 * copy and `m >= 2` for its gap balls. Each term is an intersection of
 * generalized balls whose member SDFs are exact, and the max of an
 * intersection's member SDFs lower-bounds its distance, so the min over
 * terms is an exact lower bound `L`. `L` is carried back through each
 * inversion with `inversionDistanceLowerBound`, which is exact transport of
 * an empty ball (the doc's two-case algebra) and monotone, so a lower bound
 * stays one.
 *
 * WHAT IS CERTIFIED, AND UNDER WHICH HYPOTHESES. For generators with
 * pairwise disjoint interiors (tangency included) and a seed that is an
 * intersection of generalized balls with no depth-1 plane image — exactly
 * what `analyzeSphereInversionSystem` admits — a POSITIVE return is a lower
 * bound on the Euclidean distance from the query to `O_D`, up to f64
 * rounding, and it is marched at step scale 1 (`SPHERE_INVERSION_STEP_SCALE`)
 * with no damping. The explicit-orbit oracle
 * (`sphere-inversion-oracle.ts`) pins that claim in the tests. NOT
 * certified, and not advertised: a return `<= 0` is a MEMBER SIGNAL in
 * folded coordinates (the folded seed SDF, untransported), not a signed
 * distance; nothing here is an f32 statement (the shader mirror owes its own
 * argument); the Bridges 2016 damped local-derivative form and its factor are
 * not used; and the limit set is not the object.
 *
 * DEFINED OUTCOMES.
 *   - Pole: returns 0 and is not a member. The bound also decays toward a
 *     centre, so a ray aimed exactly at one creeps.
 *   - Exhausted: not a member; the bound drops the ball it is stuck in
 *     (nothing of `O_D` lies there at that depth) and stays positive.
 *   - Tangency: valid; the depth-2 gap terms reach 0 AT a tangency point (a
 *     cusp), where the estimate is 0 without membership — a stall, never an
 *     overshoot.
 *   - A seed sphere through a generator centre, and overlapping generators:
 *     refused when the DE is built.
 *   - Far queries: the seed term is `|p| − ρ`, finite at any f64 distance.
 *
 * THE CUTOFF CONTRACT is `surface-de.ts`'s, pinned against the explicit
 * orbit in the tests:
 *   - a return `>= cutoff` equals the `cutoff = 0` result bit for bit, so it
 *     is the certified lower bound (never above the true distance);
 *   - a return `< cutoff` happens EXACTLY when the full result is `< cutoff`
 *     — so whenever the true distance is below the cutoff, and otherwise
 *     only where the full bound itself already under-reads, the lower
 *     bound's own safe direction. The cutoff never changes a decision.
 *   - a sub-cutoff exit value lies in `[full, cutoff)`: it is a DECISION
 *     value, not a distance, and no caller may transport, damp or compose it
 *     as one (`inversion.ts`'s `inversionDistanceLowerBound` forbids a
 *     cutoff-shortened input; a Balloon- or lens-style wrapper must query
 *     with cutoff 0 or honour the decision alone).
 * An exit is taken only after transporting the RUNNING minimum forward:
 * that minimum is an exact lower bound on the distance to the part of the
 * cover already scanned — never a cutoff-shortened distance — so the
 * transport's hypothesis holds, and the transported value is at least the
 * full estimate. The exit must clear `SPHERE_INVERSION_CUTOFF_EXIT_MARGIN`
 * so f64 rounding in the transport cannot flip the decision; no such flip
 * was found without it (about 580,000 positive queries across four
 * fixtures with the cutoff on the full value to the ulp), so the margin is a
 * written-argument hardening, not a measured repair. The folded-coordinate
 * threshold only decides when an exit is worth trying.
 *
 * NO SLAB IN EITHER DIMENSION: see `sphere-inversion-de-4d.ts`.
 */
import {
  SPHERE_INVERSION_CUTOFF_EXIT_MARGIN,
  SPHERE_INVERSION_FOLD_DOMAIN,
  SPHERE_INVERSION_FOLD_EXHAUSTED,
  SPHERE_INVERSION_FOLD_POLE,
  SPHERE_INVERSION_POLE_FLOOR,
  createSphereInversionDE,
  makeSphereInversionHit,
  sphereInversionFoldedCutoff,
  sphereInversionFoldedNormal,
  sphereInversionGapGenerator,
  transportSphereInversionBound,
} from "./sphere-inversion";
import type {
  SphereInversionBallTable,
  SphereInversionConstruction,
  SphereInversionDE,
  SphereInversionFoldStatus,
  SphereInversionHit,
} from "./sphere-inversion";
import type { Vec3 } from "./types";

/** Build the 3D estimator. Throws for a 4D or ineligible construction. */
export function buildSphereInversionDE(
  construction: SphereInversionConstruction,
): SphereInversionDE {
  return createSphereInversionDE(construction, 3);
}

// Fold results, read immediately after `fold3` by its callers.
let foldK = 0;
let foldParent = -1;
let foldFirst = -1;
let foldStatus: SphereInversionFoldStatus = SPHERE_INVERSION_FOLD_DOMAIN;

function fold3(de: SphereInversionDE, p: Vec3): void {
  const n = de.generatorCount;
  const gc = de.generatorCenter;
  const gr2 = de.generatorRadius2;
  const depth = de.depth;
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let k = 0;
  let parent = -1;
  let first = -1;
  let status: SphereInversionFoldStatus = SPHERE_INVERSION_FOLD_DOMAIN;
  for (;;) {
    let found = -1;
    let foundD2 = 0;
    for (let j = 0; j < n; j++) {
      if (j === parent) continue;
      const o = j * 3;
      const dx = x - gc[o];
      const dy = y - gc[o + 1];
      const dz = z - gc[o + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < gr2[j]) {
        found = j;
        foundD2 = d2;
        break;
      }
    }
    if (found < 0) break;
    if (k === depth) {
      status = SPHERE_INVERSION_FOLD_EXHAUSTED;
      break;
    }
    const R2 = gr2[found];
    if (
      foundD2 <=
      SPHERE_INVERSION_POLE_FLOOR * SPHERE_INVERSION_POLE_FLOOR * R2
    ) {
      status = SPHERE_INVERSION_FOLD_POLE;
      break;
    }
    const o = found * 3;
    const s = R2 / foundD2;
    x = gc[o] + s * (x - gc[o]);
    y = gc[o + 1] + s * (y - gc[o + 1]);
    z = gc[o + 2] + s * (z - gc[o + 2]);
    de.foldRadius[k] = Math.sqrt(foundD2);
    de.foldRadius2[k] = R2;
    de.foldGenerator[k] = found;
    if (k === 0) first = found;
    k++;
    parent = found;
  }
  de.foldPoint[0] = x;
  de.foldPoint[1] = y;
  de.foldPoint[2] = z;
  foldK = k;
  foldParent = parent;
  foldFirst = first;
  foldStatus = status;
}

/** Max of an intersection's member SDFs at `(x, y, z)`. */
function sdfIntersection3(
  t: SphereInversionBallTable,
  x: number,
  y: number,
  z: number,
): number {
  const c = t.center;
  let best = -Infinity;
  for (let i = 0; i < t.count; i++) {
    const o = i * 3;
    const dx = x - c[o];
    const dy = y - c[o + 1];
    const dz = z - c[o + 2];
    const v =
      t.sign[i] * (Math.sqrt(dx * dx + dy * dy + dz * dz) - t.radius[i]);
    if (v > best) best = v;
  }
  return best;
}

/** Index of the binding (max-SDF) member of an intersection. */
function bindingMember3(
  t: SphereInversionBallTable,
  x: number,
  y: number,
  z: number,
): number {
  const c = t.center;
  let best = -Infinity;
  let arg = -1;
  for (let i = 0; i < t.count; i++) {
    const o = i * 3;
    const dx = x - c[o];
    const dy = y - c[o + 1];
    const dz = z - c[o + 2];
    const v =
      t.sign[i] * (Math.sqrt(dx * dx + dy * dy + dz * dz) - t.radius[i]);
    if (v > best) {
      best = v;
      arg = i;
    }
  }
  return arg;
}

/** The one estimator body; `hit` null is the plain estimate. */
function evaluate3(
  de: SphereInversionDE,
  p: Vec3,
  cutoff: number,
  hit: SphereInversionHit | null,
): number {
  fold3(de, p);
  const k = foldK;
  const parent = foldParent;
  if (foldStatus === SPHERE_INVERSION_FOLD_POLE) {
    if (hit) {
      hit.d = 0;
      hit.status = SPHERE_INVERSION_FOLD_POLE;
      hit.foldDepth = k;
      hit.depth = k;
      hit.firstGenerator = foldFirst;
      hit.lastGenerator = parent;
      hit.seedMember = -1;
    }
    return 0;
  }
  const x = de.foldPoint[0];
  const y = de.foldPoint[1];
  const z = de.foldPoint[2];
  const n = de.generatorCount;
  const gc = de.generatorCenter;
  const gr = de.generatorRadius;
  const m = de.depth - k;
  // Winning term: -1 the folded seed, else generator j's copy (gapIndex -1)
  // or its gap ball gapIndex.
  let termJ = -1;
  let termGap = -1;
  let best = sdfIntersection3(de.domainSeed, x, y, z);
  let result = best;
  let exitAt =
    cutoff > 0
      ? sphereInversionFoldedCutoff(de.foldRadius, de.foldRadius2, k, cutoff)
      : -Infinity;
  const done = best <= 0;
  const tryExit = (): boolean => {
    if (!(best < exitAt)) return false;
    const v = transportSphereInversionBound(
      de.foldRadius,
      de.foldRadius2,
      k,
      best,
    );
    if (v * (1 + SPHERE_INVERSION_CUTOFF_EXIT_MARGIN) < cutoff) {
      result = v;
      return true;
    }
    exitAt = best;
    return false;
  };
  let exited = !done && tryExit();
  for (let j = 0; j < n && !done && !exited; j++) {
    const isParent = j === parent;
    if (!isParent && m < 1) continue;
    const o = j * 3;
    const dx = x - gc[o];
    const dy = y - gc[o + 1];
    const dz = z - gc[o + 2];
    // Everything this generator's ball can hold lies inside it.
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - gr[j] >= best) continue;
    const dc = sdfIntersection3(de.copies[j], x, y, z);
    if (dc < best) {
      best = dc;
      termJ = j;
      termGap = -1;
    }
    if (best <= 0) break;
    if (isParent || m >= 2) {
      const g = de.gaps[j];
      const c = g.center;
      for (let i = 0; i < g.count; i++) {
        const oo = i * 3;
        const ex = x - c[oo];
        const ey = y - c[oo + 1];
        const ez = z - c[oo + 2];
        const v = Math.sqrt(ex * ex + ey * ey + ez * ez) - g.radius[i];
        if (v < best) {
          best = v;
          termJ = j;
          termGap = i;
        }
      }
    }
    exited = tryExit();
  }
  if (!exited) {
    result =
      best <= 0
        ? best
        : transportSphereInversionBound(de.foldRadius, de.foldRadius2, k, best);
  }
  if (hit) {
    hit.d = result;
    hit.status = foldStatus;
    hit.foldDepth = k;
    if (termJ < 0) {
      hit.depth = k;
      hit.firstGenerator = foldFirst;
      hit.lastGenerator = parent;
      const member = bindingMember3(de.domainSeed, x, y, z);
      hit.seedMember = member < de.seedCount ? member : -1;
    } else {
      hit.firstGenerator = k > 0 ? foldFirst : termJ;
      if (termGap < 0) {
        hit.depth = k + 1;
        hit.lastGenerator = termJ;
        const member = bindingMember3(de.copies[termJ], x, y, z);
        hit.seedMember = member < de.seedCount ? member : -1;
      } else {
        hit.depth = k + 2;
        hit.lastGenerator = sphereInversionGapGenerator(termJ, termGap);
        hit.seedMember = -1;
      }
    }
  }
  return result;
}

/**
 * The CERTIFIED lower bound on the distance from `p` to `O_D` (module doc):
 * positive values are distances' lower bounds, `<= 0` means member, a pole
 * returns 0. `cutoff` follows the module doc's contract.
 */
export function estimateSphereInversionDistance(
  de: SphereInversionDE,
  p: Vec3,
  cutoff = 0,
): number {
  return evaluate3(de, p, cutoff, null);
}

/** {@link estimateSphereInversionDistance} plus attribution, written into
 * `out` (a fresh record when omitted). `out.d` is bit-identical to the plain
 * estimate at the same cutoff; at a cutoff exit the attribution is the
 * running minimum's. */
export function sphereInversionHitInfo(
  de: SphereInversionDE,
  p: Vec3,
  cutoff = 0,
  out: SphereInversionHit = makeSphereInversionHit(),
): SphereInversionHit {
  evaluate3(de, p, cutoff, out);
  return out;
}

/**
 * The SIGNED field: {@link estimateSphereInversionDistance} outside, and a
 * CERTIFIED INTERIOR CLEARANCE inside — a lower bound on the distance from a
 * member to the complement of `O_D`. The optical transport needs a sign to
 * march a refracted ray (`docs/surface-dielectric-transport.md`'s scope wall:
 * a boundary query "can find a boundary only from OUTSIDE, so a refracted
 * child — which is what glass IS — either misses the domain without a
 * crossing or crawls its anchor suppression into the step cap"), and the
 * unsigned estimator's `<= 0` is a MEMBER SIGNAL in FOLDED coordinates, not
 * a distance in the query's own.
 *
 * THE INTERIOR VALUE IS EXACT IN FOLDED COORDINATES AND EXACTLY TRANSPORTED
 * OUT, so this adds no new arithmetic and no new approximation:
 *
 *   - `K ∩ F` is an intersection of generalized balls whose member SDFs are
 *     exact, and inside an intersection the distance to the complement is
 *     `min_i(−sdf_i) = −max_i(sdf_i)` — which is exactly `−d`, the value the
 *     unsigned estimator already computed.
 *   - Inversion carries a ball to a ball EXACTLY (`inversion.ts`'s identity),
 *     so the folded clearance ball transports to a clearance ball at the
 *     query. Writing the image out — for folded clearance `rho` at distance
 *     `s` from the inversion centre, the clearance at the unfolded point (at
 *     `r = R²/s`) is `R²·rho / (s·(s + rho))` = `r²·rho / (R² + r·rho)` —
 *     gives `inversionDistanceLowerBound`'s expression TERM FOR TERM. The
 *     full-ball law and the empty-ball law are the SAME MAP, so the interior
 *     clearance rides {@link transportSphereInversionBound} unchanged, over
 *     the same `foldRadius`/`foldRadius2` the fold just wrote.
 *
 * It is CONSERVATIVE at the seams, deliberately: the clearance is the
 * containing PIECE's, and the union may reach further past a generator
 * sphere where the next copy continues. A march understeps there; it never
 * oversteps (the closed-solid backend's own "the deepest containing part's
 * certified depth" reading).
 *
 * THE SIGN AGREES WITH {@link sphereInversionContains} BY CONSTRUCTION, not
 * by measurement, and the argument is the fold's: at DOMAIN the folded point
 * lies outside EVERY generator ball — the fold inverts through any ball but
 * the parent, and inversion through the parent put the point outside it — so
 * every `copies[j]` term (each contained in its own ball) is positive and the
 * only term that can be non-positive is the domain seed, which is exactly
 * what membership tests. At EXHAUSTED the point is inside some non-parent
 * ball, which the seed's `ext(B_i)` members make positive, and that ball's
 * own copy term is skipped for want of budget. A POLE returns 0. The status
 * guard below is therefore unreachable, and is kept because a silent sign
 * disagreement is the one defect this field must not have.
 *
 * THE SIGN IS CUTOFF-INDEPENDENT, which is worth stating because the obvious
 * worry is that it is not: the cutoff's early exit returns a small POSITIVE
 * decision value, so an exit taken before a negative term was reached would
 * invert the sign. It cannot happen. A member's negative term is the DOMAIN
 * SEED, which is the FIRST term evaluated, and it short-circuits (`done`)
 * ahead of every cutoff test; and at DOMAIN no other term can be negative
 * anyway, by the fold argument above. A member therefore returns the same
 * value at every cutoff, pinned in the tests.
 *
 * THIS ENTRY STILL TAKES NO CUTOFF, because one would buy nothing: the
 * interior branch is a single table scan with no search to shorten, and the
 * exterior branch IS {@link estimateSphereInversionDistance}, which a caller
 * wanting the early exit should call directly.
 */
export function sphereInversionSignedDistance(
  de: SphereInversionDE,
  p: Vec3,
): number {
  const d = evaluate3(de, p, 0, null);
  if (d >= 0) return d;
  if (foldStatus !== SPHERE_INVERSION_FOLD_DOMAIN) return d;
  const clearance = transportSphereInversionBound(
    de.foldRadius,
    de.foldRadius2,
    foldK,
    -d,
  );
  return clearance > 0 ? -clearance : 0;
}

/** MEMBERSHIP in `O_D`: the fold reaches `F` and the folded point lies in
 * `K ∩ F`. Never a threshold on a distance. */
export function sphereInversionContains(
  de: SphereInversionDE,
  p: Vec3,
): boolean {
  fold3(de, p);
  if (foldStatus !== SPHERE_INVERSION_FOLD_DOMAIN) return false;
  return (
    sdfIntersection3(
      de.domainSeed,
      de.foldPoint[0],
      de.foldPoint[1],
      de.foldPoint[2],
    ) <= 0
  );
}

/** THE EXACT MÖBIUS NORMAL of the signed field at `p`
 * ({@link sphereInversionFoldedNormal}): the unit gradient direction, or
 * null at a pole, an exhausted fold, or a degenerate offset, where a caller
 * falls back to finite-difference taps. One fold and one cover scan — the
 * cost of one field evaluation. */
export function sphereInversionSignedNormal(
  de: SphereInversionDE,
  p: Vec3,
): Vec3 | null {
  fold3(de, p);
  if (foldStatus !== SPHERE_INVERSION_FOLD_DOMAIN) return null;
  const out = new Float64Array(3);
  if (!sphereInversionFoldedNormal(de, 3, foldK, foldParent, out)) return null;
  return [out[0], out[1], out[2]];
}
