/**
 * Escape-time chain, one dimension up: `escape-de.ts`'s forward formula
 * chain over 4D points, for the systems whose maps reach out of the
 * `w = 0` hyperplane — the dimensional-parity half of the family the site is
 * named after.
 *
 * WHY IT EXISTS. `escape-de.ts` is flat BY GATE: `analyzeEscapeSystem` pushes
 * "map N extends into 4D" for any non-flat map and "the kaleidoscope rotates
 * into 4D" for a `w`-plane or a twist. That is a description of the
 * estimator's state, never a decision that a 4D one should not exist — and
 * the sharpest case is `qsquare`, whose 4D form is the DEFINITION and whose
 * 3D form is the restriction (`variations4.ts`). The one map in this family
 * whose home dimension is four was the one being run flattened, and
 * `scripts/hybrid-chain.harness.ts`'s k-component sweep measured what that
 * component does to it. So this module is the 4D half of a mode that had
 * none.
 *
 * WHAT LIFTS, AND WHAT DOES NOT — the gate refuses PER LINK KIND rather than
 * per map, because the three questions have three different answers:
 *
 *   - THE FOLDS lift outright. `variations4.ts` treats `w` exactly like a
 *     spatial axis (the box fold reflects all four, the sphere fold inverts
 *     through the full 4-radius) and is pinned bit-exact against the 3D forms
 *     at `w = 0`, non-classic radii included. This module duplicates that
 *     ARITHMETIC under the twin-file convention and imports every constant
 *     and code from {@link import("./escape-de")}, exactly as `variations4.ts`
 *     imports `resolveFoldRadii` rather than restating it.
 *   - `qsquare` lifts by being what it always was: the full quaternion
 *     square, `q² = (x²−y²−z²−w², 2xy, 2xz, 2xw)`. Its local factor `2|q|`
 *     stays EXACT rather than heuristic — quaternion norms multiply in the
 *     full algebra, not merely on the 3D subspace — so a 4D chain carrying
 *     one has the same single certified factor its 3D twin does.
 *   - `bulb` does NOT lift, and that refusal is `bulb-de.ts`'s, not this
 *     module's. Triplex numbers are R³ with a spherical-coordinate product;
 *     there is no fourth component to give meaning to, so `variations4.ts`'s
 *     `bulb` carries `w` through untouched — honest for the chaos game and
 *     useless to an estimator, since the carried axis has derivative 1 while
 *     `dr` is being multiplied by `8|y|⁷` computed on the OTHER three. A
 *     chain holding one is refused here with that reason and stays on the 3D
 *     path, where the whole system is flat and the carried axis never moves.
 *
 * THE ORBIT IS DIMENSION-FREE. Everything structural about `escape-de.ts` —
 * cycling rather than chaining, the per-link `+ p`, the bailout test after
 * EACH link, the shared scalar `dr` with its `+ 1` floor, the linear
 * `r / dr` against the Böttcher `0.5·r·ln r / dr` — is stated in norms and
 * scalars and carries verbatim. Only the point type and the five maps'
 * arithmetic widen. That is why this file is a fraction of its twin's length
 * and why every measured verdict quoted in the 3D module doc (cycling's ball
 * fill, `ESCAPE_STEP_SCALE` 0.35 at every chain length, the bailout radius 4)
 * stands here without re-derivation: they are properties of the recurrence,
 * not of the ambient dimension.
 *
 * THE KALEIDOSCOPE generalises cleanly and the twist does not.
 * {@link foldQueryIntoSector4} folds the query into the `π / order` wedge of
 * ANY of the six coordinate planes — `w`-planes included, which is exactly
 * what the 3D gate refuses — leaving the other two coordinates untouched. It
 * is still a composition of half-space folds, hence 1-Lipschitz and an
 * isometry per sector, so the marching ball does not move. A nonzero TWIST is
 * refused: a double rotation's fundamental domain is not a wedge, so there is
 * no sector retraction to apply, and inventing one would render a set the
 * chaos game does not draw.
 *
 * NO SLAB, AND THAT IS THE SHIPPED PATTERN ONE MODE OVER. `surface-de-4d.ts`
 * refuses slab queries for any system whose fold set includes a
 * spherefold or a mandelbox ({@link import("./surface-de-4d").slabExact4}) —
 * the mid branch is an inversion, which takes a segment to an arc — and the
 * app clamps `sliceHalfW` to 0 for those sessions rather than degrading into
 * a silently wrong image. A FORWARD orbit refuses it for a stronger reason
 * that no fold kind escapes: there is no branch enumeration, so a segment
 * straddling a box fold's wall maps to a bent polyline in one step. This
 * module therefore takes no `halfExtent` at all, and its hosts clamp the
 * slice thickness to zero.
 *
 * ANCHORED AT `w = 0`, and the anchor has one seam worth naming because it
 * is NOT this module's. Every expression below appends the fourth
 * coordinate at the END of the term it joins (`+ yw * yw`,
 * `foldAxis(yw)`), so the ORBIT's arithmetic is bit-identical to
 * `estimateEscapeDistance`'s — `+ 0.0` is exact and `foldAxis(0) = 0` is
 * exact, `variations4.ts`'s anchor property term for term. The tests pin
 * that with `toBe`, which is what makes "the 3D system and its 4D lift
 * render the same object" a checked fact rather than an intention.
 *
 * The AFFINE part is a different story, and it predates this file:
 * `composeAffine4(toTransform4(t))` and `composeAffine(t)` agree to ULPs
 * rather than to the bit whenever a transform carries a nonzero rotation
 * — `affine4.ts`'s `rotationMatrix4` multiplies its factors in its own
 * order, and `affine4.test.ts` has always compared the two with
 * `toBeCloseTo(…, 12)` for exactly that reason. So the `toBe` fixtures
 * here keep `rotation: [0, 0, 0]`; a rotated one would fail on
 * `affine4.ts`'s rounding, not on anything below. Worth stating rather
 * than quietly avoiding: the claim this module can make is that its own
 * arithmetic adds no divergence, not that the two composition paths are
 * one function.
 */
import { composeAffine4, toTransform4 } from "./affine4";
import {
  effectiveSymmetryOrder,
  systemHasChaos,
  systemHasEmitters,
} from "./chaos-game";
import {
  ESCAPE_LINK_BOXFOLD,
  ESCAPE_LINK_MANDELBOX,
  ESCAPE_LINK_QSQUARE,
  ESCAPE_LINK_SPHEREFOLD,
  ESCAPE_PROBE_POINTS,
  ESCAPE_PROBE_SEED,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeLinkPower,
} from "./escape-de";
import type { EscapeEligibility, EscapeLinkKind } from "./escape-de";
import { mulberry32 } from "./rng";
import {
  SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT,
  calibrateSurfaceNativeCarriers,
} from "./surface-pattern";
import type {
  SurfaceNativeCalibration,
  SurfaceNativeCarrierSample,
} from "./surface-pattern";
import { CONTRACTION_LIMIT } from "./surface-de";
import { transformSigmas4 } from "./surface-de-4d";
import { resolveFoldRadii, sphereFoldLipschitz } from "./variations";
import type {
  SymmetryParams,
  SymmetryPlane,
  Transform,
  Variation,
  Vec4,
} from "./types";

/** One link of the 4D orbit's formula chain — `escape-de.ts`'s
 * {@link import("./escape-de").EscapeLink} with a 4x4 affine part. Every
 * other field means exactly what it means there, and the numeric `kind`
 * codes are that module's own (imported, never restated). */
export interface EscapeLink4 {
  /** Row-major 4x4 FORWARD linear part M of the lifted map. */
  m: number[];
  /** Forward translation t. */
  t: Vec4;
  /** The map applied after the affine part. Never
   * {@link import("./escape-de").ESCAPE_LINK_BULB} — the gate refuses a
   * triplex power here (module doc). */
  kind: EscapeLinkKind;
  /** Signed variation weight w. */
  w: number;
  /** `|w| · sigma_max(M)`, the 4x4 sigma. */
  derivGrowth: number;
  /** The box fold's reflection plane, resolved. Classic 1. */
  boxLimit: number;
  /** `mR²`, resolved. Classic 0.25. */
  minRadius2: number;
  /** `fR²`, resolved. Classic 1. */
  fixedRadius2: number;
}

/**
 * Everything the 4D escape-time marcher needs — the wire format
 * `surface-de-gpu.ts`'s `core: "escape4"` mirrors, and the 4D twin of
 * {@link import("./escape-de").EscapeDE}.
 *
 * It EXTENDS {@link EscapeLink4} for the reason its twin extends
 * `EscapeLink`: the flat fields are the head link's, which is the shape the
 * packers' variant block carries.
 */
export interface EscapeDE4 extends EscapeLink4 {
  /** The formula chain in document order; step `i` applies `links[i mod n]`. */
  links: EscapeLink4[];
  /** Read the terminal radius through the Böttcher form — true exactly when
   * some link is a POWER map, which in 4D means `qsquare` alone. */
  logEstimate: boolean;
  /** Kaleidoscope sectors the query is folded into before the orbit starts
   * ({@link foldQueryIntoSector4}); `1` is off. */
  symmetryOrder: number;
  /** The plane that fold turns in — any of the six, `w`-planes included,
   * which is the whole difference from the 3D wire. Never read at order 1. */
  symmetryPlane: SymmetryPlane;
  /** Marching bounds: the non-escaping set sits inside the bailout
   * 3-sphere, so the tracer enters/exits against this radius. The wedge fold
   * is an isometry and does not move it. */
  boundingRadius: number;
  /** Camera-independent p03/p97 normalization of the shader's bailout-
   * normalized radial and y-plane traps. */
  patternCalibration: SurfaceNativeCalibration;
}

type EscapeCalibrationDE4 = Omit<EscapeDE4, "patternCalibration">;

/** {@link import("./escape-de").EscapeDE}'s `linkVariation` one dimension up
 * — the single active entry a link may carry. `bulb` is RECOGNISED here so
 * the gate can refuse it by name (module doc) rather than reporting the
 * generic "not a pure fold or power map". */
function linkVariation4(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  const v = active[0];
  return v.type === "boxfold" ||
    v.type === "spherefold" ||
    v.type === "mandelbox" ||
    v.type === "bulb" ||
    v.type === "qsquare"
    ? v
    : null;
}

/** The maps that make up the chain: active, in DOCUMENT ORDER — 3D's
 * `activeMaps`, and `weight` is read as on/off there for the same reason (a
 * sequenced orbit has no selection probability). */
function activeMaps(transforms: Transform[]): Transform[] {
  return transforms.filter((t) => (t.weight ?? 1) > 0);
}

/** A lifted map's composite forward Lipschitz bound `|w|·L_V·sigma_max(M4)`
 * — 3D's `foldLipschitz` against the 4x4 sigma, so the 4D escape gate and
 * `analyzeSurfaceSystem4` cannot disagree about which side of
 * {@link CONTRACTION_LIMIT} a map falls. */
function foldLipschitz4(fold: Variation, map: Transform): number {
  return (
    Math.abs(fold.weight) *
    (fold.type === "boxfold"
      ? 1
      : sphereFoldLipschitz(resolveFoldRadii(fold))) *
    transformSigmas4(toTransform4(map)).max
  );
}

/**
 * Classify a system for the 4D escape-time render — `analyzeEscapeSystem`'s
 * twin, and the same deliberate COMPLEMENT of `analyzeSurfaceSystem4` on
 * chains of pure-fold maps.
 *
 * Three clauses differ from 3D and no others:
 *   - flatness is NOT required of a map (that is the point of the module);
 *   - a `bulb` link is refused outright, with its own reason (module doc's
 *     WHAT LIFTS section) — so a chain holding one keeps the 3D gate, where
 *     the system is flat and the triplex power's carried `w` never moves;
 *   - the kaleidoscope may turn in any of the six planes, but a nonzero
 *     TWIST is refused ({@link foldQueryIntoSector4}).
 */
export function analyzeEscapeSystem4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeEligibility {
  const reasons: string[] = [];
  const active = activeMaps(transforms);
  if (active.length === 0) {
    reasons.push("no active maps");
  }
  let anyExpands = false;
  transforms.forEach((map, i) => {
    if ((map.weight ?? 1) <= 0) return;
    const label = `map ${i + 1}`;
    const v = linkVariation4(map);
    if (!v) {
      reasons.push(`${label} is not a pure fold or power map`);
    } else if (v.type === "bulb") {
      reasons.push(
        `${label} is a triplex power, which has no fourth component ` +
          `(the 3D escape-time render owns it)`,
      );
    } else if (v.type === "qsquare") {
      if (active.length < 2) {
        // 3D's LONE POWER MAP clause, and it holds here for the same reason:
        // `qjulia-de.ts`'s object is a measured won't-do, dull alone and
        // worth rendering composed. Two links is a chain.
        reasons.push(
          `${label} is a lone quaternion square (chain it with another map)`,
        );
      } else {
        // A power link always expands (3D's paragraph, unchanged: its local
        // factor reaches 2·4 on the bailout ball's rim, and
        // `analyzeSurfaceSystem4` refuses any map carrying a non-fold
        // variation outright).
        anyExpands = true;
      }
    } else if (foldLipschitz4(v, map) >= CONTRACTION_LIMIT) {
      anyExpands = true;
    }
  });
  if (active.length > 0 && reasons.length === 0 && !anyExpands) {
    reasons.push("every map contracts (the attractor surface render owns it)");
  }
  // Chaos rows: the 3D gate's refusal verbatim (escape-de.ts) — a forward
  // orbit cycles its links, there is no pick for a row to direct, and the
  // dimension changes nothing about that.
  if (systemHasChaos(transforms)) {
    reasons.push("chaos rows (unsupported in escape-time mode)");
  }
  // Shape emitters: the 3D gate's refusal verbatim (escape-de.ts) — a
  // forward orbit has no per-step pick to emit on, would silently march the
  // plain chain, and a link may carry `emitter` beside an admissible fold,
  // so the refusal must be explicit rather than structural.
  if (systemHasEmitters(transforms)) {
    reasons.push("shape emitters (unsupported in escape-time mode)");
  }
  if (finalTransform) {
    reasons.push("final transform (unsupported in escape-time mode)");
  }
  if (symmetry.order > 1 && (symmetry.twist ?? 0) !== 0) {
    reasons.push("the kaleidoscope twists (a double rotation has no wedge)");
  }
  return {
    status: reasons.length > 0 ? "ineligible" : "eligible",
    reasons,
  };
}

/** One link of the chain, from the document's own vocabulary — 3D's
 * `buildEscapeLink` over the LIFTED transform. A power link carries the
 * classic fold lengths for the reason 3D's does: no branch reads them, and
 * zeros would be a stray divisor. */
function buildEscapeLink4(map: Transform): EscapeLink4 {
  const v = linkVariation4(map)!;
  const lifted = toTransform4(map);
  const affine = composeAffine4(lifted);
  const radii = resolveFoldRadii(v);
  return {
    m: affine.m,
    t: affine.t,
    kind:
      v.type === "boxfold"
        ? ESCAPE_LINK_BOXFOLD
        : v.type === "spherefold"
          ? ESCAPE_LINK_SPHEREFOLD
          : v.type === "mandelbox"
            ? ESCAPE_LINK_MANDELBOX
            : ESCAPE_LINK_QSQUARE,
    w: v.weight,
    derivGrowth: Math.abs(v.weight) * transformSigmas4(lifted).max,
    boxLimit: radii.boxLimit,
    minRadius2: radii.minRadius * radii.minRadius,
    fixedRadius2: radii.fixedRadius * radii.fixedRadius,
  };
}

/**
 * Precompute the {@link EscapeDE4} for an eligible system. Throws on an
 * ineligible one ({@link analyzeEscapeSystem4}) — the app gates first, so
 * reaching the throw is a bug.
 */
export function buildEscapeDE4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeDE4 {
  const analysis = analyzeEscapeSystem4(transforms, finalTransform, symmetry);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no 4D escape-time estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  const links = activeMaps(transforms).map(buildEscapeLink4);
  const de: EscapeCalibrationDE4 = {
    ...links[0],
    links,
    logEstimate: links.some((l) => escapeLinkPower(l.kind) > 0),
    symmetryOrder: effectiveSymmetryOrder(symmetry.order, transforms.length),
    symmetryPlane: symmetry.plane,
    boundingRadius: ESCAPE_TIME_RADIUS,
  };
  return {
    ...de,
    patternCalibration: calibrateEscapePattern4(de),
  };
}

/** One axis of the box fold — `variations.ts`'s `foldAxis`, duplicated for
 * the reason `escape-de.ts` and `variations4.ts` both duplicate it. */
function foldAxis(t: number, wall: number): number {
  return 2 * Math.max(-wall, Math.min(wall, t)) - t;
}

/** The two coordinate indices a {@link SymmetryPlane} names. `xy` → (0, 1)
 * and so on through `zw` → (2, 3) — the same pairs `Rotation4` uses, and on
 * the three `w`-free planes exactly `foldQueryIntoSector`'s `ia`/`ib`. */
const PLANE_AXES: Readonly<Record<SymmetryPlane, [number, number]>> = {
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2],
  xw: [0, 3],
  yw: [1, 3],
  zw: [2, 3],
};

/**
 * The plane code the `core: "escape4"` wire carries — the index into
 * `types.ts`'s `SYMMETRY_PLANES`, so the kernel can recover
 * {@link PLANE_AXES}' pair.
 *
 * It is NOT `surface-de.ts`'s `SYM_PLANE_CODE`, and the difference is
 * load-bearing rather than cosmetic: that one deliberately COLLAPSES
 * `xw`/`yw`/`zw` onto `0`/`1`/`2`, which is sound for the descents (their
 * kaleidoscope is a swept MATRIX, and the code is dead at the only order
 * that would read it) and wrong here, where the wedge fold picks its two
 * axes BY NAME and a `w`-plane is exactly the case this module exists for.
 */
export const SYM_PLANE_CODE4: Readonly<Record<SymmetryPlane, number>> = {
  xy: 0,
  xz: 1,
  yz: 2,
  xw: 3,
  yw: 4,
  zw: 5,
};

/**
 * The kaleidoscope's query-space wedge fold in 4D — `escape-de.ts`'s
 * {@link import("./escape-de").foldQueryIntoSector} over any of the six
 * planes. Reflect `p` into the `π / order` wedge of `plane`, writing into
 * `out` (which may alias `p`); the two coordinates outside the plane ride
 * through untouched.
 *
 * The argument is 3D's verbatim, because it never mentioned the ambient
 * dimension: a rotation by the nearest whole sector followed by a mirror
 * across the plane's first axis is the reflection group's fundamental-domain
 * retraction — a composition of half-space folds, hence continuous, exactly
 * 1-Lipschitz, and an isometry on each sector, so `|g(p)| = |p|` and the
 * marching ball never moves. `order <= 1` is the identity, copied through,
 * which keeps an unsymmetrised document bit-identical.
 *
 * A `w`-plane is ADMISSIBLE here and is exactly what 3D's throw routes to
 * this module. A TWIST is not, and this function never sees one — a double
 * rotation's fundamental domain is not a wedge, so {@link analyzeEscapeSystem4}
 * refuses it before a DE is built.
 */
export function foldQueryIntoSector4(
  p: Vec4,
  order: number,
  plane: SymmetryPlane,
  out: Vec4,
): Vec4 {
  out[0] = p[0];
  out[1] = p[1];
  out[2] = p[2];
  out[3] = p[3];
  if (order <= 1) return out;
  const [ia, ib] = PLANE_AXES[plane];
  const sector = (2 * Math.PI) / order;
  const a = p[ia];
  const b = p[ib];
  const turn = Math.round(Math.atan2(b, a) / sector) * sector;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  out[ia] = a * c + b * s;
  out[ib] = Math.abs(b * c - a * s);
  return out;
}

/** The folded query, reused across calls — module state for the reason 3D's
 * `FOLDED` is (the estimator runs ~1e7 times a frame and is synchronous). */
const FOLDED4: Vec4 = [0, 0, 0, 0];

/** The orbit's terminal radius and derivative bound, left in module scratch
 * by {@link runEscapeOrbit4} so the estimate and the membership reader cannot
 * disagree about what the orbit is — 3D's split, for its reason. */
let orbitR = 0;
let orbitDr = 1;

/**
 * Run the chain's forward orbit from `p`, leaving the terminal radius and
 * derivative bound in the module scratch above. The loop
 * `surface-de-gpu.ts`'s `core: "escape4"` kernel mirrors.
 */
function runEscapeOrbit4(de: EscapeDE4, p: Vec4, maxIterations: number): void {
  const links = de.links;
  const n = links.length;
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector4(p, de.symmetryOrder, de.symmetryPlane, FOLDED4)
      : p;
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let vw = qw;
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw);
  const maxSteps = maxIterations * n;
  for (let step = 0; step < maxSteps && r <= ESCAPE_TIME_RADIUS; step++) {
    const link = links[step % n];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + m[3] * vw + link.t[0];
    const yy = m[4] * vx + m[5] * vy + m[6] * vz + m[7] * vw + link.t[1];
    const yz = m[8] * vx + m[9] * vy + m[10] * vz + m[11] * vw + link.t[2];
    const yw = m[12] * vx + m[13] * vy + m[14] * vz + m[15] * vw + link.t[3];
    let fx: number;
    let fy: number;
    let fz: number;
    let fw: number;
    let localL: number;
    const wall = link.boxLimit;
    const mR2 = link.minRadius2;
    const fR2 = link.fixedRadius2;
    if (link.kind === ESCAPE_LINK_BOXFOLD) {
      fx = foldAxis(yx, wall);
      fy = foldAxis(yy, wall);
      fz = foldAxis(yz, wall);
      fw = foldAxis(yw, wall);
      localL = 1;
    } else if (link.kind === ESCAPE_LINK_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz + yw * yw;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      fw = yw * f;
      localL = f;
    } else if (link.kind === ESCAPE_LINK_MANDELBOX) {
      const bx = foldAxis(yx, wall);
      const by = foldAxis(yy, wall);
      const bz = foldAxis(yz, wall);
      const bw = foldAxis(yw, wall);
      const r2 = bx * bx + by * by + bz * bz + bw * bw;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      fw = bw * f;
      localL = f;
    } else {
      // The FULL quaternion square — `variations4.ts`'s `qsquare`, whose 4D
      // form is the definition and whose 3D form is the `w = 0` restriction.
      // `2·|y|` is EXACT and not a bound in either dimension: quaternion
      // multiplication is norm-multiplicative on the whole algebra, so
      // `|d(q²)| = 2|q|·|dq|` identically (`qjulia-de.ts`).
      fx = yx * yx - yy * yy - yz * yz - yw * yw;
      fy = 2 * yx * yy;
      fz = 2 * yx * yz;
      fw = 2 * yx * yw;
      localL = 2 * Math.sqrt(yx * yx + yy * yy + yz * yz + yw * yw);
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    vw = link.w * fw + qw;
    dr = link.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw);
  }
  orbitR = r;
  orbitDr = dr;
}

/**
 * The shader hit-info orbit's rings/sheets half, separate from
 * {@link runEscapeOrbit4} so distance and membership queries keep their
 * allocation-free hot path unchanged.
 */
function escapePatternCarrierSample4(
  de: EscapeCalibrationDE4,
  p: Vec4,
): SurfaceNativeCarrierSample {
  const links = de.links;
  const n = links.length;
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector4(p, de.symmetryOrder, de.symmetryPlane, FOLDED4)
      : p;
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let vw = qw;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw);
  let rings = 1;
  let sheets = 1;
  const maxSteps = ESCAPE_TIME_ITERATIONS * n;
  for (let step = 0; step < maxSteps && r <= de.boundingRadius; step++) {
    const link = links[step % n];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + m[3] * vw + link.t[0];
    const yy = m[4] * vx + m[5] * vy + m[6] * vz + m[7] * vw + link.t[1];
    const yz = m[8] * vx + m[9] * vy + m[10] * vz + m[11] * vw + link.t[2];
    const yw = m[12] * vx + m[13] * vy + m[14] * vz + m[15] * vw + link.t[3];
    let fx: number;
    let fy: number;
    let fz: number;
    let fw: number;
    const wall = link.boxLimit;
    const mR2 = link.minRadius2;
    const fR2 = link.fixedRadius2;
    if (link.kind === ESCAPE_LINK_BOXFOLD) {
      fx = foldAxis(yx, wall);
      fy = foldAxis(yy, wall);
      fz = foldAxis(yz, wall);
      fw = foldAxis(yw, wall);
    } else if (link.kind === ESCAPE_LINK_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz + yw * yw;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      fw = yw * f;
    } else if (link.kind === ESCAPE_LINK_MANDELBOX) {
      const bx = foldAxis(yx, wall);
      const by = foldAxis(yy, wall);
      const bz = foldAxis(yz, wall);
      const bw = foldAxis(yw, wall);
      const r2 = bx * bx + by * by + bz * bz + bw * bw;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      fw = bw * f;
    } else {
      fx = yx * yx - yy * yy - yz * yz - yw * yw;
      fy = 2 * yx * yy;
      fz = 2 * yx * yz;
      fw = 2 * yx * yw;
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    vw = link.w * fw + qw;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw);
    rings = Math.min(rings, r / de.boundingRadius);
    sheets = Math.min(sheets, Math.abs(vy) / de.boundingRadius);
  }
  return {
    rings: Math.max(0, Math.min(1, rings)),
    sheets: Math.max(0, Math.min(1, sheets)),
  };
}

/** Fixed-seed, camera-independent samples over the query-space 4-ball. */
function calibrateEscapePattern4(
  de: EscapeCalibrationDE4,
): SurfaceNativeCalibration {
  const rng = mulberry32(ESCAPE_PROBE_SEED);
  const samples = new Array<SurfaceNativeCarrierSample>(
    SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT,
  );
  const direction: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < samples.length; i++) {
    const radius = Math.pow(rng(), 0.25) * de.boundingRadius;
    sampleS3(rng, direction);
    samples[i] = escapePatternCarrierSample4(de, [
      radius * direction[0],
      radius * direction[1],
      radius * direction[2],
      radius * direction[3],
    ]);
  }
  return calibrateSurfaceNativeCarriers(samples);
}

/**
 * The 4D escape-time distance estimate — the CPU oracle the `core: "escape4"`
 * kernel mirrors line for line. `maxIterations` counts PASSES, exactly as in
 * 3D, so it says "how many times is each link applied" at any chain length.
 *
 * Returns a bound on the FOUR-dimensional distance, which is also a valid
 * bound on the distance within any 3D slice through the query (the slice
 * distance is never smaller) — the property the 4D descent already relies on,
 * and what lets a 3D sphere tracer march this.
 *
 * Takes no `halfExtent`: a forward orbit cannot thread a segment (module
 * doc), so slab queries are refused rather than approximated.
 */
export function estimateEscapeDistance4(
  de: EscapeDE4,
  p: Vec4,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): number {
  runEscapeOrbit4(de, p, maxIterations);
  if (!de.logEstimate) return orbitR / orbitDr;
  // `ln r` goes negative below r = 1, which a converging orbit reaches, and a
  // negative estimate would march the tracer BACKWARDS — 0 is the inside
  // signal and is safe in the direction a sphere tracer needs. Every module
  // in this family takes the identical exit.
  return orbitR <= 1 ? 0 : (0.5 * orbitR * Math.log(orbitR)) / orbitDr;
}

/**
 * Is `p` in the set the marcher will draw — did its orbit stay inside the
 * bailout ball for the whole budget? The rendered object is the
 * FINITE-BUDGET one, so this asks with the same budget the estimate uses.
 *
 * Exists because thresholding {@link estimateEscapeDistance4} cannot answer
 * it (3D's paragraph, and the set-extent correction of four harness sheets
 * that tried).
 */
export function escapeSetContains4(
  de: EscapeDE4,
  p: Vec4,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): boolean {
  runEscapeOrbit4(de, p, maxIterations);
  return orbitR <= ESCAPE_TIME_RADIUS;
}

/**
 * What fraction of the bailout 4-BALL the rendered set occupies, from a
 * seeded uniform sample.
 *
 * THIS MEASURES VOLUME, AND DOES NOT ANSWER "WILL IT RENDER" — read
 * {@link import("./escape-de").probeEscapeFill}'s warning, which is stronger
 * here than in 3D and was measured on this very family: a `w = 0.4` slice of
 * `hybridChainQuaternion` has LITERALLY ZERO members in 524288 samples of its
 * own bailout ball and still draws 20.9% of its rays as a coherent shaded
 * object. A slice through a set of shells is a set of surfaces, and no
 * volume statistic can see one. In 4D the trap is routine rather than
 * exotic, because every rendered frame IS such a slice.
 */
export function probeEscapeFill4(
  de: EscapeDE4,
  points = ESCAPE_PROBE_POINTS,
  seed = ESCAPE_PROBE_SEED,
): number {
  if (points <= 0) return 0;
  const rng = mulberry32(seed);
  let inside = 0;
  const dir: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < points; i++) {
    // Uniform in the 4-ball: the radial CDF is r⁴, so `u^(1/4)`, against a
    // direction drawn uniformly on S³ by Marsaglia's method (two rejected
    // disc pairs, which is exact where a normalized cube is not).
    const u = Math.pow(rng(), 0.25) * ESCAPE_TIME_RADIUS;
    sampleS3(rng, dir);
    if (
      escapeSetContains4(de, [u * dir[0], u * dir[1], u * dir[2], u * dir[3]])
    ) {
      inside++;
    }
  }
  return inside / points;
}

/** A uniform point on the unit 3-sphere (Marsaglia 1972), written into
 * `out`. Two rejection-sampled unit discs `(x1, x2)` and `(x3, x4)`; the
 * second is rescaled by `sqrt((1 − s1) / s2)`. Exact, unlike normalizing a
 * cube sample, and cheap — the expected rejection count is ~1.27 draws per
 * disc. */
function sampleS3(rng: () => number, out: Vec4): void {
  let x1 = 0;
  let x2 = 0;
  let s1 = 2;
  while (s1 >= 1) {
    x1 = 2 * rng() - 1;
    x2 = 2 * rng() - 1;
    s1 = x1 * x1 + x2 * x2;
  }
  let x3 = 0;
  let x4 = 0;
  let s2 = 2;
  while (s2 >= 1 || s2 === 0) {
    x3 = 2 * rng() - 1;
    x4 = 2 * rng() - 1;
    s2 = x3 * x3 + x4 * x4;
  }
  const scale = Math.sqrt((1 - s1) / s2);
  out[0] = x1;
  out[1] = x2;
  out[2] = x3 * scale;
  out[3] = x4 * scale;
}
