/**
 * Does the Mandelbox sphere fold's ball radius earn a DOCUMENT parameter?
 *
 * `variations.ts`'s `sphereFoldFactor` pins the classic `mR² = 0.25`,
 * `fR² = 1`, and `foldAxis` pins the box wall at 1. Un-freezing them would
 * put the FIRST per-variation parameter into `Variation` (`{type, weight}`
 * today, and every producer — the editor, `random-system`, `mutate-system`,
 * `flame-file`, `morph`'s union-by-type, `persist`'s validator, the GPU
 * flame kernels' weight-only lanes — treats a variation list as a
 * type -> weight MAP), plus the ten oracle-pinned fold mirrors. This sheet
 * exists to say whether that buys a new SHAPE before anyone pays for it.
 *
 * THE TRAP THIS SHEET IS BUILT AROUND. The fold has three lengths — `mR`,
 * `fR`, the box wall — but only two DIMENSIONLESS RATIOS can be new,
 * because uniform pre-scale is equivariant through both folds:
 *
 *     B_1(k·q)          =  k · B_{1/k}(q)
 *     S_{0.5,1}(k·q)    =  k · S_{0.5/k,1/k}(q)
 *     MB_{0.5,1,1}(k·q) =  k · MB_{0.5/k,1/k,1/k}(q)
 *
 * so `w·V(M p + t)` with `M = k·A` ALREADY renders the whole family whose
 * three lengths scale together — that is just the affine part scaling the
 * object, which every author has today. Carried through the escape orbit
 * (`v <- w·V(Mv + t) + p`, `v_0 = p`) with `v = k·u`, `p = k·q`, `t = k·τ`,
 * the same substitution gives the SAME system at apparatus `1/k` and
 * bailout `B/k` — so the whole non-escaping SET scales by `k` and nothing
 * about its shape moves. Verified before this sheet was written: the map
 * identity holds to 1.6e-15 relative over 200k random `(q, k)`, and the
 * ORBIT carries it — 0 escape-count disagreements in 105k samples at
 * `s = 1/2` and `s = 2` (exact in binary f64), 1-4 at `s = 0.7, 1.4`, which
 * are the boundary-straddling rounding flips a chaotic orbit always
 * carries.
 *
 * A panel that merely LOOKS different is therefore not evidence. Every arm
 * here is framed on its OWN measured object radius ({@link objectRadius},
 * a 256-direction inward sphere trace — fine-resolution where the escape
 * family's usual 35³ grid probe would quantize the normalizer by ~3%) at a
 * fixed zoom, so a pure rescale produces the same picture, and the verdict
 * number is {@link maskIoU} against the shipped arm — the object-mask IoU
 * the project already uses as its same-object criterion (the 4D compute
 * port's verdict read 0.996). High IoU after normalization = a zoom you
 * already have = do not pay the schema.
 *
 * GUARD THE GUARD. `it("conjugation control")` sweeps all three lengths
 * TOGETHER (plus the bailout and `t`, which the substitution also scales).
 * Its IoU must read ~1: if it does not, the normalization is broken and
 * every other number on this sheet is meaningless. It is held to
 * `s ∈ [0.5, 2]` for a reason — `de-preview.ts`'s hit test is
 * `d < eps·max(t, 1)`, whose `max(·, 1)` kink is the one part of the
 * marcher that is NOT scale-covariant, and these scales keep every marched
 * `t` above 1.
 *
 * THE ESTIMATOR. {@link paramEscapeDE} is `escape-de.ts`'s `runEscapeOrbit`
 * with the three lengths and the bailout lifted out of the constants — the
 * `juliaFormDE` idiom `escape-form-sweep.harness.ts` used for the form it
 * had not paid six mirrors for. It is not TRUSTED to be that estimator:
 * `it("pins the parameterized fold")` asserts it returns
 * `estimateEscapeDistance`'s value TO THE BIT at shipped parameters over
 * 24k queries, so a reconstruction error cannot pass as a measurement.
 * The later arms lifted its two original restrictions: it takes ONE parameter
 * record per LINK (broadcast from one, which is how the four original arms
 * still read) and cycles `links[step % n]` like the shipped orbit, and it
 * applies the kaleidoscope's query-space wedge by calling the estimator's
 * OWN `foldQueryIntoSector`. Both lifts are pinned the same way, over a
 * 2-link chain, a 3-link chain, an order-5 chain and an order-3 single map.
 *
 * SEVEN SHEETS, because the parameter would land in several very different
 * roles and they can disagree:
 *   1. `spherefold-magnification.png` — `fR²/mR²` (the ×4 inner
 *      inflation), the ratio no conjugation reaches. `mR = fR` is the
 *      identity end: the mid shell closes, the factor is `fR²/fR²`
 *      everywhere and the sphere fold vanishes, leaving the box fold
 *      alone — so arm 0 is a principled end of the axis, not an arbitrary
 *      extreme.
 *   2. `spherefold-ball-vs-box.png` — `fR/wall`, the second ratio: how
 *      much of the folding is mirrors and how much is lens. Magnification
 *      is held at the shipped 4× so this axis moves one ratio only.
 *   3. `spherefold-conjugation.png` — the control above.
 *   4. `spherefold-lens.png` — the ONE-SHOT case, which is the shape a
 *      `mandelbox` FINAL transform has (`chaos-game.ts`'s `plotPoint`
 *      bends each plotted point once and never feeds it back), measured
 *      on a hand-authored affine attractor as an occupancy IoU over the
 *      scale-normalized cloud. An iterated fold compounds its parameters;
 *      a lens applied once may not, and the document parameter would be
 *      the same field for both. No preset carries a pure-fold FINAL, so
 *      the base system is authored here rather than loaded.
 * And the three added later, which ask where the first four stopped:
 *   5. `spherefold-chain-links.png` — the SAME map alone, as link 0 of a
 *      three-link chain, as link 1, and both links moved together. A
 *      per-link parameter gives a six-link chain twelve new ratios, so the
 *      question is whether those twelve are twelve degrees of freedom.
 *   6. `spherefold-bare-lens.png` — the bare `spherefold` against the
 *      `mandelbox` composition through the same lens on the same attractor,
 *      which is the box-wall CONTROL: without a box there is only one ratio
 *      left. (The escape-time half of that arm renders no sheet, because it
 *      found nothing to render — see the verdict.)
 *   7. `spherefold-kaleidoscope.png` — `foldChain` against
 *      `foldChainFlower`, the same chain with a five-fold query-space wedge
 *      on and off, swept identically.
 *
 * A BLANK ARM IS A FINDING, not a failure: a parameter value that empties
 * the set is exactly what this sheet is looking for. Only the SHIPPED
 * reference panel of each row is asserted non-blank, because the IoU
 * column is meaningless without it.
 *
 * THE VERDICT (measured, this sheet's own numbers):
 *
 * The control is exact — IoU 1.000 and relief 0.0000 at every scale across
 * a 4x span of apparatus size, five visually identical panels, with
 * `radius/s` reading 3.941 to three decimals at all five. A pure rescale
 * is INVISIBLE to this instrument, so every number below is a shape
 * difference and not a zoom.
 *
 * BOTH RATIOS ARE REAL PARAMETERS. The `fR/wall` axis is the stronger of
 * the two: growing the ball past the box takes the w=2 object from a
 * solid pitted Mandelbox to a sparse gasket of separated clusters —
 * IoU 0.215 at `fR = 2`, with hits collapsing 30.4% -> 11.5%. The
 * magnification axis moves the same object over IoU 0.69-0.87.
 *
 * SILHOUETTE IS NOT THE WHOLE STORY, and this is why {@link relief}
 * exists. The `w = -1.5` cube rows sit at IoU 0.93-0.98 THROUGHOUT — the
 * silhouette is a cube whatever the parameters — while their faces go
 * from nearly featureless to deep concentric rosettes: 35.6% of shared
 * pixels off by >2% of the radius on the magnification axis, 63.6% at
 * `fR = 2`. Read the two columns together; IoU alone under-reports.
 *
 * THE ONE-SHOT LENS IS THE MOST SENSITIVE ROLE OF ALL, which is the
 * result this sheet did not expect: a lens applied once cannot compound
 * its parameters the way 30 iterations can, and it moves FURTHER anyway.
 * Across the same `mR` range the cloud's occupancy IoU against the
 * shipped arm runs 0.16-0.31 — six essentially distinct objects. The
 * bracket that makes the scale of that concrete, all within the one
 * metric: at `mR = fR` the lens is exactly the identity on this attractor
 * (IoU-vs-unlensed 1.000, since the attractor lies inside the box and the
 * sphere fold has closed), and moving the ratio from the shipped 4x to
 * 16x moves the cloud ALMOST AS FAR as deleting the lens altogether
 * (0.214 against 0.164).
 *
 * So the parameter earns its schema cost, and it earns it MOST in the
 * FINAL-transform role — the one place a reader would have guessed a
 * once-applied map would be bland. What it would cost is unchanged and
 * unchanged: the first per-variation parameter in the document,
 * ten oracle-pinned fold mirrors, `SPHEREFOLD_LIPSCHITZ` becoming
 * `fR²/mR²` (which moves the surface DE's eligibility gate with the
 * knob), and `SPHEREFOLD_MID_MIN_R` scaling with `fR²`. The GPU wire
 * needs nothing: `GpuMap`'s `p1` lane and `GpuMap4`'s carry two free f32
 * each, so a packed `(mR², fR²)` pair fits inside the frozen strides.
 *
 * THE EXTENSION VERDICT (four more arms, same instrument):
 *
 * A CHAIN DAMPS ITS OWN LINKS, which is the formula chain's bound-quality
 * result showing up in the picture. `mandelboxClassic` and
 * `foldChainBoulder`'s link 0 are the SAME map (mandelbox at weight 2,
 * unrotated), so the comparison is like-for-like: moving that map's
 * magnification displaces the object by 1 − IoU =
 * 0.309/0.222/0.168/0.126/0.157 across the `mR` arms when it is alone, and
 * 0.081/0.057/0.039/0.024/0.025 when it is one link of three — 3.8x to 6.4x
 * QUIETER, monotonically more so the further the ratio moves. So a six-link
 * chain's twelve ratios are twelve weak knobs, not twelve strong ones.
 *
 * AND THEY BARELY INTERACT. Link 1's own displacement measured with link 0
 * at the shipped ratio, against the same displacement measured after link 0
 * has already moved to that ratio, runs 0.72x-0.91x at four of five arms
 * (1.71x at `mR = fR`, the identity end where link 0's fold has vanished
 * and the comparison is between two nearly-equal small numbers). Roughly
 * separable, then: each link's contribution does not depend much on what
 * the others are set to. One structural note the same fixture makes
 * plainly: a BOX-FOLD link's `mR`/`fR` are inert, so a per-variation
 * schema hands `boxfold` two fields it cannot use.
 *
 * THE BARE SPHERE FOLD HAS NO ESCAPE-TIME OBJECT AT ALL — a negative result,
 * and structural rather than a bad choice of weight. The sphere fold only
 * ever moves points OUTWARD in radius (inner scales by `fR²/mR²`, mid sends
 * `[mR, fR]` out to `[fR, fR²/mR]`, outer is the identity), so with no box
 * fold to bring them back the orbit splits on `|w|` and neither half is a
 * fractal: at `|w| >= 1.2` nothing is captured and the set measures EMPTY at
 * every affine part and offset tried (0.00% fill, 8 of 8 weights x 4
 * fixtures), while at `|w| < 1` the outer branch alone contracts to a fixed
 * point and the set is a smooth SOLID (0.8% to 100% fill) whose boundary is
 * not a `dr` blow-up — so the Buddhi/Rrrola heuristic cannot see it, and a
 * ray marching inward accepts only at the origin (measured radius 0.000 at
 * every CONFORMAL affine part; anisotropy is the only thing that gives the
 * heuristic a surface, and it finds a blob). This is why the first four arms'
 * mandelbox rows are not a confound to be controlled away: in the escape-time
 * family, the box fold is what makes an object exist for the sphere fold's
 * ratios to shape.
 *
 * SO THE CONTROL RUNS THROUGH THE LENS instead, where a bare sphere fold IS
 * well-defined — and it needs a pre-scale to mean anything. At the lens's
 * own scale the attractor lies entirely INSIDE the box wall, so the box
 * fold is the identity on every plotted point and the bare and boxed rows
 * come out at occupancy IoU exactly 1.000: a perfect agreement that says
 * nothing, and a reminder that `fR/wall` does nothing to a cloud that never
 * reaches the wall. Pre-scaled 2x so the cloud straddles it, the bare
 * sphere fold alone moves the cloud 0.666/0.468/0.301/0.305/0.317 and the
 * composition 0.713/0.581/0.414/0.395/0.408 — a box contribution of
 * 1.07x-1.38x. The magnification ratio is therefore REAL ON THE BALL
 * ALONE; the box amplifies it by a third at most.
 *
 * THE KALEIDOSCOPE IS ORTHOGONAL, as the algebra suggests it should be: the
 * wedge fold is angular and an isometry per sector, the sphere fold is
 * radial. `foldChain` displaces 0.144/0.085/0.049/0.026/0.027 across the
 * arms and `foldChainFlower` — the same chain, five-fold wedge on —
 * 0.137/0.093/0.098/0.011/0.012, i.e. 0.42x-1.98x with no direction to it
 * and both small. No amplification, no damping, nothing a per-link
 * parameter has to account for.
 *
 * THE ELIGIBILITY SEAM IS REACHED BY EXACTLY ONE SHIPPED SYSTEM, which is
 * the number the eligibility-gate UI question turns on.
 * `SPHEREFOLD_LIPSCHITZ` IS the magnification ratio (asserted, not assumed:
 * `fR²/mR² = 4` at the shipped lengths), and it multiplies into
 * `analyzeSurfaceSystem`'s contraction
 * gate and — as the deliberate complement — into `analyzeEscapeSystem`'s
 * admits-when-something-expands test, so both gates pivot on the same
 * threshold `rho_crit = min_i CONTRACTION_LIMIT / (|w_i|·sigma_max(M_i))`
 * over the SPHERE-FAMILY maps. Tabulated over every shipped fold system,
 * within the schema's own domain `mR <= fR` (i.e. `rho >= 1`):
 *   - `mandelboxKifs` CROSSES, and it is not far: `rho_crit` 4.382 against
 *     the shipped 4.0, a 9% margin — `mR` 0.478 instead of 0.500 at
 *     `fR = 1`, bound by map 1 (|w| 1.20 x sigma_max 0.190). A 4.4% edit
 *     to one field moves the app's flagship fold preset from the Surface
 *     descent to the escape-time renderer.
 *   - the three single-map escape presets would need `rho` 0.333-0.666,
 *     i.e. `mR` 1.2-1.7 at `fR = 1`, which is `mR > fR` and outside the
 *     domain. UNREACHABLE.
 *   - all three CHAINS are unreachable at any ratio, and for a reason no
 *     tuning changes: each contains a box-fold link whose Lipschitz bound
 *     is 1 at every ratio and which already expands, so something in the
 *     chain expands whatever the knob does.
 *   - `mandelboxLattice` has no PURE-fold map (its `mandelbox` is blended
 *     with `linear`), so neither gate's fold path applies to it at all.
 * Two scope facts bound the problem further. The box wall NEVER enters
 * either gate — box branches are reflection isometries at any wall — so
 * the ratio this sheet measured as the STRONGER of the two is gate-free.
 * And the FINAL-transform lens has no contraction gate at all
 * (`surface-de.ts`'s `descendLens`: an un-iterated lens needs none), so the
 * ROLE this sheet measured as the most sensitive is gate-free too. The
 * design problem is one system and one ratio wide.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/spherefold-radius-sweep.harness.ts
 * Writes: `scripts/out/spherefold-*.png`
 */
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  estimateEscapeDistance,
  foldQueryIntoSector,
  probeEscapeFill,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import {
  analyzeSurfaceSystem,
  transformSigmas,
  CONTRACTION_LIMIT,
  SPHEREFOLD_LIPSCHITZ,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import {
  foldChain,
  foldChainBoulder,
  foldChainFlower,
  mandelboxClassic,
  mandelboxCube,
  mandelboxKifs,
  mandelboxLattice,
  mandelboxRings,
  PRESET_SYMMETRIES,
} from "../src/fractal/presets";
import { runChaosGame } from "../src/fractal/chaos-game";
import { mulberry32 } from "../src/fractal/rng";
import type {
  SymmetryParams,
  Transform,
  Variation,
} from "../src/fractal/types";
import { renderPreview, writeContactSheet, PREVIEW_HIT } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 320;
/** The escape family's pose (`escape-chain.harness.ts`, `chain-speckle`),
 * so these panels read beside those sheets. Fixed across every arm — the
 * framing must not move when the object does. */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/**
 * The three lengths the shipped fold bakes in, plus the bailout the orbit
 * tests against. `wall` is `foldAxis`'s reflection plane; `mR`/`fR` are
 * `sphereFoldFactor`'s minimum and fixed radii.
 */
interface FoldParams {
  mR: number;
  fR: number;
  wall: number;
  bailout: number;
}

const SHIPPED: FoldParams = {
  mR: 0.5,
  fR: 1,
  wall: 1,
  bailout: ESCAPE_TIME_RADIUS,
};

/** The two ratios that survive conjugation — the only things a parameter
 * could actually buy. Printed on every row so the sheet reads as a sweep
 * of THEM rather than of three correlated numbers. */
const magnification = (fp: FoldParams) => (fp.fR * fp.fR) / (fp.mR * fp.mR);
const ballOverBox = (fp: FoldParams) => fp.fR / fp.wall;

/** `foldChainFlower`'s five-fold wedge, read off the shipped side table
 * rather than re-typed — the preset IS its kaleidoscope (presets.ts), and
 * arm 3 exists to sweep exactly that pairing. */
const FLOWER_SYMMETRY: SymmetryParams = PRESET_SYMMETRIES.foldChainFlower!;

/** One chain's worth of parameters with a single link overridden — the
 * per-link sweep's only move. `link` indexes the DOCUMENT's active maps, in
 * order, which is the order `buildEscapeDE` builds `links` in. */
function perLink(n: number, link: number, override: Partial<FoldParams>) {
  return Array.from({ length: n }, (_, i) =>
    i === link ? { ...SHIPPED, ...override } : { ...SHIPPED },
  );
}

/** A single pure-fold map — the shape `analyzeEscapeSystem` admits, and
 * `presets.ts`'s `escapeMandelbox` recipe verbatim. `preScale` is the map's
 * own affine part, left at the preset's 1 everywhere except the lens control
 * (arm 2), which needs the cloud to reach past the box wall. */
function foldSystem(weight: number, position: Vec3, preScale = 1): Transform {
  return {
    id: 1,
    position,
    rotation: [0, 0, 0],
    scale: [preScale, preScale, preScale],
    variations: [{ type: "mandelbox", weight }],
  };
}

/** The same recipe with the BARE sphere fold — no box wall in the map at
 * all, which is what makes arm 2 a one-ratio control (module doc). */
function sphereFoldSystem(
  weight: number,
  position: Vec3,
  preScale = 1,
): Transform {
  return {
    id: 1,
    position,
    rotation: [0, 0, 0],
    scale: [preScale, preScale, preScale],
    variations: [{ type: "spherefold", weight }],
  };
}

/** `surface-de.ts`'s `pureFoldVariation` predicate, which is module-private
 * there: the single active fold-family entry a map's variation list must be
 * for either gate to admit it. Arm 4 re-derives the gate's own arithmetic,
 * so it needs the gate's own notion of which variation carries it. */
function soleFoldVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  const v = active[0];
  return v.type === "boxfold" ||
    v.type === "spherefold" ||
    v.type === "mandelbox"
    ? v
    : null;
}

/**
 * `escape-de.ts`'s `runEscapeOrbit` with {@link FoldParams} lifted out of
 * the constants: `v <- w·V(Mv + t) + p` seeded at `v_0 = p`, one shared
 * scalar Buddhi/Rrrola derivative floored by `+ 1` per link, bailout tested
 * once per step. `derivGrowth` is deliberately reused unchanged — it is
 * `|w|·sigma_max(M)`, which no fold length enters; the sphere fold's
 * contribution rides the per-step `localL`, and that picks up the new
 * parameters on its own.
 *
 * CHAINS (arm 1). `fp` is either ONE record broadcast to every
 * link, or one PER LINK in document order — the shape a document field
 * would actually have, since the lengths would live on the `Variation` and
 * the chain carries one fold variation per link. The orbit cycles
 * `links[step % n]` for `ESCAPE_TIME_ITERATIONS * n` single-link steps,
 * which is `runEscapeOrbit` verbatim ("THE LIST IS THE SEQUENCE"). The
 * BAILOUT is the orbit's and not a link's, so an array must agree on it —
 * it rides the same record only because the conjugation control has to
 * scale it with the lengths.
 *
 * KALEIDOSCOPE (arm 3). The wedge fold is applied ONCE, before the
 * orbit, and the folded point seeds AND offsets it — `foldQueryIntoSector`
 * imported from the estimator itself rather than re-derived, so the one
 * thing this copy must not get wrong it cannot get wrong.
 *
 * Pinned bit-exact against the shipped estimator at {@link SHIPPED} by the
 * first two `it`s below — single link, chain, and kaleidoscope — so nothing
 * here rests on the copy being faithful by inspection.
 */
function paramEscapeDE(
  de: EscapeDE,
  fp: FoldParams | FoldParams[],
): DistanceEstimator {
  const links = de.links;
  const n = links.length;
  const per = Array.isArray(fp) ? fp : links.map(() => fp);
  if (per.length !== n) {
    throw new Error(
      `paramEscapeDE: ${per.length} parameter records for ${n} links`,
    );
  }
  const bailout = per[0].bailout;
  if (per.some((f) => f.bailout !== bailout)) {
    throw new Error("paramEscapeDE: the bailout is the orbit's, not a link's");
  }
  // Hoisted per-link scratch: this estimator runs ~1e6 times per panel.
  const mR2 = per.map((f) => f.mR * f.mR);
  const fR2 = per.map((f) => f.fR * f.fR);
  const walls = per.map((f) => f.wall);
  const order = de.symmetryOrder;
  const plane = de.symmetryPlane;
  const folded: Vec3 = [0, 0, 0];
  const maxSteps = ESCAPE_TIME_ITERATIONS * n;
  return (p) => {
    const q = order > 1 ? foldQueryIntoSector(p, order, plane, folded) : p;
    const qx = q[0];
    const qy = q[1];
    const qz = q[2];
    let vx = qx;
    let vy = qy;
    let vz = qz;
    let dr = 1;
    let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    for (let step = 0; step < maxSteps && r <= bailout; step++) {
      const li = step % n;
      const link = links[li];
      const m = link.m;
      let yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
      let yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
      let yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
      let localL = 1;
      if (link.kind !== SURFACE_FOLD_SPHEREFOLD) {
        const wall = walls[li];
        yx = 2 * Math.max(-wall, Math.min(wall, yx)) - yx;
        yy = 2 * Math.max(-wall, Math.min(wall, yy)) - yy;
        yz = 2 * Math.max(-wall, Math.min(wall, yz)) - yz;
      }
      if (link.kind !== SURFACE_FOLD_BOXFOLD) {
        const f =
          fR2[li] /
          Math.max(mR2[li], Math.min(fR2[li], yx * yx + yy * yy + yz * yz));
        yx *= f;
        yy *= f;
        yz *= f;
        localL = f;
      }
      vx = link.w * yx + qx;
      vy = link.w * yy + qy;
      vz = link.w * yz + qz;
      dr = link.derivGrowth * localL * dr + 1;
      r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    return r / dr;
  };
}

/** The same fold applied ONCE — a pure-fold FINAL transform's plot-time
 * lens `w·V(M p + t)`, which is what `chaos-game.ts`'s `plotPoint` does to
 * every plotted point. The `EscapeDE` is used purely as a carrier for the
 * `composeAffine` the app itself would build, and `foldKind` picks which
 * fold is applied exactly as {@link paramEscapeDE} does — so a `spherefold`
 * lens (arm 2) and a `mandelbox` one run the same code path. */
function paramFoldOnce(de: EscapeDE, fp: FoldParams, p: Vec3, out: Vec3): void {
  const m = de.m;
  const mR2 = fp.mR * fp.mR;
  const fR2 = fp.fR * fp.fR;
  const wall = fp.wall;
  let x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0];
  let y = m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1];
  let z = m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2];
  if (de.kind !== SURFACE_FOLD_SPHEREFOLD) {
    x = 2 * Math.max(-wall, Math.min(wall, x)) - x;
    y = 2 * Math.max(-wall, Math.min(wall, y)) - y;
    z = 2 * Math.max(-wall, Math.min(wall, z)) - z;
  }
  if (de.kind !== SURFACE_FOLD_BOXFOLD) {
    const f = fR2 / Math.max(mR2, Math.min(fR2, x * x + y * y + z * z));
    x *= f;
    y *= f;
    z *= f;
  }
  out[0] = de.w * x;
  out[1] = de.w * y;
  out[2] = de.w * z;
}

/** The affine attractor both lens arms bend. Hand-authored rather than
 * loaded, because no preset ships a pure-fold FINAL — and SHARED, so the
 * `mandelbox` lens row and the bare `spherefold` one differ in exactly one
 * thing: whether a box fold is in the map. That is what makes arm 2 a
 * control for the box-wall confound rather than a second unrelated sheet. */
const LENS_BASE: Transform[] = [
  {
    id: 1,
    position: [0.4, 0.35, 0.1],
    rotation: [0.2, 0.5, 0],
    scale: [0.52, 0.52, 0.52],
  },
  {
    id: 2,
    position: [-0.45, 0.2, -0.3],
    rotation: [0, -0.7, 0.3],
    scale: [0.5, 0.5, 0.5],
  },
  {
    id: 3,
    position: [0.1, -0.5, 0.35],
    rotation: [0.9, 0, -0.4],
    scale: [0.48, 0.48, 0.48],
  },
  {
    id: 4,
    position: [-0.15, -0.3, -0.45],
    rotation: [-0.3, 0.25, 0.8],
    scale: [0.5, 0.5, 0.5],
  },
];

/** Every point of `cloud` through the one-shot lens, scale-normalized. */
function bendCloud(
  lens: EscapeDE,
  fp: FoldParams,
  cloud: { positions: Float32Array; count: number },
): { points: Float32Array; rms: number } {
  const out = new Float32Array(cloud.count * 3);
  const q: Vec3 = [0, 0, 0];
  for (let i = 0; i < cloud.count; i++) {
    paramFoldOnce(
      lens,
      fp,
      [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ],
      q,
    );
    out[i * 3] = q[0];
    out[i * 3 + 1] = q[1];
    out[i * 3 + 2] = q[2];
  }
  return normalizeCloud(out, cloud.count);
}

/** 256 near-uniform directions (Fibonacci sphere) — deterministic, and the
 * same set for every arm, so a radius difference is the object's and not
 * the sampling's. */
const DIRECTIONS: Vec3[] = (() => {
  const n = 256;
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i): Vec3 => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    return [Math.cos(th) * rad, y, Math.sin(th) * rad];
  });
})();

/**
 * The object's circumscribed radius, by sphere-tracing INWARD from the
 * bailout ball along {@link DIRECTIONS} and taking the furthest first hit.
 * Every quantity scales with `R0`, so under the conjugation control this
 * returns exactly `s ×` the shipped arm's radius — which is what makes a
 * per-arm camera a normalization rather than one more free variable.
 */
function objectRadius(de: DistanceEstimator, R0: number): number {
  const eps = R0 * 1e-4;
  let best = 0;
  for (const d of DIRECTIONS) {
    let t = 0;
    for (let i = 0; i < 400 && t < R0; i++) {
      const s = R0 - t;
      const v = de([d[0] * s, d[1] * s, d[2] * s]);
      if (v < eps) {
        best = Math.max(best, s);
        break;
      }
      t += Math.max(v * ESCAPE_STEP_SCALE, eps);
    }
  }
  return best;
}

/** Intersection-over-union of two panels' HIT masks — the project's
 * same-object criterion. Both panels must have been rendered with
 * `collect`. */
function maskIoU(a: PanelStats, b: PanelStats): number {
  const sa = a.status;
  const sb = b.status;
  if (!sa || !sb) throw new Error("maskIoU needs collect: true");
  let inter = 0;
  let union = 0;
  for (let i = 0; i < sa.length; i++) {
    const ha = sa[i] === PREVIEW_HIT;
    const hb = sb[i] === PREVIEW_HIT;
    if (ha && hb) inter++;
    if (ha || hb) union++;
  }
  return union === 0 ? 1 : inter / union;
}

interface Arm {
  panel: PanelStats;
  /** The measured object radius this arm was framed on. */
  radius: number;
}

/**
 * Surface RELIEF disagreement, the complement {@link maskIoU} needs: over
 * the pixels BOTH arms hit, the hit point's distance from the origin in
 * units of that arm's own object radius — so it is a camera-free,
 * scale-free statement of "how far out is the surface in this direction".
 * Returns its RMS and the fraction of shared pixels differing by more than
 * 2% of the radius.
 *
 * It exists because the sheet's first run measured the cube rows at IoU
 * 0.93-0.98 while their FACES went from nearly featureless to deep
 * concentric rosettes: a mask IoU compares silhouettes, and two objects can
 * share one exactly while sharing no surface at all. Scale-covariant like
 * everything else here, so the conjugation control pins it at ~0 too.
 */
function relief(a: Arm, b: Arm): { rms: number; frac: number } {
  const sa = a.panel.status;
  const sb = b.panel.status;
  const pa = a.panel.hitPos;
  const pb = b.panel.hitPos;
  if (!sa || !sb || !pa || !pb) throw new Error("relief needs collect: true");
  let n = 0;
  let sum = 0;
  let off = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== PREVIEW_HIT || sb[i] !== PREVIEW_HIT) continue;
    const ra =
      Math.hypot(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]) / (a.radius || 1);
    const rb =
      Math.hypot(pb[i * 3], pb[i * 3 + 1], pb[i * 3 + 2]) / (b.radius || 1);
    const d = ra - rb;
    sum += d * d;
    if (Math.abs(d) > 0.02) off++;
    n++;
  }
  return n === 0
    ? { rms: 0, frac: 0 }
    : { rms: Math.sqrt(sum / n), frac: off / n };
}

const reliefCol = (a: Arm, b: Arm): string => {
  const { rms, frac } = relief(a, b);
  return `relief ${rms.toFixed(4)} (${(100 * frac).toFixed(1)}% of shared px >2%)`;
};

/** One arm, framed on its own measured radius at the shared zoom. */
function armPanel(de: DistanceEstimator, R0: number): Arm {
  const radius = objectRadius(de, R0);
  const panel = renderPreview(
    {
      de,
      boundingRadius: radius > 0 ? radius * 1.15 : R0,
      stepScale: ESCAPE_STEP_SCALE,
      eyeOffset: EYE,
      zoom: ZOOM,
      collect: true,
    },
    SIZE,
  );
  return { panel, radius };
}

const hitPct = (p: PanelStats) => ((100 * p.hits) / (SIZE * SIZE)).toFixed(2);

/* ------------------------------------------------------------------ */

describe("spherefold radius sweep", () => {
  it("pins the parameterized fold to the shipped estimator", () => {
    // The whole sheet rests on paramEscapeDE being runEscapeOrbit with three
    // constants lifted out. Assert it; don't inspect it.
    const rng = mulberry32(0x5f01d);
    for (const w of [2, 3, -1.5]) {
      for (const t of [
        [0, 0, 0],
        [0.4, 0.3, 0.2],
      ] as Vec3[]) {
        const de = buildEscapeDE([foldSystem(w, t)]);
        const local = paramEscapeDE(de, SHIPPED);
        for (let i = 0; i < 4000; i++) {
          const p: Vec3 = [rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6];
          expect(
            local(p),
            `w=${w} t=[${t.join(", ")}] p=[${p.join(", ")}]`,
          ).toBe(estimateEscapeDistance(de, p));
        }
      }
    }
  });

  it("pins the parameterized fold on a CHAIN and under a kaleidoscope", () => {
    // Arms 1 and 3 lift the two restrictions the original copy threw
    // on. Both were guarding a real hazard — a chain that ignored
    // `links[step % n]` and a kaleidoscope that skipped `foldQueryIntoSector`
    // would each render a DIFFERENT object while every IoU column below still
    // looked plausible — so the lift is worth exactly as much as this pin.
    const rng = mulberry32(0x5f02e);
    const cases: [string, Transform[], SymmetryParams][] = [
      ["foldChain (2 links)", foldChain(), { order: 1, plane: "xz" }],
      [
        "foldChainBoulder (3 links)",
        foldChainBoulder(),
        { order: 1, plane: "xz" },
      ],
      [
        "foldChainFlower (2 links, order 5)",
        foldChainFlower(),
        FLOWER_SYMMETRY,
      ],
      [
        "mandelboxClassic (1 link)",
        mandelboxClassic(),
        { order: 1, plane: "xz" },
      ],
      // A kaleidoscope over ONE link: the wedge fold and the chain cycle are
      // independent lifts, so the pin has to cross them.
      [
        "mandelboxClassic under order 3",
        mandelboxClassic(),
        { order: 3, plane: "xy" },
      ],
    ];
    for (const [label, transforms, symmetry] of cases) {
      const de = buildEscapeDE(transforms, null, symmetry);
      const local = paramEscapeDE(de, SHIPPED);
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6];
        expect(local(p), `${label} p=[${p.join(", ")}]`).toBe(
          estimateEscapeDistance(de, p),
        );
      }
    }
  });

  it("pins the PRODUCTION estimator's own fold radii against this copy", () => {
    // The authored fold lengths gave `Variation` its three lengths, so
    // `estimateEscapeDistance` now reads them off the document instead of
    // baking them in. This sheet's copy predates that and was pinned at the
    // classic lengths before it existed — which makes it an INDEPENDENT
    // oracle for the parameterized production path, not a restatement of it.
    // Same lengths, two implementations, bit-exact or the change is wrong.
    const rng = mulberry32(0x5f03c);
    const cases: [string, FoldParams[]][] = [
      ["one link, wider ball", [{ mR: 0.35, fR: 1.4, wall: 1, bailout: 4 }]],
      ["one link, tighter box", [{ mR: 0.5, fR: 1, wall: 0.6, bailout: 4 }]],
      [
        "two links, DIFFERENT lengths per link",
        [
          { mR: 0.3, fR: 1.2, wall: 0.9, bailout: 4 },
          { mR: 0.45, fR: 0.8, wall: 1.5, bailout: 4 },
        ],
      ],
    ];
    for (const [label, per] of cases) {
      // The document the app would carry: one fold variation per link, each
      // with its own three fields.
      const authored: Transform[] = per.map((fp, i) => ({
        id: i,
        position: [0, 0, 0],
        rotation: [0, (i * 20 * Math.PI) / 180, 0],
        scale: [1, 1, 1],
        variations: [
          {
            type: "mandelbox" as const,
            weight: i === 0 ? 2 : 1.6,
            minRadius: fp.mR,
            fixedRadius: fp.fR,
            boxLimit: fp.wall,
          },
        ],
      }));
      // The same system with the fields absent — the carrier this sheet's own
      // estimator parameterizes from the outside.
      const bare: Transform[] = authored.map((t) => ({
        ...t,
        variations: [
          { type: "mandelbox" as const, weight: t.variations![0].weight },
        ],
      }));
      const production = buildEscapeDE(authored);
      const local = paramEscapeDE(buildEscapeDE(bare), per);
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6];
        expect(local(p), `${label} p=[${p.join(", ")}]`).toBe(
          estimateEscapeDistance(production, p),
        );
      }
    }
  });

  it("sweeps the magnification ratio fR²/mR²", () => {
    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const systems: [string, number][] = [
      ["ball w=2   ", 2],
      ["cube w=-1.5", -1.5],
    ];
    const panels: PanelStats[] = [];
    for (const [label, w] of systems) {
      const de = buildEscapeDE([foldSystem(w, [0, 0, 0])]);
      const row = arms.map((mR) => {
        const fp = { ...SHIPPED, mR };
        return armPanel(paramEscapeDE(de, fp), fp.bailout);
      });
      const ref = row[shippedAt];
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, mR: arms[i] };
        console.log(
          `  ${label}  mR ${arms[i].toFixed(2)}  ` +
            `magnification ${magnification(fp).toFixed(2)}x  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank, so its IoU column means nothing`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
      panels.push(...row.map((a) => a.panel));
    }
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-magnification.png")}`,
    );
  });

  it("sweeps the ball-vs-box ratio fR/wall", () => {
    const arms = [0.5, 0.7, 1.0, 1.4, 2.0];
    const shippedAt = arms.indexOf(SHIPPED.fR);
    const systems: [string, number][] = [
      ["ball w=2   ", 2],
      ["cube w=-1.5", -1.5],
    ];
    const panels: PanelStats[] = [];
    for (const [label, w] of systems) {
      const de = buildEscapeDE([foldSystem(w, [0, 0, 0])]);
      const row = arms.map((fR) => {
        const fp = { ...SHIPPED, fR, mR: fR / 2 };
        return armPanel(paramEscapeDE(de, fp), fp.bailout);
      });
      const ref = row[shippedAt];
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, fR: arms[i], mR: arms[i] / 2 };
        console.log(
          `  ${label}  fR ${arms[i].toFixed(2)}  ` +
            `ball/box ${ballOverBox(fp).toFixed(2)}  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
      panels.push(...row.map((a) => a.panel));
    }
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-ball-vs-box.png")}`,
    );
  });

  it("conjugation control: scaling all three lengths must change nothing", () => {
    // The guard the other sheets are read against. Both ratios are held and
    // every length — mR, fR, wall, the bailout, and t, which the
    // substitution v = k·u also scales — moves together, so the set is the
    // shipped set scaled by s and the per-arm camera must undo it exactly.
    const scales = [0.5, 0.7, 1.0, 1.4, 2.0];
    const shippedAt = scales.indexOf(1.0);
    const t: Vec3 = [0.4, 0.3, 0.2];
    const row = scales.map((s) => {
      const de = buildEscapeDE([foldSystem(2, [t[0] * s, t[1] * s, t[2] * s])]);
      const fp: FoldParams = {
        mR: SHIPPED.mR * s,
        fR: SHIPPED.fR * s,
        wall: SHIPPED.wall * s,
        bailout: SHIPPED.bailout * s,
      };
      return armPanel(paramEscapeDE(de, fp), fp.bailout);
    });
    const ref = row[shippedAt];
    row.forEach((arm, i) => {
      console.log(
        `  s ${scales[i].toFixed(2)}  radius ${arm.radius.toFixed(3)}  ` +
          `radius/s ${(arm.radius / scales[i]).toFixed(3)}  ` +
          `hits ${hitPct(arm.panel)}%  ` +
          `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
          reliefCol(arm, ref),
      );
    });
    console.log(
      `  wrote ${writeContactSheet(
        row.map((a) => a.panel),
        scales.length,
        "spherefold-conjugation.png",
      )}`,
    );
    // If either of these fails, the normalization is broken and no other
    // number on this sheet means anything.
    row.forEach((arm, i) => {
      expect(
        maskIoU(arm.panel, ref.panel),
        `conjugation control s=${scales[i]}: silhouette moved`,
      ).toBeGreaterThan(0.97);
      expect(
        relief(arm, ref).rms,
        `conjugation control s=${scales[i]}: surface moved`,
      ).toBeLessThan(0.01);
    });
  });

  it("sweeps the magnification ratio through a ONE-SHOT lens", () => {
    // The FINAL-transform case: the fold applied once to every plotted point
    // of an ordinary affine attractor ({@link LENS_BASE}), never fed back.
    const cloud = runChaosGame(LENS_BASE, 150_000, mulberry32(0xc10d));
    const lens = buildEscapeDE([foldSystem(2, [0, 0, 0])]);

    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const bent = arms.map((mR) => bendCloud(lens, { ...SHIPPED, mR }, cloud));

    // The un-lensed attractor, normalized the same way: the "the lens did
    // nothing recognisable" baseline the arms are read against.
    const raw = normalizeCloud(
      cloud.positions.slice(0, cloud.count * 3),
      cloud.count,
    );
    const ref = bent[shippedAt];
    const panels = bent.map((c, i) => {
      const fp = { ...SHIPPED, mR: arms[i] };
      console.log(
        `  lens  mR ${arms[i].toFixed(2)}  ` +
          `magnification ${magnification(fp).toFixed(2)}x  ` +
          `rms ${c.rms.toFixed(3)}  ` +
          `IoU-vs-shipped ${occupancyIoU(c.points, ref.points).toFixed(3)}  ` +
          `IoU-vs-unlensed ${occupancyIoU(c.points, raw.points).toFixed(3)}` +
          (i === shippedAt ? "  <- ships" : ""),
      );
      return splatPanel(c.points);
    });
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-lens.png")}`,
    );
  });

  /* ---- where the first four arms stopped ------------------------- */

  it("sweeps magnification PER LINK along a chain", () => {
    // ARM 1. A per-link parameter gives a six-link chain twelve new ratios,
    // so the question is not "does the ratio matter" (arms above answer that)
    // but whether the links' responses INTERACT. The formula chain measured
    // composition IMPROVING bound quality — violation rates 13.4% at one link
    // down to 1.5% at six — which predicts a chain is LESS sensitive per
    // link.
    //
    // `foldChainBoulder` is the fixture because it is the only shipped chain
    // with TWO sphere-family links (mandelbox 2, mandelbox -1.5, boxfold
    // 1.6@20°); the box-fold link's mR/fR are inert by construction, which is
    // itself part of the answer — a per-link schema hands a box fold two
    // fields it cannot use.
    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const chain = buildEscapeDE(foldChainBoulder());
    const n = chain.links.length;
    const single = buildEscapeDE(mandelboxClassic());

    // Four rows over one arms list: the same map alone, that map as link 0 of
    // the chain, link 1 alone, and both links moved together.
    const rowSingle = arms.map((mR) =>
      armPanel(paramEscapeDE(single, { ...SHIPPED, mR }), SHIPPED.bailout),
    );
    const row0 = arms.map((mR) =>
      armPanel(paramEscapeDE(chain, perLink(n, 0, { mR })), SHIPPED.bailout),
    );
    const row1 = arms.map((mR) =>
      armPanel(paramEscapeDE(chain, perLink(n, 1, { mR })), SHIPPED.bailout),
    );
    const rowBoth = arms.map((mR) =>
      armPanel(
        paramEscapeDE(
          chain,
          Array.from({ length: n }, (_, i) =>
            i <= 1 ? { ...SHIPPED, mR } : { ...SHIPPED },
          ),
        ),
        SHIPPED.bailout,
      ),
    );

    const rows: [string, Arm[]][] = [
      ["single map ", rowSingle],
      ["chain link0", row0],
      ["chain link1", row1],
      ["chain both ", rowBoth],
    ];
    for (const [label, row] of rows) {
      const ref = row[shippedAt];
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, mR: arms[i] };
        console.log(
          `  ${label}  mR ${arms[i].toFixed(2)}  ` +
            `magnification ${magnification(fp).toFixed(2)}x  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
    }

    // THE HEADLINE, and it is a like-for-like comparison: `mandelboxClassic`
    // and `foldChainBoulder`'s link 0 are the SAME map (mandelbox at weight 2,
    // no rotation), so this row pair isolates "alone" against "one link of
    // three" with nothing else moving.
    arms.forEach((mR, i) => {
      if (i === shippedAt) return;
      const alone = 1 - maskIoU(rowSingle[i].panel, rowSingle[shippedAt].panel);
      const inChain = 1 - maskIoU(row0[i].panel, row0[shippedAt].panel);
      console.log(
        `  per-link damping  mR ${mR.toFixed(2)}  ` +
          `displacement alone ${alone.toFixed(3)}  ` +
          `as link 0 of 3 ${inChain.toFixed(3)}  ` +
          `${(alone / (inChain || 1)).toFixed(1)}x quieter in the chain`,
      );
    });

    // SEPARABILITY, asked as one comparison per arm: how far does link 1 move
    // the object when link 0 is at the shipped ratio, versus when link 0 has
    // already moved to the same ratio? Identical displacements = the links'
    // responses do not interact and a per-link schema buys independent knobs;
    // divergent = the chain's ratios are coupled and the twelve numbers are
    // not twelve degrees of freedom.
    arms.forEach((mR, i) => {
      if (i === shippedAt) return;
      const alone = 1 - maskIoU(row1[i].panel, row1[shippedAt].panel);
      const after = 1 - maskIoU(rowBoth[i].panel, row0[i].panel);
      console.log(
        `  separability  mR ${mR.toFixed(2)}  ` +
          `link1 displacement alone ${alone.toFixed(3)}  ` +
          `after link0 moved ${after.toFixed(3)}  ` +
          `ratio ${(after / (alone || 1)).toFixed(2)}x`,
      );
    });
    console.log(
      `  wrote ${writeContactSheet(
        [...rowSingle, ...row0, ...row1, ...rowBoth].map((a) => a.panel),
        arms.length,
        "spherefold-chain-links.png",
      )}`,
    );
  });

  it("finds the bare sphere fold has no escape-time object to sweep", () => {
    // ARM 2, part 1, and it is a NEGATIVE result reached by measurement.
    //
    // Every escape arm above sweeps the `mandelbox` composition, where the box
    // wall is a second length in the same map — so a magnification row there
    // is "the ball against a fixed box". The bare `spherefold` was supposed to
    // be the control: no box, so `fR/wall` is vacuous and the magnification
    // axis stands alone. It is not a control, because in the escape-time role
    // it has nothing to render, and the reason is structural rather than a bad
    // choice of weight.
    //
    // The sphere fold is purely EXPANDING in radius — inner scales by
    // `fR²/mR²`, mid sends the shell `[mR, fR]` outward to `[fR, fR²/mR]`,
    // outer is the identity — so with no box fold to bring points back in, the
    // orbit `v <- w·S(Mv + t) + p` splits on `|w|` and neither side is a
    // fractal:
    //   |w| >= ~1  nothing is captured. The set is EMPTY (the finding
    //              `escape-form-sweep.harness.ts` recorded for w=2, t=0).
    //   |w| <  1   the outer branch alone contracts to the fixed point
    //              `(I - wM)⁻¹p`, so a large region never escapes and the set
    //              is a smooth SOLID. Its boundary is not a `dr` blow-up, so
    //              the Buddhi/Rrrola heuristic cannot see it: the estimate
    //              reads ~|p| everywhere inside and the marcher walks to the
    //              origin.
    // Two columns tell the two apart: FILL is the measured volume fraction of
    // the bailout ball (`probeEscapeFill`), RADIUS is where a ray marching
    // inward first accepts. Empty reads (0, 0); an invisible solid reads
    // (large, ~0).
    const weights = [0.3, 0.5, 0.8, 1.2, 2, 3, -0.5, -1.5];
    const affines: [string, Vec3, Vec3][] = [
      ["conformal", [0, 0, 0], [1, 1, 1]],
      // Anisotropy is the only thing that gives the heuristic any surface to
      // find here, and it finds a blob rather than a fractal — reported so the
      // negative result is not resting on one affine part.
      ["anisotropic", [0.3, 0.5, 0.2], [1.2, 0.9, 1.0]],
    ];
    const offsets: [string, Vec3][] = [
      ["t=0    ", [0, 0, 0]],
      ["t=[1,0,0]", [1, 0, 0]],
    ];
    let renderable = 0;
    for (const [aLabel, rotation, scale] of affines) {
      for (const [tLabel, position] of offsets) {
        for (const w of weights) {
          const de = buildEscapeDE([
            {
              id: 1,
              position,
              rotation,
              scale,
              variations: [{ type: "spherefold", weight: w }],
            },
          ]);
          const fill = probeEscapeFill(de, 4096);
          const radius = objectRadius(
            paramEscapeDE(de, SHIPPED),
            SHIPPED.bailout,
          );
          // "Renderable" = a surface far enough out to frame: not empty, and
          // not a solid whose only accepted point is the origin.
          const ok = fill > 0.0005 && radius > 0.25 * SHIPPED.bailout;
          if (ok) renderable++;
          console.log(
            `  bare sphere  ${aLabel.padEnd(11)} ${tLabel}  ` +
              `w ${w.toFixed(1).padStart(4)}  ` +
              `fill ${(100 * fill).toFixed(2).padStart(6)}%  ` +
              `radius ${radius.toFixed(3)}  ` +
              (fill <= 0.0005
                ? "EMPTY"
                : radius <= 0.25 * SHIPPED.bailout
                  ? "solid, no visible boundary"
                  : "renderable"),
          );
        }
      }
    }
    console.log(
      `  verdict: ${renderable} of ${weights.length * affines.length * offsets.length} ` +
        `bare sphere folds are renderable — the magnification axis has no ` +
        `escape-time fixture, so it is swept through the LENS below instead`,
    );
    // Not an assertion that the count is zero: the point is the measurement,
    // and a future estimator that could see a smooth boundary would raise it.
    // What must hold is that the survey ran on systems the gate admits.
    expect(renderable).toBeLessThan(
      weights.length * affines.length * offsets.length,
    );
  });

  it("isolates the magnification axis through a BARE sphere-fold lens", () => {
    // ARM 2, part 2. The one-shot lens is where a bare sphere fold IS
    // well-defined — `chaos-game.ts` bends each plotted point once and never
    // feeds it back, so none of the escape orbit's expansion dichotomy
    // applies — and it is the role the first four arms measured as the most
    // sensitive of the three. Both rows below bend the SAME attractor ({@link
    // LENS_BASE}) with the same weight, differing only in whether a box fold
    // precedes the sphere fold, which is the box-wall control arm 2 was asked
    // for.
    const cloud = runChaosGame(LENS_BASE, 150_000, mulberry32(0xc10d));
    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const raw = normalizeCloud(
      cloud.positions.slice(0, cloud.count * 3),
      cloud.count,
    );
    // THE BOX HAS TO BITE, or the control is vacuous. Measured first, because
    // the obvious fixture fails silently: at the lens's shipped pre-scale of 1
    // the attractor lies entirely INSIDE the wall, so the box fold is the
    // identity on every plotted point and the two rows come out bit-identical
    // — a perfect agreement that says nothing about the wall. So the control
    // runs at pre-scale 2, where the cloud straddles the wall, and the
    // pre-scale-1 degeneracy is recorded here as its own small finding: the
    // second ratio `fR/wall` has NO effect whatever on a lens whose cloud
    // never reaches the wall.
    const inertBox = occupancyIoU(
      bendCloud(buildEscapeDE([sphereFoldSystem(2, [0, 0, 0])]), SHIPPED, cloud)
        .points,
      bendCloud(buildEscapeDE([foldSystem(2, [0, 0, 0])]), SHIPPED, cloud)
        .points,
    );
    console.log(
      `  pre-scale 1 (cloud inside the wall): bare vs boxed lens IoU ` +
        `${inertBox.toFixed(3)} — the box fold is inert, so the control is ` +
        `run at pre-scale 2 below`,
    );
    expect(inertBox).toBe(1);

    const lenses: [string, EscapeDE][] = [
      ["bare sphere ", buildEscapeDE([sphereFoldSystem(2, [0, 0, 0], 2)])],
      ["with the box", buildEscapeDE([foldSystem(2, [0, 0, 0], 2)])],
    ];
    const panels: PanelStats[] = [];
    const rows = lenses.map(([label, lens]) => {
      const row = arms.map((mR) => bendCloud(lens, { ...SHIPPED, mR }, cloud));
      const ref = row[shippedAt];
      row.forEach((c, i) => {
        const fp = { ...SHIPPED, mR: arms[i] };
        console.log(
          `  lens ${label}  mR ${arms[i].toFixed(2)}  ` +
            `magnification ${magnification(fp).toFixed(2)}x  ` +
            `rms ${c.rms.toFixed(3)}  ` +
            `IoU-vs-shipped ${occupancyIoU(c.points, ref.points).toFixed(3)}  ` +
            `IoU-vs-unlensed ${occupancyIoU(c.points, raw.points).toFixed(3)}` +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      panels.push(...row.map((c) => splatPanel(c.points)));
      return row;
    });
    // The isolation the arm exists for: with the box present the magnification
    // row is "the ball against a fixed wall", without it the ball alone. Same
    // attractor, same weight, same normalization — so the gap between the two
    // displacement columns is the box's whole contribution.
    arms.forEach((mR, i) => {
      if (i === shippedAt) return;
      const bare =
        1 - occupancyIoU(rows[0][i].points, rows[0][shippedAt].points);
      const boxed =
        1 - occupancyIoU(rows[1][i].points, rows[1][shippedAt].points);
      console.log(
        `  box contribution  mR ${mR.toFixed(2)}  ` +
          `displacement bare ${bare.toFixed(3)}  ` +
          `with the box ${boxed.toFixed(3)}  ` +
          `ratio ${(boxed / (bare || 1)).toFixed(2)}x`,
      );
    });
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-bare-lens.png")}`,
    );
  });

  it("sweeps magnification under a five-fold kaleidoscope", () => {
    // ARM 3. `foldChainFlower` is `foldChain` under an order-5 query-space
    // wedge fold (`foldQueryIntoSector` — 1-Lipschitz, an isometry per
    // sector, applied ONCE before the orbit). A wedge is angular and the
    // sphere fold is radial, so they act on orthogonal parts of the query and
    // the naive prediction is that the wedge changes nothing about the
    // ratio's effect. The two rows here are the same chain with the fold on
    // and off, swept identically, which is what makes that prediction
    // falsifiable rather than plausible.
    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const plain = buildEscapeDE(foldChain());
    const flower = buildEscapeDE(foldChainFlower(), null, FLOWER_SYMMETRY);
    const n = plain.links.length;

    const rows: [string, Arm[]][] = [
      [
        "chain      ",
        arms.map((mR) =>
          armPanel(
            paramEscapeDE(plain, perLink(n, 0, { mR })),
            SHIPPED.bailout,
          ),
        ),
      ],
      [
        "flower (x5)",
        arms.map((mR) =>
          armPanel(
            paramEscapeDE(flower, perLink(n, 0, { mR })),
            SHIPPED.bailout,
          ),
        ),
      ],
    ];
    const panels: PanelStats[] = [];
    const displacement: Record<string, number[]> = {};
    for (const [label, row] of rows) {
      const ref = row[shippedAt];
      displacement[label] = row.map((a) => 1 - maskIoU(a.panel, ref.panel));
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, mR: arms[i] };
        console.log(
          `  ${label}  mR ${arms[i].toFixed(2)}  ` +
            `magnification ${magnification(fp).toFixed(2)}x  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
      panels.push(...row.map((a) => a.panel));
    }
    arms.forEach((mR, i) => {
      if (i === shippedAt) return;
      const bare = displacement["chain      "][i];
      const wedged = displacement["flower (x5)"][i];
      console.log(
        `  wedge effect  mR ${mR.toFixed(2)}  ` +
          `displacement bare ${bare.toFixed(3)}  ` +
          `under wedge ${wedged.toFixed(3)}  ` +
          `ratio ${(wedged / (bare || 1)).toFixed(2)}x`,
      );
    });
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-kaleidoscope.png")}`,
    );
  });

  it("tabulates how much of the ratio's range crosses the eligibility gate", () => {
    // ARM 4, the arm with a decision riding on it (the eligibility-gate UI
    // question).
    //
    // `SPHEREFOLD_LIPSCHITZ` becomes `fR²/mR²` — the magnification ratio
    // exactly — and it multiplies into BOTH gates: `analyzeSurfaceSystem`
    // admits a pure-fold map when `|w|·L·sigma_max < CONTRACTION_LIMIT`, and
    // `analyzeEscapeSystem` is its deliberate complement, admitting when some
    // map does NOT contract. So one threshold governs both sides:
    //
    //     rho*_i = CONTRACTION_LIMIT / (|w_i| · sigma_max(M_i))
    //
    // is the magnification at which map `i` stops contracting, and the SEAM a
    // system sits on is `rho_crit = min over sphere-family maps of rho*_i`.
    // A system whose maps all contract today stays on the surface side while
    // `rho < rho_crit`; an escape system falls off the escape side when
    // `rho < rho_crit` — UNLESS one of its expanding maps is a box fold,
    // whose Lipschitz bound is 1 at every ratio, in which case no value of
    // the knob can move it and the crossing is unreachable.
    //
    // Note what is NOT here: the box wall. `fR/wall` — the ratio this sheet
    // measured as the STRONGER shape parameter — never enters either gate,
    // because the box fold's branches are reflection isometries whatever the
    // wall is. And the FINAL-transform lens has no contraction gate at all
    // (surface-de.ts's `descendLens`: an un-iterated lens needs
    // none), so the role this sheet measured as MOST sensitive is likewise
    // untouched. This arm concerns ITERATED BASE MAPS only.
    const shippedRho = magnification(SHIPPED);
    // The whole arm rests on `SPHEREFOLD_LIPSCHITZ` being exactly the
    // magnification ratio at the shipped lengths — that identity is what makes
    // a per-variation radius a parameter of the ELIGIBILITY GATE and not only
    // of the picture. Assert it rather than assume it.
    expect(shippedRho).toBe(SPHEREFOLD_LIPSCHITZ);
    const systems: [string, Transform[], SymmetryParams | null][] = [
      ["mandelboxKifs      ", mandelboxKifs(), null],
      ["mandelboxLattice   ", mandelboxLattice(), null],
      ["mandelboxClassic w2", mandelboxClassic(), null],
      ["mandelboxRings   w3", mandelboxRings(), null],
      ["mandelboxCube  w-1.5", mandelboxCube(), null],
      ["foldChain          ", foldChain(), null],
      ["foldChainBoulder   ", foldChainBoulder(), null],
      ["foldChainFlower    ", foldChainFlower(), FLOWER_SYMMETRY],
    ];
    for (const [label, transforms, symmetry] of systems) {
      const surface = analyzeSurfaceSystem(transforms, null).status;
      const escape = analyzeEscapeSystem(
        transforms,
        null,
        symmetry ?? undefined,
      ).status;
      const today = escape === "eligible" ? "escape" : surface;

      // Per-map critical ratios. A box-fold map's bound is |w|·sigma_max at
      // every ratio, so it is a CONSTANT term in both gates.
      let rhoCrit = Infinity;
      let binding = "";
      const fixedExpanders: string[] = [];
      transforms.forEach((t, i) => {
        if ((t.weight ?? 1) <= 0) return;
        const fold = soleFoldVariation(t);
        if (!fold) return;
        const sigmaMax = transformSigmas(t).max;
        const base = Math.abs(fold.weight) * sigmaMax;
        if (fold.type === "boxfold") {
          if (base >= CONTRACTION_LIMIT) fixedExpanders.push(`map ${i + 1}`);
          return;
        }
        const rho = CONTRACTION_LIMIT / base;
        if (rho < rhoCrit) {
          rhoCrit = rho;
          binding = `map ${i + 1}, |w| ${Math.abs(fold.weight).toFixed(2)} x sigma_max ${sigmaMax.toFixed(3)}`;
        }
      });

      // The algebra must reproduce today's gate at the shipped ratio, or the
      // table below is describing some other seam than the one that ships.
      const fixedExpander = fixedExpanders[0];
      if (Number.isFinite(rhoCrit) || fixedExpander) {
        const predicted =
          fixedExpander || shippedRho >= rhoCrit ? "escape" : "surface";
        expect(
          predicted === "escape",
          `${label}: the reachability algebra disagrees with the shipped gate ` +
            `(predicted ${predicted}, gates say ${today})`,
        ).toBe(escape === "eligible");
      }

      // AUTHORABLE RANGE. `mR <= fR` is the schema's own invariant (mR > fR
      // inverts the shell and is not a fold anyone would author; the authored
      // lengths' morph rule requires it at every t), so the reachable
      // magnification is `rho >= 1`, with `rho = 1` the identity end where
      // the fold vanishes. A threshold at or below 1 is therefore outside the
      // range entirely.
      const where = !Number.isFinite(rhoCrit)
        ? "no PURE-fold map — neither gate's fold path applies here"
        : fixedExpander
          ? `UNREACHABLE (${fixedExpander} is a box fold that expands at ` +
            `every ratio, so the knob cannot move this system)`
          : rhoCrit <= 1
            ? `UNREACHABLE (would need rho ${rhoCrit.toFixed(3)}, i.e. ` +
              `mR ${(1 / Math.sqrt(rhoCrit)).toFixed(3)} > fR, outside mR <= fR)`
            : `CROSSES at rho ${rhoCrit.toFixed(3)} ` +
              `(mR ${(1 / Math.sqrt(rhoCrit)).toFixed(3)} at fR=1) — ` +
              `shipped rho ${shippedRho.toFixed(1)} is ` +
              `${(100 * Math.abs(shippedRho / rhoCrit - 1)).toFixed(0)}% away; ` +
              `bound by ${binding}`;
      console.log(`  ${label}  today ${today.padEnd(11)}  ${where}`);
    }
  });
});

/* ---- the lens sheet's own small machinery ------------------------- */

/**
 * Centre and scale a cloud to unit RMS radius. Both are free to an author
 * already — the final transform's own position and scale — so normalizing
 * them is what leaves only the fold's ratios in the comparison. Rotation is
 * free too and deliberately NOT normalized, so this test can only
 * OVER-report difference, never under-report it.
 */
function normalizeCloud(
  xyz: Float32Array,
  count: number,
): { points: Float32Array; rms: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += xyz[i * 3];
    cy += xyz[i * 3 + 1];
    cz += xyz[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3] - cx;
    const dy = xyz[i * 3 + 1] - cy;
    const dz = xyz[i * 3 + 2] - cz;
    sum += dx * dx + dy * dy + dz * dz;
  }
  const rms = Math.sqrt(sum / count) || 1;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    points[i * 3] = (xyz[i * 3] - cx) / rms;
    points[i * 3 + 1] = (xyz[i * 3 + 1] - cy) / rms;
    points[i * 3 + 2] = (xyz[i * 3 + 2] - cz) / rms;
  }
  return { points, rms };
}

/** Occupancy IoU over a 64³ grid spanning ±3 RMS radii — the cloud twin of
 * {@link maskIoU}. */
function occupancyIoU(a: Float32Array, b: Float32Array): number {
  const N = 64;
  const SPAN = 3;
  const cells = (xyz: Float32Array) => {
    const set = new Set<number>();
    for (let i = 0; i < xyz.length; i += 3) {
      const ix = Math.floor(((xyz[i] / SPAN + 1) / 2) * N);
      const iy = Math.floor(((xyz[i + 1] / SPAN + 1) / 2) * N);
      const iz = Math.floor(((xyz[i + 2] / SPAN + 1) / 2) * N);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= N || iy >= N || iz >= N) continue;
      set.add((iz * N + iy) * N + ix);
    }
    return set;
  };
  const sa = cells(a);
  const sb = cells(b);
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Additive orthographic point splat on {@link EYE}'s view basis, with
 * `de-preview.ts`'s backdrop, so the lens sheet reads beside the marched
 * ones. A point cloud has no surface to march; this is not a ninth marcher
 * but the scatter `mutation-thumbs.ts` does for the mutation grid, minus
 * the per-transform colouring this sheet has no use for.
 */
function splatPanel(points: Float32Array): PanelStats {
  const started = Date.now();
  const len = Math.hypot(EYE[0], EYE[1], EYE[2]);
  // The eye looks at the origin, so forward is -EYE normalized; right/up
  // mirror renderPreview's basis exactly.
  const fwd: Vec3 = [-EYE[0] / len, -EYE[1] / len, -EYE[2] / len];
  const rRaw: Vec3 = [-fwd[2], 0, fwd[0]]; // cross(fwd, [0,1,0])
  const rl = Math.hypot(rRaw[0], rRaw[1], rRaw[2]) || 1;
  const right: Vec3 = [rRaw[0] / rl, rRaw[1] / rl, rRaw[2] / rl];
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const SPAN = 2.6; // RMS radii across the half-frame
  const acc = new Float32Array(SIZE * SIZE);
  let plotted = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    const u = (x * right[0] + y * right[1] + z * right[2]) / SPAN;
    const v = (x * up[0] + y * up[1] + z * up[2]) / SPAN;
    const px = Math.floor(((u + 1) / 2) * SIZE);
    const py = Math.floor(((1 - v) / 2) * SIZE);
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
    acc[py * SIZE + px] += 1;
    plotted++;
  }
  let peak = 0;
  for (const a of acc) peak = Math.max(peak, a);
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  const tint = [1.0, 0.86, 0.62];
  let occupied = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const g = (y + 0.5) / SIZE;
      const bg = [
        0.1 + (0.04 - 0.1) * g,
        0.12 + (0.045 - 0.12) * g,
        0.16 + (0.06 - 0.16) * g,
      ];
      // Log density against the panel's OWN peak, so a lens that piles the
      // cloud into a smaller volume does not simply read brighter.
      const d = acc[i] > 0 ? Math.log1p(acc[i]) / Math.log1p(peak) : 0;
      if (acc[i] > 0) occupied++;
      for (let c = 0; c < 3; c++) {
        rgb[i * 3 + c] = Math.round(
          255 * Math.min(1, bg[c] + d * tint[c] * (1 - bg[c])),
        );
      }
    }
  }
  return {
    rgb,
    width: SIZE,
    height: SIZE,
    hits: occupied,
    evals: plotted,
    steps: 0,
    ms: Date.now() - started,
    exhausted: 0,
  };
}
