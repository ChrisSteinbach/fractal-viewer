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
 * A CROSS-FAMILY CHAIN CAN BE CHEAPER THAN THE SINGLE MAP (fr-j231), which
 * is the same result the STIFFNESS paragraph reaches from the other side.
 * Priced as RATIOS against `mandelboxClassic` at the same budget in one run
 * — the absolute moves with machine load, the ratio does not —
 * `scripts/hybrid-chain.harness.ts` measures `mbox2 -> bulb(1)` at
 * **0.54x** the single map and `bulb(0.5) -> bulb(0.5) rot20` at 0.95x,
 * against 1.26-1.80x for the rest. At pre-scale 1 the bulb link sits 3.4x
 * past its stiffness limit, so nearly every orbit leaves on its first pass
 * and never reaches the second link at all, let alone the 30-pass ceiling.
 * A stiff link makes a chain CHEAP; what it costs is set size, and the
 * measurements below say it does not cost much of that either.
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
 * why — which reads as a broken app. (This paragraph used to name a power
 * link as the sharpest case, on figures that were the PROTOTYPE's chaining
 * arm read through a grid — and fr-j231 both admitted that shape into this
 * gate and re-measured it: see POWER LINKS ARE STIFF below, where the
 * untuned cross chain turns out to draw 11% of its rays.) FOLD-ONLY chains
 * reach it, measured: `mbox2 ->
 * mbox2 pre-scale 4`, `mbox2 pre-scale 8 -> boxfold1.6`, `boxfold6 x3` and
 * `spherefold3 pre-scale 6 -> mbox2` all probe empty, and every one of
 * them passes this gate. So {@link probeEscapeFill} exists: a seeded,
 * deterministic sample of the bailout ball, asking
 * {@link escapeSetContains} rather than thresholding a distance, so the
 * mode can say "this chain's set looks empty" instead of showing nothing.
 * main.ts calls it once per surface session, at the single moment the DE
 * is built (fr-17qu), and reports a zero as a toast without refusing the
 * render — a probe is not a proof, and a set thinner than the sample
 * reads 0. It is deliberately NOT part of {@link analyzeEscapeSystem} (a
 * structural gate that runs on every state change must stay cheap, and
 * this costs 1.2-3.2 ms measured) and NOT computed in
 * {@link buildEscapeDE} (a build has callers that never want the answer);
 * it is a call the caller makes when it wants it.
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
 * CROSS-FAMILY LINKS (fr-j231): A LINK NEED NOT BE A FOLD. The chain admits
 * the escape-time family's two POWER maps beside its three folds — the
 * White/Nylander triplex 8th power (`variations.ts`'s `bulb`, the
 * Mandelbulb's map) and the quaternion square restricted to span{1, i, j}
 * (`qsquare`) — so a document can hold a Mandelbox and a Mandelbulb in one
 * formula chain. That is where Mandelbulber gets its range, and it is the
 * only thing this mode was still missing: three estimators shipped as three
 * separate modes, unable to be COMBINED.
 *
 * Nothing structural had to move. A link contributes exactly one thing to
 * the orbit — its forward map — and one thing to the estimate — its LOCAL
 * Lipschitz factor `L(y)` — and both are already written down for these two
 * maps in the modules that render them alone:
 *
 *     boxfold           reflections            L = 1
 *     spherefold        sphereFoldFactor       L = fR²/clamp(|u|², mR², fR²)
 *     mandelbox         box, then sphere       the same, at the FOLDED u
 *     bulb              triplexPow8            L = 8·|u|⁷      (bulb-de.ts)
 *     qsquare           q ↦ q²                 L = 2·|u|       (qjulia-de.ts)
 *
 * The QUATERNION SQUARE's factor is EXACT — quaternion norms multiply, so
 * `|d(q²)| = 2|q|·|dq|` identically — and every other row is the field's
 * heuristic. So the widened chain composes the SHIPPED bounds and inherits
 * their status rather than introducing a new one: the same argument the
 * fold-only chain made, with two more rows in the table.
 *
 * `u` is the point that map's nonlinearity actually receives: `y = M v + t`
 * for every row but the mandelbox, whose sphere fold reads the BOX-FOLDED
 * `y` rather than `y` itself. {@link runEscapeOrbit} has always evaluated
 * it there; only this table's shorthand ever said otherwise, and a mirror
 * written from that shorthand would be wrong on exactly the one link kind
 * that ships most.
 *
 * IN `v` SPACE, WITH THE LITERAL `+ 1`, and that has to be deliberate.
 * `bulb-de.ts` and `qjulia-de.ts` iterate `y = M v + t` with `dr` tracking
 * `dy/dp`, so they SEED `dr` at `sigma_max(M)` and add `+ sigma_max(M)`;
 * this module iterates `v` with `dr` tracking `dv/dp`, so it seeds 1 and
 * adds 1. `bulb-de.ts`'s own doc says the two are the same recurrence in
 * different coordinates (factor `sigma_max` out and the `+ sigma_max`
 * becomes `+ 1`) — but that factoring needs ONE `M` to push through, and a
 * chain has n of them. So the chain stays in `v` space throughout, which is
 * how it avoids having to choose. The consequence worth stating: a ONE-LINK
 * bulb chain is not `estimateBulbDistance` — different coordinates, and a
 * different iteration budget — which is one of the two reasons the gate
 * below refuses a lone power map outright.
 *
 * THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW (`logEstimate`), which
 * is the one genuinely new decision. A fold orbit escapes EXPONENTIALLY
 * (the maps are asymptotically affine), so its potential is `log r` and the
 * distance reads `r / dr`. A power orbit escapes SUPER-exponentially
 * (`r ↦ r^d`), so its potential is `log log r` and the distance reads the
 * Böttcher/Green's form `0.5·r·ln r / dr` — which is exactly what
 * `bulb-de.ts` and `qjulia-de.ts` return. A chain holding both is
 * super-exponential (one power link dominates a pass), so it reads the
 * Böttcher form; a fold-only chain keeps the linear one, bit for bit.
 *
 * Note what this does NOT contradict. `scripts/escape-estimate-form.harness
 * .ts` (fr-282c) refused the log form for the FOLD family, and its argument
 * was dimensional: the folds are uniform-rescale equivariant, so an
 * estimator must satisfy `DE_λ(λp) = λ·DE(p)`, which `ln r` cannot (it
 * needs `r` dimensionless). A power map is NOT rescale equivariant —
 * `V(λy) = λ^d V(y)` — so that argument does not reach a chain containing
 * one, and the harness's other finding (`log/linear` IS `0.5·ln r`, pinned
 * near `0.5·ln 4` because a fold's escape lands just outside the bailout
 * ball) is exactly what changes here: a power link's escape lands at `r^d`,
 * far outside it, and `0.5·ln r` is then the 5x correction the Böttcher
 * form exists to apply. The multiplier is a CONTINUOUS function of the
 * terminal radius either way, so the flag moves no seam across the surface;
 * it is one number per chain, resolved at build and carried on the wire so
 * that six mirrors cannot each decide it differently.
 *
 * fr-282c's DECISIVE control settles it, re-run over three independent
 * seeds: the near/far decile medians of `log/linear` are FLAT for a fold
 * chain (1.00x) and for a fold-TERMINATED cross chain, and reach 0.55x on a
 * power-dominated one — and the rows where the ratio is not flat are
 * exactly the rows where the form wins big (bound overshoot cut 3.7x at
 * `mbox2 -> bulb(0.5)`, against the 1.2x it buys where flat, which is the
 * constant fr-282c already refused).
 *
 * ONE OPEN OBSERVATION, deliberately not a result. A three-link fixture
 * adapts the OTHER way — `box1.6 -> bulb(0.3) -> sph1.2` reads near 0.793
 * against far 1.048 — and the direction is stable (1.32x / 1.31x / 1.32x
 * over three seeds), but it is a property of that SYSTEM rather than of
 * chain length or of cross-family chains: the same power link at the same
 * pre-scale between different folds (`mbox2 -> bulb(0.3) -> box1.6 rot20`)
 * reads FLAT at 0.98x. The untested guess worth writing down for whoever
 * picks it up is that the ratio IS `0.5·ln r_terminal`, so it is set by
 * which link the orbit escapes on, and the adaptive fixture is the only one
 * here ending in a BARE sphere fold, whose inversion throws an escaping
 * point far past the bailout ball — its far decile sits at `r ~ 8.1`,
 * double the bailout. Nothing ships on that fixture.
 *
 * POWER LINKS ARE STIFF, AND CYCLING RESCUES THEM ANYWAY — the feature's
 * one predicted hazard, tested on the shipped orbit and REFUTED. The
 * prediction was sound and its arithmetic is worth keeping: a mandelbox
 * step leaves `|v|` near 7, a triplex 8th power sends 7 to 5.8e5 in one
 * link, and the condition for a link of degree `d` and weight `w` entering
 * with `|v| <= R` to keep its output inside the ball is
 *
 *     sigma_max(M) <= (R / |w|)^(1/d) / R
 *
 * — 0.30 for a unit-weight triplex power at `R = 4`, 0.5 for the
 * quaternion square. Above that the composite looks like a one-way trip
 * out of its own bailout ball at every query, and the prototype appeared
 * to measure exactly that: `mandelbox w=2 -> bulb` at pre-scale 1 reading
 * 0.01% of the ball and rising to only 5.09% at pre-scale 0.3.
 * fr-17qu's whole blank-frame notice was scheduled ahead of this bead on
 * the strength of that row, and the bead recorded a second prediction
 * beside it — that cycling would NOT help, since a cycled bulb link still
 * sees `|v| <= 4` and `4⁸ = 65536` still escapes.
 *
 * BOTH HALVES OF THAT ROW WERE WRONG, and separating them took two
 * measurements. Its INSTRUMENT was a grid thresholding the distance
 * estimate (see THE INSTRUMENT below); re-read through
 * {@link probeEscapeFill} at the same 16-pass budget, so the instrument is
 * the only thing that changed, the chaining arm reads 0.01 / 0.12 / 0.24 /
 * 6.40 / 72.88 / 98.32% as the pre-scale falls 1 -> 0.2, against the
 * record's 0.01 / 0.05 / 2.09 / 10.30 / 5.09 / 0.47. That is 8.7x HIGH at
 * 0.5 and then 14x and 209x LOW at 0.3 and 0.2 — not a precision error but
 * a different SHAPE: the record describes a narrow usable band with a
 * collapse after it, where the arm actually climbs monotonically into a
 * solid ball. And its ORBIT was the rejected one, which is the next
 * paragraph.
 *
 * The prototype's numbers are its CHAINING arm's, and the shipped orbit
 * cycles. That is the whole difference, and it is decisive: cycling
 * re-enters `+ p` after EVERY link, so a power link is applied to a point
 * the query has just tethered and its output is tested before any fold can
 * compound it. Both arms re-measured through ONE instrument at EQUAL WORK
 * (30 passes each, same bailout ball, same seeded 131072-point sampler —
 * {@link probeEscapeFill}'s, not a grid; see the INSTRUMENT note below),
 * `scripts/hybrid-chain.harness.ts`:
 *
 *     mandelbox w=2 -> bulb, pre-scale    1     0.6    0.5    0.4    0.3    0.2
 *       ball fill, CYCLING  (shipped)     0.29   1.57   2.78   6.32  22.89  64.56 %
 *       ball fill, CHAINING (rejected)    0.01   0.11   0.23   2.26  69.08  98.29 %
 *       rays hit, shipped                11.0   26.9   39.1   55.0   64.8   14.4  %
 *
 *     mandelbox w=2 -> qsquare            1     0.6    0.5    0.4    0.3    0.2
 *       ball fill, CYCLING  (shipped)     0.01   0.33   1.59   5.01  17.61  44.41 %
 *       ball fill, CHAINING (rejected)    0.00   0.36   6.77  27.60  64.18  88.99 %
 *       rays hit, shipped                15.8   40.7   49.8   50.6   55.9   28.5  %
 *
 * The untuned pre-scale 1 — the exact case the bead calls a blank frame —
 * draws 11.0% of its rays. It is not blank; it is a constellation of bulb
 * nodules in the fold's own symmetry, and one of the best-looking things
 * in the family. Pushed the other way it stays renderable too: `-> bulb`
 * pre-scaled 8, twenty-seven times past the bound above, still draws 0.75%
 * of its rays against the 0.095% the same marcher reads for fr-17qu's own
 * degenerate system.
 *
 * AND CHAINING HAS NO USABLE RANGE AT ALL, which is more than fr-za0n's
 * fold-only sheet could see. Read the two fill rows against each other:
 * chaining is 12-29x EMPTIER than cycling from pre-scale 1 down to 0.5,
 * and then, one step later, 3.0x and 1.5x FATTER at 0.3 and 0.2 — 69% and
 * 98% of its own bailout ball, which is fr-7u8t.8's "the rendered object
 * WAS its own bounding sphere" defect returning intact. It goes from
 * nothing to a solid ball with no window in between, while cycling climbs
 * smoothly through the whole range and reaches neither failure. The
 * rejected arm is not merely worse here; on a cross-family chain it has no
 * setting that works.
 *
 * SO THERE IS NO AUTO-SCALE AND NO NEW SIGNAL, and a hint computed from
 * the bound above was written and then deleted rather than shipped: it
 * fires on every row of that table, all of which render, which is fr-17qu's
 * own second-cut lesson verbatim ("a signal that fires on good input is
 * worse than the silence it replaced"). The volume figures are the same
 * trap one layer down, and the qsquare row is the sharpest case this
 * family has produced: 0.012% fill for a system that draws a SIXTH of its
 * rays, beside `mandelboxRings` reading 0.000% at the same sample count
 * while drawing 44.9% of them. A volume probe cannot answer "will it
 * render", here or anywhere else in this mode. fr-17qu's shipped signal
 * already asks the right question (did the first settle's own arithmetic
 * draw anything), and it covers these chains unchanged.
 *
 * THE INSTRUMENT, because a first draft of this paragraph was wrong about
 * its own numbers and so was the record it inherited. Ball fill here is a
 * SEEDED UNIFORM SAMPLE against {@link escapeSetContains}, never a grid
 * and never a threshold. Two independent defects, and the second is the
 * larger:
 *
 * THE GRID ALIASES. A regular grid does not measure the volume of a fold
 * set: the structure sits on the fold's own walls — at the integers, for
 * the classic `boxLimit` — so a grid whose planes land there over-samples
 * them, and over `[-4, 4]` the aligned resolutions are exactly `n - 1` in
 * {8, 16, 24, 32, 40, 48}. On `mandelboxClassic`, n = 23..49 reads
 * 4.54 / 9.33 / 3.44 / 4.63 / 3.60 / 7.96 / 5.98 / 5.61% — a 2.72x spread
 * with no convergence, every aligned resolution high — where the sampler
 * reads 3.540 / 3.548 / 3.568% at 4k / 64k / 128k. THIN sets only: a
 * 22%-fill chain reads 22.4-22.9% at every n, which is why this is easy to
 * miss, since it bites exactly the rows a blank-frame question is about.
 *
 * AND A DISTANCE THRESHOLD IS NOT A MEMBERSHIP ORACLE, in EITHER
 * direction — which is what manufactured the phantom collapse above.
 * {@link escapeSetContains}'s own doc gives one direction: `|v|/dr` goes
 * small for a near-boundary ESCAPER too, whose `dr` has run away just as
 * far. The other direction is the one that bit, and it is specific to the
 * rejected orbit: CHAINING floors `dr` only once per PASS, so a
 * hard-contracting chain keeps `dr` near 1 and returns O(1) distances at
 * points whose orbits never leave the ball. Those points ARE in the set,
 * and a `de(p) < eps` test counts every one of them out — so the record's
 * 0.47% at pre-scale 0.2 was a set filling 98% of its own bailout ball,
 * read as almost empty. fr-azjk carries both findings back to the sheets
 * that predate this one.
 *
 * ELIGIBILITY is the COMPLEMENT of the IFS gate on the shapes this formula
 * covers: one or more active maps, each of whose active variation list is
 * exactly one fold-family OR power entry, all flat, no final transform, no
 * kaleidoscope that rotates out of 3D — and NOT an IFS-eligible
 * contraction. That contraction clause is what fr-za0n widened:
 * `analyzeSurfaceSystem` admits a system when EVERY map contracts, so this
 * gate admits when at least one does NOT. A two-map non-contracting fold
 * system used to be refused by both gates and rendered by nothing; it is
 * this mode's now. Everything else stays ineligible for both modes, with
 * reasons.
 *
 * A LONE POWER MAP IS REFUSED, deliberately, and that is what keeps this
 * gate disjoint from `analyzeBulbSystem` rather than merely ordered before
 * it. A single triplex power already HAS an object and a better estimator —
 * `bulb-de.ts`'s, in `y` space with the Böttcher form and its own presets
 * and kernel core — and a single quaternion square is `qjulia-de.ts`'s
 * measured-dull object, which fr-7u8t.5 closed won't-do after twenty panels
 * came back smooth. Neither refusal costs range: two power links ARE a
 * chain (`bulb -> bulb` at a rotation is a genuinely new set), and it is
 * composition, not the maps, that this gate widened for.
 *
 * WHAT THE MIRRORS SEE (fr-s04t landed the pass fr-za0n scheduled). The
 * GLSL `SURFACE_ESCAPE` variant and the WGSL `core:"escape"` kernel both
 * CYCLE the list now, term for term with {@link runEscapeOrbit} — the
 * query fold included — so a chain renders what this module estimates on
 * every path. Each carries the list in its own dialect: GLSL as one
 * `uEscM`/`uEscT`/`uEscParams` slot per link (a 24-slot cap, the descent's
 * own, which is the mode's cap because eligibility must be one answer for
 * both engines), WGSL as one `GpuMap` per link on the maps storage binding
 * the descent cores already carry. {@link EscapeDE} still extends
 * {@link EscapeLink}, so the flat `m`/`t`/`kind`/`w`/`derivGrowth`
 * fields remain the head link's — the WGSL params block keeps packing them
 * as frozen layout ballast, and nothing reads them to render. A one-link
 * document renders bit-identically to fr-kltj's on every path (`n = 1`
 * makes the cycle the single map, order 1 skips the fold entirely), which
 * is what the bench's recorded escape rows check for free.
 *
 * fr-j231 cost those mirrors three things and no layout. The two POWER
 * bodies append behind a `kind < 4` guard (see {@link EscapeLinkKind} for
 * why the guard rather than a rewrite); {@link EscapeDE.logEstimate} rides
 * the one slot each wire already reserved for exactly this — GLSL's
 * `uEscLogForm`, WGSL's `escParams.w`, whose comment named it "where a
 * form flag would ride if the bulb family ever earns one"; and the
 * hit-info's CONTINUOUS escape count learned a second interpolant, because
 * `log(r/R)/log(growth)` models CONSTANT-factor growth and silently
 * degenerates on a power link (a pre-scaled one has `growth < 1`, so the
 * guard fires and the trap falls back to the raw integer count — fr-7u8t.8's
 * palette confetti, through the back door). A power-terminated orbit reads
 * the power form `log(log r / log R) / log d` instead, selected by the
 * DEGREE of the link that produced the terminal radius — which is the same
 * per-step register the constant-factor arm already tracked as `growth`.
 */
import { composeAffine } from "./affine";
import { isFlatTransform, symmetryIsNonFlat } from "./affine4";
import { BULB_POWER } from "./bulb-de";
import { effectiveSymmetryOrder } from "./chaos-game";
import { mulberry32 } from "./rng";
import {
  CONTRACTION_LIMIT,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_SPHEREFOLD,
  transformSigmas,
} from "./surface-de";
import { resolveFoldRadii, sphereFoldLipschitz } from "./variations";
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

/**
 * The maps a chain LINK may carry, as the numeric code every mirror
 * dispatches on. The three folds keep `surface-de.ts`'s own values, so a
 * fold-only document packs the bytes it always packed; fr-j231's two POWER
 * maps append at 4 and 5.
 *
 * The codes are ORDERED — folds below {@link ESCAPE_LINK_BULB}, powers at or
 * above it — and the mirrors lean on that: the fold family is dispatched by
 * a pair of NEGATIVE tests (`kind != 2` runs the box fold, `kind != 1` runs
 * the sphere fold) that are exhaustive by negation over {1, 2, 3} alone, so
 * every one of them sits behind a `kind < 4` guard rather than being
 * rewritten. `surface-de-gpu.ts`'s module doc names that hazard as the
 * reason the Mandelbulb became a sixth CORE instead of a fourth kind; the
 * guard is what makes a fourth and fifth kind safe here.
 */
export const ESCAPE_LINK_BOXFOLD = SURFACE_FOLD_BOXFOLD;
export const ESCAPE_LINK_SPHEREFOLD = SURFACE_FOLD_SPHEREFOLD;
export const ESCAPE_LINK_MANDELBOX = SURFACE_FOLD_MANDELBOX;
/** The White/Nylander triplex 8th power — `variations.ts`'s `bulb`. */
export const ESCAPE_LINK_BULB = 4;
/** The quaternion square on span{1, i, j} — `variations.ts`'s `qsquare`. */
export const ESCAPE_LINK_QSQUARE = 5;

export type EscapeLinkKind = 1 | 2 | 3 | 4 | 5;

/**
 * A link's POWER `d` — the degree of its map, `V(λy) = λ^d V(y)`, which is
 * both the exponent in its local factor `d·|y|^(d-1)` and the base of the
 * continuous escape count the shaders paint with. `0` means "not a power
 * map": a fold is asymptotically affine and has neither.
 */
export function escapeLinkPower(kind: EscapeLinkKind): number {
  return kind === ESCAPE_LINK_BULB
    ? BULB_POWER
    : kind === ESCAPE_LINK_QSQUARE
      ? 2
      : 0;
}

/** One link of the orbit's formula chain (fr-za0n) — one active map of the
 * document, in document order, and everything the orbit needs from it. */
export interface EscapeLink {
  /** Row-major 3x3 FORWARD linear part M of the map. */
  m: number[];
  /** Forward translation t. */
  t: Vec3;
  /** The map applied after the affine part — a fold, or (fr-j231) one of
   * the two power maps. */
  kind: EscapeLinkKind;
  /** Signed variation weight w — the classic Mandelbox scale for a fold,
   * and a free multiplier on a power link (the orbit's `dr` accounts for
   * it exactly, so unlike `analyzeBulbSystem`'s lone map there is no
   * textbook object here for it to deform away from). */
  w: number;
  /** `|w| · sigma_max(M)` — the per-step derivative growth the local
   * factor multiplies onto. No fold LENGTH enters it: the sphere
   * fold's contribution rides the per-step local factor instead, and so
   * does a power link's `d·|y|^(d-1)`. */
  derivGrowth: number;
  /** The box fold's reflection plane (`variations.ts`'s `boxLimit`,
   * resolved). Classic 1. */
  boxLimit: number;
  /** `mR²`, the sphere fold's squared minimum radius (resolved). Classic
   * 0.25 — squared here so the orbit's hot loop never squares per step. */
  minRadius2: number;
  /** `fR²`, the sphere fold's squared fixed radius (resolved). Classic 1. */
  fixedRadius2: number;
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
  /**
   * Read the terminal radius through the Böttcher/Green's form
   * `0.5·r·ln r / dr` rather than the fold family's linear `r / dr`
   * (module doc's ESTIMATE FORM paragraph) — true exactly when some link
   * is a POWER map, whose super-exponential escape the linear form
   * under-reads by a factor `0.5·ln r`.
   *
   * One number per chain, resolved here rather than in each of the six
   * mirrors, and false for every document that predates fr-j231 — which
   * is what keeps a fold-only chain bit-identical.
   */
  logEstimate: boolean;
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
 * copy private): the single active entry a LINK may carry — the fold
 * family, plus (fr-j231) the two escape-time power maps — or null.
 * Exactly the set whose forward local Lipschitz factor is known in closed
 * form, which is the whole requirement for a link. */
function linkVariation(t: Transform): Variation | null {
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

/** Which of {@link linkVariation}'s types is a POWER map (fr-j231) — the
 * two the gate treats differently and the orbit dispatches past its fold
 * branches. */
function isPowerVariation(v: Variation): boolean {
  return v.type === "bulb" || v.type === "qsquare";
}

/**
 * Does this system's chain hold a POWER link — is it a CROSS-FAMILY hybrid
 * rather than the fold chain fr-za0n shipped? `qjulia-de.ts`'s
 * `systemHasActiveQSquare` is the precedent, and so is its reason: main.ts's
 * eligibility note has to name what it is about to render, and "these N
 * folds do not all contract" stops being true the moment one of them is a
 * triplex power.
 *
 * Reads the same LINK shape {@link analyzeEscapeSystem} does — one active
 * variation per active map — so it cannot report a hybrid the gate would
 * refuse, or miss one it admits.
 */
export function systemHasPowerLink(transforms: Transform[]): boolean {
  return activeMaps(transforms).some((map) => {
    const v = linkVariation(map);
    return v !== null && isPowerVariation(v);
  });
}

/** A map's composite forward Lipschitz bound `|w|·L_V·sigma_max(M)` — the
 * same expression `analyzeSurfaceSystem` gates contraction on, so the two
 * gates cannot disagree about which side of the line a map falls.
 * `sphereFoldLipschitz` is the magnification `fR²/mR²` (fr-s9ll), so the
 * fold's own radii move this seam with them. */
function foldLipschitz(fold: Variation, map: Transform): number {
  return (
    Math.abs(fold.weight) *
    (fold.type === "boxfold"
      ? 1
      : sphereFoldLipschitz(resolveFoldRadii(fold))) *
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
    const v = linkVariation(map);
    if (!v) {
      reasons.push(`${label} is not a pure fold or power map`);
    } else if (!isFlatTransform(map)) {
      reasons.push(`${label} extends into 4D`);
    } else if (isPowerVariation(v)) {
      if (active.length < 2) {
        // Module doc's LONE POWER MAP paragraph: both of these already
        // have a home, and refusing them here is what keeps this gate
        // DISJOINT from `analyzeBulbSystem` rather than merely ordered
        // before it — main.ts's forward arm reads the two in sequence.
        reasons.push(
          v.type === "bulb"
            ? `${label} is a lone triplex power (the Mandelbulb render owns it)`
            : `${label} is a lone quaternion square (chain it with another map)`,
        );
      } else {
        // A power link ALWAYS expands, at every parameter a document can
        // author: its local factor `d·|y|^(d-1)` reaches 8·4⁷ = 131072 on
        // the bailout ball's rim. The complement with the IFS gate is
        // firmer still — `analyzeSurfaceSystem` refuses any map carrying a
        // non-fold variation outright ("map N uses variations"), so a
        // chain holding one is never IFS-eligible whatever its weights.
        anyExpands = true;
      }
    } else if (foldLipschitz(v, map) >= CONTRACTION_LIMIT) {
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
  const v = linkVariation(map)!;
  const affine = composeAffine(map);
  // A POWER link has no fold apparatus at all, and `resolveFoldRadii`
  // returns the CLASSIC set for a variation carrying none — so its lane
  // travels the wire holding the numbers every unparameterised fold link
  // holds, rather than zeros a stray sphere-fold read could divide by.
  // No branch reads them: the orbit dispatches on `kind` first.
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
            : v.type === "bulb"
              ? ESCAPE_LINK_BULB
              : ESCAPE_LINK_QSQUARE,
    w: v.weight,
    derivGrowth: Math.abs(v.weight) * transformSigmas(map).max,
    boxLimit: radii.boxLimit,
    minRadius2: radii.minRadius * radii.minRadius,
    fixedRadius2: radii.fixedRadius * radii.fixedRadius,
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
    logEstimate: links.some((l) => escapeLinkPower(l.kind) > 0),
    symmetryOrder: effectiveSymmetryOrder(symmetry.order, transforms.length),
    symmetryPlane: symmetry.plane,
    boundingRadius: ESCAPE_TIME_RADIUS,
  };
}

/**
 * The stiffness bound of the module doc's POWER LINKS paragraph: the
 * largest `sigma_max(M)` at which a link of degree `d` and weight `w`
 * keeps its own output inside a bailout ball of radius `R` when the whole
 * ball is thrown at it.
 *
 * NOT A GATE AND NOT A SIGNAL — nothing in the app calls it. It exists
 * because the bead this feature came from blocked on it, and because
 * `scripts/hybrid-chain.harness.ts` measures the shipped orbit against it:
 * the bound is the CHAINING arm's, and cycling's per-link `+ p` means a
 * real chain renders across the whole range it declares hopeless. Keeping
 * it executable is what makes that a measurement rather than an assertion.
 */
export function escapeLinkStiffnessLimit(
  power: number,
  weight: number,
  radius = ESCAPE_TIME_RADIUS,
): number {
  const w = Math.abs(weight);
  if (power <= 0 || !(w > 0)) return Infinity;
  return Math.pow(radius / w, 1 / power) / radius;
}

/** One axis of the box fold — variations.ts's `foldAxis`, duplicated here
 * for the same reason `variations4.ts` duplicates it: the estimator must
 * be dependency-light and bit-exact against the GLSL mirror. `wall` is the
 * link's resolved `boxLimit` (fr-s9ll); at the classic 1 the expression is
 * character for character the one that shipped. */
function foldAxis(t: number, wall: number): number {
  return 2 * Math.max(-wall, Math.min(wall, t)) - t;
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
    // The link's own fold lengths (fr-s9ll). At the classic 0.25/1/1 every
    // expression below is the one that shipped, term for term.
    const wall = link.boxLimit;
    const mR2 = link.minRadius2;
    const fR2 = link.fixedRadius2;
    if (link.kind === ESCAPE_LINK_BOXFOLD) {
      fx = foldAxis(yx, wall);
      fy = foldAxis(yy, wall);
      fz = foldAxis(yz, wall);
      localL = 1;
    } else if (link.kind === ESCAPE_LINK_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else if (link.kind === ESCAPE_LINK_MANDELBOX) {
      const bx = foldAxis(yx, wall);
      const by = foldAxis(yy, wall);
      const bz = foldAxis(yz, wall);
      const r2 = bx * bx + by * by + bz * bz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    } else if (link.kind === ESCAPE_LINK_BULB) {
      // `variations.ts`'s triplexPow8, INLINED — duplicated for the reason
      // `foldAxis` is above, and character for character `bulb-de.ts`'s own
      // copy so the two cannot drift. Its local factor `8·|y|⁷` is the
      // triplex power's radial/polar stretch: a HEURISTIC, under-reading
      // the azimuthal stretch by up to 8x at the poles (bulb-de.ts's own
      // paragraph), which is the same class of slack the folds contribute.
      const a = yx * yx + yy * yy;
      const z2 = yz * yz;
      const r2 = a + z2;
      const r4 = r2 * r2;
      fz =
        128 * z2 * z2 * z2 * z2 -
        256 * z2 * z2 * z2 * r2 +
        160 * z2 * z2 * r4 -
        32 * z2 * r4 * r2 +
        r4 * r4;
      const s =
        128 * z2 * z2 * z2 * yz -
        192 * z2 * z2 * yz * r2 +
        80 * z2 * yz * r4 -
        8 * yz * r4 * r2;
      const rho = Math.sqrt(a);
      const inv = rho > 0 ? 1 / rho : 0;
      const u1 = yx * inv;
      const v1 = yy * inv;
      const u2 = u1 * u1 - v1 * v1;
      const v2 = 2 * u1 * v1;
      const u4 = u2 * u2 - v2 * v2;
      const v4 = 2 * u2 * v2;
      const u8 = u4 * u4 - v4 * v4;
      const v8 = 2 * u4 * v4;
      fx = rho * s * u8;
      fy = rho * s * v8;
      localL = BULB_POWER * (r2 * r2 * r2 * Math.sqrt(r2));
    } else {
      // The quaternion square on span{1, i, j} — `variations.ts`'s
      // `qsquare`, which is closed on that subspace (the `v x v` term
      // drops). Its `2·|y|` is EXACT rather than a bound: quaternion
      // multiplication is norm-multiplicative, so `|d(q²)| = 2|q|·|dq|`
      // identically (`qjulia-de.ts`). The one certified factor in the
      // chain's product.
      fx = yx * yx - yy * yy - yz * yz;
      fy = 2 * yx * yy;
      fz = 2 * yx * yz;
      localL = 2 * Math.sqrt(yx * yx + yy * yy + yz * yz);
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
  if (!de.logEstimate) return orbitR / orbitDr;
  // The Böttcher/Green's form for a chain that escapes super-exponentially
  // (module doc's ESTIMATE FORM paragraph). `ln r` goes NEGATIVE below
  // r = 1, which a converging orbit reaches, and a negative estimate would
  // march the tracer BACKWARDS — returning 0 there is the inside signal and
  // is safe in the direction a sphere tracer needs. `bulb-de.ts` and
  // `qjulia-de.ts` take the identical exit, for the identical reason.
  return orbitR <= 1 ? 0 : (0.5 * orbitR * Math.log(orbitR)) / orbitDr;
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

/** Points {@link probeEscapeFill} samples the bailout ball with.
 * `surface-de.ts`'s bounding-radius probe is the precedent (8192 there);
 * half of it here, because this probe answers a coarse yes/no rather than
 * fitting a radius, and it runs a full forward orbit per point. Measured
 * cost of the whole probe: 1.2-3.2 ms on the shipped presets — which is
 * why its caller pays it once per session, never per state change. */
export const ESCAPE_PROBE_POINTS = 4096;

/** Fixed seed for that probe, so a given system always reports the same
 * fill — `surface-de.ts`'s `PROBE_SEED` discipline, for its reason. */
export const ESCAPE_PROBE_SEED = 0x5eed_e5ca;

/**
 * What fraction of the bailout ball the rendered set occupies, from a
 * seeded uniform sample (module doc's EMPTY CHAINS section).
 *
 * THIS MEASURES VOLUME, AND DOES NOT ANSWER "WILL IT RENDER". Read the
 * warning that follows before reaching for it, because fr-17qu's first cut
 * reached for it and was wrong.
 *
 * An escape-time set is frequently a thin FRACTAL — filaments and dust with
 * a large surface and essentially no volume — and uniform volume sampling
 * finds nothing in one however many points it throws. The shipped
 * `mandelboxRings` preset is exactly that: `0.0000%` fill at 65536 samples,
 * and ~38k surface hits in a 1024x640 frame that is one of the prettiest
 * objects the app ships. So `0` here means "the set has no measurable
 * volume", NOT "there is nothing to draw", and a caller wanting the second
 * must ask the marcher (main.ts fires its blank-frame notice off a completed
 * settle's own hit count for that reason).
 *
 * What it is genuinely for: comparing how much of the ball two systems fill,
 * which is what `escape-chain.harness.ts` and `hybrid-chain.harness.ts` use
 * it for when pricing whether composition inflates a set toward a solid ball.
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
