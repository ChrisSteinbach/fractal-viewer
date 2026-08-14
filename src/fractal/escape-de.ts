/**
 * Escape-time fold render (fr-kltj, made COMPOSABLE by fr-za0n): the
 * distance-estimated ESCAPE-TIME set of a CHAIN of fold maps — the canonical
 * Mandelbox/Juliabox object and its hybrids — for exactly the systems the IFS
 * surface mode is right to refuse.
 *
 * THE OBJECT. `surface-de.ts` renders IFS attractors: the fixed set of a
 * CONTRACTIVE map family, estimated by descending inverse maps. A pure-fold
 * map authored at the classic Mandelbox parameters (weight ~2) is not
 * contractive — it has NO IFS attractor, `analyzeSurfaceSystem` correctly
 * reads "does not contract", and no inverse-descent estimator exists. But
 * that map has a different canonical set: iterate the map FORWARD from the
 * query point and ask whether the orbit stays bounded. The boundary of the
 * non-escaping region is the object every published Mandelbox render
 * marches.
 *
 * THE TRANSFORM LIST IS THE SEQUENCE (fr-za0n). fr-kltj admitted EXACTLY ONE
 * active map, and that made the mode a dead end: adding a transform, or
 * turning symmetry on, dropped the document out of the renderer entirely.
 * The narrowness was a scoping choice, not mathematics — a Lipschitz bound
 * composes, so a running derivative accumulates through a sequence of maps
 * exactly as it does through one. Mandelbulber2 (whose author wrote the
 * Buddhi/Rrrola estimate this module uses) sequences its 470 formulas
 * through one shared accumulator with our exact recurrence,
 * `aux.DE = aux.DE * <local factor> + <offset>`, and picks the formula for
 * iteration `i` with `seq->GetSequence(i)` — slot `i mod n`. So the
 * document's own transform list IS the hybrid: every active map is a LINK,
 * and no second document format is needed (morphs, mutations, persistence,
 * timelines and sharing are all untouched, which is the price fr-kltj's
 * scoping decision was protecting).
 *
 * Two harnesses stand behind this module rather than one.
 * `scripts/hybrid-chain.harness.ts` asked the question from a local
 * prototype, on maps this gate still refuses (the triplex power, the
 * quaternion square) as well as the folds it admits;
 * `scripts/escape-chain.harness.ts` answers it with the shipped estimator,
 * and every number quoted below is that one's.
 *
 * CYCLING, NOT CHAINING, and the sheet decided it rather than the citation.
 * The two candidate orbits differ in how often the Mandelbrot offset re-
 * enters and how often escape is tested:
 *
 *     cycling   one link per step, `+ p` and the bailout test after EACH
 *     chaining  the whole list per step, `+ p` and the test after all n
 *
 * At EQUAL WORK (both applying every link the same number of times) cycling
 * won, and the ball-fill column is why. Chaining lets n folds compound
 * before the query point tethers the orbit again, so its non-escaping set
 * FATTENS as links are added, and it fattens toward the bailout ball it is
 * supposed to sit inside — measured over
 * `scripts/escape-chain.harness.ts`'s eight fixtures, chaining fills
 * 32 / 13 / 43% of a radius-4 ball at two links, 47% at four and 72.8% at
 * six, reaching the full bailout radius every time. That is exactly the
 * defect fr-7u8t.8 existed to fix ("the rendered object WAS its own
 * bounding sphere"), reappearing through the back door as soon as the list
 * grows, and `escape-chain-sequence.png` shows it happening: the four- and
 * six-link chaining panels are near-solid pale balls. Cycling's sets stay
 * where they should — 6.0 / 7.0 / 7.4% of the same radius-4 ball at two
 * links, and at four and six links the object has drawn IN, to 3.8% and
 * 3.6% of that ball by volume — and the panels carry lobes, arches and
 * filigree at every length. The one-link row of that sheet is its own
 * control: the two arms are the same orbit there, and print identically.
 *
 * A PASS IS ONE FULL CYCLE, which is what keeps `maxIterations` meaning the
 * same thing it always meant. The loop runs `maxIterations * links.length`
 * single-link steps, so {@link ESCAPE_TIME_ITERATIONS}, the preview tier's
 * depth clamp and the GPU's `maxDepth` all still say "how many times is each
 * map applied" rather than silently going n times shallower on an n-link
 * document. It also matters for the ESTIMATE and not just the object: the
 * rendered set is already settled at 30 total steps (fill is identical at 30
 * and at 30n for every fixture measured), but the shorter budget leaves `dr`
 * under-grown for the points that never escape, which is where the estimate
 * has to be smallest.
 *
 * The n-times-the-budget price is a CEILING, and only a non-escaping orbit
 * ever pays it. Measured over 60k uniform queries in each fixture's own
 * marching ball (`scripts/escape-chain.harness.ts`, f64, single thread),
 * the single map costs 0.25 us/eval and the eight chains 0.27-1.10, with
 * the SIX-link chain at 0.60 — 2.4x the single map, not the 6x the ceiling
 * implies. Every extra link is another chance for the orbit to leave the
 * bailout ball, and it tends to draw the object (and so the marching ball
 * the queries are drawn in) inward as well.
 *
 * WHERE THE OFFSET LANDS IS THE SAME FORK UNDER ANOTHER NAME, which is
 * worth saying because the prototype names it separately. That harness
 * offers `offset: "pass" | "link"` inside its chaining orbit — `+ p` after
 * all n links, or after each. Cycling with a per-LINK offset and chaining
 * with a per-PASS one ARE the two arms above; cycling with a per-PASS
 * offset is chaining with an earlier bailout test, and it fattens for the
 * same reason. So there is one axis here, not two, and the sheet settles
 * it once: the offset lands per LINK.
 *
 * The prototype's own per-map numbers agree where they can be compared and
 * split where they cannot: over its three fixtures, per-PASS wins on the
 * two-link fold pair (bound/step violations 11.2/8.4 against 23.7/15.9)
 * and per-LINK wins on the three-link fold chain (1.1/1.1 against 8.1/4.9)
 * and decisively on a chain containing a triplex-power link (38.6/35.4
 * against 92.2/84.3, at ~2.5x the steps). Those are three fixtures at one
 * length each; the fill measurements above are eight fixtures at one to six
 * links, on the shipped code, and they are what a chain that keeps growing
 * has to survive. The rejected arm stays executable as
 * `escape-chain.harness.ts`'s `estimateChained` — the discipline
 * `escape-form-sweep.harness.ts` set for the retired Julia form — rather
 * than as a flag, because a flag here would be permanent document state and
 * this bead exists to avoid exactly that.
 *
 * COMPOSITION BUYS DE QUALITY, which is the real argument for widening the
 * gate and was the opposite of what a "product of heuristics" intuition
 * predicts. Bound- and damped-step violation rates over 1200 exterior
 * queries drawn in the SAME bailout ball for every row (the fitted ball
 * would crowd queries against a compact chain's surface and punish it for
 * being tight), each certified ball probed in 14 directions against
 * {@link escapeSetContains}:
 *
 *     CONTROL single mbox2 (ships today)   bound 13.4%   step  6.6%
 *     mbox2 -> boxfold1.6                        4.3%         1.5%
 *     mbox2 -> mbox2 rot20y                      5.9%         3.0%
 *     mbox2 -> mbox-1.5                          6.1%         3.1%
 *     box1 rot25y -> sph2                        3.7%         1.0%
 *     mbox2 -> box1.6 -> sph1.2                  2.7%         0.7%
 *     FOUR-link                                  2.1%         0.3%
 *     SIX-link                                   1.5%         0.6%
 *
 * The shipped single map is the WORST row, by 2-9x, and the rates fall as
 * links are added. Same mechanism as the step scale: cycling floors `dr` at
 * every link, and more links means more floors per unit of orbit.
 *
 * THE BAILOUT STAYS AT 4 for chains, also measured rather than inherited.
 * Raising it at a fixed iteration budget does not reveal more of the set,
 * it INFLATES it — 30 passes stop sufficing to prove escape, so slow
 * escapers are counted as members: the single-map control's ball fill runs
 * 2.9% -> 57.7% -> 65.6% at bailout 4 / 8 / 16. And chains genuinely use
 * the ball they are given, reaching 3.5-4.0 where the single map reaches
 * only 2.4-3.1, so 4 is exactly right rather than generous.
 *
 * EMPTY CHAINS ARE REACHABLE, AND THE MODE MUST BE ABLE TO SAY SO. A chain
 * whose composite expands too hard escapes on its first pass everywhere,
 * and then this mode renders a blank frame with nothing anywhere saying
 * why — which reads as a broken app. The sharpest case is a power link
 * (a mandelbox leaves `|v|` near 7 and a triplex 8th power sends 7 to
 * 5.8e5 in one step, so `mandelbox w=2 -> bulb` is 0.01% full and only
 * becomes non-empty when the link's pre-scale roughly inverts the
 * expansion ahead of it — 5.09% at pre-scale 0.3), and that shape is out
 * of this gate. But FOLD-ONLY chains reach it too, measured: `mbox2 ->
 * mbox2 pre-scale 4`, `mbox2 pre-scale 8 -> boxfold1.6`, `boxfold6 x3` and
 * `spherefold3 pre-scale 6 -> mbox2` all probe empty, and every one of
 * them passes this gate. So {@link probeEscapeFill} exists: a seeded,
 * deterministic sample of the bailout ball, asking
 * {@link escapeSetContains} rather than thresholding a distance, so a
 * later UI pass can say "this chain's set is empty" instead of showing
 * nothing. It is deliberately NOT part of {@link analyzeEscapeSystem}
 * (a structural gate that runs on every state change must stay cheap) and
 * NOT computed in {@link buildEscapeDE} (1-5 ms nobody has asked for yet);
 * it is a call the caller makes when it wants the answer.
 *
 * ONE THING LEFT ON THE TABLE, deliberately: the prototype measured the
 * Böttcher/log estimate form (`0.5·r·ln r / dr`, `bulb-de.ts`'s) beating
 * this module's linear `r / dr` on EVERY system it tried — the fold-only
 * chain included — for 20-40% more steps per ray. That is a change to the
 * single map as much as to the chain, so it is filed separately rather
 * than folded in here.
 *
 * TWO FORMS, ONE TERM APART (fr-7u8t.8), and this mode shipped the wrong
 * one. Where the per-iteration offset comes from decides which of the
 * escape-time family's two canonical objects gets rendered:
 *
 *     Mandelbrot   v <- w·V(M v + t) + p     (p = the query point)
 *     Julia        v <- w·V(M v + t)         (offset fixed by the document)
 *
 * fr-kltj chose the Julia form deliberately and for a good reason: the
 * document's `t` is a fixed offset, so the mode stayed a render MODE over
 * the existing transform vocabulary rather than becoming a second document
 * format. The reasoning was sound. The object was not: at a small `t` the
 * Julia-form fold set is a FAT BLOB, and every authorable constant near the
 * origin lands there. Measured on the project's own bench fixture
 * (`escMandelbox`: mandelbox weight 2 at position (0.4, 0.3, 0.2)), 94% of
 * the bounding ball was non-escaping — the rendered object WAS its own
 * bounding sphere, speckled where the escaping filaments fell below a
 * pixel. That was the mode's entire visual output.
 *
 * So the offset now comes from the query point, unconditionally: `+ p`, the
 * object everyone means by "Mandelbox". `t` loses nothing — it stays the
 * PRE-fold offset (the fold's box/sphere centre), which is a live
 * deformation knob here, with the classic Mandelbox at exactly `t = 0`.
 * Morphs, mutations and the chaos game keep speaking the same vocabulary,
 * and the mode still adds NO document state.
 *
 * WHY NOT BOTH FORMS, since one flag would buy the Juliabox
 * (`scripts/escape-form-sweep.harness.ts` is that decision's evidence, and
 * keeps the rejected form as an executable local): because the flag would
 * be a permanent document field, and the measurement does not earn it. At
 * the classic weight 2 the Julia set fills 97 / 93 / 77 / 60 / 23% of the
 * marching ball as |t| runs 0.5 / 1 / 1.5 / 2 / 2.5 — a sphere across
 * everything a user would plausibly author, thinning only in a narrow band
 * just before it vanishes entirely — and even at the best constant found
 * (weight -1.5, t = (2.5, 0, 0), 6% fill) the object is a pitted BALL,
 * where the Mandelbrot form at those same weights gives three distinct
 * objects and needs no constant at all. A knob whose default 95% of range
 * renders a sphere is worse than no knob. If the bulb family (fr-7u8t.7)
 * measures that ITS Julia form earns a flag, this loop inherits one
 * cheaply: the wire has a spare float reserved for exactly that
 * (`surface-de-gpu.ts`'s escParams tail), and the term is a multiply by
 * 1-or-0, not a branch.
 *
 * THE ESTIMATE. The classic scalar-derivative distance estimate
 * (Hart's unbounding volumes via the Buddhi/Rrrola Mandelbox form the
 * fr-kltj sketch names), with the chain's inner step folded in:
 *
 *     v = g(p); dr = 1
 *     repeat maxIterations * n times or until |v| > ESCAPE_TIME_RADIUS:
 *       L  = links[step mod n]                 // the fr-za0n cycle
 *       y  = M_L v + t_L
 *       v  = w_L · V_L(y) + g(p)   // the fold, exactly variations.ts's
 *                                  // forward math, plus the Mandelbrot
 *                                  // form's offset
 *       dr = |w_L| · L_L(y) · sigma_max(M_L) · dr + 1
 *     DE = |v| / dr
 *
 * `L_L(y)` is that link's fold's local conformal factor at the point — 1
 * for the boxfold's reflections, `sphereFoldFactor(|y|²)` (1..4) for the
 * spherefold family — and `sigma_max(M_L)` bounds its affine part, so `dr`
 * over-estimates the orbit derivative and the quotient under-estimates
 * distance in the direction a sphere tracer needs. EVERY LINK CONTRIBUTES
 * ITS OWN FACTOR TO THE ONE SHARED `dr`, which is the whole of what
 * composition costs: the chain's bound is the product of the shipped
 * single-map bounds, so a one-link chain is not merely similar to fr-kltj's
 * estimator, it IS it, bit for bit (`escape-de.test.ts` pins that against a
 * hand-computed reference and across a probe grid). Unlike the IFS
 * estimators this is the field's standard HEURISTIC bound, not a certified
 * one; the marcher's stepScale and acceptance epsilon absorb the usual
 * slack exactly as every published Mandelbox marcher does. A non-escaping
 * orbit returns |v|/dr with dr grown huge — effectively 0, the inside
 * signal.
 *
 * The `+ 1` in `dr` needed no change: it is the Mandelbrot form's own
 * `d(+p)/dp` term, which is why the pre-fr-7u8t.8 doc could only call it
 * "the Mandelbrot-form's conservatism" — it belonged to a form the loop
 * did not yet compute. It is also load-bearing beyond exactness: it
 * floors `dr` at 1, hence `DE <= |v|`. Without it a map whose derivative
 * bound SHRINKS (`|w|·L·sigma_max` can sit at a quarter and still clear
 * the non-contraction gate, which prices `L` at its 4x maximum) drives
 * `dr` toward zero over the iteration budget and returns a distance
 * vastly larger than the query's own radius — a marcher that steps clean
 * past the object. Cycling makes it MORE load-bearing, not less: it is the
 * per-link offset's own derivative, so it now floors `dr` once per link
 * rather than once per n, and a chain of contracting links (legal, as long
 * as ONE link expands) leans on that floor at every step.
 *
 * KALEIDOSCOPE IS FREE, AND IT IS A QUERY-SPACE FOLD (fr-za0n). The bead
 * predicted symmetry would be free because a rotation has Lipschitz factor
 * 1. It is free, but not as an orbit operation — putting a rotation inside
 * the orbit buys nothing a link's own `rotation` field cannot already
 * express, and it does not make the SET symmetric: the escape set of
 * `v <- F(v) + p` inherits a rotational symmetry R only when F COMMUTES
 * with R, which no added fold or rotation arranges. What does work is
 * folding the QUERY, once, before the orbit starts:
 *
 *     E = { p : the orbit seeded and offset by g(p) stays bounded }
 *       = g^-1(M)
 *
 * where `g` ({@link foldQueryIntoSector}) folds `p` into one wedge of the
 * symmetry plane and `M` is the ordinary escape set. `E` is then EXACTLY
 * symmetric under the wedge group by construction, and the estimate costs
 * one `atan2` and one rotation PER QUERY — nothing per orbit step. It is
 * also sound at no extra conservatism: `g` is 1-Lipschitz, so for any
 * `q` in `E`, `|g(p) - g(q)| <= |p - q|` with `g(q)` in `M`, hence
 * `dist(g(p), M) <= dist(p, E)` — the plain estimate for the folded point
 * is already an estimate for the original. `dr` needs no new term either:
 * the orbit's dependence on `p` now runs through `g`, whose derivative has
 * norm 1 wherever it exists, so the literal `+ 1` still over-estimates.
 *
 * The fold is DIHEDRAL (rotations AND mirrors) where the chaos game's
 * kaleidoscope is CYCLIC (rotated copies only), and that is forced rather
 * than chosen: the cyclic fold — rotate by the nearest multiple of the
 * sector — JUMPS across sector boundaries, and a discontinuous map has no
 * Lipschitz bound at all, so the estimate would certify empty balls
 * straight through the seam. Folding with a mirror is continuous, is a
 * composition of half-space reflections, and is therefore 1-Lipschitz
 * exactly. So `order` here means `order` rotations and their mirrors, and
 * the fundamental wedge is `pi / order` wide about the plane's first axis.
 *
 * MEASURED (`scripts/escape-chain.harness.ts`, `escape-chain-kaleido.png`,
 * a two-link chain at orders 1/2/3/5/8 seen down the symmetry axis): the
 * estimate moves by at most 2.1e-14 under a whole sector rotation — f64
 * rounding in the fold's own `atan2`/`cos`/`sin`, nothing else — and costs
 * 0.45-0.75 us/eval with no trend in the order, against 0.65 unsymmetrised.
 * Free, as predicted, for a reason the prediction had not identified.
 * `SymmetryParams.blend` is deliberately not read, matching `surface-de.ts`
 * (it fades the chaos game's copy SELECTION WEIGHTS, never geometry, and
 * there are no weights in a sequenced orbit); `order` is the only symmetry
 * field this module reads, plus the flatness clause a `w`-plane or a twist
 * trips.
 *
 * ELIGIBILITY is the COMPLEMENT of the IFS gate on the shapes this formula
 * covers: one or more active maps, each of whose active variation list is
 * exactly one fold-family entry, all flat, no final transform, no
 * kaleidoscope that rotates out of 3D — and NOT an IFS-eligible
 * contraction. That last clause is what widened: `analyzeSurfaceSystem`
 * admits a system when EVERY map contracts, so this gate admits when at
 * least one does NOT. A two-map non-contracting fold system used to be
 * refused by both gates and rendered by nothing; it is this mode's now.
 * Everything else stays ineligible for both modes, with reasons.
 *
 * WHAT THE SIX MIRRORS SEE, until fr-za0n's mirror pass lands. {@link
 * EscapeDE} extends {@link EscapeLink}, so the flat `m`/`t`/`foldKind`/
 * `w`/`derivGrowth` wire the GLSL `SURFACE_ESCAPE` variant and the WGSL
 * `core:"escape"` packer already read is the FIRST LINK's, unchanged. A
 * one-link document therefore renders bit-identically on every path. A
 * multi-link one renders its head link on the GPU paths until they gain the
 * same inner step — the mirrors are a scheduled, separate pass, and a
 * half-mirrored kernel would be worse than an unmirrored one.
 */
import { composeAffine } from "./affine";
import { isFlatTransform, symmetryIsNonFlat } from "./affine4";
import { effectiveSymmetryOrder } from "./chaos-game";
import { mulberry32 } from "./rng";
import {
  CONTRACTION_LIMIT,
  SPHEREFOLD_LIPSCHITZ,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_SPHEREFOLD,
  transformSigmas,
} from "./surface-de";
import type { SurfaceFoldKind } from "./surface-de";
import type {
  SymmetryParams,
  SymmetryPlane,
  Transform,
  Variation,
  Vec3,
} from "./types";

/** How many times the orbit applies EACH link before a point counts as
 * non-escaping — a PASS is one full cycle through the chain (module doc), so
 * an n-link system runs `n` times this many single-link steps. The classic
 * Mandelbox quality/cost balance (published marchers run 15-50); the preview
 * tier halves it through the same depth-clamp plumbing the IFS descent
 * uses. */
export const ESCAPE_TIME_ITERATIONS = 30;

/** Orbit radius past which escape is certain for every eligible map and
 * the estimate is settled. The classic small bailout: larger radii buy
 * marginally smoother far fields for strictly more iterations. */
export const ESCAPE_TIME_RADIUS = 4;

/**
 * March step fudge for the escape-time marchers (GLSL variant and WGSL core
 * alike): the scalar-derivative estimate is the field's standard heuristic,
 * not a certified lower bound, so every published Mandelbox marcher damps
 * its steps.
 *
 * ONE NUMBER FOR EVERY CHAIN LENGTH, and that was MEASURED rather than
 * assumed — fr-za0n predicted the opposite. The expectation was that a
 * chain's bound would degrade multiplicatively, a product of per-link
 * heuristics where the single map pays its slack once, so chains would need
 * heavier damping. Both harnesses say no, from opposite directions.
 *
 * Hit coverage against step scale on the SHIPPED estimator
 * (`scripts/escape-chain.harness.ts`, `escape-chain-march.png`), the single
 * map first as the control:
 *
 *     CONTROL single mbox2       0.7 33.2  0.35 38.3  0.2 40.1  0.05 41.7
 *     mbox2 -> boxfold1.6        0.7 35.5  0.35 40.3  0.2 41.9  0.05 43.2
 *     mbox2 -> mbox2 rot20y      0.7 43.4  0.35 48.6  0.2 50.1  0.05 51.2
 *     mbox2 -> box1.6 -> sph1.2  0.7 61.7  0.35 63.7  0.2 64.6  0.05 65.3
 *     mbox2 -> mbox-1.5          0.7 48.6  0.35 53.0  0.2 55.2  0.05 57.1
 *     box1 rot25y -> sph2        0.7 30.7  0.35 30.1  0.2 30.7  0.05 30.9
 *     FOUR-link                  0.7 59.8  0.35 63.2  0.2 64.0  0.05 65.1
 *     SIX-link                   0.7 42.0  0.35 48.6  0.2 50.5  0.05 52.5
 *
 * From 0.35 down to 0.05 the SINGLE MAP gains the most of the eight (+8.8%
 * relative, against +2.4 to +7.9% for the chains) — every chain's curve is
 * at least as flat as the one 0.35 was chosen against. The prototype
 * (`scripts/hybrid-chain.harness.ts`), sweeping the other candidate orbit
 * and a cross-family chain, lands in the same place from the other side:
 * as a fraction of its own 0.05 asymptote, 0.35 reaches 95.7% for the
 * control and 96.6% for the chain. Chains are more sensitive at the LOOSE
 * end (1.0 costs the chain 38.1% against the control's 53.1%), which is
 * exactly the region 0.35 already sits well inside.
 *
 * The mechanism is cycling's doing: `+ p` re-enters and `dr` is floored
 * after EVERY link, so no two folds ever compound between derivative
 * floors, and the slack per step is the single map's, unchanged. The
 * multiplicative degradation the prediction feared is a property of the
 * REJECTED per-pass orbit, not of composition.
 *
 * So 0.35 stands, for chains and single maps alike, and there is no second
 * constant to keep in step across six mirrors.
 *
 * 0.7 — the common conservative pick — was chosen (fr-kltj) against an
 * object that could not test it: the Julia form's blob filled 94% of its
 * own bounding ball and every ray hit on its first step, at a measured 0.3
 * steps per ray. The Mandelbrot form (fr-7u8t.8) is 10% solid and threaded
 * with filaments, and there 0.7 visibly OVERSHOOTS — rays step past thin
 * features and the surface renders as dark dropout speckle rather than a
 * lit solid. Measured over the classic weight-2 Mandelbox
 * (`scripts/escape-form-sweep.harness.ts`, whose sheet is the picture that
 * settles it), hit coverage against step scale:
 *
 *     1.0 -> 62.0%   0.7 -> 74.3%   0.5 -> 80.2%
 *     0.35 -> 84.3%  0.2 -> 87.4%   0.1 -> 89.1%
 *
 * There is no convergence knee to find — a fractal keeps yielding surface
 * as the march refines — so this is a cost/quality pick, not a correctness
 * one. 0.35 is where the image stops reading as erosion and starts reading
 * as a lit object, at 15.0 steps per ray against 0.7's 7.9: 1.9x the
 * marching on a mode that settles in tens of milliseconds. Damping further
 * buys little and costs a lot (0.2 is 26.1 steps/ray, 0.1 is 52.5) and
 * would start pressing the marcher's own per-ray step budget, which
 * exhausts into exactly the dropout this is fixing.
 */
export const ESCAPE_STEP_SCALE = 0.35;

export type EscapeEligibilityStatus = "eligible" | "ineligible";

/** What {@link analyzeEscapeSystem} feeds the session gate. */
export interface EscapeEligibility {
  status: EscapeEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when ineligible. */
  reasons: string[];
}

/** One link of the orbit's formula chain (fr-za0n) — one active map of the
 * document, in document order, and everything the orbit needs from it. */
export interface EscapeLink {
  /** Row-major 3x3 FORWARD linear part M of the map. */
  m: number[];
  /** Forward translation t. */
  t: Vec3;
  /** The fold family applied after the affine part. */
  foldKind: SurfaceFoldKind;
  /** Signed fold weight w — the classic Mandelbox scale. */
  w: number;
  /** `|w| · sigma_max(M)` — the per-step derivative growth the local
   * fold factor multiplies onto. */
  derivGrowth: number;
}

/**
 * Everything the escape-time marcher needs — the GLSL uniform wire
 * format, mirroring {@link estimateEscapeDistance}.
 *
 * It EXTENDS {@link EscapeLink} rather than merely holding a list: the flat
 * fields are the FIRST link's, which is the wire fr-kltj's six mirrors
 * already read (module doc's mirror note).
 */
export interface EscapeDE extends EscapeLink {
  /** The formula chain, in document order — one entry per active map. The
   * orbit applies `links[step mod links.length]` at each step. */
  links: EscapeLink[];
  /** Kaleidoscope sectors the query is folded into before the orbit starts
   * ({@link foldQueryIntoSector}); `1` is off, and the whole fold is then
   * skipped, which is what keeps an unsymmetrised system bit-identical. */
  symmetryOrder: number;
  /** The plane that fold turns in — w-free, guaranteed by the gate. Never
   * read at order 1. */
  symmetryPlane: SymmetryPlane;
  /** Marching bounds: the non-escaping set is contained in the bailout
   * ball, so the sphere tracer enters/exits against this radius. The
   * kaleidoscope fold is an isometry, so it does not move this. */
  boundingRadius: number;
}

/** `composeVariations`' active filter again (surface-de.ts keeps its own
 * copy private): the single active fold-family entry, or null. */
function pureFoldVariation(t: Transform): Variation | null {
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

/** A map's composite forward Lipschitz bound `|w|·L_V·sigma_max(M)` — the
 * same expression `analyzeSurfaceSystem` gates contraction on, so the two
 * gates cannot disagree about which side of the line a map falls. */
function foldLipschitz(fold: Variation, map: Transform): number {
  return (
    Math.abs(fold.weight) *
    (fold.type === "boxfold" ? 1 : SPHEREFOLD_LIPSCHITZ) *
    transformSigmas(map).max
  );
}

/** The maps that make up the chain: active, in DOCUMENT ORDER. `weight` is
 * the chaos game's SELECTION probability and a sequenced orbit has no
 * selection, so it is read here only as on/off — the same rule fr-kltj's
 * single-map gate used. */
function activeMaps(transforms: Transform[]): Transform[] {
  return transforms.filter((t) => (t.weight ?? 1) > 0);
}

/**
 * Classify a system for the escape-time render. Deliberately the
 * COMPLEMENT of the IFS gate on chains of pure-fold maps: a system whose
 * maps ALL contract has a genuine attractor and the sound inverse-descent
 * estimator — this mode exists for the canonical expanding
 * parameterizations that gate refuses, which since fr-za0n includes every
 * multi-map one.
 */
export function analyzeEscapeSystem(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeEligibility {
  const reasons: string[] = [];
  const active = activeMaps(transforms);
  if (active.length === 0) {
    reasons.push("no active maps");
  }
  // At least one link must EXPAND, or the IFS attractor tracer owns the
  // system: `analyzeSurfaceSystem` admits exactly when every map contracts.
  let anyExpands = false;
  transforms.forEach((map, i) => {
    if ((map.weight ?? 1) <= 0) return;
    const label = `map ${i + 1}`;
    const fold = pureFoldVariation(map);
    if (!fold) {
      reasons.push(`${label} is not a pure fold`);
    } else if (!isFlatTransform(map)) {
      reasons.push(`${label} extends into 4D`);
    } else if (foldLipschitz(fold, map) >= CONTRACTION_LIMIT) {
      anyExpands = true;
    }
  });
  if (active.length > 0 && reasons.length === 0 && !anyExpands) {
    reasons.push("every map contracts (the attractor surface render owns it)");
  }
  if (finalTransform) {
    reasons.push("final transform (unsupported in escape-time mode)");
  }
  // A kaleidoscope is welcome (module doc) as long as it stays in 3D: a
  // `w`-plane or a nonzero twist rotates the copies out of the `w = 0`
  // hyperplane, and this estimator has no fourth coordinate to fold in.
  if (symmetryIsNonFlat(symmetry)) {
    reasons.push("the kaleidoscope rotates into 4D");
  }
  return {
    status: reasons.length > 0 ? "ineligible" : "eligible",
    reasons,
  };
}

/** One link of the chain, from the document's own vocabulary. */
function buildEscapeLink(map: Transform): EscapeLink {
  const fold = pureFoldVariation(map)!;
  const affine = composeAffine(map);
  return {
    m: affine.m,
    t: affine.t,
    foldKind:
      fold.type === "boxfold"
        ? SURFACE_FOLD_BOXFOLD
        : fold.type === "spherefold"
          ? SURFACE_FOLD_SPHEREFOLD
          : SURFACE_FOLD_MANDELBOX,
    w: fold.weight,
    derivGrowth: Math.abs(fold.weight) * transformSigmas(map).max,
  };
}

/**
 * Precompute the {@link EscapeDE} for an eligible system. Throws on an
 * ineligible one ({@link analyzeEscapeSystem}) — the app gates first, so
 * reaching the throw is a bug.
 */
export function buildEscapeDE(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeDE {
  const analysis = analyzeEscapeSystem(transforms, finalTransform, symmetry);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no escape-time estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  const links = activeMaps(transforms).map(buildEscapeLink);
  return {
    // The head link's fields, flat — the wire fr-kltj's mirrors read.
    ...links[0],
    links,
    symmetryOrder: effectiveSymmetryOrder(symmetry.order, transforms.length),
    symmetryPlane: symmetry.plane,
    boundingRadius: ESCAPE_TIME_RADIUS,
  };
}

/** One axis of the box fold — variations.ts's `foldAxis`, duplicated here
 * for the same reason `variations4.ts` duplicates it: the estimator must
 * be dependency-light and bit-exact against the GLSL mirror. */
function foldAxis(t: number): number {
  return 2 * Math.max(-1, Math.min(1, t)) - t;
}

/**
 * The kaleidoscope's query-space wedge fold (module doc) — `g`. Reflect
 * `p` into the `pi / order` wedge about `plane`'s FIRST axis, writing into
 * `out` so the estimator's per-query path never allocates. `out` may alias
 * `p`.
 *
 * The two steps are a rotation by the nearest whole sector and a mirror
 * across the first axis, which together are the reflection group's
 * fundamental-domain retraction: a composition of half-space folds, hence
 * continuous and exactly 1-Lipschitz, and an ISOMETRY on each sector — so
 * `|g(p)| = |p|` and the marching ball never moves. `order <= 1` is the
 * identity, copied through untouched, which is what keeps an unsymmetrised
 * document bit-identical to fr-kltj's.
 *
 * Throws on a `w`-plane, exactly as `chaos-game.ts`'s `symmetryRotation`
 * does and for the same reason: a 4D kaleidoscope has no 3x3, and
 * {@link analyzeEscapeSystem} already refuses one, so reaching here with
 * one is a bug rather than a case to degrade.
 */
export function foldQueryIntoSector(
  p: Vec3,
  order: number,
  plane: SymmetryPlane,
  out: Vec3,
): Vec3 {
  out[0] = p[0];
  out[1] = p[1];
  out[2] = p[2];
  if (order <= 1) return out;
  if (plane !== "xy" && plane !== "xz" && plane !== "yz") {
    throw new Error(
      `foldQueryIntoSector: "${plane}" mixes w and has no 3x3 — a 4D ` +
        `kaleidoscope has no escape-time fold (analyzeEscapeSystem)`,
    );
  }
  const ia = plane === "yz" ? 1 : 0;
  const ib = plane === "xy" ? 1 : 2;
  const sector = (2 * Math.PI) / order;
  const a = p[ia];
  const b = p[ib];
  // Rotate BACK by the nearest whole sector, then mirror across the first
  // axis. Landing exactly on a boundary is consistent either way (the two
  // roundings differ by a reflection the mirror then undoes).
  const turn = Math.round(Math.atan2(b, a) / sector) * sector;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  out[ia] = a * c + b * s;
  out[ib] = Math.abs(b * c - a * s);
  return out;
}

/** The folded query, reused across calls — {@link estimateEscapeDistance}
 * runs ~1e7 times a frame and an allocation per call is not free. Safe as
 * module state because the estimator is synchronous and single-threaded,
 * the convention `surface-de.ts`'s descent scratch already runs on. */
const FOLDED: Vec3 = [0, 0, 0];

/** The orbit's terminal radius and derivative bound, left in module scratch
 * by {@link runEscapeOrbit} for the same reason `FOLDED` is module state.
 * {@link estimateEscapeDistance} and {@link escapeSetContains} are both thin
 * readers of the one loop, so they cannot disagree about what the orbit is —
 * which is the whole point of the split, and the reason
 * {@link probeEscapeFill} can ask about the RENDERED set rather than about a
 * threshold on a distance. */
let orbitR = 0;
let orbitDr = 1;

/**
 * Run the chain's forward orbit from `p`, leaving the terminal radius and
 * derivative bound in the module scratch above. This is the loop the
 * `SURFACE_ESCAPE` GLSL variant and the WGSL `core:"escape"` kernel mirror;
 * they inline it into their own estimator, since neither needs the
 * membership reader.
 */
function runEscapeOrbit(de: EscapeDE, p: Vec3, maxIterations: number): void {
  const links = de.links;
  const n = links.length;
  // The kaleidoscope, once, before anything else: the orbit is seeded AND
  // offset by the folded point, which is what makes the rendered set
  // exactly wedge-symmetric (module doc).
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector(p, de.symmetryOrder, de.symmetryPlane, FOLDED)
      : p;
  // Copied out of the scratch before the loop reads it, so nothing in the
  // hot path depends on module state surviving the call.
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const maxSteps = maxIterations * n;
  for (let step = 0; step < maxSteps && r <= ESCAPE_TIME_RADIUS; step++) {
    // Mandelbulber2's `seq->GetSequence(i)`: slot `i mod n`, which is the
    // single map itself at n = 1.
    const link = links[step % n];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    if (link.foldKind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx);
      fy = foldAxis(yy);
      fz = foldAxis(yz);
      localL = 1;
    } else if (link.foldKind === SURFACE_FOLD_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else {
      const bx = foldAxis(yx);
      const by = foldAxis(yy);
      const bz = foldAxis(yz);
      const r2 = bx * bx + by * by + bz * bz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    dr = link.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  orbitR = r;
  orbitDr = dr;
}

/**
 * The escape-time distance estimate (module doc) — the CPU oracle the
 * `SURFACE_ESCAPE` GLSL variant mirrors line for line. `maxIterations`
 * counts PASSES, one pass being one full cycle through the chain, so it
 * says "how many times is each link applied" at any chain length; it
 * exists for the preview tier's depth clamp, and callers wanting the full
 * estimate pass nothing.
 */
export function estimateEscapeDistance(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): number {
  runEscapeOrbit(de, p, maxIterations);
  return orbitR / orbitDr;
}

/**
 * Is `p` in the set the marcher will draw — did its orbit stay inside the
 * bailout ball for the whole budget? The rendered object is the
 * FINITE-BUDGET one, so this asks with the same budget the estimate uses,
 * not with a longer truth oracle.
 *
 * Exists because thresholding {@link estimateEscapeDistance} cannot answer
 * it: `|v|/dr` goes small for a near-boundary ESCAPER too, whose `dr` has
 * run away just as far. Analysis code that needs membership — the emptiness
 * probe below, and the harnesses' bound-violation measurements — asks here.
 */
export function escapeSetContains(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): boolean {
  runEscapeOrbit(de, p, maxIterations);
  return orbitR <= ESCAPE_TIME_RADIUS;
}

/** Probe points {@link buildEscapeDE} samples the bailout ball with for
 * {@link EscapeDE.probeFill}. `surface-de.ts`'s bounding-radius probe is the
 * precedent (8192 there); half of it here, because this probe answers a
 * coarse yes/no rather than fitting a radius, and it runs a full forward
 * orbit per point. Measured cost of the whole probe: 1-5 ms. */
export const ESCAPE_PROBE_POINTS = 4096;

/** Fixed seed for that probe, so a given system always reports the same
 * fill — `surface-de.ts`'s `PROBE_SEED` discipline, for its reason. */
export const ESCAPE_PROBE_SEED = 0x5eed_e5ca;

/**
 * What fraction of the bailout ball the rendered set occupies, from a
 * seeded uniform sample (module doc's EMPTY CHAINS section).
 *
 * ZERO IS THE SIGNAL: a chain whose composite expands too hard escapes on
 * its first pass everywhere, and the mode then renders an empty frame with
 * nothing anywhere saying why. This is what lets a caller say "this chain's
 * set is empty" instead. It is a PROBE and not a proof — a set thinner than
 * the sample can read 0 — so the honest reading of `0` is "the probe found
 * nothing", which is exactly the claim a UI wants to make.
 */
export function probeEscapeFill(
  de: EscapeDE,
  points = ESCAPE_PROBE_POINTS,
  seed = ESCAPE_PROBE_SEED,
): number {
  if (points <= 0) return 0;
  const rng = mulberry32(seed);
  let inside = 0;
  for (let i = 0; i < points; i++) {
    // Uniform in the bailout ball: cbrt for the radius, cos-uniform for the
    // polar angle.
    const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    if (
      escapeSetContains(de, [
        u * st * Math.cos(ph),
        u * st * Math.sin(ph),
        u * ct,
      ])
    ) {
      inside++;
    }
  }
  return inside / points;
}
