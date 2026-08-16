/**
 * The escape-time family ACROSS ITS OWN BOUNDARY (fr-j231) — the sheet the
 * shipped estimator draws for a chain that mixes folds with powers, and the
 * prototype that asked for it, kept beside it as the control.
 *
 * THE HOLE IS CLOSED. This file opened as a prototype arguing for a shape no
 * gate admitted: `analyzeSurfaceSystem` refused a non-contracting map,
 * `analyzeEscapeSystem` admitted exactly one, `analyzeBulbSystem` admitted
 * exactly one triplex power, and a document holding a Mandelbox and a
 * Mandelbulb rendered as nothing at all. fr-za0n closed the fold-only half
 * (the transform LIST became the formula chain); fr-j231 closed this one.
 * `escape-de.ts` now admits `bulb` and `qsquare` links in any chain of two
 * or more maps, resolves the estimate form per chain (`logEstimate`), and
 * both shader mirrors gained the two power bodies — appended PAST the
 * `kind < 4` guard that now fences the fold family's negative-test dispatch,
 * rather than rewriting it.
 *
 * SO THE SUBJECT AND THE CONTROL HAVE SWAPPED, and that is the whole shape
 * of this rewrite. Everything measured through `estimateEscapeDistance` is
 * the subject; the local prototype ({@link runChain} and its
 * `sequence`/`offset`/`estimate` forks) is now an INDEPENDENT
 * cross-validation control, kept executable rather than deleted — the
 * discipline `escape-form-sweep.harness.ts` keeps the retired Julia form
 * under and `escape-chain.harness.ts` keeps `estimateChained` under.
 * `escape-de.ts`'s module doc describes the resulting pair: that harness
 * answers the fold-only half with shipped code, this one answers the
 * cross-family half the same way, and the prototype is what keeps both
 * honest.
 *
 * IF YOU CAME HERE FOR A NUMBER TO QUOTE, take it from the `CANONICAL
 * TABLE` test and nowhere else. It prints fill, rays hit, steps/ray and
 * overshoot for every row any doc in this repo cites — the two pre-scale
 * sweeps, the three hybrid presets and the three controls — at ONE sample
 * count and ONE panel size, both stated inline above the table. The other
 * tests each pick the size their own question needs (200px where only an
 * order of magnitude matters, 420px where the picture is the output), and
 * quoting across them is how a fill figure and a hit figure end up
 * describing different measurements. Every table in this file names its
 * instrument in its own stdout, so nothing here needs the source read to be
 * understood six months from now.
 *
 * THE STRONGEST RESULT HERE IS ALSO THE CHEAPEST, and a later reader must
 * not re-derive any of it by hand. The prototype and `escape-de.ts` were
 * written from the same Mandelbulber2 reading but not from each other, so
 * agreement between them is evidence rather than a tautology. The
 * cross-validation `it()` runs the prototype's `cycle` arm with a per-LINK
 * offset at `ESCAPE_TIME_ITERATIONS * n` steps against the shipped
 * estimator over 4000 queries — half in the [-4, 4] box, half uniform in the
 * bailout ball — on NINE chains, five of them cross-family including a
 * three-link one and a two-power one, and the worst absolute difference is
 * EXACTLY ZERO on every row. That covers the two inlined power bodies, their
 * local factors `8|y|⁷` and `2|y|`, and the Böttcher return with its
 * `r <= 1` clamp: the parts six mirrors are written against.
 *
 * ================== 1. CYCLING RESCUES THE POWER LINK ===================
 *
 * The feature's one predicted hazard, tested on the shipped orbit and
 * REFUTED. A mandelbox step leaves `|v|` near 7, a triplex 8th power sends 7
 * to 5.8e5 in one link, and {@link escapeLinkStiffnessLimit} is the closed
 * form of when a link keeps its own output inside the ball — 0.297 for a
 * unit-weight bulb at R = 4, 0.500 for the quaternion square. The prototype
 * measured exactly that, and the bead carried a second prediction beside it:
 * that cycling would NOT help, since a cycled bulb link still sees `|v| <= 4`
 * and `4⁸ = 65536` still escapes.
 *
 * That second prediction is what this table refutes. Cycling re-enters `+ p`
 * after EVERY link, so a power link is applied to a point the query has just
 * tethered and its output is tested before any fold can compound it. EVERY
 * fill figure below is `probeEscapeFill`'s own seeded sample at 131072
 * points over the radius-4 bailout ball — one instrument, three orbits — and
 * rays hit is `de-preview.ts`'s framing pose at 260px:
 *
 *     mandelbox w=2 -> bulb, pre-scale   1     0.6    0.5    0.4    0.3    0.2
 *       fill, CYCLING @30 (shipped)      0.29   1.57   2.78   6.32  22.89  64.56 %
 *       fill, CHAINING @30 (equal work)  0.01   0.11   0.23   2.26  69.08  98.29 %
 *       fill, CHAINING @16 (bead budget) 0.01   0.12   0.24   6.40  72.88  98.32 %
 *       rays hit, shipped               11.0   26.9   39.1   55.0   64.8   14.4  %
 *
 *     mandelbox w=2 -> qsquare           1     0.6    0.5    0.4    0.3    0.2
 *       fill, CYCLING @30 (shipped)      0.01   0.33   1.59   5.01  17.61  44.41 %
 *       fill, CHAINING @30 (equal work)  0.00   0.36   6.77  27.60  64.18  88.99 %
 *       fill, CHAINING @16 (bead budget) 0.00   1.77  12.04  32.59  66.22  89.30 %
 *       rays hit, shipped               15.8   40.7   49.8   50.6   55.9   28.5  %
 *
 * THE VERDICT: chaining does not merely render less, it SKIPS THE USEFUL
 * RANGE. Over pre-scale 1 to 0.5 it is 12-29x emptier than cycling; one or
 * two steps later it is 3.0x and 1.5x FATTER, at 69% and 98% of the bailout
 * ball — a featureless crust, precisely the defect fr-7u8t.8 existed to fix,
 * arriving by the back door exactly as `escape-chain.harness.ts` measured it
 * arriving for fold-only chains. The quaternion square does the same one
 * notch earlier (5.5x fatter already at 0.4). Cycling climbs smoothly across
 * the whole sweep and reaches neither failure. The two chaining rows are
 * within noise of each other except at pre-scale 0.4, so THE BUDGET IS NOT
 * WHAT SHAPES THAT CURVE.
 *
 * AND THE CHAINING FIGURES ON RECORD ARE WRONG, which is a finding and not a
 * detail — the bead, and `escape-de.ts`'s module doc after it, quote
 * 0.01 / 2.09 / 5.09 / 0.47% at pre-scale 1 / 0.5 / 0.3 / 0.2 for this arm.
 * Those came from the prototype's {@link scan}, and holding the budget fixed
 * at the bead's own 16 passes so the instrument is the only difference, the
 * same arm reads 0.01 / 0.24 / 72.88 / 98.32%. The record is 8.7x HIGH at
 * pre-scale 0.5 and then 14x and 209x LOW at 0.3 and 0.2 — it reports a
 * narrow band of usable fill with a collapse after it, where the truth is a
 * monotone climb into a solid ball. Two mechanisms, both of them `scan`'s:
 * it grids (section 5), and it thresholds `de(p) < 1e-3` instead of asking
 * membership. The second is what produces the phantom collapse — chaining
 * floors `dr` only once per PASS, so a hard-contracting chain keeps `dr`
 * near 1 and returns a LARGE distance at points whose orbits never leave the
 * ball. Those points are in the set and the threshold counts them out.
 * Nothing about the verdict changes; the shape of the curve underneath it
 * does.
 *
 * And the untuned pre-scale 1 — the exact case the bead calls a blank
 * frame — draws 11.0% of its rays for the bulb and 15.8% for the quaternion
 * square. It is not blank.
 *
 * `mandelbox w=2 -> qsquare` AT PRE-SCALE 1 IS THE SHARPEST CASE IN THE SET,
 * and it is worth stating on its own: 0.01% of the bailout ball at 131072
 * samples — 0.000% at `probeEscapeFill`'s default 4096, i.e. not one sample
 * inside — while the same system draws 15.8% of its rays at the framing
 * pose. That is `mandelboxRings`' exact signature (0.000% fill here, 44.9%
 * of rays) reproduced by a brand-new chain, and it is the whole of why
 * fr-17qu's first cut was wrong: A VOLUME PROBE MUST NEVER BE READ AS "WILL
 * IT RENDER". A thin fractal has a large surface and no measurable volume,
 * and the marcher finds the surface.
 *
 * PUSHED THE OTHER WAY IT STAYS RENDERABLE. `-> bulb` pre-scaled 8, 27x past
 * the stiffness bound, still draws 0.75% of its rays through this marcher,
 * against 0.095% for fr-17qu's own degenerate system (a lone Mandelbox
 * pre-scaled by 8) and 38.9 / 44.9 / 48.2% for the shipped
 * `mandelboxClassic` / `mandelboxRings` / `foldChain`. There is a real
 * blank regime and the cross chains are not in it.
 *
 * SO THERE IS NO AUTO-SCALE AND NO NEW SIGNAL, which is what the stiffness
 * bound was going to be used for. It declares hopeless a range that renders,
 * and fr-17qu's own lesson applies verbatim: a signal that fires on good
 * input is worse than the silence it replaced.
 *
 * ==================== 2. WHICH ESTIMATE FORM A CHAIN READS ================
 *
 * `escape-de.ts` reads the Böttcher form `0.5·r·ln r/dr` when some link is a
 * power map and the fold family's linear `r/dr` otherwise. fr-282c REFUSED
 * the log form for the folds, and this section's job is to show why neither
 * of its two arguments reaches a power chain — measured, not argued.
 *
 * (a) IS log/linear PINNED? Both arms read one terminal radius through one
 * `dr`, so their ratio is exactly `0.5·ln r`. A fold orbit lands just
 * outside its radius-4 bailout ball, pinning it near `0.5·ln 4 = 0.693`:
 *
 *     CONTROL mbox2 -> boxfold1.6   p05 0.698 p25 0.725 p50 0.755 p95 0.851  PINNED
 *     mbox2 -> qsq(0.4)             p05 0.691 p25 0.714 p50 0.748 p95 0.868  pinned
 *     mbox2 -> bulb(0.3)            p05 0.540 p25 0.695 p50 0.726 p95 0.879  pinned
 *     mbox2 -> bulb(0.4)            p05 0.661 p25 0.733 p50 0.874 p95 1.786  NOT pinned
 *     mbox2 -> bulb(0.5)            p05 0.698 p25 0.761 p50 1.514 p95 2.675  NOT pinned
 *
 * (b) IS IT BOUNDARY-ADAPTIVE? fr-282c's decisive control: the ratio's
 * median over the nearest and farthest deciles of exterior queries. Flat
 * means a constant, i.e. not a different bound but a damping knob the mode
 * already exposes. Measured at THREE independent seeds, because the
 * DIRECTION of the spread is what is being read and one seed cannot say
 * whether a direction belongs to the system or to that seed's decile
 * membership; the verdict column requires all three to agree.
 *
 *     CONTROL mbox2 -> boxfold1.6     near 0.738  far 0.734  1.00x  FLAT
 *     mbox2 -> qsq(0.4)               near 0.737  far 0.740  1.00x  FLAT
 *     mbox2 -> bulb(0.3)              near 0.737  far 0.742  1.01x  FLAT
 *     mbox2 -> bulb(0.4)              near 0.908  far 0.736  0.81x  ADAPTIVE
 *     mbox2 -> bulb(0.5)              near 1.347  far 0.735  0.55x  ADAPTIVE
 *     box1.6 -> bulb(0.3) -> sph1.2   near 0.793  far 1.048  1.32x  ADAPTIVE
 *     mbox2 -> bulb(0.3) -> box1.6r20 near 0.750  far 0.735  0.98x  FLAT
 *
 * The seeds agree to three decimals on every row (the 1.32x row reads
 * 1.32 / 1.31 / 1.32), so none of these directions is sampling noise.
 *
 * THE LAST TWO ROWS ARE A PAIR, and they are why the 1.32x row must not be
 * generalised. Both are three links with the SAME power link at the same
 * pre-scale — one where the two-link `mbox2 -> bulb(0.3)` row is flat — and
 * they differ only in the folds around it. One is adaptive the OPPOSITE way
 * to the bulb rows (far > near, the only such row in the file) and the other
 * is flat. So the direction is a property of THAT SYSTEM, not of chain
 * length and not of cross-family chains in general. An untested mechanism
 * worth naming for whoever picks it up: the ratio is `0.5·ln r_terminal`, so
 * it is set by WHICH LINK the orbit escapes on, and the adaptive fixture is
 * the only one here ending in a BARE sphere fold, whose inversion throws an
 * escaping point far past the bailout ball (its far decile sits at
 * `r ≈ 8.1`, double the bailout). Nothing ships on that fixture; treat it as
 * an observation, not a result.
 *
 * (c) AND THE PAYOFF LINES UP WITH (b) EXACTLY. Bound- and damped-step
 * violation rates over 900 exterior queries, 14 probe directions each, at
 * `ESCAPE_STEP_SCALE`, the two arms being one `EscapeDE` with `logEstimate`
 * flipped so they share the orbit, the bailout and the SET:
 *
 *     mbox2 -> bulb(0.5)             linear  7.4/ 1.0%   log  2.0/0.9%   3.7x
 *     mbox1.5 -> bulb(0.5)           linear  2.6/ 0.6%   log  1.3/0.4%   1.9x
 *     bulb(0.5) -> bulb(0.5) r20     linear  0.8/ 0.3%   log  0.4/0.3%   1.8x
 *     mbox2 -> qsq(0.5)              linear  9.6/ 1.8%   log  7.0/1.3%   1.4x
 *     mbox2 -> qsq(0.4)              linear 25.9/ 8.7%   log 19.3/5.3%   1.3x
 *     mbox2 -> bulb(0.4)             linear 15.3/ 2.2%   log  6.9/1.9%   2.2x
 *     mbox2 -> bulb(0.3)             linear 57.9/22.4%   log 47.7/16.1%  1.2x
 *     box1.6 -> bulb(0.3) -> sph1.2  linear 28.6/ 7.3%   log 25.3/ 5.0%  1.1x
 *     CONTROL mbox2 -> boxfold1.6    linear  8.0/ 3.4%   log  6.6/ 2.9%  1.2x
 *
 * The rows where the ratio is NOT flat are exactly the rows where the log
 * form wins big; where it IS flat it buys the ~1.2x fr-282c already refused
 * for the fold family, on the grounds that one constant reproduces it. That
 * is the honest reading and it is the whole argument: THE FORM IS TAKEN FOR
 * THE ADAPTIVE ROWS, and a chain carrying a power link is where they are —
 * not every such chain, as (b)'s last two rows show, but only ever such a
 * chain, which is exactly what `logEstimate` keys on.
 *
 * fr-282c's DIMENSIONAL argument does not reach here either, and that is
 * structural rather than lucky: the folds are uniform-rescale equivariant, so
 * `ln r` (which needs `r` dimensionless) breaks `DE_λ(λp) = λ·DE(p)` for
 * them. A power map is not equivariant — `V(λy) = λ^d V(y)` — so the
 * constraint that refused the log form for folds does not exist for a chain
 * containing one.
 *
 * At FRAME level, same pose, same step scale: `mbox2 -> bulb(0.4)` renders
 * 52.68% -> 54.95% of rays for 22.2 -> 19.5 steps/ray — MORE surface for
 * FEWER steps, which is what "tighter near the surface, looser far from it"
 * looks like from a marcher — and `mbox2 -> qsq(0.4)` 48.09% -> 50.62% for
 * 9.5 -> 11.4. `exhausted` is 0 in every panel.
 *
 * ========================= 3. f32 HEADROOM ===============================
 *
 * Six mirrors run f32 (max 3.4e38) and a power link's `8·r⁷` looks like an
 * overflow risk. It is not, for two structural reasons: the bailout test
 * bounds `|v|` entering EVERY link (cycling tests after each, so a power link
 * never sees a fold's expanded output), and the per-link `+ 1` floors `dr` at
 * 1 every step so the quotient cannot blow up from below. Worst `1/min(DE)`
 * over 200k queries per row, which is the reachable ceiling on `dr/r`:
 *
 *     mbox2 -> bulb(0.4)  2.57e13     mbox2 -> qsq(1)                7.86e5
 *     mbox2 -> bulb(1)    5.40e9      box1.6 -> bulb(0.3) -> sph1.2  4.44e9
 *     mbox2 -> bulb(8)    2.10e3
 *
 * 2.6e13 is the worst of them — TWENTY-FIVE orders below f32's maximum — with
 * zero non-finite results anywhere. This question is settled; do not re-open
 * it on a driver.
 *
 * ====================== 4. BUDGET, COST, AND THE PRESETS =================
 *
 * `ESCAPE_TIME_ITERATIONS` stays 30 passes for cross chains as for fold
 * ones. Fill against the budget is a slow drift and not a cliff, so 30 is
 * neither clipping the object nor inflating it: `mbox2 -> bulb(0.3)` reads
 * 28.38 / 24.92 / 22.89 / 21.58% at 8 / 16 / 30 / 60 passes, and the
 * three-link `box1.6 -> bulb(0.3) -> sph1.2` is settled to two decimals by
 * eight (7.24 / 7.24 / 7.23 / 7.23%).
 *
 * COST is 0.8-3.7x the single Mandelbox on the same query set, measured
 * across three runs of this file — well inside the band
 * `escape-chain.harness.ts` measured for fold-only chains (0.27-1.10 against
 * 0.25, up to 4.4x). One chain is CHEAPER than the map it composes with,
 * which is the stiffness result again from the cost side: an orbit that
 * leaves via a power link on its first pass never reaches the fold, so it
 * never pays the chain's n-times ceiling at all.
 *
 * READ THE RATIO, NOT THE ABSOLUTE. These are wall-clock on one machine and
 * they move with what else is running on it — the same rows read 0.15-0.73
 * against 0.20 on a busy box and 0.10-0.34 against 0.12 on a quiet one, the
 * same ratios both times. {@link shippedCost} already takes the best of
 * three timed runs after a warm-up: an earlier single-shot version of this
 * same call priced the single Mandelbox at 0.48 us/eval, more than double
 * every other measurement of it, which is what that discipline is for.
 *
 * THE THREE SHIPPED PRESETS, drawn by the estimator that renders them and
 * measured beside the fold-only `foldChain` and single `mandelboxClassic`:
 *
 *     hybridChainCube        fill 17.64%  hits 29.0%  overshoot 44.1%/0.3%
 *     hybridChainCraters     fill  0.01%  hits 18.5%  overshoot  0.0%/0.0%
 *     hybridChainQuaternion  fill  1.59%  hits 47.9%  overshoot  7.3%/2.1%
 *     CONTROL foldChain      fill  1.18%  hits 46.6%  overshoot  8.0%/4.1%
 *     CONTROL mandelboxClassic fill 3.57% hits 38.1%  overshoot 16.3%/8.8%
 *
 * Two things there are worth naming. `hybridChainCube`'s raw bound is the
 * loosest of the five and its DAMPED step the tightest — `ESCAPE_STEP_SCALE`
 * absorbing exactly the slack it exists for, which is why both columns are
 * printed. And `hybridChainCraters` fills 0.011% of its bailout ball while
 * drawing 18.5% of its rays: a thin fractal with a large surface, the same
 * shape `mandelboxRings` has (measured 0.000% fill here at 128k samples
 * against 44.9% of rays hit) and the exact confusion fr-17qu's first cut was
 * built on. VOLUME IS NOT VISIBILITY; do not reach for a fill number to
 * predict whether something renders.
 *
 * ================== 5. THE FILL INSTRUMENT ITSELF ========================
 *
 * A result about the measurement rather than the objects. It corrects this
 * file's own earlier drafts, and every fill figure quoted above is here
 * because of it. TWO WAYS TO MEASURE FILL WRONG, both of them reachable from
 * code already in this file.
 *
 * (a) A REGULAR GRID DOES NOT MEASURE THE VOLUME OF A THIN ESCAPE-TIME SET.
 * A fold's set has hard structure on the fold's own walls (`±1`, `±2`, the
 * box limit and its images), and a grid over [-4, 4] whose spacing divides
 * those lands a disproportionate share of its points exactly on them.
 * `mandelboxClassic` on grids of n = 23..49 gives 4.54 / 9.33 / 3.44 / 4.63
 * / 3.60 / 7.96 / 5.98 / 5.61% — a 2.7x spread with no convergence, the n=25
 * grid (spacing exactly 1/3, so every integer is a grid plane) the high
 * outlier — where the seeded sample reads 3.540 / 3.548 / 3.568% at 4k / 64k
 * / 128k points and has plainly converged. Thick sets are unaffected
 * (`mbox2 -> bulb(0.3)` is 22.4-22.9% at every n), which is why the aliasing
 * is easy to miss: it bites only the rows a blank-frame question is about.
 *
 * (b) A THRESHOLD ON THE ESTIMATE IS NOT MEMBERSHIP, and it is the larger
 * error of the two. `de(p) < eps` asks "is the estimate small", and `|v|/dr`
 * goes small for a near-boundary ESCAPER whose `dr` has run away — but it
 * also goes LARGE for a genuine member whose `dr` never grew. Section 1's
 * 209x discrepancy is that second case: chaining floors `dr` once per PASS,
 * so a hard-contracting chain returns O(1) distances at points whose orbits
 * never leave the ball, and the threshold counts them out of a set they are
 * in. {@link escapeSetContains} and {@link chainMember} ask the orbit
 * directly, which is why every arm here goes through one of them.
 *
 * So: fills are `probeEscapeFill`'s seeded sample of the bailout ball,
 * asking membership. {@link escapeFill} IS that function;
 * {@link escapeFillAtBudget} exists only because it has no budget parameter
 * and {@link chainFill} only because it cannot ask the prototype's orbit,
 * and both are pinned equal to it by assertion at two sample counts so they
 * cannot become a second definition of "fill". {@link scan} survives for
 * reach/extent and for fitting a marching radius — never as a fill value,
 * and its `fitFill` column is labelled in the output to keep it out of one.
 *
 * ======================= WHAT THE PROTOTYPE STILL SAYS ====================
 *
 * {@link runChain} iterates an ARRAY of maps, accumulating one scalar
 * running derivative through each link:
 *
 *     v = p;  dr = 1
 *     repeat until |v| > bailout or the budget runs out:
 *       for each link i:
 *         y  = M_i v + t_i
 *         v  = w_i · V_i(y)
 *         dr = |w_i| · L_i(y) · sigma_max(M_i) · dr
 *       v = v + p                                  // Mandelbrot offset
 *       dr = dr + 1
 *     DE = |v| / dr            (linear)
 *        = 0.5·|v|·ln|v| / dr  (log / Böttcher)
 *
 * A Lipschitz bound composes MULTIPLICATIVELY through a chain, which is all
 * the inner loop is. Every link's `L_i` is the local factor the shipped
 * estimator for that map already uses — 1 for the boxfold's reflections,
 * `1/clamp(|y|², 0.25, 1)` for the spherefold family, `8|y|⁷` for the triplex
 * power, `2|y|` for the quaternion square — so a ONE-LINK chain is not merely
 * similar to the shipped estimator, it IS it, which the second `it()` pins
 * against BOTH shipped oracles bit-exactly. That is the soundness argument in
 * the only form worth having: the generalisation degenerates to what it
 * generalises, so it inherits their heuristic status rather than adding a new
 * one.
 *
 * IN `v` SPACE, WITH THE LITERAL `+ 1`. `escape-de.ts` reads `|v|` with `dr`
 * tracking `dv/dp`; `bulb-de.ts` reads `|y|` with `dr` tracking `dy/dp` and
 * therefore seeds `dr = sigma_max(M)` and adds `+ sigma_max(M)`. Those are
 * the SAME recurrence in two coordinates, but the factoring needs ONE `M` to
 * push through and a chain has n of them — so both the prototype and the
 * shipped chain stay in `v` space throughout. Mixing the conventions is the
 * trap `bulb-de.ts` warns about, and it is why a one-link BULB chain is not
 * `estimateBulbDistance` and why the gate refuses a lone power map.
 *
 * THE PROTOTYPE'S THREE FORKS, all now settled, all still executable:
 *   - HOW THE LIST IS CONSUMED: chaining vs cycling.
 *     `hybrid-chain-sequence.png` (+ `-close`) is the fold-only verdict, and
 *     on the shared bailout ball at equal work it is emphatic: at six links
 *     chaining fills 37.1% of it (a featureless crust reaching the full
 *     radius 4.00) where cycling fills 0.2% and draws in to reach 2.28, and
 *     at four links 13.8% against 0.6%. `hybrid-chain-cross-sequence.png` is
 *     the cross-family one, and section 1 above is the same fork measured
 *     against the code that shipped.
 *   - WHERE THE OFFSET GOES: per PASS or per LINK
 *     (`hybrid-chain-offset.png`). Moot under cycling, where a pass IS one
 *     link — the same axis under two names, as `escape-de.ts` says.
 *   - WHICH ESTIMATE FORM a mixed chain reads: settled in section 2, on the
 *     shipped orbit rather than on this one.
 *
 * Every panel runs through `de-preview.ts`'s identical shading, so a sheet
 * compares OBJECTS and not lighting, and the sibling harnesses' caveat
 * applies: no empty-space grid, no tier-pinned acceptance epsilon, a 600-step
 * budget — fold surfaces speckle here where the shipped tracer resolves them.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/hybrid-chain.harness.ts
 * Writes, all under `scripts/out/`:
 *   SHIPPED estimator — `hybrid-chain-presets.png` (the three hybrid presets
 *         beside `foldChain` and `mandelboxClassic`),
 *         `hybrid-chain-cross-prescale.png` (section 1's pre-scale sweep,
 *         bulb and quaternion square), `hybrid-chain-form.png` (section 2's
 *         linear/log A/B at one pose);
 *   PROTOTYPE — `hybrid-chain.png` (the 12-panel sheet) and
 *         `hybrid-chain-close.png`; `hybrid-chain-sequence.png` and
 *         `hybrid-chain-sequence-close.png` (chaining vs cycling, the fork
 *         that decided fr-za0n); `hybrid-chain-cross-sequence.png` (the same
 *         fork on cross-family chains); `hybrid-chain-offset.png`;
 *         `hybrid-chain-march.png` and `hybrid-chain-march2.png`
 */
import {
  analyzeBulbSystem,
  BULB_ITERATIONS,
  BULB_POWER,
  buildBulbDE,
  estimateBulbDistance,
} from "../src/fractal/bulb-de";
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  ESCAPE_PROBE_POINTS,
  ESCAPE_PROBE_SEED,
  escapeLinkStiffnessLimit,
  escapeSetContains,
  estimateEscapeDistance,
  probeEscapeFill,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import { composeAffine } from "../src/fractal/affine";
import {
  foldChain,
  hybridChainCraters,
  hybridChainCube,
  hybridChainQuaternion,
  mandelboxClassic,
  mandelboxRings,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  transformSigmas,
} from "../src/fractal/surface-de";
import type { Transform, VariationType } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 420;
/** Panel size for the secondary sheets — the same objects, cheaper. */
const SMALL = 340;

/**
 * `de-preview.ts`'s default eye direction pulled in to 2.2 marching radii
 * (from 2.53), with the frustum widened to keep the whole silhouette in
 * frame. Its shading fogs on absolute ray distance, so the default stand-off
 * buries a fitted object under ~60% fog — fine when every panel on a sheet
 * shares one bounding radius, misleading when each fits its own. Still
 * outside the marching ball, which is the module's one constraint.
 */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/** The close pose: `de-preview.ts`'s direction at 2.0 radii with a narrow
 * frustum, so roughly a third of the object fills the frame. Backing the eye
 * out rather than narrowing further keeps the marching ball uncropped —
 * `boundingRadius` is both the camera stand-off and the march bound, so a
 * close-up has to be a telephoto, never a dolly-in. */
const CLOSE_EYE: Vec3 = [1.225, 0.87, 1.423];
const CLOSE_ZOOM = 0.28;

// --------------------------------------------------------------- the chain

/** The maps a link can carry: `variations.ts`'s fold family plus the two
 * escape-time powers. Exactly the set whose forward Lipschitz factor is known
 * in closed form, which is the whole requirement for a link. */
type LinkKind = "boxfold" | "spherefold" | "mandelbox" | "bulb" | "qsquare";

interface ChainLink {
  kind: LinkKind;
  /** Row-major 3x3 FORWARD linear part `M_i` (`composeAffine`'s). */
  m: number[];
  /** Forward translation `t_i` — the PRE-fold/power offset, exactly the role
   * `t` plays in both shipped estimators. */
  t: Vec3;
  /** Signed variation weight `w_i`. */
  w: number;
  /** `|w_i| · sigma_max(M_i)` — `EscapeDE.derivGrowth`, per link. Precomputed
   * in this association order so a one-link chain is BIT-exact against
   * `estimateEscapeDistance`. */
  growth: number;
}

interface Chain {
  label: string;
  links: ChainLink[];
  /**
   * How the orbit consumes the list. `"chain"` applies EVERY link, in order,
   * inside one pass; `"cycle"` applies link `i mod n` at pass `i` — the
   * literal `seq->GetSequence(i)` of Mandelbulber2's `compute_fractal.cpp`.
   */
  sequence?: "chain" | "cycle";
  /** Orbit radius past which escape is called. `ESCAPE_TIME_RADIUS` (4) is
   * both shipped estimators' value; the bailout `it()` sweeps it. */
  bailout: number;
  iterations: number;
  /** Where the Mandelbrot `+ p` goes (module doc). */
  offset: "pass" | "link";
  /** Which distance form the terminal radius is read through (module doc). */
  estimate: "linear" | "log";
  /** Marching-ball radius for the preview; fitted by {@link fitMarchRadius}
   * unless pinned. */
  marchR?: number;
}

/**
 * Per-link magnitude past which the pass is abandoned. Pure overflow
 * insurance, NOT a second bailout: with `|v| <= 4` entering a link the
 * largest output any link can produce is `4⁸ = 65536` (the triplex power),
 * three orders below this, so it never fires on anything the sheets render —
 * which is what keeps the one-link chains bit-exact against the shipped
 * estimators. It exists because two power links in one pass would reach
 * `(4⁸)⁸ = 1e38` and a third would leave f64 entirely.
 */
const LINK_OVERFLOW_GUARD = 1e6;

// The orbit's terminal state, returned through module scratch rather than an
// object: `runChain` is called ~1e8 times across a sheet and an allocation per
// call is the difference between a two-minute run and a twenty-minute one.
let chainR = 0;
let chainDr = 1;
let chainIters = 0;

/** `variations.ts`'s `foldAxis`, duplicated for the reason `escape-de.ts`
 * duplicates it: the prototype must stay allocation-free and term-for-term. */
function foldAxis(t: number): number {
  return 2 * Math.max(-1, Math.min(1, t)) - t;
}

/**
 * Run the chain's forward orbit from `p`, leaving the terminal radius,
 * derivative bound and iteration count in the module scratch. The distance
 * estimate ({@link chainDE}) and the membership oracle ({@link chainMember})
 * are both thin readers of this one loop, so they cannot disagree about what
 * the orbit is.
 */
function runChain(chain: Chain, p: Vec3, maxIterations: number): void {
  const links = chain.links;
  const cycling = chain.sequence === "cycle";
  const perLink = chain.offset === "link";
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  let i = 0;
  outer: for (; i < maxIterations && r <= chain.bailout; i++) {
    // Chaining runs the whole list per pass; cycling runs slot `i mod n`
    // alone (Mandelbulber2's `seq->GetSequence(i)`).
    const first = cycling ? i % links.length : 0;
    const last = cycling ? first : links.length - 1;
    for (let j = first; j <= last; j++) {
      const link = links[j];
      const m = link.m;
      const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
      const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
      const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
      let fx: number;
      let fy: number;
      let fz: number;
      // `localL` is the map's own local Lipschitz factor at `y` — the SAME
      // number the shipped estimator for that map uses, which is what makes
      // the product below a composition of the shipped bounds rather than a
      // new one.
      let localL: number;
      if (link.kind === "boxfold") {
        fx = foldAxis(yx);
        fy = foldAxis(yy);
        fz = foldAxis(yz);
        localL = 1; // reflections are isometries
      } else if (link.kind === "spherefold") {
        const r2 = yx * yx + yy * yy + yz * yz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = yx * f;
        fy = yy * f;
        fz = yz * f;
        localL = f;
      } else if (link.kind === "mandelbox") {
        const bx = foldAxis(yx);
        const by = foldAxis(yy);
        const bz = foldAxis(yz);
        const r2 = bx * bx + by * by + bz * bz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = bx * f;
        fy = by * f;
        fz = bz * f;
        localL = f;
      } else if (link.kind === "qsquare") {
        // `q²` on span{1, i, j} is norm-multiplicative, so `2|q|` is the
        // EXACT derivative norm — `qjulia-de.ts`'s certified factor.
        fx = yx * yx - yy * yy - yz * yz;
        fy = 2 * yx * yy;
        fz = 2 * yx * yz;
        localL = 2 * Math.sqrt(yx * yx + yy * yy + yz * yz);
      } else {
        // `bulb-de.ts`'s inlined `triplexPow8` + its `8·r⁷` heuristic factor.
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
      }
      vx = link.w * fx;
      vy = link.w * fy;
      vz = link.w * fz;
      dr = link.growth * localL * dr;
      if (perLink) {
        vx += p[0];
        vy += p[1];
        vz += p[2];
        dr = dr + 1;
      }
      if (!(
        Math.abs(vx) < LINK_OVERFLOW_GUARD &&
        Math.abs(vy) < LINK_OVERFLOW_GUARD &&
        Math.abs(vz) < LINK_OVERFLOW_GUARD
      )) {
        r = Math.sqrt(vx * vx + vy * vy + vz * vz);
        i++;
        break outer;
      }
    }
    if (!perLink) {
      vx += p[0];
      vy += p[1];
      vz += p[2];
      dr = dr + 1;
    }
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  chainR = r;
  chainDr = dr;
  chainIters = i;
}

/** The chain's distance estimate, bound to a scene (module doc). */
function chainDE(chain: Chain, maxIterations = chain.iterations) {
  const log = chain.estimate === "log";
  return (p: Vec3): number => {
    runChain(chain, p, maxIterations);
    const r = chainR;
    if (!log) return r / chainDr;
    // `ln r` goes negative below 1, and a negative estimate marches the
    // tracer BACKWARDS — `bulb-de.ts`'s clamp, for its reason.
    return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / chainDr;
  };
}

/**
 * Does `p` belong to the set the marcher will actually draw? Deliberately the
 * chain's OWN iteration budget rather than a long-budget truth oracle: the
 * question the overshoot probe asks is "does the estimate step past the
 * rendered object", and the rendered object is the finite-budget one.
 */
function chainMember(chain: Chain, p: Vec3): boolean {
  runChain(chain, p, chain.iterations);
  return chainR <= chain.bailout;
}

// ------------------------------------------------------------ chain authoring

interface LinkOpts {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

/** Build a link from the DOCUMENT vocabulary — a `Transform` through
 * `composeAffine`/`transformSigmas` — so a chain is exactly what a scene
 * document could hold if the gates admitted it. */
function link(kind: LinkKind, w: number, opts: LinkOpts = {}): ChainLink {
  const t: Transform = {
    id: 1,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: opts.scale ?? [1, 1, 1],
    variations: [{ type: kind, weight: w }],
  };
  const affine = composeAffine(t);
  return {
    kind,
    m: affine.m,
    t: affine.t,
    w,
    growth: Math.abs(w) * transformSigmas(t).max,
  };
}

function chain(
  label: string,
  links: ChainLink[],
  opts: Partial<Omit<Chain, "label" | "links">> = {},
): Chain {
  const hasPower = links.some((l) => l.kind === "bulb" || l.kind === "qsquare");
  return {
    label,
    links,
    sequence: opts.sequence ?? "chain",
    bailout: opts.bailout ?? ESCAPE_TIME_RADIUS,
    // A power link reaches the bailout in two or three passes; a fold chain
    // needs the fold family's longer budget. Both are the shipped numbers.
    iterations:
      opts.iterations ?? (hasPower ? BULB_ITERATIONS : ESCAPE_TIME_ITERATIONS),
    offset: opts.offset ?? "pass",
    // The rule the estimate-form `it()` tests: a power map's potential grows
    // like `log log`, which is what the Böttcher form linearises.
    estimate: opts.estimate ?? (hasPower ? "log" : "linear"),
    marchR: opts.marchR,
  };
}

// -------------------------------------------------------------- measurement

/** Grid scan of the marching box: how much of the ball the object fills, and
 * how far it reaches. `escape-form-sweep.harness.ts`'s `extent()`, with the
 * ball radius decoupled from the scan box so a set that outgrew its bound
 * shows up as reach rather than clipping. */
function scan(
  de: DistanceEstimator,
  scanR: number,
  ballR: number,
  n: number,
): { fillPct: number; reachAbs: number } {
  let inBall = 0;
  let interiorInBall = 0;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p: Vec3 = [
          -scanR + (2 * scanR * i) / (n - 1),
          -scanR + (2 * scanR * j) / (n - 1),
          -scanR + (2 * scanR * k) / (n - 1),
        ];
        const r = Math.hypot(p[0], p[1], p[2]);
        const interior = de(p) < 1e-3;
        if (r <= ballR) {
          inBall++;
          if (interior) interiorInBall++;
        }
        if (interior) maxR = Math.max(maxR, r);
      }
    }
  }
  return { fillPct: (100 * interiorInBall) / inBall, reachAbs: maxR };
}

/** Fit the preview's marching ball to the object, so every panel frames its
 * own set the same way and the sheet compares SHAPES. Over-estimates
 * deliberately (rays entering further out cost steps, never geometry). */
function fitMarchRadius(de: DistanceEstimator, scanR: number): number {
  const { reachAbs } = scan(de, scanR, scanR, 35);
  if (reachAbs <= 0) return scanR;
  return Math.min(scanR, Math.max(1.15, reachAbs * 1.06));
}

/**
 * How often does the estimate claim an empty ball that is not empty? For each
 * exterior query the DE certifies `ball(p, d)` clear of the set; probing in
 * several directions and asking the membership oracle turns "the bound is
 * heuristic" into a number, comparable across chains because the shipped
 * single-map controls are measured the same way.
 *
 * TWO radii, because they answer different questions. `bound` probes at
 * `0.9·d` — how often the estimate itself is not a lower bound, i.e. how
 * heuristic it has become. `step` probes at `ESCAPE_STEP_SCALE·d` — how often
 * the marcher's ACTUAL step lands in the set, which is the only violation a
 * damped sphere tracer can be hurt by. A large gap between them means the
 * bound is loose but the shipped damping already absorbs it.
 */
function overshootPct(
  c: Chain,
  de: DistanceEstimator,
  marchR: number,
  queries = 1200,
  dirs = 14,
): { bound: number; step: number } {
  const rng = mulberry32(0x5eed_1234);
  let probed = 0;
  let badBound = 0;
  let badStep = 0;
  for (let q = 0; q < queries; q++) {
    // Uniform in the marching ball.
    const u = Math.cbrt(rng()) * marchR;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
    const d = de(p);
    if (!(d > 1e-6)) continue; // on or inside the set: nothing certified
    probed++;
    let hitBound = false;
    let hitStep = false;
    for (let k = 0; k < dirs; k++) {
      const c2 = 2 * rng() - 1;
      const s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
      const p2 = 2 * Math.PI * rng();
      const ux = s2 * Math.cos(p2);
      const uy = s2 * Math.sin(p2);
      const uz = c2;
      if (
        !hitBound &&
        chainMember(c, [
          p[0] + 0.9 * d * ux,
          p[1] + 0.9 * d * uy,
          p[2] + 0.9 * d * uz,
        ])
      ) {
        hitBound = true;
      }
      if (
        !hitStep &&
        chainMember(c, [
          p[0] + ESCAPE_STEP_SCALE * d * ux,
          p[1] + ESCAPE_STEP_SCALE * d * uy,
          p[2] + ESCAPE_STEP_SCALE * d * uz,
        ])
      ) {
        hitStep = true;
      }
      if (hitBound && hitStep) break;
    }
    if (hitBound) badBound++;
    if (hitStep) badStep++;
  }
  if (probed === 0) return { bound: 0, step: 0 };
  return { bound: (100 * badBound) / probed, step: (100 * badStep) / probed };
}

interface PanelReport {
  panel: PanelStats;
  marchR: number;
  fillPct: number;
  reachAbs: number;
  overshoot: { bound: number; step: number };
  dampGain: number;
}

/** Render one chain and measure it. `dampGain` is the fraction of hits a 4x
 * finer march recovers — `escape-de.ts`'s own step-scale evidence, reduced to
 * one number: a DE whose steps overshoot hides surface that damping reveals.
 * The shipped mandelbox control fixes the scale for reading it. */
function report(
  c: Chain,
  scanR = 6,
  stepScale = ESCAPE_STEP_SCALE,
): PanelReport {
  const de = chainDE(c);
  const marchR = c.marchR ?? fitMarchRadius(de, scanR);
  const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
  const view = { de, boundingRadius: marchR, eyeOffset: EYE, zoom: ZOOM };
  const panel = renderPreview({ ...view, stepScale }, SIZE);
  const coarse = renderPreview({ ...view, stepScale }, 150);
  const fine = renderPreview({ ...view, stepScale: 0.08 }, 150);
  return {
    panel,
    marchR,
    fillPct,
    reachAbs,
    overshoot: overshootPct(c, de, marchR),
    dampGain:
      coarse.hits > 0 ? (100 * (fine.hits - coarse.hits)) / coarse.hits : 0,
  };
}

function printReport(i: number, c: Chain, r: PanelReport): void {
  const px = SIZE * SIZE;
  console.log(
    `  ${String(i).padStart(2)}. ${c.label}\n` +
      `      links ${c.links.length}  ${c.offset}-offset  ${c.estimate}  ` +
      `iters ${c.iterations}  bailout ${c.bailout}\n` +
      `      marchR ${r.marchR.toFixed(2)}  ball fill ${r.fillPct.toFixed(1)}%  ` +
      `reach ${r.reachAbs.toFixed(2)} (${(r.reachAbs / ESCAPE_TIME_RADIUS).toFixed(2)}xR4)  ` +
      `hits ${((100 * r.panel.hits) / px).toFixed(1)}%\n` +
      `      steps/ray ${(r.panel.steps / px).toFixed(1)}  ` +
      `overshoot bound ${r.overshoot.bound.toFixed(1)}% / step ${r.overshoot.step.toFixed(1)}%  ` +
      `damp+ ${r.dampGain >= 0 ? "+" : ""}${r.dampGain.toFixed(1)}%  ` +
      `${r.panel.ms}ms`,
  );
}

// ------------------------------------------------- the SHIPPED estimator
//
// Everything above this line is the prototype, which is now the CONTROL.
// Everything below runs `escape-de.ts` itself, which is now the subject —
// the swap fr-j231 made, and the reason this file is a sibling of
// `escape-chain.harness.ts` rather than a predecessor of it.

/**
 * A single map in the DOCUMENT vocabulary — the shape all three gates read,
 * so one fixture feeds `buildEscapeDE` and {@link linksOf} alike and the two
 * arms cannot silently be measured on different systems. `scale` is the
 * link's PRE-map scale (`sigma_max(M)`, the quantity
 * {@link escapeLinkStiffnessLimit} bounds); `rotY` is degrees about `y`, and
 * is genuinely part of the formula rather than a re-posing, since folds and
 * powers do not commute with rotations.
 */
function xmap(
  id: number,
  type: VariationType,
  weight: number,
  opts: { scale?: number; rotY?: number; position?: Vec3 } = {},
): Transform {
  const s = opts.scale ?? 1;
  return {
    id,
    position: opts.position ?? [0, 0, 0],
    rotation: [0, ((opts.rotY ?? 0) * Math.PI) / 180, 0],
    scale: [s, s, s],
    variations: [{ type, weight }],
  };
}

/** The same document, read as the prototype's link list — the bridge the
 * cross-validation stands on. */
function linksOf(transforms: Transform[]): ChainLink[] {
  return transforms.map((t) => {
    const v = t.variations![0];
    return link(v.type as LinkKind, v.weight, {
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
    });
  });
}

/** Sample count every fill column below is measured at. Large because the
 * thin rows are the interesting ones: at 0.3% fill this is still ~400 hits,
 * so two rows an order of magnitude apart cannot be sampling noise. */
const FILL_POINTS = 131072;

/**
 * Share of the BAILOUT ball a set occupies, from a SEEDED UNIFORM sample —
 * {@link probeEscapeFill}'s own sampler, lifted to take any membership
 * oracle so the shipped and prototype arms of a table are literally one
 * measurement rather than two conventions that happen to agree.
 *
 * Membership, never a threshold on a distance: `|v|/dr` goes small for a
 * near-boundary ESCAPER too, whose `dr` has run away just as far.
 *
 * A REGULAR GRID IS THE WRONG INSTRUMENT HERE, and this file measures why
 * rather than asserting it (see the aliasing test). A fold's escape set has
 * hard structure on the fold's own walls — `±1`, `±2`, the box limit and its
 * images — and a grid over `[-4, 4]` whose spacing divides those lands a
 * disproportionate share of its points exactly on them. Measured on
 * `mandelboxClassic`: 3.44% to 9.33% across `n = 23..49`, with the n=25 grid
 * (spacing exactly 1/3, hitting every integer) the high outlier, where this
 * sampler reads 3.540% at 4096 points and 3.548% at 65536. The thick rows
 * are unaffected (22.4-22.9% for `mbox2 -> bulb(0.3)` at every n), which is
 * exactly why the aliasing is easy to miss: it only bites the rows a
 * blank-frame question is about.
 */
function sampleFill(
  member: (p: Vec3) => boolean,
  points = FILL_POINTS,
  seed = ESCAPE_PROBE_SEED,
): number {
  const rng = mulberry32(seed);
  let inside = 0;
  for (let i = 0; i < points; i++) {
    const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    if (member([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct])) {
      inside++;
    }
  }
  return (100 * inside) / points;
}

/**
 * Fill of the SHIPPED orbit's set — literally `probeEscapeFill`, the
 * module's OWN seeded Monte-Carlo instrument, so this column is not a
 * second definition of "fill" that happens to agree with the shipped one.
 * Every existing doc in the repo that quotes a fill quotes this function.
 */
function escapeFill(de: EscapeDE, points = FILL_POINTS): number {
  return 100 * probeEscapeFill(de, points);
}

/** The same, at a NON-default pass budget, which `probeEscapeFill` has no
 * parameter for — the budget sweep's only reason to go through
 * {@link sampleFill} instead. Pinned identical to {@link escapeFill} at the
 * default budget by the aliasing test, so the sweep's rows and every other
 * fill column in this file are one instrument. */
function escapeFillAtBudget(
  de: EscapeDE,
  points: number,
  maxIterations: number,
): number {
  return sampleFill((p) => escapeSetContains(de, p, maxIterations), points);
}

/** {@link sampleFill} against the PROTOTYPE's orbit — the same sampler, the
 * same seed, the same ball, the same membership question, so the headline
 * table's arms differ by their ORBIT and by nothing else. The prototype's
 * own {@link scan} is a grid and must not be read as a fill value; it
 * survives for reach/extent and for fitting a marching radius. */
function chainFill(c: Chain, points = FILL_POINTS): number {
  return sampleFill((p) => chainMember(c, p), points);
}

/** The regular-grid fill this file used before the aliasing above was
 * measured. Kept because the figures quoted in `escape-de.ts`'s module doc
 * and in the bead are grid figures, and a harness that cannot reproduce the
 * record it is replacing has not replaced it. */
function gridFill(de: EscapeDE, n = 29): number {
  let inside = 0;
  let total = 0;
  const R = ESCAPE_TIME_RADIUS;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p: Vec3 = [
          -R + (2 * R * i) / (n - 1),
          -R + (2 * R * j) / (n - 1),
          -R + (2 * R * k) / (n - 1),
        ];
        if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > R * R) continue;
        total++;
        if (escapeSetContains(de, p)) inside++;
      }
    }
  }
  return (100 * inside) / total;
}

/**
 * How often the SHIPPED estimate claims a ball that is not clear —
 * {@link overshootPct}'s question asked of `escape-de.ts` instead of the
 * prototype, and the column every estimate-form row is judged on.
 *
 * ONE DELIBERATE DIFFERENCE from the prototype's version: `bound` probes at
 * the full `d`, not at `0.9·d`. The prototype's slack was there to keep a
 * merely-tight bound from reading as a violation while an unshipped orbit
 * was being explored; a shipped estimator should be asked the real question,
 * and the two columns are never compared with each other. `step` probes at
 * `ESCAPE_STEP_SCALE·d`, which is the only violation a damped sphere tracer
 * can actually be hurt by. Directions are a fixed 14-point spiral (not
 * random), so two rows differ by their DE and by nothing else.
 */
function shippedOvershoot(
  de: EscapeDE,
  seed: number,
  samples = 900,
): { bound: number; step: number; n: number } {
  const rng = mulberry32(seed);
  const R = ESCAPE_TIME_RADIUS;
  const dirs: Vec3[] = [];
  for (let i = 0; i < 14; i++) {
    const ct = 2 * ((i + 0.5) / 14) - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = i * 2.399963;
    dirs.push([st * Math.cos(ph), st * Math.sin(ph), ct]);
  }
  let bound = 0;
  let step = 0;
  let n = 0;
  let guard = 0;
  while (n < samples && guard++ < samples * 60) {
    const u = Math.cbrt(rng()) * R;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
    if (escapeSetContains(de, p)) continue;
    const d = estimateEscapeDistance(de, p);
    if (!(d > 0) || !Number.isFinite(d)) continue;
    n++;
    let hitFull = false;
    let hitStep = false;
    for (const dir of dirs) {
      const q: Vec3 = [p[0] + dir[0] * d, p[1] + dir[1] * d, p[2] + dir[2] * d];
      if (escapeSetContains(de, q)) hitFull = true;
      const s = ESCAPE_STEP_SCALE * d;
      const r: Vec3 = [p[0] + dir[0] * s, p[1] + dir[1] * s, p[2] + dir[2] * s];
      if (escapeSetContains(de, r)) hitStep = true;
      if (hitFull && hitStep) break;
    }
    if (hitFull) bound++;
    if (hitStep) step++;
  }
  return { bound: (100 * bound) / n, step: (100 * step) / n, n };
}

/**
 * us/eval of the shipped estimator over a seeded box of queries. The BOX
 * rather than each system's fitted ball, because these rows are compared with
 * each other and with the single map: cost is dominated by orbit length, and
 * a fitted ball would hand a compact chain a different query population.
 *
 * A WARM-UP PASS AND THE BEST OF THREE, which is not fussiness — a 40k-query
 * run of a phone-cheap estimator is ~10 ms, short enough that JIT warm-up and
 * a moment of machine contention both swamp it. An earlier single-shot
 * reading of this same call priced the single Mandelbox at 0.48 us/eval where
 * every other measurement of it (this file, `escape-chain.harness.ts`) reads
 * 0.22-0.25. The minimum is the least-contended run and is what a reader
 * should compare across rows.
 */
function shippedCost(de: EscapeDE, seed: number, queries = 40000): number {
  const rng = mulberry32(seed);
  const pts: Vec3[] = [];
  const R = ESCAPE_TIME_RADIUS;
  for (let i = 0; i < queries; i++) {
    pts.push([2 * R * rng() - R, 2 * R * rng() - R, 2 * R * rng() - R]);
  }
  let acc = 0;
  let best = Infinity;
  for (let run = 0; run < 4; run++) {
    const t0 = performance.now();
    for (const p of pts) acc += estimateEscapeDistance(de, p);
    const ms = performance.now() - t0;
    if (run > 0) best = Math.min(best, ms); // run 0 is the warm-up
  }
  if (!Number.isFinite(acc)) throw new Error("non-finite cost checksum");
  return (best * 1000) / queries;
}

/** Panel size for the cross-family pre-scale and estimate-form sweeps. The
 * hit percentages those tests print are quoted in this file's docblock and in
 * `escape-de.ts`'s, so the size is pinned rather than tuned. */
const CROSS = 260;
/** Panel size for the emptiness hunt, pinned for the same reason. */
const HUNT = 200;

/**
 * Render the SHIPPED estimator at the app's own framing: the marching ball is
 * the BAILOUT ball (what `buildEscapeDE` pins `boundingRadius` to and what
 * main.ts frames a new escape session on), never a fitted one — a cross-family
 * chain that draws in tight has to be seen doing that, since the app will show
 * it at this stand-off.
 */
function shotShipped(
  de: EscapeDE,
  size: number,
  stepScale = ESCAPE_STEP_SCALE,
): PanelStats {
  return renderPreview(
    {
      de: (p: Vec3) => estimateEscapeDistance(de, p),
      boundingRadius: ESCAPE_TIME_RADIUS,
      stepScale,
      zoom: ZOOM,
      eyeOffset: EYE,
    },
    size,
  );
}

const hitPct = (panel: PanelStats, size: number) =>
  (100 * panel.hits) / (size * size);

/**
 * The three hybrid presets fr-j231 ships, IMPORTED rather than restated —
 * along with the fold-only {@link foldChain} and single-map
 * {@link mandelboxClassic} controls beside them. A sheet that argues for a
 * menu entry has to draw the menu entry: restating the parameters here would
 * let a preset edit drift away from its own evidence silently, which is the
 * failure mode this whole family of harnesses exists to prevent.
 */
const HYBRID_PRESETS: [string, Transform[]][] = [
  ["hybridChainCube  mbox-1.5 -> bulb(0.5)", hybridChainCube()],
  ["hybridChainCraters  bulb(0.5) -> mbox2", hybridChainCraters()],
  ["hybridChainQuaternion  mbox2 -> qsq(0.5)", hybridChainQuaternion()],
];

describe("hybrid chains: the escape-time family across its own boundary", () => {
  it("tracks the CLOSED gate: which shapes compose, and which still do not", () => {
    // This test used to assert that the cross-family rows were refused
    // EVERYWHERE — it was the hole's regression record. fr-j231 closed the
    // hole, so it now asserts the other side of the same line, on the same
    // rows, with every gate's verbatim reasons still printed: that is the
    // part worth keeping either way, since a reader reaching this file wants
    // to know what the three gates say, not what they said.
    //
    // `admits` is the whole readout. Exactly one mode should claim each row
    // (or none, for the shapes that genuinely have no estimator), because
    // `analyzeEscapeSystem` is written as the COMPLEMENT of the other two
    // rather than as a fallback ordered behind them.
    const cases: {
      what: string;
      escape: "eligible" | "ineligible";
      bulb: "eligible" | "ineligible";
      transforms: Transform[];
    }[] = [
      {
        // fr-za0n's half of the hole: fold-only chains.
        what: "two mandelbox w=2 maps",
        escape: "eligible",
        bulb: "ineligible",
        transforms: [
          xmap(1, "mandelbox", 2),
          xmap(2, "mandelbox", 2, { position: [0.3, 0, 0] }),
        ],
      },
      {
        what: "mandelbox w=2 + boxfold w=1.6",
        escape: "eligible",
        bulb: "ineligible",
        transforms: [xmap(1, "mandelbox", 2), xmap(2, "boxfold", 1.6)],
      },
      {
        // fr-j231's half, and the rows this whole file exists for. Note the
        // pre-scale is 1: the UNTUNED cross-family chain is eligible, which
        // is the feature (the headline test measures whether it RENDERS).
        what: "mandelbox w=2 + bulb (CROSS-FAMILY)",
        escape: "eligible",
        bulb: "ineligible",
        transforms: [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1)],
      },
      {
        what: "mandelbox w=2 + qsquare (CROSS-FAMILY)",
        escape: "eligible",
        bulb: "ineligible",
        transforms: [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1)],
      },
      {
        // Two POWER links are a chain like any other — `bulb -> bulb` at a
        // rotation is a genuinely new set, and it is composition rather than
        // the maps that the gate widened for.
        what: "bulb + bulb rotated 20deg (TWO POWER LINKS)",
        escape: "eligible",
        bulb: "ineligible",
        transforms: [
          xmap(1, "bulb", 1, { scale: 0.5 }),
          xmap(2, "bulb", 1, { scale: 0.5, rotY: 20 }),
        ],
      },
      {
        // A LONE power map stays refused HERE and owned THERE, which is what
        // keeps the two gates disjoint rather than merely ordered: the
        // Mandelbulb already has an object, a better estimator (`y` space,
        // Böttcher form), its own presets and its own kernel core.
        what: "ONE bulb map (a lone triplex power)",
        escape: "ineligible",
        bulb: "eligible",
        transforms: [xmap(1, "bulb", 1)],
      },
      {
        // The lone quaternion square is refused by all three, and that is
        // deliberate too: `qjulia-de.ts`'s object is production-dead by
        // fr-7u8t.5's twenty smooth panels. As a LINK it is alive.
        what: "ONE qsquare map (a lone quaternion square)",
        escape: "ineligible",
        bulb: "ineligible",
        transforms: [xmap(1, "qsquare", 1)],
      },
      {
        // Still refused everywhere, and not by an oversight: a BLEND is a
        // weighted sum, not a composition — no inverse branches to descend
        // for the IFS gate, and no single forward map with a closed-form
        // local Lipschitz factor for this one.
        what: "ONE map carrying mandelbox w=2 AND boxfold w=1 (a blend, not a chain)",
        escape: "ineligible",
        bulb: "ineligible",
        transforms: [
          {
            id: 1,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            variations: [
              { type: "mandelbox", weight: 2 },
              { type: "boxfold", weight: 1 },
            ],
          },
        ],
      },
    ];
    for (const { what, escape, bulb: bulbWant, transforms } of cases) {
      const ifs = analyzeSurfaceSystem(transforms);
      const esc = analyzeEscapeSystem(transforms);
      const bulb = analyzeBulbSystem(transforms);
      const admits = [
        ifs.status === "eligible" ? "IFS" : null,
        esc.status === "eligible" ? "escape" : null,
        bulb.status === "eligible" ? "bulb" : null,
      ].filter(Boolean);
      console.log(
        `  ${what}  ${admits.length === 0 ? "[NO MODE ADMITS IT]" : `[admitted by: ${admits.join(", ")}]`}\n` +
          `      IFS    ${ifs.status}: ${ifs.reasons.join("; ")}\n` +
          `      escape ${esc.status}: ${esc.reasons.join("; ")}\n` +
          `      bulb   ${bulb.status}: ${bulb.reasons.join("; ")}`,
      );
      // The IFS gate refuses every row here for reasons no widening of an
      // escape-time gate touches (non-contraction, a non-fold variation, or
      // a blended list with no branch decomposition), so it stays asserted
      // throughout — it is the fixed point the other two are read against.
      expect(ifs.status, `${what}: IFS`).toBe("ineligible");
      expect(esc.status, `${what}: escape`).toBe(escape);
      expect(bulb.status, `${what}: bulb`).toBe(bulbWant);
      // No row may be claimed twice: the three gates partition, and a shape
      // admitted by two of them would mean main.ts's forward arm decides by
      // the ORDER it happens to read them in.
      expect(admits.length, `${what}: modes admitting it`).toBeLessThan(2);
    }
  });

  it("degenerates to BOTH shipped estimators at chain length 1", () => {
    // The soundness argument, executed: if the one-link chain is the shipped
    // estimator to the last bit, then chaining cannot have introduced a new
    // heuristic — it composed two existing ones.
    const rng = mulberry32(0xc0ffee);
    const escSystem = [xmap(1, "mandelbox", 2, { position: [0.4, 0.3, 0.2] })];
    const escDe = buildEscapeDE(escSystem);
    const escChain = chain("", [
      link("mandelbox", 2, { position: [0.4, 0.3, 0.2] }),
    ]);
    const escProto = chainDE(escChain);

    const bulbSystem = [xmap(1, "bulb", 1)];
    const bulbDe = buildBulbDE(bulbSystem);
    const bulbChain = chain("", [link("bulb", 1)], {
      bailout: bulbDe.bailout,
      iterations: BULB_ITERATIONS,
      estimate: "log",
    });
    const bulbProto = chainDE(bulbChain);

    let escMax = 0;
    let bulbMax = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      escMax = Math.max(
        escMax,
        Math.abs(escProto(p) - estimateEscapeDistance(escDe, p)),
      );
      const q: Vec3 = [3 * rng() - 1.5, 3 * rng() - 1.5, 3 * rng() - 1.5];
      bulbMax = Math.max(
        bulbMax,
        Math.abs(bulbProto(q) - estimateBulbDistance(bulbDe, q)),
      );
    }
    console.log(
      `  one-link chain vs shipped, worst absolute difference over 4000 queries:\n` +
        `      mandelbox ${escMax}   bulb ${bulbMax}   (0 = bit-exact)`,
    );
    expect(escMax).toBe(0);
    expect(bulbMax).toBe(0);
  });

  it("cross-validates the SHIPPED chain against this prototype, CROSS-FAMILY included", () => {
    // Two independent implementations of the same idea, written from the same
    // Mandelbulber2 reading but not from each other: `escape-de.ts`'s
    // multi-map `estimateEscapeDistance` (which cycles `links[step % n]` for
    // `maxIterations * n` steps) and this harness's `cycle` arm at the same
    // budget. Bit-exact agreement over random queries is the cheapest strong
    // assurance available for six shader mirrors written against it — and the
    // two were reached by different routes, so an agreement is evidence
    // rather than a tautology.
    //
    // fr-j231 extends it across the family boundary, which is where it is
    // worth the most and costs the least. The cross-family rows exercise
    // three things no fold-only row can reach: the two POWER bodies
    // (`triplexPow8` and the quaternion square, each inlined in both files
    // and each easy to transcribe subtly wrong), their local factors
    // `8|y|⁷` and `2|y|`, and the Böttcher RETURN — `de.logEstimate` on one
    // side, `estimate: "log"` on the other, both including the `r <= 1`
    // clamp a converging orbit reaches. A later reader should NOT re-derive
    // any of that by hand; this is the check.
    //
    // The prototype's arm is `cycle` + `offset: "link"`, which is the
    // shipped orbit exactly (module doc: under cycling a pass IS one link,
    // so the two offset positions are the same fork under two names).
    const rng = mulberry32(0x2b1d);
    const systems: [string, Transform[]][] = [
      [
        "2 maps: mandelbox w=2 + boxfold w=1.6",
        [xmap(1, "mandelbox", 2), xmap(2, "boxfold", 1.6)],
      ],
      [
        "2 maps: mandelbox w=2 + mandelbox w=-1.5 at (0.3,0,0)",
        [
          xmap(1, "mandelbox", 2),
          xmap(2, "mandelbox", -1.5, { position: [0.3, 0, 0] }),
        ],
      ],
      [
        "3 maps: mandelbox + boxfold + spherefold",
        [
          xmap(1, "mandelbox", 2),
          xmap(2, "boxfold", 1.6),
          xmap(3, "spherefold", 1.2),
        ],
      ],
      [
        "4 maps: mandelbox + boxfold + spherefold + mandelbox w=-1.5",
        [
          xmap(1, "mandelbox", 2),
          xmap(2, "boxfold", 1.6),
          xmap(3, "spherefold", 1.2),
          xmap(4, "mandelbox", -1.5),
        ],
      ],
      [
        "CROSS 2 maps: mandelbox w=2 + bulb (pre-scale 0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.4 })],
      ],
      [
        "CROSS 2 maps: mandelbox w=2 + qsquare (pre-scale 0.5)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.5 })],
      ],
      [
        "CROSS 2 maps: bulb (0.5) + bulb (0.5) rot 20y — TWO POWER LINKS",
        [
          xmap(1, "bulb", 1, { scale: 0.5 }),
          xmap(2, "bulb", 1, { scale: 0.5, rotY: 20 }),
        ],
      ],
      [
        "CROSS 3 maps: boxfold 1.6 + bulb (0.3) + spherefold 1.2",
        [
          xmap(1, "boxfold", 1.6),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "spherefold", 1.2),
        ],
      ],
      [
        "CROSS 3 maps: mandelbox w=2 + qsquare (0.5) + boxfold 1.6 rot 20y",
        [
          xmap(1, "mandelbox", 2),
          xmap(2, "qsquare", 1, { scale: 0.5 }),
          xmap(3, "boxfold", 1.6, { rotY: 20 }),
        ],
      ],
    ];
    for (const [label, transforms] of systems) {
      const de = buildEscapeDE(transforms);
      const links = linksOf(transforms);
      const c = chain(label, links, {
        sequence: "cycle",
        offset: "link",
        // `de.logEstimate` rather than the prototype's own default rule, so
        // the two implementations are compared on the SHIPPED decision about
        // which form a chain reads — that flag is itself part of what this
        // agreement pins.
        estimate: de.logEstimate ? "log" : "linear",
        iterations: ESCAPE_TIME_ITERATIONS * links.length,
      });
      const proto = chainDE(c);
      let worst = 0;
      // Half the queries in the [-4, 4] box (the escaping far field, where
      // the two loops must agree about the bailout test) and half uniform in
      // the bailout BALL (where the orbits are long and the derivative
      // product has the most chances to diverge).
      for (let i = 0; i < 4000; i++) {
        let p: Vec3;
        if (i % 2 === 0) {
          p = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        } else {
          const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
          const ct = 2 * rng() - 1;
          const st = Math.sqrt(Math.max(0, 1 - ct * ct));
          const ph = 2 * Math.PI * rng();
          p = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
        }
        worst = Math.max(
          worst,
          Math.abs(proto(p) - estimateEscapeDistance(de, p)),
        );
      }
      console.log(
        `  ${label.padEnd(62)} ${de.logEstimate ? "log" : "lin"}  ` +
          `worst |shipped - prototype| = ${worst}`,
      );
      expect(worst, label).toBe(0);
    }
  });

  it("REFUTES the stiffness prediction: cycling rescues the power link", () => {
    // THE HEADLINE, and the one measurement that had to be made on the
    // SHIPPED orbit rather than on the prototype.
    //
    // The prediction was sound and its arithmetic survives: a mandelbox step
    // leaves `|v|` near 7, a triplex 8th power sends 7 to 5.8e5 in one link,
    // and `escapeLinkStiffnessLimit` is the closed form of the condition for
    // a link to keep its own output inside the ball when the whole ball is
    // thrown at it. The prototype measured exactly what it predicts — the
    // CHAINING columns below — and the bead this feature came from carried a
    // second prediction beside it: that cycling would not help, since a
    // cycled bulb link still sees `|v| <= 4` and `4⁸ = 65536` still escapes.
    //
    // That second prediction is what this table refutes. Cycling re-enters
    // `+ p` after EVERY link, so a power link is applied to a point the query
    // has just tethered, and its output is tested before any fold can
    // compound it. The `+ p` is not a small correction here: it is the whole
    // difference between a one-way trip out of the ball and an orbit.
    //
    // ONE INSTRUMENT, FOUR COLUMNS. The first three are the same seeded
    // Monte-Carlo sample of the radius-4 bailout ball — `probeEscapeFill`'s,
    // the module's own — asked of three different ORBITS, which is the only
    // thing that may vary if the comparison is to mean anything:
    //
    //   cycling@30      the shipped orbit
    //   chaining@30     the rejected per-PASS orbit at EQUAL WORK
    //   chaining@16     the same orbit at the budget the bead recorded
    //
    // The last two exist separately because the bead's chaining figures
    // changed under TWO edits at once — instrument (grid -> probe) and
    // budget (16 -> 30 passes) — and a table that applied both together
    // could not say which moved them. `chaining@16` holds the budget fixed
    // so the instrument is the only difference from the record.
    //
    // The prototype's own `scan()` grid does not appear here at all. It is a
    // grid, it fills a radius-SIX box, and it thresholds the estimate rather
    // than asking membership; it survives in this file for reach/extent and
    // for fitting a marching radius, never as a fill value.
    const panels: PanelStats[] = [];
    console.log(
      `  fills below are probeEscapeFill's own sampler at ${FILL_POINTS} ` +
        `points over the radius-${ESCAPE_TIME_RADIUS} bailout ball`,
    );
    for (const [name, type, power] of [
      ["bulb", "bulb", BULB_POWER],
      ["qsquare", "qsquare", 2],
    ] as [string, VariationType, number][]) {
      console.log(
        `  mandelbox w=2 -> ${name}: stiffness limit on sigma_max(M) is ` +
          `${escapeLinkStiffnessLimit(power, 1).toFixed(3)} ` +
          `(escapeLinkStiffnessLimit, degree ${power}, weight 1, R=4)`,
      );
      for (const s of [1, 0.6, 0.5, 0.4, 0.3, 0.2]) {
        const transforms = [
          xmap(1, "mandelbox", 2),
          xmap(2, type, 1, { scale: s }),
        ];
        const de = buildEscapeDE(transforms);
        const links = linksOf(transforms);
        // Equal work: chaining applies every link once per pass, so 30
        // passes is 30 applications of each — the shipped budget.
        const equal = chain("", links, {
          sequence: "chain",
          offset: "pass",
          estimate: "log",
          iterations: ESCAPE_TIME_ITERATIONS,
        });
        // The prototype's recorded budget, unchanged (16 passes, log) — the
        // arm the bead's figures came off, measured on THIS instrument.
        const recorded = chain("", links);
        const panel = shotShipped(de, CROSS);
        panels.push(panel);
        console.log(
          `      pre-scale ${String(s).padEnd(4)}  ball fill: ` +
            `cycling@30 ${escapeFill(de).toFixed(2).padStart(5)}%  ` +
            `chaining@30 ${chainFill(equal).toFixed(2).padStart(5)}%  ` +
            `chaining@16 ${chainFill(recorded).toFixed(2).padStart(5)}%  |  ` +
            `shipped rays hit ${hitPct(panel, CROSS).toFixed(1).padStart(4)}%  ` +
            `steps/ray ${(panel.steps / (CROSS * CROSS)).toFixed(1)}  ` +
            `${panel.ms}ms`,
        );
      }
    }
    console.log(
      `  wrote ${writeContactSheet(
        panels,
        6,
        "hybrid-chain-cross-prescale.png",
      )}`,
    );
    // The claim, asserted rather than merely printed: the UNTUNED
    // cross-family chain — pre-scale 1, the exact case the bead calls a
    // blank frame — renders. The bar is fr-17qu's own reading of what blank
    // means (its degenerate system draws 0.095% of rays through this
    // marcher), with an order of magnitude of margin.
    for (const type of ["bulb", "qsquare"] as VariationType[]) {
      const de = buildEscapeDE([xmap(1, "mandelbox", 2), xmap(2, type, 1)]);
      expect(
        hitPct(shotShipped(de, HUNT), HUNT),
        `untuned mandelbox w=2 -> ${type} renders`,
      ).toBeGreaterThan(1);
    }
  });

  it("CANONICAL TABLE: every quoted row, one instrument, one panel size", () => {
    // THE TABLE TO QUOTE FROM. Everything a doc elsewhere in the repo needs
    // to cite about these systems, in one place, measured one way.
    //
    // It deliberately RE-RENDERS rows other tests also render, and that
    // duplication is the point: those tests each pick the panel size their
    // own question needs (200px for the emptiness hunt, where only an order
    // of magnitude matters; 420px for the preset sheet, where the picture is
    // the output), and quoting across them is exactly how a fill figure and
    // a hit figure end up describing different measurements. So this table
    // fixes ONE sample count and ONE panel size for every row and prints
    // both inline, and a reader who wants a number for a doc takes it from
    // here and nowhere else.
    const rows: [string, Transform[]][] = [];
    for (const s of [1, 0.6, 0.5, 0.4, 0.3, 0.2]) {
      rows.push([
        `mbox2 -> bulb(${s})`,
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: s })],
      ]);
    }
    for (const s of [1, 0.6, 0.5, 0.4, 0.3, 0.2]) {
      rows.push([
        `mbox2 -> qsq(${s})`,
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: s })],
      ]);
    }
    rows.push(
      ["PRESET hybridChainCube", hybridChainCube()],
      ["PRESET hybridChainCraters", hybridChainCraters()],
      ["PRESET hybridChainQuaternion", hybridChainQuaternion()],
      ["CONTROL foldChain", foldChain()],
      ["CONTROL mandelboxClassic", mandelboxClassic()],
      ["CONTROL mandelboxRings", mandelboxRings()],
    );
    console.log(
      `  fill      = probeEscapeFill at ${FILL_POINTS} points, over the ` +
        `radius-${ESCAPE_TIME_RADIUS} bailout ball, membership not a threshold\n` +
        `  rays hit  = de-preview.ts's framing pose at ${CROSS}x${CROSS}, ` +
        `stepScale ${ESCAPE_STEP_SCALE}, marching ball = the bailout ball\n` +
        `  overshoot = bound/step violation over 900 exterior queries, 14 ` +
        `probe directions, at ESCAPE_STEP_SCALE`,
    );
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const panel = shotShipped(de, CROSS);
      const os = shippedOvershoot(de, 0x0aa1);
      console.log(
        `  ${label.padEnd(30)} ${de.logEstimate ? "log" : "lin"}  ` +
          `fill ${escapeFill(de).toFixed(3).padStart(6)}%  ` +
          `hits ${hitPct(panel, CROSS).toFixed(2).padStart(6)}%  ` +
          `steps/ray ${(panel.steps / (CROSS * CROSS)).toFixed(1).padStart(5)}  ` +
          `overshoot ${os.bound.toFixed(1).padStart(5)}%/${os.step.toFixed(1).padStart(5)}%`,
      );
    }
  });

  it("pushes the OTHER way: is any cross chain actually blank?", () => {
    // The stiffness bound's own direction, and the control band fr-17qu's
    // blank-frame notice has to be read against. Every row goes through ONE
    // marcher at ONE pose, so the shipped presets and the deliberately
    // degenerate system calibrate the scale rather than being asserted about.
    const rows: [string, Transform[]][] = [];
    for (const s of [8, 4, 2, 1.4, 1]) {
      rows.push([
        `mbox2 -> bulb(${s})`,
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: s })],
      ]);
    }
    for (const s of [8, 4, 2, 1]) {
      rows.push([
        `mbox2 -> qsq(${s})`,
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: s })],
      ]);
    }
    rows.push(
      ["mbox3 -> bulb(1)", [xmap(1, "mandelbox", 3), xmap(2, "bulb", 1)]],
      // The controls: three shipped presets, and fr-17qu's own degenerate
      // system (a Mandelbox pre-scaled by 8, which the app measures at
      // 0.019% of rays against the presets' 5.0-10.3%).
      ["CONTROL mandelboxClassic (ships)", mandelboxClassic()],
      ["CONTROL mandelboxRings (ships)", mandelboxRings()],
      ["CONTROL foldChain (ships)", foldChain()],
      [
        "CONTROL fr-17qu degenerate (mbox2 pre-scaled 8)",
        [xmap(1, "mandelbox", 2, { scale: 8 })],
      ],
    );
    console.log(
      `  fill = probeEscapeFill at ${FILL_POINTS} points over the radius-` +
        `${ESCAPE_TIME_RADIUS} bailout ball; grid25 = the ALIASED 25^3 grid, ` +
        `printed only to show what it does here; hits = ${HUNT}x${HUNT} at ` +
        `de-preview.ts's framing pose (NOT the canonical table's ${CROSS}px)`,
    );
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const panel = shotShipped(de, HUNT);
      const hits = hitPct(panel, HUNT);
      console.log(
        `  ${label.padEnd(48)} fill ${escapeFill(de).toFixed(3).padStart(6)}%  ` +
          `grid25 ${gridFill(de, 25).toFixed(3).padStart(6)}%  ` +
          `hits ${hits.toFixed(3).padStart(6)}%  ${hits < 0.1 ? "BLANK" : ""}`,
      );
    }
  });

  it("measures the FILL INSTRUMENT itself, because a thin set aliases", () => {
    // Not a property of the objects — a property of how they are measured,
    // and it has to be written down because both this file's earlier drafts
    // and the figures quoted in `escape-de.ts`'s module doc are regular-grid
    // fills, and on a thin set a regular grid does not measure volume.
    //
    // A fold's escape set has hard structure on the fold's own walls, and a
    // grid over [-4, 4] whose spacing divides them puts a disproportionate
    // share of its points exactly there. The n=25 grid is the worst case in
    // the family — spacing exactly 1/3, so every integer coordinate is a
    // grid plane — and it is also the one the prototype happened to use.
    //
    // WHAT A LATER READER MUST NOT DO: quote a grid fill of a thin
    // escape-time set, or compare two rows measured at different `n`. The
    // seeded sample is stable and is what every fill column above reads.
    const rows: [string, Transform[]][] = [
      ["mandelboxClassic (thin)", mandelboxClassic()],
      [
        "mbox2 -> bulb(1) (thin)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1)],
      ],
      [
        "mbox2 -> bulb(0.3) (thick)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.3 })],
      ],
    ];
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const grids = [23, 25, 27, 29, 31, 33, 41, 49].map((n) =>
        gridFill(de, n),
      );
      console.log(
        `  ${label.padEnd(28)} grid n=23..49 ` +
          `${grids.map((g) => g.toFixed(2)).join(" ")}  ` +
          `(spread ${(Math.max(...grids) / Math.min(...grids)).toFixed(2)}x)\n` +
          `  ${" ".repeat(28)} sample 4k ${escapeFill(de, 4096).toFixed(3)}%  ` +
          `64k ${escapeFill(de, 65536).toFixed(3)}%  ` +
          `${FILL_POINTS / 1024}k ${escapeFill(de).toFixed(3)}%`,
      );
    }
    // ONE INSTRUMENT, pinned rather than asserted in prose. {@link escapeFill}
    // IS `probeEscapeFill`; the two derived readers must return the module's
    // own number wherever the questions coincide, or the tables above are
    // quietly comparing two definitions of "fill".
    const de = buildEscapeDE(mandelboxClassic());
    for (const points of [ESCAPE_PROBE_POINTS, 65536]) {
      expect(escapeFill(de, points)).toBe(100 * probeEscapeFill(de, points));
      // `escapeFillAtBudget` exists only because `probeEscapeFill` has no
      // budget parameter; at the default budget it must not differ.
      expect(escapeFillAtBudget(de, points, ESCAPE_TIME_ITERATIONS)).toBe(
        escapeFill(de, points),
      );
    }
    // And {@link chainFill} samples the same ball the same way: the
    // prototype's `cycle` arm at the shipped budget IS the shipped orbit
    // (the cross-validation test proves that bit-exactly), so its fill has
    // to agree to the last sample.
    const single = mandelboxClassic();
    expect(
      chainFill(
        chain("", linksOf(single), {
          sequence: "cycle",
          offset: "link",
          iterations: ESCAPE_TIME_ITERATIONS * single.length,
        }),
        ESCAPE_PROBE_POINTS,
      ),
    ).toBe(escapeFill(de, ESCAPE_PROBE_POINTS));
  });

  it("forks the ESTIMATE FORM on the shipped orbit: linear vs Bottcher log", () => {
    // `escape-de.ts` resolves this per chain (`logEstimate`, true exactly
    // when some link is a power map) and carries the answer on the wire so
    // six mirrors cannot each decide it differently. This is the measurement
    // behind that rule, and it has to answer fr-282c — which REFUSED the log
    // form for the fold family, on evidence that does not reach a power
    // chain and must not be read as if it did.
    //
    // Bound- and damped-step violation rates over 900 exterior queries in
    // the bailout ball, 14 probe directions each, at ESCAPE_STEP_SCALE. The
    // two arms are the same `EscapeDE` with `logEstimate` flipped, so they
    // share the orbit, the bailout and the SET, and differ only in the
    // return statement.
    const rows: [string, Transform[]][] = [
      [
        "mbox2 -> bulb(0.5)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.5 })],
      ],
      [
        "mbox2 -> bulb(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.4 })],
      ],
      [
        "mbox2 -> bulb(0.3)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.3 })],
      ],
      [
        "mbox2 -> bulb(0.2)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.2 })],
      ],
      ["mbox2 -> bulb(1)", [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1)]],
      [
        "mbox2 -> qsq(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.4 })],
      ],
      [
        "mbox2 -> qsq(0.5)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.5 })],
      ],
      [
        "mbox1.5 -> bulb(0.5)",
        [xmap(1, "mandelbox", 1.5), xmap(2, "bulb", 1, { scale: 0.5 })],
      ],
      [
        "bulb(0.5) -> bulb(0.5) r20",
        [
          xmap(1, "bulb", 1, { scale: 0.5 }),
          xmap(2, "bulb", 1, { scale: 0.5, rotY: 20 }),
        ],
      ],
      [
        "box1.6 -> bulb(0.3) -> sph1.2",
        [
          xmap(1, "boxfold", 1.6),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "spherefold", 1.2),
        ],
      ],
      [
        "CONTROL mbox2 -> boxfold1.6",
        [xmap(1, "mandelbox", 2), xmap(2, "boxfold", 1.6)],
      ],
    ];
    console.log(
      `  overshoot = bound/step violation over 900 exterior queries in the ` +
        `radius-${ESCAPE_TIME_RADIUS} bailout ball, 14 fixed probe directions,
` +
        `  bound probed at the full estimate d and step at ` +
        `ESCAPE_STEP_SCALE*d (${ESCAPE_STEP_SCALE}); membership by ` +
        `escapeSetContains, never a threshold`,
    );
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const lin: EscapeDE = { ...de, logEstimate: false };
      const log: EscapeDE = { ...de, logEstimate: true };
      const a = shippedOvershoot(lin, 0x51ee);
      const b = shippedOvershoot(log, 0x51ee);
      console.log(
        `  ${label.padEnd(30)} ships=${de.logEstimate ? "log" : "lin"}  ` +
          `linear ${a.bound.toFixed(1).padStart(5)}/${a.step.toFixed(1).padStart(4)}%  ` +
          `log ${b.bound.toFixed(1).padStart(5)}/${b.step.toFixed(1).padStart(4)}%  ` +
          `(bound gain ${(a.bound / Math.max(b.bound, 1e-9)).toFixed(1)}x, n=${a.n})`,
      );
    }
    // And what it is worth at FRAME level, same pose, same step scale: the
    // column the overshoot rates cannot show, because a tighter bound near
    // the surface and a looser one far from it is a change in where the
    // steps go rather than in how many there are.
    console.log(
      `  --- frame level, same pose, ${CROSS}x${CROSS}, stepScale ` +
        `${ESCAPE_STEP_SCALE} ---`,
    );
    const forms: PanelStats[] = [];
    for (const [label, transforms] of [
      [
        "mbox2 -> bulb(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.4 })],
      ],
      [
        "mbox2 -> qsq(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.4 })],
      ],
    ] as [string, Transform[]][]) {
      const de = buildEscapeDE(transforms);
      for (const logEstimate of [false, true]) {
        const panel = shotShipped({ ...de, logEstimate }, CROSS);
        forms.push(panel);
        console.log(
          `  ${label.padEnd(22)} ${logEstimate ? "log   " : "linear"}  ` +
            `hits ${hitPct(panel, CROSS).toFixed(2)}%  ` +
            `steps/ray ${(panel.steps / (CROSS * CROSS)).toFixed(1)}  ` +
            `exhausted ${panel.exhausted}  ${panel.ms}ms`,
        );
      }
    }
    console.log(
      `  wrote ${writeContactSheet(forms, 2, "hybrid-chain-form.png")}`,
    );
  });

  it("asks fr-282c's two questions of a POWER chain", () => {
    // fr-282c refused the log form for the FOLD family on two measurements,
    // and neither reaches a chain carrying a power link. This test runs both
    // of them here so the difference is measured rather than argued.
    //
    //  (a) IS log/linear PINNED? The two arms read the same terminal radius
    //      through the same `dr`, so their ratio is exactly `0.5·ln r`. A
    //      fold orbit lands just outside its radius-4 bailout ball, which
    //      pins the ratio near `0.5·ln 4 = 0.693` — and a constant damping
    //      is a knob the mode already exposes, not a different bound.
    //  (b) IS IT BOUNDARY-ADAPTIVE? fr-282c's decisive column: the ratio's
    //      median in the nearest and farthest deciles of exterior queries.
    //      Flat means it carries no distance information at all.
    //
    // The rows are ordered so the transition is visible. Read them against
    // the estimate-form test's overshoot table: the rows where the ratio is
    // NOT flat are exactly the rows where the log form wins big.
    const rows: [string, Transform[]][] = [
      [
        "CONTROL mbox2 -> boxfold1.6",
        [xmap(1, "mandelbox", 2), xmap(2, "boxfold", 1.6)],
      ],
      [
        "mbox2 -> qsq(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.4 })],
      ],
      [
        "mbox2 -> bulb(0.3)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.3 })],
      ],
      [
        "mbox2 -> bulb(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.4 })],
      ],
      [
        "mbox2 -> bulb(0.5)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.5 })],
      ],
      // The two THREE-LINK rows are a pair, and they are here to answer
      // whether the direction of the spread is a property of the SYSTEM or
      // of one fixture. Both hold the power link at pre-scale 0.3 — where
      // the two-link `mbox2 -> bulb(0.3)` row above is FLAT — and differ in
      // which folds surround it. If both come out adaptive the same way, the
      // extra fold links are what moved it, not the fixture.
      [
        "box1.6 -> bulb(0.3) -> sph1.2",
        [
          xmap(1, "boxfold", 1.6),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "spherefold", 1.2),
        ],
      ],
      [
        "mbox2 -> bulb(0.3) -> box1.6 r20",
        [
          xmap(1, "mandelbox", 2),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "boxfold", 1.6, { rotY: 20 }),
        ],
      ],
    ];
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const lin: EscapeDE = { ...de, logEstimate: false };
      const log: EscapeDE = { ...de, logEstimate: true };

      // (a) the whole distribution, over the bailout ball.
      const rngA = mulberry32(0xf00d);
      const ratios: number[] = [];
      for (let i = 0; i < 40000; i++) {
        const u = Math.cbrt(rngA()) * ESCAPE_TIME_RADIUS;
        const ct = 2 * rngA() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rngA();
        const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
        const a = estimateEscapeDistance(lin, p);
        const b = estimateEscapeDistance(log, p);
        if (a > 0 && Number.isFinite(a) && Number.isFinite(b))
          ratios.push(b / a);
      }
      ratios.sort((x, y) => x - y);
      const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))];

      // (b) the near/far deciles, EXTERIOR queries only (an interior point
      // has no distance to be adaptive about).
      //
      // THREE INDEPENDENT SEEDS, not one, because the DIRECTION of the
      // spread is the thing being read and a single seed cannot say whether
      // a direction is a property of the system or of that seed's decile
      // membership. A row is only reported ADAPTIVE if all three seeds agree
      // on the direction; disagreement prints UNSTABLE and should be read as
      // an open observation rather than a result.
      const decileAt = (seed: number): { near: number; far: number } => {
        const rngB = mulberry32(seed);
        const pts: { d: number; ratio: number }[] = [];
        let guard = 0;
        while (pts.length < 20000 && guard++ < 400000) {
          const u = Math.cbrt(rngB()) * ESCAPE_TIME_RADIUS;
          const ct = 2 * rngB() - 1;
          const st = Math.sqrt(Math.max(0, 1 - ct * ct));
          const ph = 2 * Math.PI * rngB();
          const p: Vec3 = [
            u * st * Math.cos(ph),
            u * st * Math.sin(ph),
            u * ct,
          ];
          if (escapeSetContains(de, p)) continue;
          const a = estimateEscapeDistance(lin, p);
          const b = estimateEscapeDistance(log, p);
          if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) {
            pts.push({ d: a, ratio: b / a });
          }
        }
        pts.sort((x, y) => x.d - y.d);
        const med = (arr: { ratio: number }[]) => {
          const r = arr.map((z) => z.ratio).sort((x, y) => x - y);
          return r[Math.floor(r.length / 2)];
        };
        const dec = Math.max(1, Math.floor(pts.length / 10));
        return { near: med(pts.slice(0, dec)), far: med(pts.slice(-dec)) };
      };
      const seeds = [0xbeef, 0x1dea, 0x51ee];
      const decs = seeds.map(decileAt);
      const spreads = decs.map((d) => d.far / d.near);
      const flat = spreads.every((s) => Math.abs(s - 1) < 0.05);
      const agree =
        spreads.every((s) => s > 1.05) || spreads.every((s) => s < 0.95);
      console.log(
        `  ${label.padEnd(30)} log/linear  ` +
          `p05 ${q(0.05).toFixed(3)} p25 ${q(0.25).toFixed(3)} ` +
          `p50 ${q(0.5).toFixed(3)} p75 ${q(0.75).toFixed(3)} ` +
          `p95 ${q(0.95).toFixed(3)}   (n=${ratios.length} in the bailout ball)\n` +
          `  ${" ".repeat(30)} near/far deciles over 3 seeds: ` +
          decs
            .map((d) => `${d.near.toFixed(3)}/${d.far.toFixed(3)}`)
            .join("  ") +
          `\n  ${" ".repeat(30)} spread ` +
          `${spreads.map((s) => `${s.toFixed(2)}x`).join(" ")}  ` +
          `${flat ? "FLAT (a constant)" : agree ? "ADAPTIVE (all 3 seeds agree on direction)" : "UNSTABLE (seeds disagree — read as an open observation)"}` +
          `   (0.5*ln4 = 0.693; 20k exterior queries per seed)`,
      );
    }
  });

  it("measures f32 headroom, because six mirrors run f32", () => {
    // A power link's `8·r⁷` looks like an overflow risk on a 32-bit mirror,
    // and it is worth settling here rather than discovering it on a driver.
    // It is not one, for two structural reasons: the bailout test bounds
    // `|v|` entering EVERY link (cycling tests after each, so a power link
    // never sees a fold's expanded output), and cycling's per-link `+ 1`
    // floors `dr` at 1 every step, so the derivative cannot collapse toward
    // zero and blow the quotient up.
    //
    // `1/min(DE)` over a large query set is the reachable ceiling on that
    // quotient — the quantity that would saturate f32 (max 3.4e38).
    const rows: [string, Transform[]][] = [
      [
        "mbox2 -> bulb(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.4 })],
      ],
      ["mbox2 -> bulb(1)", [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1)]],
      [
        "mbox2 -> bulb(8)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 8 })],
      ],
      ["mbox2 -> qsq(1)", [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1)]],
      [
        "box1.6 -> bulb(0.3) -> sph1.2",
        [
          xmap(1, "boxfold", 1.6),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "spherefold", 1.2),
        ],
      ],
    ];
    console.log(
      `  200000 queries per row, uniform in [-${ESCAPE_TIME_RADIUS}, ` +
        `${ESCAPE_TIME_RADIUS}]^3, f64 CPU; the ceiling is 1/min(DE>0)`,
    );
    let worstCeiling = 0;
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const rng = mulberry32(0x1234);
      let maxD = 0;
      let minD = Infinity;
      let nonFinite = 0;
      const R = ESCAPE_TIME_RADIUS;
      for (let i = 0; i < 200000; i++) {
        const p: Vec3 = [
          2 * R * rng() - R,
          2 * R * rng() - R,
          2 * R * rng() - R,
        ];
        const d = estimateEscapeDistance(de, p);
        if (!Number.isFinite(d)) nonFinite++;
        else {
          maxD = Math.max(maxD, d);
          if (d > 0) minD = Math.min(minD, d);
        }
      }
      worstCeiling = Math.max(worstCeiling, 1 / minD);
      console.log(
        `  ${label.padEnd(30)} DE max ${maxD.toExponential(2)}  ` +
          `min>0 ${minD.toExponential(2)}  ~dr/r ceiling ${(1 / minD).toExponential(2)}  ` +
          `non-finite ${nonFinite}   (f32 max 3.4e38)`,
      );
      expect(nonFinite, `${label}: non-finite estimates`).toBe(0);
    }
    console.log(
      `  worst ~dr/r ceiling over all rows ${worstCeiling.toExponential(2)}, ` +
        `${(Math.log10(3.4e38) - Math.log10(worstCeiling)).toFixed(0)} orders below f32's max`,
    );
    expect(worstCeiling, "f32 headroom").toBeLessThan(1e30);
  });

  it("prices the budget and the cost of a cross-family chain", () => {
    // Two questions the mode's shipped constants depend on, asked of the
    // chains fr-j231 admits.
    //
    // BUDGET: `ESCAPE_TIME_ITERATIONS` is 30 PASSES for a fold chain. A
    // power link escapes in two or three, so the budget could plausibly have
    // been the wrong size in either direction here. Ball fill against the
    // budget is the readout: a CLIFF would mean 30 is clipping or inflating
    // the object, a slow drift means it is settled.
    //
    // COST: composition is n links per pass, but every extra link is another
    // chance for the orbit to leave the ball, and the n-times budget is a
    // ceiling only a non-escaping orbit ever pays.
    const specs: [string, Transform[]][] = [
      [
        "mbox2 -> bulb(0.3)",
        [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1, { scale: 0.3 })],
      ],
      ["mbox2 -> bulb(1)", [xmap(1, "mandelbox", 2), xmap(2, "bulb", 1)]],
      [
        "mbox2 -> qsq(0.4)",
        [xmap(1, "mandelbox", 2), xmap(2, "qsquare", 1, { scale: 0.4 })],
      ],
      [
        "bulb(0.5) -> bulb(0.5) r20",
        [
          xmap(1, "bulb", 1, { scale: 0.5 }),
          xmap(2, "bulb", 1, { scale: 0.5, rotY: 20 }),
        ],
      ],
      [
        "box1.6 -> bulb(0.3) -> sph1.2",
        [
          xmap(1, "boxfold", 1.6),
          xmap(2, "bulb", 1, { scale: 0.3 }),
          xmap(3, "spherefold", 1.2),
        ],
      ],
    ];
    // THE CONTROL IS MEASURED FIRST and every cost is printed as a RATIO
    // against it as well as an absolute. The ratio is the quotable number:
    // the absolutes are wall-clock and move with whatever else is on the
    // machine, the ratio does not (both arms pay the same contention inside
    // one run). The absolute is printed anyway so a reader can see what kind
    // of machine produced the ratio.
    const control = buildEscapeDE(mandelboxClassic());
    const controlUs = shippedCost(control, 7);
    console.log(
      `  fills: probeEscapeFill's sampler at ${FILL_POINTS} points over the ` +
        `radius-${ESCAPE_TIME_RADIUS} bailout ball, at the stated PASS budget\n` +
        `  cost:  40000 queries in [-4,4]^3, best of 3 timed runs after a ` +
        `warm-up, at ESCAPE_TIME_ITERATIONS = ${ESCAPE_TIME_ITERATIONS}\n` +
        `  CONTROL single mandelboxClassic = ${controlUs.toFixed(2)} us/eval ` +
        `(= 1.00x, the denominator of every ratio below)`,
    );
    for (const [label, transforms] of specs) {
      const de = buildEscapeDE(transforms);
      const row = [8, 16, 30, 60].map(
        (passes) =>
          `${passes}p:${escapeFillAtBudget(de, FILL_POINTS, passes).toFixed(2)}%`,
      );
      const us = shippedCost(de, 7);
      console.log(
        `  ${label.padEnd(30)} ${row.join("  ")}   ` +
          `${us.toFixed(2)} us/eval = ${(us / controlUs).toFixed(2)}x control` +
          `${us < controlUs ? "  <- CHEAPER than the single map" : ""}`,
      );
    }
  });

  it("renders the three SHIPPED hybrid presets beside their controls", () => {
    // The sheet that argues for the menu entries, drawn by the estimator
    // that renders them. Two controls anchor it: the fold-only `foldChain`
    // (fr-za0n's hybrid — what composition looked like before it could cross
    // the family boundary) and the single `mandelboxClassic` (what the mode
    // rendered before it could compose at all).
    const rows: [string, Transform[]][] = [
      ...HYBRID_PRESETS,
      ["CONTROL foldChain (ships)", foldChain()],
      ["CONTROL mandelboxClassic (ships)", mandelboxClassic()],
    ];
    const panels: PanelStats[] = [];
    console.log(
      `  panels are ${SIZE}x${SIZE} (the SHEET's size — for a hit rate to ` +
        `quote, use the canonical table's ${CROSS}px rows); fill = ` +
        `probeEscapeFill at ${FILL_POINTS} points; cost = best of 3 after a ` +
        `warm-up`,
    );
    for (const [label, transforms] of rows) {
      const de = buildEscapeDE(transforms);
      const panel = shotShipped(de, SIZE);
      panels.push(panel);
      const os = shippedOvershoot(de, 0x0aa1, 1200);
      console.log(
        `  ${label.padEnd(40)} ${de.logEstimate ? "log" : "lin"}  ` +
          `fill ${escapeFill(de).toFixed(3).padStart(6)}%  ` +
          `hits ${hitPct(panel, SIZE).toFixed(1).padStart(5)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1).padStart(5)}  ` +
          `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}%  ` +
          `${shippedCost(de, 3).toFixed(2)} us/eval  ${panel.ms}ms`,
      );
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-presets.png")}`,
    );
    // A preset that opens on a blank pane is the one failure mode a menu
    // entry must not have — fr-17qu's bar again, at the framing the app
    // itself uses.
    panels.forEach((p, i) => {
      expect(hitPct(p, SIZE), `${rows[i][0]} renders`).toBeGreaterThan(1);
    });
  });

  // ======================================================================
  // From here down: THE PROTOTYPE'S OWN SHEETS, which are now the CONTROL
  // arm. They measure `runChain`, not `escape-de.ts` — the rejected per-PASS
  // orbit, the offset fork, the bailout sweep and the fold-only sequence
  // verdict that fr-za0n came off. They are kept executable rather than
  // deleted (this project's discipline for a superseded arm), and every
  // number they print is the arm the sections above are a refutation OF.
  // ======================================================================

  it("searches for cross-family chains that are not EMPTY", () => {
    // The first thing the prototype found, and the shape of every sheet
    // below it: under CHAINING, `mandelbox w=2 -> bulb` renders NOTHING. A
    // mandelbox step at the classic weight leaves `|v|` as large as ~7, and
    // a triplex 8th power sends 7 to 5.8e5 in one link — every query escapes
    // on its first pass. Power-8 links are STIFF: a chained system holding
    // one is only non-empty when the link's pre-scale roughly inverts
    // whatever expansion precedes it, which is where this file's
    // cross-family panel parameters come from.
    //
    // READ IT AS THE CONTROL IT NOW IS. This measures the prototype's
    // rejected per-PASS orbit; the shipped one cycles, and the headline test
    // above measures the same systems through it and finds the stiffness
    // largely gone. These rows are why that result is interesting rather
    // than obvious — they are the arm it is a refutation OF.
    const rows: [string, ChainLink[]][] = [];
    for (const w of [2, 1.5, 1]) {
      for (const s of [1, 0.5, 0.3, 0.2, 0.145, 0.1]) {
        rows.push([
          `mandelbox w=${w} -> bulb (pre-scale ${s})`,
          [link("mandelbox", w), link("bulb", 1, { scale: [s, s, s] })],
        ]);
      }
    }
    for (const s of [1, 0.5, 0.3, 0.2]) {
      rows.push([
        `bulb (pre-scale ${s}) -> mandelbox w=2`,
        [link("bulb", 1, { scale: [s, s, s] }), link("mandelbox", 2)],
      ]);
    }
    for (const w of [2, 1.5]) {
      for (const s of [1, 0.6, 0.4, 0.3, 0.2]) {
        rows.push([
          `mandelbox w=${w} -> qsquare (pre-scale ${s})`,
          [link("mandelbox", w), link("qsquare", 1, { scale: [s, s, s] })],
        ]);
      }
    }
    // Fold-only chains need no such tuning — every fold is at most linearly
    // expanding — but these are where the sheet's fold panels come from.
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    rows.push(
      [
        "mandelbox w=2 -> boxfold w=1.6",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
      [
        "mandelbox w=2 -> boxfold w=1.6 -> spherefold w=1.2",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      [
        "mandelbox w=2 -> mandelbox w=2 rot 20y",
        [link("mandelbox", 2), link("mandelbox", 2, { rotation: rot(20) })],
      ],
      [
        "boxfold w=1 rot 25y -> spherefold w=2",
        [link("boxfold", 1, { rotation: rot(25) }), link("spherefold", 2)],
      ],
      [
        "mandelbox w=2 -> mandelbox w=-1.5",
        [link("mandelbox", 2), link("mandelbox", -1.5)],
      ],
    );
    for (const [label, links] of rows) {
      const c = chain(label, links);
      const de = chainDE(c);
      const { fillPct, reachAbs } = scan(de, 6, 6, 27);
      console.log(
        `  ${label.padEnd(50)} fill ${fillPct.toFixed(2)}%  reach ${reachAbs.toFixed(2)}`,
      );
    }
  });

  it("renders the chain contact sheet", () => {
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const s = (v: number): Vec3 => [v, v, v];
    const chains: Chain[] = [
      // Row 1 — the two shipped single-map objects, then folds chained.
      chain("CONTROL single mandelbox w=2 (ships today)", [
        link("mandelbox", 2),
      ]),
      chain("CONTROL single bulb (ships today)", [link("bulb", 1)]),
      chain("mandelbox w=2 -> boxfold w=1.6", [
        link("mandelbox", 2),
        link("boxfold", 1.6),
      ]),
      chain("mandelbox w=2 -> boxfold w=1.6 -> spherefold w=1.2", [
        link("mandelbox", 2),
        link("boxfold", 1.6),
        link("spherefold", 1.2),
      ]),
      // Row 2 — cross-family, and the order fork on ONE pair of links.
      chain("CROSS mandelbox w=2 -> bulb (pre-scale 0.3)", [
        link("mandelbox", 2),
        link("bulb", 1, { scale: s(0.3) }),
      ]),
      chain(
        "CROSS bulb (pre-scale 0.3) -> mandelbox w=2 — SAME PAIR REVERSED",
        [link("bulb", 1, { scale: s(0.3) }), link("mandelbox", 2)],
      ),
      chain("CROSS mandelbox w=1.5 -> bulb (pre-scale 0.5)", [
        link("mandelbox", 1.5),
        link("bulb", 1, { scale: s(0.5) }),
      ]),
      chain("CROSS mandelbox w=2 -> qsquare (pre-scale 0.4)", [
        link("mandelbox", 2),
        link("qsquare", 1, { scale: s(0.4) }),
      ]),
      // Row 3 — rotation between links, and two chosen for range.
      chain("mandelbox w=2 -> mandelbox w=2 ROTATED 20deg y", [
        link("mandelbox", 2),
        link("mandelbox", 2, { rotation: rot(20) }),
      ]),
      chain("boxfold w=1 (rot 25deg y) -> spherefold w=2 — a split mandelbox", [
        link("boxfold", 1, { rotation: rot(25) }),
        link("spherefold", 2),
      ]),
      chain("mandelbox w=2 -> mandelbox w=-1.5 — the ball meets the cube", [
        link("mandelbox", 2),
        link("mandelbox", -1.5),
      ]),
      chain(
        "CROSS mandelbox w=2 -> bulb (0.3), PER-LINK offset (cf. panel 5)",
        [link("mandelbox", 2), link("bulb", 1, { scale: s(0.3) })],
        { offset: "link" },
      ),
    ];

    const reports = chains.map((c, i) => {
      const r = report(c);
      printReport(i + 1, c, r);
      return r;
    });
    console.log(
      `  wrote ${writeContactSheet(
        reports.map((r) => r.panel),
        4,
        "hybrid-chain.png",
      )}`,
    );
    // Guard the guard: a blank panel makes the sheet meaningless.
    reports.forEach((r, i) => {
      expect(r.panel.hits, `panel ${i + 1} rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
    });
  });

  it("looks CLOSE, where mush and structure separate", () => {
    // The silhouette sheet cannot settle "richer or just fatter": every
    // escape-time set reads as a crusty ball from far enough away. This is
    // `bulb-de.ts`'s own move — re-run at a pose where creases and filigree,
    // not an outline, are what the marcher must resolve. Same eye, narrow
    // frustum, so nothing is clipped by the marching ball.
    const s = (v: number): Vec3 => [v, v, v];
    const closes: Chain[] = [
      chain("CONTROL single mandelbox w=2", [link("mandelbox", 2)]),
      chain("CONTROL single bulb", [link("bulb", 1)]),
      chain("mandelbox w=2 -> mandelbox w=2 rot 20y", [
        link("mandelbox", 2),
        link("mandelbox", 2, { rotation: [0, Math.PI / 9, 0] }),
      ]),
      chain("boxfold w=1 rot 25y -> spherefold w=2", [
        link("boxfold", 1, { rotation: [0, (25 * Math.PI) / 180, 0] }),
        link("spherefold", 2),
      ]),
      chain("CROSS mandelbox w=2 -> bulb (0.3)", [
        link("mandelbox", 2),
        link("bulb", 1, { scale: s(0.3) }),
      ]),
      chain("CROSS mandelbox w=1.5 -> bulb (0.5)", [
        link("mandelbox", 1.5),
        link("bulb", 1, { scale: s(0.5) }),
      ]),
    ];
    // Aim at the object's near RIM, not its centre, so each panel carries a
    // silhouette edge as well as a surface. `de-preview.ts` centres the
    // marching ball on `target`, so the ball is inflated by the same offset —
    // a close pose must never crop the object it is inspecting.
    const dir = Math.hypot(...CLOSE_EYE);
    const panels = closes.map((c) => {
      const de = chainDE(c);
      const fit = fitMarchRadius(de, 6);
      const aim = 0.62 * fit;
      const target: Vec3 = [
        (CLOSE_EYE[0] / dir) * aim,
        (CLOSE_EYE[1] / dir) * aim,
        (CLOSE_EYE[2] / dir) * aim,
      ];
      const marchR = fit + aim;
      const panel = renderPreview(
        {
          de,
          boundingRadius: marchR,
          target,
          stepScale: ESCAPE_STEP_SCALE,
          eyeOffset: [
            (CLOSE_EYE[0] / dir) * 1.3,
            (CLOSE_EYE[1] / dir) * 1.3,
            (CLOSE_EYE[2] / dir) * 1.3,
          ],
          zoom: CLOSE_ZOOM,
        },
        SIZE,
      );
      console.log(
        `  ${c.label.padEnd(38)} marchR ${marchR.toFixed(2)}  ` +
          `hits ${((100 * panel.hits) / (SIZE * SIZE)).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-close.png")}`,
    );
  });

  it("forks the offset: per PASS vs per LINK", () => {
    const pairs: [string, ChainLink[]][] = [
      [
        "mandelbox w=2 -> boxfold w=1.6",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
      [
        "mandelbox w=2 -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> boxfold -> spherefold",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
    ];
    const panels: PanelStats[] = [];
    for (const offset of ["pass", "link"] as const) {
      for (const [label, links] of pairs) {
        const c = chain(`${offset}-offset  ${label}`, links, { offset });
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${c.label}\n` +
            `      marchR ${marchR.toFixed(2)}  fill ${fillPct.toFixed(1)}%  ` +
            `reach ${reachAbs.toFixed(2)}  ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}%  ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)}  ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}%  ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-offset.png")}`,
    );
  });

  it("forks the estimate form: linear vs Bottcher log on a mixed chain", () => {
    // `escape-de.ts` reads `r/dr`, `bulb-de.ts` reads `0.5·r·ln r/dr`. A chain
    // holding both has to pick one, and Mandelbulber2 makes it a per-hybrid
    // setting. These are the numbers behind this harness's default rule.
    const specs: [string, ChainLink[]][] = [
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> qsquare (pre-scale 0.4)",
        [link("mandelbox", 2), link("qsquare", 1, { scale: [0.4, 0.4, 0.4] })],
      ],
      [
        "mandelbox -> boxfold (no power link)",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
    ];
    for (const [label, links] of specs) {
      for (const estimate of ["linear", "log"] as const) {
        const c = chain(label, links, { estimate });
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          200,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(38)} ${estimate.padEnd(6)}  ` +
            `marchR ${marchR.toFixed(2)}  ` +
            `hits ${((100 * panel.hits) / (200 * 200)).toFixed(1)}%  ` +
            `steps/ray ${(panel.steps / (200 * 200)).toFixed(1)}  ` +
            `overshoot bound ${os.bound.toFixed(1)}% / step ${os.step.toFixed(1)}%`,
        );
      }
    }
  });

  it("asks what bailout radius a chain needs", () => {
    // The single-map estimators use 4. A chain of expanding maps might not
    // settle there — if the object keeps growing as the bailout rises, 4 is
    // clipping it.
    const specs: [string, ChainLink[]][] = [
      ["CONTROL single mandelbox w=2", [link("mandelbox", 2)]],
      ["mandelbox -> boxfold", [link("mandelbox", 2), link("boxfold", 1.6)]],
      [
        "mandelbox -> boxfold -> spherefold",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> mandelbox rot 20",
        [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: [0, Math.PI / 9, 0] }),
        ],
      ],
    ];
    for (const [label, links] of specs) {
      const row: string[] = [];
      for (const bailout of [4, 8, 16, 64]) {
        const c = chain(label, links, { bailout });
        const de = chainDE(c);
        const { fillPct, reachAbs } = scan(de, 6, 6, 33);
        // Average orbit length over the same grid, for the cost side.
        let iters = 0;
        let n = 0;
        for (let i = 0; i < 15; i++)
          for (let j = 0; j < 15; j++)
            for (let k = 0; k < 15; k++) {
              runChain(
                c,
                [-3 + (6 * i) / 14, -3 + (6 * j) / 14, -3 + (6 * k) / 14],
                c.iterations,
              );
              iters += chainIters;
              n++;
            }
        row.push(
          `${bailout}: fill ${fillPct.toFixed(1)}% reach ${reachAbs.toFixed(2)} iters ${(iters / n).toFixed(1)}`,
        );
      }
      console.log(`  ${label}\n      ${row.join("   |   ")}`);
    }
  });

  it("sweeps the march step scale on the cross-family chain", () => {
    // `escape-de.ts` measured 0.35 against the single mandelbox. If chaining
    // degraded the bound, the chain's hits will keep climbing below 0.35
    // where the control's flatten — that climb IS the degradation signal.
    const cases: [string, Chain][] = [
      ["CONTROL single mandelbox w=2", chain("", [link("mandelbox", 2)])],
      [
        "CROSS mandelbox -> bulb (0.3)",
        chain("", [
          link("mandelbox", 2),
          link("bulb", 1, { scale: [0.3, 0.3, 0.3] }),
        ]),
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, c] of cases) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      for (const stepScale of [1, 0.5, 0.35, 0.2, 0.1, 0.05]) {
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        console.log(
          `  ${label.padEnd(30)} stepScale ${String(stepScale).padEnd(5)}  ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(2)}%  ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)}  ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "hybrid-chain-march.png")}`,
    );
  });

  it("forks the sequence: CHAINING vs CYCLING", () => {
    // The fr-za0n fork. CHAINING applies every link inside one pass;
    // CYCLING applies slot `i mod n` at pass `i` — Mandelbulber2's own
    // `seq->GetSequence(i)`. Cycling at the SAME iteration budget applies
    // each map a third as often, so each fixture is rendered three ways:
    // chained, cycled at the same budget, and cycled at n x the budget
    // (equal fold applications, equal cost).
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const fixtures: [string, ChainLink[]][] = [
      ["mbox2 -> boxfold1.6", [link("mandelbox", 2), link("boxfold", 1.6)]],
      [
        "mbox2 -> mbox2 rot20y",
        [link("mandelbox", 2), link("mandelbox", 2, { rotation: rot(20) })],
      ],
      [
        "mbox2 -> boxfold1.6 -> sphere1.2",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      ["mbox2 -> mbox-1.5", [link("mandelbox", 2), link("mandelbox", -1.5)]],
      [
        "FOUR: mbox2 -> box1.6 -> sph1.2 -> mbox-1.5",
        [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
          link("mandelbox", -1.5),
        ],
      ],
      [
        "SIX: mbox2 x2 -> box1.6 -> sph1.2 -> mbox-1.5 -> box1 rot25y",
        [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: rot(20) }),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
          link("mandelbox", -1.5),
          link("boxfold", 1, { rotation: rot(25) }),
        ],
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, links] of fixtures) {
      const n = links.length;
      const arms: [string, Chain][] = [
        ["chain", chain(label, links)],
        ["cycle", chain(label, links, { sequence: "cycle" })],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            iterations: ESCAPE_TIME_ITERATIONS * n,
          }),
        ],
      ];
      for (const [arm, c] of arms) {
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: 0.2,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(28)} ${arm.padEnd(9)} iters ${String(c.iterations).padEnd(3)} ` +
            `marchR ${marchR.toFixed(2)} fitFill ${fillPct.toFixed(1)}% ` +
            // The FITTED ball's fill is a grid figure over each arm's OWN
            // radius, so the two arms' columns are not the same question —
            // which is exactly what makes chaining's "fattens toward its own
            // bailout ball" visible (its fitted radius IS the bailout one).
            // `ballFill` is the seeded probe over the SHARED radius-4 ball,
            // and it is the number a docblock may quote.
            `ballFill ${chainFill(c).toFixed(1)}% ` +
            `reach ${reachAbs.toFixed(2)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}% ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-sequence.png")}`,
    );

    // The same fork CLOSE UP, where mush and structure separate — the sheet
    // above can only compare silhouettes, and "richer" is not a silhouette
    // property. Equal-work arms only (chain@30 and cycle@30n both apply each
    // link 30 times).
    const close: PanelStats[] = [];
    for (const [label, links] of fixtures.slice(0, 4)) {
      const n = links.length;
      for (const [arm, c] of [
        ["chain", chain(label, links)],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            iterations: ESCAPE_TIME_ITERATIONS * n,
          }),
        ],
      ] as [string, Chain][]) {
        const de = chainDE(c);
        // The RIM-aimed close pose, not a centred one: `de-preview.ts`
        // centres the marching ball on `target`, so a narrow frustum aimed at
        // the origin shows nothing but interior surface and reads as noise.
        // Aim at the near rim and inflate the ball by the same offset.
        const fit = fitMarchRadius(de, 6);
        const aim = 0.62 * fit;
        const cd = Math.hypot(...CLOSE_EYE);
        const panel = renderPreview(
          {
            de,
            boundingRadius: fit + aim,
            target: [
              (CLOSE_EYE[0] / cd) * aim,
              (CLOSE_EYE[1] / cd) * aim,
              (CLOSE_EYE[2] / cd) * aim,
            ],
            stepScale: 0.2,
            eyeOffset: [
              (CLOSE_EYE[0] / cd) * 1.3,
              (CLOSE_EYE[1] / cd) * 1.3,
              (CLOSE_EYE[2] / cd) * 1.3,
            ],
            zoom: CLOSE_ZOOM,
          },
          SMALL,
        );
        console.log(
          `  CLOSE ${label.padEnd(28)} ${arm.padEnd(9)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ${panel.ms}ms`,
        );
        close.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(close, 2, "hybrid-chain-sequence-close.png")}`,
    );
  });

  it("asks whether CYCLING dissolves the power-link stiffness", () => {
    // The prediction the fold-only fixtures above cannot test, and the one
    // that could settle the fork on its own. CHAINING feeds the power link
    // the fold's EXPANDED output — a mandelbox step leaves `|v|` up to ~7 and
    // `7⁸ = 5.8e5` — which is why `mandelbox w=2 -> bulb` is EMPTY at
    // pre-scale 1 and has to be detuned to ~0.3. CYCLING never does that: at
    // the power link's turn the orbit has just passed the bailout check, so
    // `|v| <= 4` by construction. If that alone is enough, cycling admits
    // cross-family systems with NO per-link tuning — which is the difference
    // between a knob users must discover and a mode that just works.
    const s = (v: number): Vec3 => [v, v, v];
    const specs: [string, ChainLink[]][] = [];
    for (const ps of [1, 0.5, 0.3]) {
      specs.push([
        `mandelbox w=2 -> bulb (pre-scale ${ps})`,
        [link("mandelbox", 2), link("bulb", 1, { scale: s(ps) })],
      ]);
    }
    for (const ps of [1, 0.6, 0.4]) {
      specs.push([
        `mandelbox w=2 -> qsquare (pre-scale ${ps})`,
        [link("mandelbox", 2), link("qsquare", 1, { scale: s(ps) })],
      ]);
    }
    const panels: PanelStats[] = [];
    for (const [label, links] of specs) {
      const n = links.length;
      const arms: [string, Chain][] = [
        ["chain", chain(label, links)],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            // Equal work: each link applied the same number of times as the
            // chained arm applies it.
            iterations: BULB_ITERATIONS * n,
          }),
        ],
      ];
      for (const [arm, c] of arms) {
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: 0.2,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(38)} ${arm.padEnd(9)} ` +
            `marchR ${marchR.toFixed(2)} fill ${fillPct.toFixed(2)}% ` +
            `reach ${reachAbs.toFixed(2)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}% ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 4, "hybrid-chain-cross-sequence.png")}`,
    );
  });

  it("sweeps the march step scale at a SILHOUETTE pose", () => {
    // The sweep the shipped scale has to come off. `escape-form-sweep`'s pose
    // (default eye, zoom 0.28), NOT this module's close-up: at the close pose
    // every panel reads ~100% hits and the metric is saturated, so it can
    // only compare textures. Here dropout speckle is the signal, exactly as
    // it was for fr-7u8t.8's single map.
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const cases: [string, Chain][] = [
      ["CONTROL single mbox2", chain("", [link("mandelbox", 2)])],
      [
        "mbox2 -> boxfold1.6",
        chain("", [link("mandelbox", 2), link("boxfold", 1.6)]),
      ],
      [
        "mbox2 -> mbox2 rot20y",
        chain("", [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: rot(20) }),
        ]),
      ],
      [
        "mbox2 -> boxfold -> sphere",
        chain("", [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
        ]),
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, c] of cases) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      for (const stepScale of [0.7, 0.35, 0.2, 0.15, 0.1, 0.05]) {
        const panel = renderPreview(
          { de, boundingRadius: marchR, stepScale, zoom: 0.28 },
          SMALL,
        );
        console.log(
          `  ${label.padEnd(28)} stepScale ${String(stepScale).padEnd(5)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(2)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "hybrid-chain-march2.png")}`,
    );
  });

  it("prices a chain against the single map it generalises", () => {
    // Cost is the other half of the verdict: a chain of n links is n times
    // the work per orbit step, but the orbit may also escape sooner.
    // Queries are drawn in each chain's OWN fitted marching ball, which is
    // `bulb-de.ts`'s convention for the same measurement: cost is dominated by
    // orbit length, and orbit length is a property of where the query sits
    // relative to the object rather than of a shared box.
    const specs: [string, Chain][] = [
      ["single mandelbox (shipped shape)", chain("", [link("mandelbox", 2)])],
      ["single bulb (shipped shape)", chain("", [link("bulb", 1)])],
      [
        "mandelbox -> boxfold",
        chain("", [link("mandelbox", 2), link("boxfold", 1.6)]),
      ],
      [
        "mandelbox -> boxfold -> spherefold",
        chain("", [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
        ]),
      ],
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        chain("", [
          link("mandelbox", 2),
          link("bulb", 1, { scale: [0.3, 0.3, 0.3] }),
        ]),
      ],
    ];
    for (const [label, c] of specs) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      const rng = mulberry32(0xbeef);
      const pts: Vec3[] = [];
      for (let i = 0; i < 60_000; i++) {
        const u = Math.cbrt(rng()) * marchR;
        const ct = 2 * rng() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rng();
        pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
      }
      let acc = 0;
      let iters = 0;
      const t0 = Date.now();
      for (const p of pts) {
        acc += de(p);
        iters += chainIters;
      }
      const ms = Date.now() - t0;
      console.log(
        `  ${label.padEnd(36)} ${((ms * 1000) / pts.length).toFixed(2)} us/eval  ` +
          `${(iters / pts.length).toFixed(1)} orbit iters  ` +
          `(ball ${marchR.toFixed(2)}, checksum ${acc.toFixed(3)})`,
      );
    }
  });
});
