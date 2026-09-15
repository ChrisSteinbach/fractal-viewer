/**
 * The sphere-inversion family's NATIVE 4D estimator: `sphere-inversion-de.ts`
 * one dimension up. The construction, its vocabulary, the covering tables,
 * the hit record, the transport and the cutoff scalars are IMPORTED from
 * `sphere-inversion.ts`; only the vector arithmetic below is duplicated,
 * under the twin-file convention. Every statement in the 3D module doc — the
 * fold, the budget-aware cover, what is certified under which hypotheses,
 * the defined outcomes and the cutoff contract — holds here word for word
 * with `R^4` for `R^3`: the tile identity and the empty-ball transport are
 * dimension-free.
 *
 * NATIVE, NOT PASSIVE. The generators are hyperspheres acting on all of
 * `xyzw`; no coordinate is carried through a 3D formula. The host lifts a
 * view point with the app's established rotor/slice lift
 * `q = rotorInv · (p, w0)` and queries `q`. A slice's distance is at least
 * the 4D distance, so this certified 4D bound is a certified in-slice bound
 * at every rotor and offset. Two reductions are exact, and pinned in the
 * tests: a FLAT embedding (every centre at `w = 0`, queried at `w = 0`)
 * reproduces the 3D estimator BIT FOR BIT, because each fourth-coordinate
 * term is appended last and is an exact `+ 0`; and an identity slice whose
 * off-plane generators miss the hyperplane has the in-plane sub-arrangement's
 * membership. A genuinely non-flat slice needs a generator ball that meets
 * it with its centre OFF it.
 *
 * NO SLAB (`halfExtent`), REFUSED BY DECISION. A thick slice renders the
 * projected shadow of `O_D ∩ {|w − w0| <= h}`, so its estimator needs a lower
 * bound on the distance from the SEGMENT `(p, w0 + [−h, h])` whose ZERO SET
 * is that shadow. The trivially sound `d(p, w0) − h` is a lower bound but
 * reaches zero on the `h`-thickening of the slice in every 3D direction,
 * which is a different object — the marcher would accept hits up to `h` off
 * the shadow (an executable counterexample is in the tests). The exact
 * route would carry the segment's enclosing ball through each inversion
 * (`inversion.ts`'s `inversionBallScale` transports it exactly), but a ball
 * straddling a generator sphere belongs to two fold branches at once, so the
 * fold would need `surface-de-4d.ts`'s branch enumeration, which this family
 * does not have — the same arc-not-chord obstruction `slabExact4` refuses on
 * the spherefold. So this module takes no `halfExtent`, and a host must hold
 * the slice thickness at zero for this family.
 *
 * f64 ONLY; the f32 argument belongs to the shader mirror.
 */
import {
  SPHERE_INVERSION_FOLD_DOMAIN,
  SPHERE_INVERSION_FOLD_EXHAUSTED,
  SPHERE_INVERSION_FOLD_POLE,
  SPHERE_INVERSION_POLE_FLOOR,
  createSphereInversionDE,
  makeSphereInversionHit,
  sphereInversionFoldedCutoff,
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
import type { Vec4 } from "./types";

/** Build the 4D estimator. Throws for a 3D or ineligible construction. */
export function buildSphereInversionDE4(
  construction: SphereInversionConstruction,
): SphereInversionDE {
  return createSphereInversionDE(construction, 4);
}

// Fold results, read immediately after `fold3` by its callers.
let foldK = 0;
let foldParent = -1;
let foldFirst = -1;
let foldStatus: SphereInversionFoldStatus = SPHERE_INVERSION_FOLD_DOMAIN;

function fold4(de: SphereInversionDE, p: Vec4): void {
  const n = de.generatorCount;
  const gc = de.generatorCenter;
  const gr2 = de.generatorRadius2;
  const depth = de.depth;
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  let k = 0;
  let parent = -1;
  let first = -1;
  let status: SphereInversionFoldStatus = SPHERE_INVERSION_FOLD_DOMAIN;
  for (;;) {
    let found = -1;
    let foundD2 = 0;
    for (let j = 0; j < n; j++) {
      if (j === parent) continue;
      const o = j * 4;
      const dx = x - gc[o];
      const dy = y - gc[o + 1];
      const dz = z - gc[o + 2];
      const dw = w - gc[o + 3];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
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
    const o = found * 4;
    const s = R2 / foundD2;
    x = gc[o] + s * (x - gc[o]);
    y = gc[o + 1] + s * (y - gc[o + 1]);
    z = gc[o + 2] + s * (z - gc[o + 2]);
    w = gc[o + 3] + s * (w - gc[o + 3]);
    de.foldRadius[k] = Math.sqrt(foundD2);
    de.foldRadius2[k] = R2;
    if (k === 0) first = found;
    k++;
    parent = found;
  }
  de.foldPoint[0] = x;
  de.foldPoint[1] = y;
  de.foldPoint[2] = z;
  de.foldPoint[3] = w;
  foldK = k;
  foldParent = parent;
  foldFirst = first;
  foldStatus = status;
}

/** Max of an intersection's member SDFs at `(x, y, z, w)`. */
function sdfIntersection4(
  t: SphereInversionBallTable,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  const c = t.center;
  let best = -Infinity;
  for (let i = 0; i < t.count; i++) {
    const o = i * 4;
    const dx = x - c[o];
    const dy = y - c[o + 1];
    const dz = z - c[o + 2];
    const dw = w - c[o + 3];
    const v =
      t.sign[i] *
      (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) - t.radius[i]);
    if (v > best) best = v;
  }
  return best;
}

/** Index of the binding (max-SDF) member of an intersection. */
function bindingMember4(
  t: SphereInversionBallTable,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  const c = t.center;
  let best = -Infinity;
  let arg = -1;
  for (let i = 0; i < t.count; i++) {
    const o = i * 4;
    const dx = x - c[o];
    const dy = y - c[o + 1];
    const dz = z - c[o + 2];
    const dw = w - c[o + 3];
    const v =
      t.sign[i] *
      (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) - t.radius[i]);
    if (v > best) {
      best = v;
      arg = i;
    }
  }
  return arg;
}

/** The one estimator body; `hit` null is the plain estimate. */
function evaluate4(
  de: SphereInversionDE,
  p: Vec4,
  cutoff: number,
  hit: SphereInversionHit | null,
): number {
  fold4(de, p);
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
  const w = de.foldPoint[3];
  const n = de.generatorCount;
  const gc = de.generatorCenter;
  const gr = de.generatorRadius;
  const m = de.depth - k;
  // Winning term: -1 the folded seed, else generator j's copy (gapIndex -1)
  // or its gap ball gapIndex.
  let termJ = -1;
  let termGap = -1;
  let best = sdfIntersection4(de.domainSeed, x, y, z, w);
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
    if (v < cutoff) {
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
    const o = j * 4;
    const dx = x - gc[o];
    const dy = y - gc[o + 1];
    const dz = z - gc[o + 2];
    const dw = w - gc[o + 3];
    // Everything this generator's ball can hold lies inside it.
    if (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) - gr[j] >= best)
      continue;
    const dc = sdfIntersection4(de.copies[j], x, y, z, w);
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
        const oo = i * 4;
        const ex = x - c[oo];
        const ey = y - c[oo + 1];
        const ez = z - c[oo + 2];
        const ew = w - c[oo + 3];
        const v =
          Math.sqrt(ex * ex + ey * ey + ez * ez + ew * ew) - g.radius[i];
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
      const member = bindingMember4(de.domainSeed, x, y, z, w);
      hit.seedMember = member < de.seedCount ? member : -1;
    } else {
      hit.firstGenerator = k > 0 ? foldFirst : termJ;
      if (termGap < 0) {
        hit.depth = k + 1;
        hit.lastGenerator = termJ;
        const member = bindingMember4(de.copies[termJ], x, y, z, w);
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
export function estimateSphereInversionDistance4(
  de: SphereInversionDE,
  p: Vec4,
  cutoff = 0,
): number {
  return evaluate4(de, p, cutoff, null);
}

/** {@link estimateSphereInversionDistance4} plus attribution, written into
 * `out` (a fresh record when omitted). `out.d` is bit-identical to the plain
 * estimate at the same cutoff; at a cutoff exit the attribution is the
 * running minimum's. */
export function sphereInversionHitInfo4(
  de: SphereInversionDE,
  p: Vec4,
  cutoff = 0,
  out: SphereInversionHit = makeSphereInversionHit(),
): SphereInversionHit {
  evaluate4(de, p, cutoff, out);
  return out;
}

/** MEMBERSHIP in `O_D`: the fold reaches `F` and the folded point lies in
 * `K ∩ F`. Never a threshold on a distance. */
export function sphereInversionContains4(
  de: SphereInversionDE,
  p: Vec4,
): boolean {
  fold4(de, p);
  if (foldStatus !== SPHERE_INVERSION_FOLD_DOMAIN) return false;
  return (
    sdfIntersection4(
      de.domainSeed,
      de.foldPoint[0],
      de.foldPoint[1],
      de.foldPoint[2],
      de.foldPoint[3],
    ) <= 0
  );
}
