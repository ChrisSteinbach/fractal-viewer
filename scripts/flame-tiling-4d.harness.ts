/**
 * 4D Flame slice-aware lattice proposal CDF — measurement sheet.
 *
 * QUESTION. 4D Solid's point-tiling lattice arm re-weights its per-cell
 * selection CDF by a per-cell SLICE-VISIBILITY CEILING — sampling
 * `q_k = u_k * v_k / S` (u_k = the plan's per-cell presentation ceiling
 * `plan.upper`) instead of `q_k = u_k / S`, with the deposit compensated by
 * `1/q_k` inside `visitLatticeBounded` — and measured free, unbiased, and
 * 0.64 -> 0.91 visible deposits (halved normalized L1). The open question for
 * 4D Flame asks whether the same gain shows against its 2D histogram (then
 * tone-mapped), prior to any WGSL lift. The WGSL 256 KiB cap question is a
 * LATER phase and is NOT measured here.
 *
 * LEGALITY (why this is legal in Flame when it was free in Solid).
 * `accumulateFlame4` freezes BOTH the 3D camera and the 4D rotor + slice for
 * the whole accumulation — the composed projection's sRaw row and the slice
 * weight are functions of (rotor, slice) alone, which is exactly what the
 * per-cell ceiling is a function of. A settled `setFourDView` RESTARTS the
 * accumulation (flame-worker-core.ts's retained-geometry,
 * restart-on-settled-view contract) rather than mutating a live one, so a
 * proposal built once per settled pose can never be stale mid-run. And the
 * compensation in `visitLatticeBounded` reads the proposal's OWN
 * probabilities, so the composed estimator stays unbiased for any positive
 * ceilings — the ceiling steers variance, never the mean.
 *
 * WHY minimumProduct = 0. Solid drops cells whose `u_k * v_k` falls below its
 * 1e-3 skip weight because a deposit below that bound rounds away in the
 * packed texture — the dropped cells' images are EXACTLY the deposits REF
 * itself skips, so the drop is exact against its own matching gate. Flame has
 * GHOST CONTEXT: the slice weight floors at `SLICE_GHOST_FLOOR` (0.06, never
 * 0) and the deposit visitor has NO skip gate — every emitted image deposits
 * real mass at weight >= floor * coverage > 0. Dropping any cell would
 * remove real mass and bias the estimator, so this sheet keeps ALL live
 * cells: `createLatticePointTilingProposal(plan, multipliers, 0)`.
 *
 * FIXTURE (mirrors `solid-tiling-4d.harness.ts` for comparability). The
 * `pentatope()` system lifted with `toTransform4`, symmetry {order 1, plane
 * xz}, no final transform, no schedule, no emitters, no chaos rows — all
 * ASSERTED on the prepared system, because the REF arm must replicate the
 * orbit exactly. Tiling `{kind: "lattice", cellScale: 1.6}` resolved through
 * the shipped chain resolveTiling -> chamberContentFit ->
 * poseTilingForContent -> resolvePointTilingPlan (4D) — 171 cells, asserted.
 * TWO POSES: P0 "identity" (identity rotor, sliceCenter 0) and P1
 * "w-mixing" (rotation {xw: 0.63}, sliceCenter 0.37), slice width 0.12
 * (scene.ts's FOUR_D_SLICE_WIDTH, restated — that module pulls in Three.js).
 * The view is the flame lattice view policy (flame-worker-core.ts's
 * `applyPointTilingViewPolicy` lattice branch): pivot [0,0,0,0] and
 * `invWAmp = 1/presentation.outerRadius`, asserted against the policy's own
 * expression. The projection is
 * `composeFlameProjection4(CAMERA, composeRotorProjection4(rotor, [0,0,0,0]))`
 * with CAMERA a fixed perspective pull-back (60-degree vertical fov, screen
 * scale 1/tan(30 degrees), camera at z = +40 so clipW = rotated z + 40,
 * square aspect) documented below, identical across arms and poses.
 * Attempts: 2,000,000 seeded `mulberry32(0x464c414d)` per arm (the seed is
 * chosen for no reason beyond being fixed). Histogram: 256x256, fresh per
 * arm. Color: `FourDRenderColor` "uniform" [1,1,1] — sumRGB is then exactly
 * the hits, and the hits L1 is the metric.
 *
 * ARMS (all on the SAME fixture and the same seeded orbit stream).
 * - REF: the exhaustive truth oracle. The fresh-path orbit is replicated
 *   exactly as `accumulateFlame4` runs it (seed draw `rng() - 0.5` per
 *   coordinate, WARMUP_ITERATIONS through the real non-inlined `stepOrbit4`
 *   with the same prevBase threading, then the plain loop through
 *   `stepOrbit4` + `plotPoint4` — legitimate because the fixture has no
 *   emitters/chi/schedule/final transform), and every plotted source is
 *   visited by the SHIPPED `visitPointTilingImagesExhaustive` with a visitor
 *   that replicates `accumulateFlame4`'s tiledVisitor line for line (cw gate,
 *   cx/cy projection, col/row bucket, sRaw -> s clamp,
 *   `weight = imageWeight * sliceWeight(s, center, width, SLICE_GHOST_FLOOR)`,
 *   deposit hits + sumRGB with the uniform color).
 * - A0 (shipped): `accumulateFlame4(prepared, projection, view, 256, 256,
 *   attempts, mulberry32(SEED), color, undefined x5, plan)` — a fresh
 *   histogram, so its orbit stream is REF's by construction. VERIFIED, not
 *   assumed: a tracker pass (below) must reproduce the shipped histogram
 *   BIT-IDENTICALLY, and REF's accepted-source count must equal the shipped
 *   cursor's; a divergence fails the sheet loudly.
 * - A1 (proposal): the same call plus the new `tilingProposal` tail param.
 *   multipliers[k] = the per-cell slice-visibility ceiling — the solid
 *   sheet's `latticeCeilings` adapted to flame's floor: the cell center's
 *   sRaw reads the composed projection's row S (y coefficient skipped — cell
 *   centers have y = 0; the mirror's sign flips and the |source| <= R spread
 *   are covered by `halfWidth = plan.tiling.radius * invWAmp`, row S of an
 *   SO(4) matrix being a unit vector), the interval is clamped to [-1,1], and
 *   `v_k` is 1 when it straddles the slice center else
 *   `sliceWeight(nearestEndpoint, ...)` (sliceWeight is unimodal, so the
 *   nearest endpoint is the interval max). minimumProduct MUST be 0 (see
 *   WHY above); the resulting proposal's per-mask ordinal sets are ASSERTED
 *   equal to the plan's (they must be — every u_k * v_k > 0 because the
 *   floor keeps every v_k >= 0.06).
 * - TRACKER (for A0 and A1): the same seeded orbit through the SHIPPED
 *   `visitPointTilingAttemptBounded` with the same replica visitor, asserted
 *   BIT-IDENTICAL to the shipped accumulateFlame4 histogram (hits, sumRGB,
 *   maxHits, cursor state). This is the proof that the replica visitor and
 *   the shared orbit stream are exact, and it carries the accounting the
 *   shipped call cannot expose: meanSliceWeight and the selected count
 *   (the lattice selection tests one CDF proposal per selected image, so
 *   `selected` IS the candidateTests count of the accumulation path).
 *
 * METRICS (per pose, per arm; REF is the reference for all of them).
 * - l1Raw / rmse: mass-normalized L1/RMSE of the arm's hits against REF's
 *   (`point-tiling.harness.ts`'s histogramMetric pattern: both histograms
 *   normalized to unit total mass before comparison).
 * - relMass: |total mass - REF total| / REF total — unbiasedness on the
 *   shared source set.
 * - accumulateMs: Date.now() around each accumulate call — reported as the
 *   MINIMUM over COST_REPEATS fresh repeats per arm (AMENDED 2026-09-03: a
 *   single ~1 s pair measured +-10% run to run, straddling the predeclared
 *   1.05 cost cap; the repeats are deterministic and the cap is unchanged —
 *   only the measurement was stabilized). candidateTests is reported as the
 *   tracker's `selected` (one CDF proposal per selected image); A1's
 *   lattice selection must not cost more than A0's — expected equal, since
 *   the proposal keeps every cell and only re-weights.
 * - meanSliceWeight: sum of the slice-weight factor over emitted images
 *   divided by the emitted count — the visibleFraction proxy. Emitted =
 *   every visitor invocation; images rejected by the camera/bucket gates
 *   before the slice line count 0. Tracked inside the replica visitor
 *   (REF directly; A0/A1 via their bit-identical tracker passes).
 * - Tone-mapped: `tonemapFlame` each histogram with one fixed TonemapParams
 *   (the app's shipped defaults: exposure 1, gamma 2.4, gammaThreshold
 *   DEFAULT_GAMMA_THRESHOLD, vibrancy 1 — state.ts's
 *   DEFAULT_FLAME_EXPOSURE/GAMMA/VIBRANCY restated because that module pulls
 *   in the app graph), then mass-normalized L1 on the tone-mapped RGB as a
 *   PER-CHANNEL-SUM (all width*height*3 channels pooled, alpha excluded —
 *   transparent buckets are black — both images normalized to a common total
 *   before the L1). TWO VARIANTS are reported per pose: `tonemapL1` maps
 *   each arm with its OWN maxHits (shipped-display behavior), and
 *   `tonemapL1Pinned` maps ALL THREE arms against the SAME maxHits — REF's —
 *   via `viewFlameHistogram` copies over each arm's own bucket arrays. The
 *   pinned variant is an INSTRUMENT, not a claim about shipped display: a
 *   concentration-driven maxHits shift renormalizes `tonemapFlame`'s whole
 *   `log1p(h)/log1p(maxHits)` curve and can masquerade as a structure
 *   change, so the pinned columns separate structure from that brightness
 *   renormalization. `maxHits` for REF/A0/A1 is reported per pose so the
 *   renormalization hypothesis is checkable directly.
 *
 * PREDECLARED VERDICT THRESHOLDS. Fixed here BEFORE the measured figures
 * below; a threshold failure fails the sheet loudly (that is the point):
 * - PRIMARY (the GO question): l1Raw(A1) / l1Raw(A0) at P1. GO <= 0.90;
 *   NO-GO > 0.95 (asserted); 0.90-0.95 = report as marginal.
 * - Sanity: the P0 ratio must lie in [0, 1.10] (asserted on the worsening
 *   bound; a ratio is non-negative by construction) — the proposal must not
 *   meaningfully worsen the identity pose.
 *   AMENDMENT 2026-09-03: the band was originally predeclared as
 *   [0.85, 1.10], and that lower bound was a MISDECLARATION — it
 *   contradicted the band's own stated purpose (a no-worsening guard cannot
 *   fail on improvement) and the Solid sheet's precedent, where the P0
 *   lattice ratio ALSO improved (l1Fine 0.0796 -> 0.0470 = 0.59x). The
 *   measured P0 ratio 0.6346 (kept visible in the verdict below) exposed
 *   the misdeclaration; the load-bearing direction (<= 1.10) is unchanged.
 * - Unbiasedness: |relMass(A1)| <= 1e-3 at both poses (asserted) — with
 *   minimumProduct 0 this is expected at Monte-Carlo level, modulo the
 *   measure-zero |source| > R carrier violations REF counts (reported).
 * - Cost: accumulateMs(A1) <= 1.05 x accumulateMs(A0) at both poses
 *   (asserted; accumulateMs is the min-of-COST_REPEATS measurement — see
 *   the 2026-09-03 amendment in METRICS).
 * - Band: l1Raw of every arm vs REF <= 0.30 (asserted) — the point-tiling
 *   harness band.
 * - Tone-mapped L1 (both variants) and meanSliceWeight: reported, NOT
 *   gating.
 * - Convergence sweep (0.25x/0.5x/1x/2x source budgets, both arms, both
 *   poses, compared against the SAME full-budget exhaustive REF the main
 *   matrix built — the object both arms converge to; tonemap rows report
 *   BOTH the own-maxHits and the pinned variants, and the zero-noise scale
 *   control accompanies the 2x rows): REPORT-ONLY since the 2026-09-03
 *   supersession — its two former load-bearing checks (the cross-budget
 *   raw doubling check A1@1x <= A0@2x, which missed at P1 by 1.75%, and
 *   the cross-budget pinned display check A1@2x <= A0@1x at P1, which the
 *   scale control proved UNSATISFIABLE — the zero-noise floor 0.0095
 *   exceeds the 0.0073 target) are REPLACED by the decomposition test's
 *   same-budget checks below.
 * - Class decomposition / ship question (the decisive instrument;
 *   asserted). Deposits are binned at deposit time by the SLICE weight
 *   each emitted image applied: VISIBLE = slice >= 0.5, GHOST = slice <
 *   0.1 (the [0.06, 0.1) floor tail), MID = [0.1, 0.5) accounted as
 *   full - visible - ghost. Applied to A0, A1 and REF at 1x (both poses)
 *   and 2x (P1 — the same-budget 4M exhaustive REF), every class pair
 *   normalized by its own REF-class mass. ASSERTED at P1 1x and 2x:
 *   l1RawVisible(A1) <= l1RawVisible(A0) — the visible SUBJECT must
 *   improve or tie. RECORDED (not asserted): whether
 *   tonemapGhost(A1) > tonemapGhost(A0) (expected worsens) — visible-raw
 *   improves AND ghost-tonemap worsens together = "the regression is
 *   ghost-confined" (defensible ship); visible-class regression = NO-GO.
 *   The P0 2x cell anchors its class RAW on the 1x REF (cross-budget raw
 *   is scale-clean; its class tonemaps are omitted — no same-budget P0
 *   2x REF exists).
 * - Same-budget ladder at P1 (1x from the main matrix, 2x from the new 4M
 *   exhaustive REF): A0/A1 full l1Raw and tonemapL1 vs their SAME-budget
 *   REF, with the A1/A0 tonemapL1 ratio reported per rung — the 1x row
 *   decides the direction, the 2x rung establishes whether the gap closes
 *   with budget. REPORT-ONLY (assert nothing beyond recording). The
 *   brief's 4x (8M) rung was DROPPED for runtime: an 8M exhaustive pass
 *   alone would cost ~4x the entire 2M sheet.
 *
 * MEASURED VERDICT (Node 22, 2026-09-03, the production command below;
 * FLAME4_ATTEMPTS=2000000, 305 s total; the final pass adds the class-decomposition test with a new 4M exhaustive REF at P1 — 515969358 emitted images, 122.6 s). Fixture: R = 1.0317142958214038,
 * 171 lattice cells (h = 1.65074, outer = 10.31714), acceptance 100% at
 * both poses (2,000,000 accepted of 2,000,000 attempts), REF emitted
 * 257,982,275 images (129.0 per accepted source — the solid sheet's
 * 128.995 on the same plan), max |source| 0.999162 <= R, carrier
 * violations 0. sum(u_k) = 128.7058; sum(u_k*v_k) = 46.5565 (P0) /
 * 45.2220 (P1) — the proposal concentrates on ~36% of the plan's ceiling
 * mass at either pose.
 *
 * PRIMARY (the GO question), l1Raw(A1)/l1Raw(A0) at P1: 0.0154/0.0213 =
 * 0.7213 -> GO (<= 0.90). At P0: 0.0135/0.0213 = 0.6346.
 *
 * THE P0 BAND MISDECLARATION, AND ITS AMENDMENT. The band was originally
 * predeclared as [0.85, 1.10], and the measured P0 ratio 0.6346 (kept
 * visible here) FAILED its lower bound — ON THE IMPROVEMENT SIDE: the
 * proposal nearly HALVES the raw-histogram error at the identity pose too.
 * That failure exposed the misdeclaration amended 2026-09-03 (threshold
 * note above): the lower bound contradicted the band's own no-worsening
 * purpose and the Solid sheet's precedent, where the P0 lattice ratio ALSO
 * improved (l1Fine 0.0796 -> 0.0470 = 0.59x). Under the amended [0, 1.10]
 * band the sanity check passes. Unlike Solid — whose P0 was already 0.91
 * visible so the proposal had little to fix there — Flame's ghost floor
 * (0.06) and gate-free deposit mean A0's sampling variance carries the
 * lattice's full ghost mass even at P0: only the kw = 0 cells' images sit
 * near the slice, every |kw| >= 1 cell's images fall into the floor tail,
 * so ceiling-weighted selection buys variance reduction at BOTH poses.
 * meanSliceWeight (the visibleFraction proxy) rises 0.2982 -> 0.6871 at P0
 * and 0.2414 -> 0.5329 at P1.
 *
 * UNBIASEDNESS: relMass(A1) 5.3e-5 (P0) / 6.7e-5 (P1) at 2M attempts and
 * 1.8e-4 / 3.9e-4 at the 250K attempts/8 leg — inside the 1e-3 ceiling
 * everywhere (A0: 3.2e-5 / 1.4e-5 at 2M). minimumProduct = 0 kept all 171
 * cells; the proposal's per-mask ordinal sets equal the plan's at both
 * poses.
 *
 * COST: accumulateMs(A1)/A0 = 935/900 = 1.039 at P0 and 905/927 = 0.976 at
 * P1 (min-of-5 per the 2026-09-03 instrument amendment) — inside the 1.05
 * cap. The amendment was forced by measurement, not by the proposal: three
 * earlier single-shot runs measured P0 1.034/1.044/0.913 and P1
 * 0.965/0.884/1.095 — the +-10% wall-clock spread straddled the cap while
 * every deterministic figure stayed identical, and A1's per-selection work
 * is structurally identical to A0's (same selected counts, same CDF
 * shape). selected (== the accumulation path's candidateTests: one CDF
 * proposal per selected image) is 2,000,000 for BOTH arms at BOTH poses.
 *
 * TONE-MAPPED (reported, not gating; both variants): with each arm's OWN
 * maxHits (shipped-display behavior), tonemap L1 improves at P0 (A1 0.0113
 * vs A0 0.0151) but WORSENS at P1 (A1 0.0116 vs A0 0.0074). The PINNED
 * instrument (all arms tonemapped against REF's maxHits) answers WHY — the
 * renormalization hypothesis is REFUTED: maxHits barely moves (P0:
 * REF 628844, A0 635319, A1 622739; P1: REF 370086, A0 375153, A1
 * 370716 — all within ~1.5% of REF, and log1p divides that again), and the
 * pinned L1s differ from the own-maxHits L1s by at most one digit in the
 * third decimal (P0 0.0151 / 0.0113 under BOTH variants; P1 own 0.0074 /
 * 0.0116 vs pinned 0.0073 / 0.0116). The P1 tonemapped worsening is
 * therefore
 * REAL STRUCTURE, not a brightness renormalization artifact: the
 * log-density curve amplifies the relative error of the faint ghost
 * buckets A1 now samples more coarsely. A GO on the raw histogram does not
 * automatically carry to the tone-mapped image at the adversarial pose —
 * that is the number any WGSL-phase decision should weigh.
 *
 * CONVERGENCE SWEEP (0.25x/0.5x/1x/2x = 500K/1M/2M/4M attempts, every row
 * against the main run's full-budget exhaustive REF — the truth both arms
 * converge to; tonemapL1 = own maxHits, tonemapL1Pinned = REF's;
 * accumulateMs single-shot, report-only; ladders are 0.25x -> 2x):
 * - P0 A0: l1Raw 0.0451/0.0304/0.0213/0.0146; tonemap 0.0507/0.0307/
 *   0.0151/0.0125; pinned 0.0508/0.0307/0.0151/0.0129.
 * - P0 A1: l1Raw 0.0260/0.0182/0.0135/0.0097; tonemap 0.0418/0.0231/
 *   0.0113/0.0116; pinned 0.0418/0.0232/0.0113/0.0120.
 * - P1 A0: l1Raw 0.0394/0.0310/0.0213/0.0151; tonemap 0.0279/0.0160/
 *   0.0074/0.0105; pinned 0.0280/0.0159/0.0073/0.0106.
 * - P1 A1: l1Raw 0.0299/0.0222/0.0154/0.0107; tonemap 0.0356/0.0217/
 *   0.0116/0.0112; pinned 0.0356/0.0217/0.0116/0.0116.
 *
 * SWEEP READING. RAW: A1 dominates every same-budget row at both poses,
 * and the predeclared raw check (A1@1x <= A0@2x) PASSES at P0 — 0.0135 vs
 * 0.0146, roughly 2.5x of A0's budget bought — but FAILS at P1 by 1.75%
 * (0.015384 vs 0.015119): the proposal buys about 1.9x of budget there,
 * not a clean doubling. DISPLAY: the zero-noise SCALE CONTROL — REF's own
 * histogram doubled, i.e. a perfect 4M histogram of the same truth —
 * scores 0.0101/0.0101 (P0) and 0.0094/0.0095 (P1) against REF's tonemap,
 * and every 2x row sits at or barely above that floor (0.0105-0.0129
 * pinned): `tonemapFlame`'s log1p density curve is not scale-invariant,
 * so a 2x-budget tonemap compared against a 1x-budget target measures the
 * curve's reshaping, not the estimator. The predeclared load-bearing
 * display check (A1@2x pinned <= A0@1x pinned at P1) therefore FAILED
 * (0.01157 > 0.00728) — the NO-GO signal is RECORDED as predeclared — and
 * the control proves it was UNSATISFIABLE as instrumented: no estimator
 * whatsoever, however good, could have scored below the 0.0095 floor,
 * which already exceeds the 0.0073 target. The decidable display rows are
 * the SAME-budget ones: at P0 the tonemapped crossover sits at or before
 * 1x (A1@1x 0.0113 beats A0@1x 0.0151 and even A0@2x 0.0129); at P1 the
 * proposal is tonemap-unfavorable at equal budget (A1@1x 0.0116 vs A0@1x
 * 0.0073) and never reaches A0@1x display quality anywhere in the sweep.
 * SHIP IMPLICATION: raw convergence is a GO at both poses (2.5x / 1.9x of
 * the shipped arm's budget bought); tonemapped display is a GO at P0 but
 * the open risk at P1 — the unconfounded rows refute it at equal budget,
 * and deciding whether a 2x budget closes that gap requires a same-budget
 * (4M) exhaustive REF, which this sheet deliberately did not build.
 * (SUPERSEDED 2026-09-03: the same-budget 4M REF was subsequently built
 * and the question answered — see CLASS DECOMPOSITION below.)
 *
 * CLASS DECOMPOSITION (the decisive instrument; visible = slice >= 0.5,
 * ghost = slice < 0.1, mid = [0.1, 0.5) accounted as full - visible -
 * ghost; every class pair normalized by its own REF-class mass; class
 * tonemaps anchor each class to its OWN class maxHits — an instrument,
 * not shipped display — while tonemapL1Full stays the shipped-behavior
 * metric; same-budget REFs: 1x both poses, 2x P1 via a NEW 4M exhaustive
 * pass — 515,969,358 emitted images, 100% acceptance, 122.6 s, maxHits
 * 740161; the brief's 4x/8M rung DROPPED for runtime, see the threshold
 * note):
 * - P0 1x:  visible raw A0 0.0262 / A1 0.0158; ghost raw A0 0.0159 /
 *   A1 0.0268; visible tonemap A0 0.0200 / A1 0.0112; ghost tonemap
 *   A0 0.0088 / A1 0.0219. REF class masses: visible 4.575e7 (81.0%),
 *   ghost 7.635e6 (13.5%), mid 5.5%.
 * - P0 2x (cross-budget 1x REF anchor — scale-clean RAW only, class
 *   tonemaps omitted): visible raw A0 0.0182 / A1 0.0111; ghost raw
 *   A0 0.0116 / A1 0.0177.
 * - P1 1x:  visible raw A0 0.0259 / A1 0.0162 (SUBJECT IMPROVES);
 *   ghost raw A0 0.0209 / A1 0.0418 (2.0x worse); visible tonemap
 *   A0 0.0280 / A1 0.0106 (improves); ghost tonemap A0 0.0088 /
 *   A1 0.0213 (2.4x worse). REF masses: visible 3.134e7 (67.7%),
 *   ghost 6.892e6 (14.9%), mid 17.5%.
 * - P1 2x:  visible raw A0 0.0183 / A1 0.0113 (SUBJECT IMPROVES);
 *   ghost raw A0 0.0142 / A1 0.0302 (2.1x worse); visible tonemap
 *   A0 0.0125 / A1 0.0103 (improves); ghost tonemap A0 0.0055 /
 *   A1 0.0171 (3.1x worse).
 *
 * EXTENDED SAME-BUDGET LADDER (P1, full-histogram shipped tonemap vs each
 * rung's own exhaustive REF): 1x — A0 0.0074, A1 0.0116, ratio 1.5625;
 * 2x — A0 0.0039, A1 0.0095, ratio 2.4585. THE DISPLAY GAP DOES NOT CLOSE
 * WITH BUDGET — the ratio widens, because the ghost tail is where A1's
 * variance concentration lives by construction (q_k proportional to the
 * slice ceiling), not a sampling deficit more budget would fix.
 *
 * FINAL READING. The P1 display regression is GHOST-CONFINED, decisively
 * and at both budgets: the asserted ship-question check passes (visible
 * raw improves at P1 1x and 2x), the visible class also improves on its
 * own class tonemap, and every bit of the full-image regression lives in
 * the ghost class, where A1's compensated concentration doubles-to-triples
 * the shape error and the ghost tonemap.
 *
 * SHIP DECISION: REFUSED (2026-09-03). AMENDMENT to the predeclared gate
 * structure, recorded here rather than silently re-weighted: the original
 * gates made l1Raw PRIMARY (by analogy to the Solid sheet) and the
 * tone-mapped L1 "reported, not gating", and the ship-question rule read
 * "ghost-confined regression = defensible ship". Both predeclared rules
 * were satisfied as the letter stands. But the analogy was wrong at the
 * root: the Solid sheet's primary metric WAS its display (a density
 * volume), and this project's rule is that the metric should be the
 * display — for Flame that is the TONE-MAPPED histogram, the very metric
 * the bead names. On it the proposal regresses at the off-center pose
 * (1.56x at 1x, 2.46x at 2x, same-budget exhaustive REFs) and the gap
 * does not close with budget, because the concentration is structural:
 * `tonemapFlame`'s log1p curve compresses exactly the subject error the
 * proposal buys (bright buckets) while preserving the ghost error it
 * pays with (dim buckets keep relative error). The decomposition turns
 * that into a mechanism rather than a metric preference: the cost is
 * borne ENTIRELY by the ghost context — a region flame's
 * `SLICE_GHOST_FLOOR` (0.06) authors into existence (14.9% of display
 * mass at P1) and Solid's floor-0 display does not have at all, which is
 * why the same ceiling was free there and display-visible here. Shipping
 * would regress the shipped picture, by the only display instrument
 * available, in the feature's own target regime, permanently. The
 * considered alternative — a softened ceiling (max(v_k, c)) trading
 * subject gain for ghost fidelity — is REFUSED without measurement: it
 * would mint a second definition of "the slice-aware ceiling" diverging
 * from Solid's shipped one, an unprincipled tuning constant under this
 * project's one-definition discipline. Reopening is cheap by design:
 * the `accumulateFlame4` `tilingProposal` tail param SHIPS as this
 * sheet's instrument (production-dead by this verdict — no renderer
 * passes one — the `qjulia-de.ts` stance), legacy-silent and tested, so
 * a future perceptual instrument or a tonemap that stops compressing
 * subject error re-runs this sheet through the production entry.
 *
 * THE BEAD'S SECOND QUESTION — the WGSL 256 KiB plan cap — is answered
 * by arithmetic (no WGSL was built; the ship refusal precedes it): YES,
 * with wide margin at authored scales. The worst legal lattice plan
 * (cellScale 1, 739 cells) is 34.7 KB CPU / ~66 KB binding-7 tail; a
 * second, same-shape proposal CDF (same per-mask ordinal sets, same
 * 6-float records) adds ~50 KB there and ~30 KB at the shipped cellScale
 * range's 365-cell maximum — totals of ~122 KB and ~62 KB against the
 * 256 KiB `POINT_TILING_PLAN_MEMORY_CAP_BYTES` allowance (the packer
 * would have to COUNT the proposal's bytes, which today it does not) and
 * far under `POINT_TILING_GPU_AUX_MAX_BYTES`. One standing hazard for
 * any future lift: `POINT_TILING_GPU_MAX_SPLAT_WEIGHT`'s lattice bound
 * (< 740, thrown in `packGpuPointTiling`) derives from sum(u_k) <= 739;
 * a proposal's per-splat ceiling is S/v_min ~ 16.7 x S (up to ~12,300 at
 * the extreme), so the bound must be re-derived from the proposal's own
 * quantized masses — the fixed-point weight scale itself is safe
 * (12,317 x 256 << 2^32).
 *
 * VERDICT (supersedes the predeclared-rules GO above; see the SHIP
 * DECISION amendment): REFUSED for 4D Flame on the shipped tone-mapped
 * display. The accumulator gain is real and recorded — raw L1 0.63x (P0)
 * / 0.72x (P1), unbiased (relMass <= 6.7e-5 at 2M attempts; <= 3.9e-4 at
 * 250K), cost-free (min-of-5 ratios 1.039 / 0.976, identical selected
 * counts), zero carrier violations — and P0 passes the amended [0, 1.10]
 * sanity band at 0.6346, better than the misdeclared original floor
 * allowed for. The class decomposition settles the display question:
 * the P1 regression is GHOST-CONFINED (the visible subject improves at
 * P1 1x and 2x on the raw metric AND on its own class tonemap; the ghost
 * class carries the whole regression), the shipped full-histogram
 * display gap does not close with budget (same-budget ratio 1.5625 ->
 * 2.4585), and the ghost class is flame-authored mass Solid's display
 * lacks — the reason the Solid verdict and this one legitimately
 * diverge. Both tracker passes replayed their shipped arms
 * BIT-IDENTICALLY (hits, sumRGB, maxHits, cursor state), so the shared
 * orbit stream and the replica visitor are exact.
 *
 * Run (the recorded numbers):
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/flame-tiling-4d.harness.ts
 *
 * Env knobs (defaults shown):
 *   FLAME4_ATTEMPTS=2000000
 */

import { rotationMatrix4, toTransform4 } from "../src/fractal/affine4";
import { WARMUP_ITERATIONS } from "../src/fractal/chaos-game";
import {
  prepareChaosGame4,
  plotPoint4,
  stepOrbit4,
} from "../src/fractal/chaos-game-4d";
import {
  chamberContentFit,
  poseTilingForContent,
} from "../src/fractal/chamber-content";
import {
  DEFAULT_GAMMA_THRESHOLD,
  createFlameHistogram,
  tonemapFlame,
  viewFlameHistogram,
} from "../src/fractal/flame";
import type { FlameHistogram, Mat4 } from "../src/fractal/flame";
import { accumulateFlame4 } from "../src/fractal/flame-4d";
import {
  createLatticePointTilingProposal,
  createPointTilingCursorState,
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  resolvePointTilingPlan,
  visitPointTilingAttemptBounded,
  visitPointTilingImagesExhaustive,
  type LatticePointTilingPlan,
  type LatticePointTilingProposal,
  type PointTilingImageVisitor,
} from "../src/fractal/point-tiling";
import { pentatope } from "../src/fractal/presets";
import {
  composeFlameProjection4,
  composeRotorProjection4,
  sliceWeight,
  SLICE_GHOST_FLOOR,
  type FourDView,
} from "../src/fractal/project4";
import { mulberry32 } from "../src/fractal/rng";
import { surfaceOriginVisibleRadius } from "../src/fractal/surface-de";
import { buildSurfaceDE4 } from "../src/fractal/surface-de-4d";
import { resolveTiling, type LatticeTilingSpec } from "../src/fractal/tiling";
import type { SymmetryParams } from "../src/fractal/types";

// ------------------------------------------------------- predeclared limits

/** PRIMARY (GO question) at P1: A1's raw L1 at or below this of A0's is GO. */
const GO_L1_RATIO = 0.9;
/** PRIMARY (NO-GO) at P1: above this of A0's, the proposal is refused. */
const NOGO_L1_RATIO = 0.95;
/** Sanity band for the P0 ratio, predeclared as [0, 1.10] after the
 * 2026-09-03 amendment (see the threshold note in the header): a ratio is
 * non-negative by construction, so the load-bearing direction is the
 * worsening bound — the proposal must not worsen the identity pose
 * meaningfully. */
const P0_RATIO_MAX = 1.1;
/** Unbiasedness: |relMass(A1)| ceiling at both poses. */
const UNBIAS_ABS_TOLERANCE = 1e-3;
/** Cost: A1 may not cost more than 1.05x A0's accumulate time. */
const COST_FACTOR = 1.05;
/**
 * Cost measurement repeats (AMENDED 2026-09-03). A single ~1 s wall-clock
 * accumulate pair measures +-10% run to run — observed P1 cost ratios
 * 0.884 / 0.965 / 1.095 across three full runs, straddling the predeclared
 * 1.05 cap — which swamps a 5% gate. The cap is UNCHANGED; only its
 * measurement is stabilized: JIT compilation, GC and scheduler noise only
 * ever ADD time, so the MINIMUM over COST_REPEATS fresh repeats is the
 * robust estimator of each arm's steady-state cost (the repeats are
 * deterministic — same seed, bit-identical histograms — so they measure
 * the same work K times). The reported accumulateMs is that minimum.
 */
const COST_REPEATS = 5;
/**
 * Class-split thresholds on the SLICE weight a deposit applied (the ghost
 * floor is SLICE_GHOST_FLOOR = 0.06, so the ghost class is the
 * [0.06, 0.1) floor tail and the visible class is the [0.5, 1] core).
 * Deposits with slice in [0.1, 0.5) form the MID class, accounted as
 * full - visible - ghost — never accumulated separately.
 */
const VISIBLE_CLASS_MIN = 0.5;
const GHOST_CLASS_MAX = 0.1;
/** Band: every arm's mass-normalized L1 against REF. */
const MAX_NORMALIZED_L1 = 0.3;

// ------------------------------------------------------------ frozen policy

/** `scene.ts`'s FOUR_D_SLICE_WIDTH, restated rather than imported (that
 * module pulls in Three.js). */
const SLICE_WIDTH = 0.12;
/** The adversarial pose the point-tiling and solid-tiling sheets pinned. */
const POSE1_XW_ANGLE = 0.63;
const POSE1_SLICE_CENTER = 0.37;
const SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };
const LATTICE_SPEC: LatticeTilingSpec = { kind: "lattice", cellScale: 1.6 };
/** The solid sheet measured 171 live cells for this exact fixture. */
const EXPECTED_LATTICE_CELLS = 171;
const HIST = 256;
/** Orbit seed 0x464c414d ("FLAM" in ASCII) — fixed for reproducibility, no
 * other significance. Every arm and the trackers run mulberry32(ORBIT_SEED). */
const ORBIT_SEED = 0x464c414d;
/** The fixture pins FourDRenderColor "uniform" with the trivial color, so
 * sumRGB is exactly hits and the hits L1 is the whole story. */
const UNIFORM_COLOR = { kind: "uniform", color: [1, 1, 1] } as {
  kind: "uniform";
  color: [number, number, number];
};
/** The app's shipped flame tonemap defaults (state.ts's
 * DEFAULT_FLAME_EXPOSURE/GAMMA/VIBRANCY restated — that module pulls in the
 * app graph) with flame.ts's own DEFAULT_GAMMA_THRESHOLD. */
const TONEMAP = {
  exposure: 1,
  gamma: 2.4,
  gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  vibrancy: 1,
};

/**
 * The frozen camera, identical across arms and poses: a 60-degree vertical
 * fov (screen scale 1/tan(30 degrees) = 1.7320508) pulled back to z = +40
 * (row 3 is clip-W = rotated z + 40), square aspect for the 256x256
 * histogram. It frames the whole 10R lattice carrier: the nearest carrier
 * face (z = +10R, clipW ~ 29.7) fills ~0.60 NDC, the far face ~0.36.
 */
// prettier-ignore
const CAMERA: Mat4 = [
  1.7320508, 0, 0, 0,
  0, 1.7320508, 0, 0,
  0, 0, 1, 0,
  0, 0, 1, 40,
];

// ------------------------------------------------------------------- knobs

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer, not ${raw}`);
  }
  return value;
}

const ATTEMPTS = positiveInt("FLAME4_ATTEMPTS", 2_000_000);

// ---------------------------------------------------------------- fixture

const TRANSFORMS = pentatope();
const TRANSFORMS4 = TRANSFORMS.map(toTransform4);
const SURFACE_DE4 = buildSurfaceDE4(TRANSFORMS, null, SYMMETRY, {});
const R = surfaceOriginVisibleRadius(SURFACE_DE4);
const PREPARED = prepareChaosGame4(TRANSFORMS4, null, SYMMETRY, null);

const RAW_TILING = resolveTiling(LATTICE_SPEC, R);
if (!RAW_TILING) throw new Error("lattice tiling did not resolve");
const FIT = chamberContentFit(
  TRANSFORMS,
  null,
  RAW_TILING,
  true,
  SYMMETRY,
  null,
);
if (!FIT) throw new Error("lattice content fit returned null");
const RESOLVED = poseTilingForContent(RAW_TILING, FIT);
const resolvedPlan = resolvePointTilingPlan(RESOLVED, 4);
if (!resolvedPlan)
  throw new Error("no point tiling plan for the lattice fixture");
if (resolvedPlan.kind !== "lattice") {
  throw new Error("fixture plan is not a lattice");
}
const PLAN: LatticePointTilingPlan = resolvedPlan;

interface Pose {
  label: string;
  rotor: number[];
  sliceCenter: number;
  rotorProj: Float64Array;
  projection: Float64Array;
  view: FourDView;
  multipliers: Float64Array;
  proposal: LatticePointTilingProposal;
}

/**
 * The per-cell slice-visibility CEILING, computed ONCE per (plan, pose) —
 * `solid-tiling-4d.harness.ts`'s `latticeCeilings` adapted to flame's ghost
 * floor. A cell k's image is `T_k + D_k*source` with
 * `T_k = (2h*kx, 0, 2h*kz, 2h*kw)` and `D_k = diag(+/-1, +1, +/-1, +/-1)`;
 * the composed projection's row S is the rotor's row 3 verbatim (a UNIT
 * vector, constant zero at the origin pivot), so
 * `s in [s_k - R*invWAmp, s_k + R*invWAmp]` with
 * `s_k = (rowS . T_k) * invWAmp`, and after the clamp to [-1,1] the ceiling
 * is 1 when the interval straddles the slice center and the endpoint nearer
 * the center otherwise (sliceWeight is unimodal at `center`).
 *
 * Unlike the solid sheet, NOTHING is dropped: flame's slice weight floors at
 * SLICE_GHOST_FLOOR and its deposit visitor has no skip gate, so every
 * retained cell keeps real mass and `minimumProduct` must be 0. Every
 * multiplier is therefore finite and >= the ghost floor.
 */
function sliceCeilings(pose: {
  projection: Float64Array;
  view: FourDView;
}): Float64Array {
  const multipliers = new Float64Array(PLAN.upper.length);
  const h = PLAN.tiling.h;
  const repeated = PLAN.repeatedAxes;
  const halfWidth = PLAN.tiling.radius * pose.view.invWAmp;
  for (let cell = 0; cell < PLAN.upper.length; cell++) {
    const kx = PLAN.cells[cell * repeated];
    const kz = PLAN.cells[cell * repeated + 1];
    const kw = PLAN.cells[cell * repeated + 2];
    const sRawCenter =
      pose.projection[15] * (2 * h * kx) +
      pose.projection[17] * (2 * h * kz) +
      pose.projection[18] * (2 * h * kw) +
      pose.projection[19];
    const center = sRawCenter * pose.view.invWAmp;
    let lo = center - halfWidth;
    let hi = center + halfWidth;
    lo = lo < -1 ? -1 : lo > 1 ? 1 : lo;
    hi = hi < -1 ? -1 : hi > 1 ? 1 : hi;
    let ceiling: number;
    if (pose.view.sliceCenter >= lo && pose.view.sliceCenter <= hi) {
      ceiling = 1;
    } else {
      const nearest =
        Math.abs(lo - pose.view.sliceCenter) <
        Math.abs(hi - pose.view.sliceCenter)
          ? lo
          : hi;
      ceiling = sliceWeight(
        nearest,
        pose.view.sliceCenter,
        pose.view.sliceWidth,
        SLICE_GHOST_FLOOR,
      );
    }
    multipliers[cell] = ceiling;
  }
  return multipliers;
}

function buildPose(label: string, rotor: number[], sliceCenter: number): Pose {
  const rotorProj = composeRotorProjection4(rotor, [0, 0, 0, 0]);
  const projection = composeFlameProjection4(CAMERA, rotorProj);
  // flame-worker-core.ts's applyPointTilingViewPolicy lattice branch: the
  // tiled pivot is the origin and the carrier is a rotation-invariant ball,
  // so invWAmp is 1/outerRadius at every rotor pose.
  const view: FourDView = {
    invWAmp: 1 / Math.max(PLAN.tiling.presentation.outerRadius, 1e-6),
    sliceOn: true,
    sliceCenter,
    sliceWidth: SLICE_WIDTH,
    sliceRelativeColor: false,
  };
  const multipliers = sliceCeilings({ projection, view });
  const proposal = createLatticePointTilingProposal(PLAN, multipliers, 0);
  return {
    label,
    rotor,
    sliceCenter,
    rotorProj,
    projection,
    view,
    multipliers,
    proposal,
  };
}

// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const POSES: Pose[] = [
  buildPose("P0 identity", IDENTITY_ROTOR, 0),
  buildPose(
    "P1 w-mixing",
    rotationMatrix4({ xw: POSE1_XW_ANGLE }),
    POSE1_SLICE_CENTER,
  ),
];

// ------------------------------------------------------------------- orbit

/**
 * The fresh-path orbit exactly as `accumulateFlame4` runs it: seed drawn as
 * `rng() - 0.5` per coordinate, WARMUP_ITERATIONS unrecorded steps through
 * the real non-inlined `stepOrbit4`, then the recorded loop. prevBase is
 * threaded exactly like the accumulator's warmup/hot loop (inert here — the
 * fixture is chi-free, asserted — but threaded so the replication is exact
 * by construction, not by omission).
 */
function runOrbit(
  seed: number,
  iterations: number,
  plot: (px: number, py: number, pz: number, pw: number) => void,
): void {
  const rng = mulberry32(seed);
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  let w = rng() - 0.5;
  let prevBase = -1;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const step = stepOrbit4(PREPARED, x, y, z, w, rng, rng, prevBase);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    prevBase = step.escaped ? -1 : step.index;
  }
  for (let i = 0; i < iterations; i++) {
    const step = stepOrbit4(PREPARED, x, y, z, w, rng, rng, prevBase);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    prevBase = step.escaped ? -1 : step.index;
    const p = plotPoint4(PREPARED, x, y, z, w, rng);
    plot(p[0], p[1], p[2], p[3]);
  }
}

// ------------------------------------------------------------- run stats

interface DepositStats {
  attempts: number;
  accepted: number;
  selected: number;
  emitted: number;
  deposits: number;
  /** Sum of the slice-weight factor over images reaching the slice line. */
  sliceSum: number;
  /** Emitted images (every visitor invocation). */
  sliceCount: number;
  maxSource: number;
  sourceViolations: number;
  accumulateMs: number;
}

function emptyStats(): DepositStats {
  return {
    attempts: 0,
    accepted: 0,
    selected: 0,
    emitted: 0,
    deposits: 0,
    sliceSum: 0,
    sliceCount: 0,
    maxSource: 0,
    sourceViolations: 0,
    accumulateMs: 0,
  };
}

/**
 * The class-split hit histograms: the same 256x256 buckets as the full
 * histogram, accumulating only the deposits whose slice weight fell in the
 * class. The fixture's uniform color makes each class's sumRGB exactly its
 * own hits lane-replicated (`classSumRGB`), so a class histogram is
 * tonemappable without a second color accumulation.
 */
interface ClassHits {
  visible: Float64Array;
  ghost: Float64Array;
}

function emptyClasses(): ClassHits {
  return {
    visible: new Float64Array(HIST * HIST),
    ghost: new Float64Array(HIST * HIST),
  };
}

function classMaxHits(hits: Float64Array): number {
  let max = 0;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] > max) max = hits[i];
  }
  return max;
}

/** With uniform color [1,1,1] a class's sumRGB IS its hits, lane for lane. */
function classSumRGB(classHits: Float64Array): Float64Array {
  const rgb = new Float64Array(classHits.length * 3);
  for (let i = 0; i < classHits.length; i++) {
    rgb[i * 3] = classHits[i];
    rgb[i * 3 + 1] = classHits[i];
    rgb[i * 3 + 2] = classHits[i];
  }
  return rgb;
}

/**
 * The CLASS tonemap instrument: tonemap one class histogram with ITS OWN
 * class maxHits (the log curve anchored to that class's own dynamic range).
 * This is an instrument for locating WHERE a display regression lives, not
 * a shipped-display claim — the full histogram's own-maxHits tonemap stays
 * the shipped-behavior metric.
 */
function tonemapClass(hits: Float64Array): Uint8ClampedArray {
  return tonemapFlame(
    viewFlameHistogram(
      HIST,
      HIST,
      hits,
      classSumRGB(hits),
      Math.max(classMaxHits(hits), 1e-300),
    ),
    TONEMAP,
  );
}

/**
 * `accumulateFlame4`'s tiledVisitor (flame-4d.ts, the `tilingPlan !==
 * undefined` arm) replicated line for line, for the fixture's pinned state:
 * uniform color (the source lanes are the constant [1,1,1] and the wRamp
 * branch is dead), sliceOn true. Slice/bucket accounting rides alongside so
 * the tracker passes can report what the shipped call cannot expose.
 *
 * When `classes` is given, every deposit is ALSO binned by the slice weight
 * it applied — the class split is on the SLICE factor alone, never on the
 * combined imageWeight * slice: visible (slice >= VISIBLE_CLASS_MIN) and
 * ghost (slice < GHOST_CLASS_MAX) accumulate their deposit weight into
 * their own hit histograms; mid [0.1, 0.5) is never accumulated and is
 * accounted as full - visible - ghost. The full histogram's arithmetic is
 * untouched, so the bit-identity proof is unaffected.
 */
function makeDepositVisitor(
  pose: Pose,
  hist: FlameHistogram,
  stats: DepositStats,
  classes?: ClassHits,
): PointTilingImageVisitor {
  const width = hist.width;
  const height = hist.height;
  const rx0 = pose.projection[0];
  const rx1 = pose.projection[1];
  const rx2 = pose.projection[2];
  const rx3 = pose.projection[3];
  const rx4 = pose.projection[4];
  const ry0 = pose.projection[5];
  const ry1 = pose.projection[6];
  const ry2 = pose.projection[7];
  const ry3 = pose.projection[8];
  const ry4 = pose.projection[9];
  const rw0 = pose.projection[10];
  const rw1 = pose.projection[11];
  const rw2 = pose.projection[12];
  const rw3 = pose.projection[13];
  const rw4 = pose.projection[14];
  const rs0 = pose.projection[15];
  const rs1 = pose.projection[16];
  const rs2 = pose.projection[17];
  const rs3 = pose.projection[18];
  const rs4 = pose.projection[19];
  const { invWAmp, sliceOn, sliceCenter, sliceWidth } = pose.view;
  return (imageX, imageY, imageZ, imageW, imageWeight) => {
    stats.emitted++;
    const cw = rw0 * imageX + rw1 * imageY + rw2 * imageZ + rw3 * imageW + rw4;
    if (cw <= 0) return;
    const cx = rx0 * imageX + rx1 * imageY + rx2 * imageZ + rx3 * imageW + rx4;
    const cy = ry0 * imageX + ry1 * imageY + ry2 * imageZ + ry3 * imageW + ry4;
    const col = Math.floor((cx / cw + 1) * 0.5 * width);
    const row = Math.floor((1 - cy / cw) * 0.5 * height);
    if (col < 0 || col >= width || row < 0 || row >= height) return;

    const sRaw =
      rs0 * imageX + rs1 * imageY + rs2 * imageZ + rs3 * imageW + rs4;
    const sScaled = sRaw * invWAmp;
    const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
    const slice = sliceOn
      ? sliceWeight(s, sliceCenter, sliceWidth, SLICE_GHOST_FLOOR)
      : 1;
    const weight = imageWeight * slice;
    stats.sliceSum += slice;
    stats.sliceCount++;

    const bucket = row * width + col;
    const hit = (hist.hits[bucket] += weight);
    if (hit > hist.maxHits) hist.maxHits = hit;
    const offset = bucket * 3;
    // Uniform color [1,1,1]: sumRGB tracks hits lane for lane.
    hist.sumRGB[offset] += weight;
    hist.sumRGB[offset + 1] += weight;
    hist.sumRGB[offset + 2] += weight;
    if (classes) {
      if (slice >= VISIBLE_CLASS_MIN) classes.visible[bucket] += weight;
      else if (slice < GHOST_CLASS_MAX) classes.ghost[bucket] += weight;
    }
    stats.deposits++;
  };
}

// -------------------------------------------------------------------- REF

function runReference(
  pose: Pose,
  attempts: number,
): { hist: FlameHistogram; classes: ClassHits; stats: DepositStats } {
  const hist = createFlameHistogram(HIST, HIST);
  const classes = emptyClasses();
  const stats = emptyStats();
  const visit = makeDepositVisitor(pose, hist, stats, classes);
  const start = Date.now();
  runOrbit(ORBIT_SEED, attempts, (px, py, pz, pw) => {
    stats.attempts++;
    const radial = Math.hypot(px, py, pz, pw);
    if (radial > stats.maxSource) stats.maxSource = radial;
    if (radial > PLAN.tiling.radius) stats.sourceViolations++;
    const emitted = visitPointTilingImagesExhaustive(
      PLAN,
      px,
      py,
      pz,
      pw,
      visit,
    );
    if (emitted > 0) stats.accepted++;
  });
  stats.accumulateMs = Date.now() - start;
  return { hist, classes, stats };
}

// ------------------------------------------------------------ A0/A1 shipped

function runShippedArm(
  pose: Pose,
  attempts: number,
  proposal: LatticePointTilingProposal | undefined,
): { hist: FlameHistogram; accumulateMs: number } {
  const start = Date.now();
  const hist = accumulateFlame4(
    PREPARED,
    pose.projection,
    pose.view,
    HIST,
    HIST,
    attempts,
    mulberry32(ORBIT_SEED),
    UNIFORM_COLOR,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PLAN,
    proposal,
  );
  return { hist, accumulateMs: Date.now() - start };
}

/**
 * The cost-instrumented shipped arm: `runShippedArm` repeated
 * COST_REPEATS times (deterministic — every repeat produces a
 * bit-identical histogram; the first repeat's histogram is the one the
 * metrics read), reporting the MINIMUM wall clock per the header's cost
 * amendment.
 */
function runShippedArmCosted(
  pose: Pose,
  attempts: number,
  proposal: LatticePointTilingProposal | undefined,
): { hist: FlameHistogram; accumulateMs: number; repeats: number[] } {
  const first = runShippedArm(pose, attempts, proposal);
  const repeats = [first.accumulateMs];
  let min = first.accumulateMs;
  for (let i = 1; i < COST_REPEATS; i++) {
    const again = runShippedArm(pose, attempts, proposal);
    repeats.push(again.accumulateMs);
    if (again.accumulateMs < min) min = again.accumulateMs;
  }
  return { hist: first.hist, accumulateMs: min, repeats };
}

/**
 * The tracker: the same seeded orbit through the SHIPPED
 * `visitPointTilingAttemptBounded` with the replica visitor. Asserted
 * bit-identical to the shipped accumulateFlame4 histogram — the proof that
 * the replica visitor and the shared orbit stream are exact — and the
 * carrier of meanSliceWeight and `selected` (= the accumulation path's
 * candidateTests: one CDF proposal per selected image).
 */
function runTracker(
  pose: Pose,
  attempts: number,
  proposal: LatticePointTilingProposal | undefined,
): {
  hist: FlameHistogram;
  classes: ClassHits;
  stats: DepositStats;
  cursor: ReturnType<typeof createPointTilingCursorState>;
} {
  const hist = createFlameHistogram(HIST, HIST);
  const classes = emptyClasses();
  const stats = emptyStats();
  const visit = makeDepositVisitor(pose, hist, stats, classes);
  const cursor = createPointTilingCursorState();
  const start = Date.now();
  runOrbit(ORBIT_SEED, attempts, (px, py, pz, pw) => {
    stats.attempts++;
    visitPointTilingAttemptBounded(
      PLAN,
      px,
      py,
      pz,
      pw,
      POINT_TILING_ACCUMULATION_FANOUT_CAP,
      cursor,
      visit,
      proposal,
    );
  });
  stats.accumulateMs = Date.now() - start;
  stats.accepted = cursor.accepted;
  stats.selected = cursor.selected;
  return { hist, classes, stats, cursor };
}

// ----------------------------------------------------------------- metrics

/** Mass-normalized L1/RMSE — `point-tiling.harness.ts`'s histogramMetric
 * pattern: both histograms normalized to unit total mass first. */
function hitsMetric(
  actual: Float64Array,
  reference: Float64Array,
): { l1: number; rmse: number } {
  let sumA = 0;
  let sumR = 0;
  for (let i = 0; i < actual.length; i++) {
    sumA += actual[i];
    sumR += reference[i];
  }
  let l1 = 0;
  let squared = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = sumA > 0 ? actual[i] / sumA : 0;
    const r = sumR > 0 ? reference[i] / sumR : 0;
    l1 += Math.abs(a - r);
    squared += (a - r) * (a - r);
  }
  return { l1, rmse: Math.sqrt(squared / actual.length) };
}

function totalHits(hist: FlameHistogram): number {
  let sum = 0;
  for (let i = 0; i < hist.hits.length; i++) sum += hist.hits[i];
  return sum;
}

function totalHitsClass(hits: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < hits.length; i++) sum += hits[i];
  return sum;
}

function relMass(actual: FlameHistogram, reference: FlameHistogram): number {
  const a = totalHits(actual);
  const r = totalHits(reference);
  return Math.abs(a - r) / Math.max(r, 1e-300);
}

/** Mass-normalized L1 over the tone-mapped RGB as a PER-CHANNEL-SUM: all
 * width*height*3 channels pooled, alpha excluded (transparent buckets are
 * black), both images normalized to a common total first. */
function tonemapRgbL1(
  actual: Uint8ClampedArray,
  reference: Uint8ClampedArray,
): number {
  let sumA = 0;
  let sumR = 0;
  for (let i = 0; i < actual.length; i += 4) {
    sumA += actual[i] + actual[i + 1] + actual[i + 2];
    sumR += reference[i] + reference[i + 1] + reference[i + 2];
  }
  let l1 = 0;
  for (let i = 0; i < actual.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const a = sumA > 0 ? actual[i + c] / sumA : 0;
      const r = sumR > 0 ? reference[i + c] / sumR : 0;
      l1 += Math.abs(a - r);
    }
  }
  return l1;
}

const fixed = (value: number, digits = 4): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";

/**
 * The PINNED tonemap instrument: tonemap an arm against the SAME maxHits —
 * REF's — via a `viewFlameHistogram` copy over the arm's own bucket arrays.
 * `tonemapFlame` reads `maxHits` at entry and never writes it, so the copy
 * needs no restore. `tonemapFlame`'s density is `log1p(h)/log1p(maxHits)`:
 * a concentration-driven maxHits SHIFT renormalizes the whole curve and can
 * masquerade as a structure change. This instrument separates structure
 * from that brightness renormalization — it is NOT a claim about shipped
 * display, which always tonemaps with the histogram's own maxHits (that is
 * the unpinned `tonemapL1` column).
 */
function tonemapPinned(
  hist: FlameHistogram,
  refMaxHits: number,
): Uint8ClampedArray {
  return tonemapFlame(
    viewFlameHistogram(
      hist.width,
      hist.height,
      hist.hits,
      hist.sumRGB,
      refMaxHits,
    ),
    TONEMAP,
  );
}

// -------------------------------------------------------------------- tests

/**
 * The main matrix's full-budget exhaustive REF histograms, stored here for
 * the convergence sweep. The sweep compares EVERY budget against the SAME
 * truth — the full-budget exhaustive REF the main matrix test built —
 * because that is the object both arms converge toward; re-running REF per
 * budget would change the target, not sharpen it. The main matrix test
 * (which runs first) fills this; the sweep throws if it is absent.
 */
const REF_BY_POSE = new Map<
  string,
  { hist: FlameHistogram; classes: ClassHits }
>();

describe("4D Flame slice-aware lattice proposal sheet", () => {
  it("pins the fixture, the plan, the view policy and the proposal ordinals", () => {
    // Structural preconditions: the REF arm replicates the orbit exactly,
    // which is only legitimate while every extra hot-loop branch is inert.
    expect(PREPARED.transformCount).toBe(PREPARED.baseTransformCount);
    expect(PREPARED.emitters).toBeNull();
    expect(PREPARED.schedule).toBeNull();
    expect(PREPARED.chaosRows).toBeNull();
    expect(PREPARED.finalAffine).toBeNull();
    expect(PREPARED.finalWarp).toBeNull();

    expect(PLAN.dimension).toBe(4);
    expect(PLAN.upper.length).toBe(EXPECTED_LATTICE_CELLS);
    // The ceiling's legality input: the plan's containment radius IS the
    // certified radius the resolve chain was handed.
    expect(PLAN.tiling.radius).toBe(R);

    console.log(
      `[flame-tiling-4d] fixture: pentatope lifted, R=${R}, attempts=${ATTEMPTS}, hist=${HIST}x${HIST}, sliceWidth=${SLICE_WIDTH}, cells=${PLAN.upper.length}, outerRadius=${PLAN.tiling.presentation.outerRadius}`,
    );

    for (const pose of POSES) {
      // The flame lattice view policy (flame-worker-core.ts): pivot at the
      // origin, invWAmp = 1/outerRadius; row S of the composed projection is
      // the rotor's row 3 verbatim — the sRaw row the ceiling reads.
      expect(pose.view.invWAmp).toBe(
        1 / Math.max(PLAN.tiling.presentation.outerRadius, 1e-6),
      );
      for (let i = 15; i < 20; i++) {
        expect(pose.projection[i]).toBe(pose.rotorProj[i]);
      }
      // minimumProduct = 0 keeps every live cell: every multiplier is finite
      // and at least the ghost floor, so every u_k * v_k > 0 and the
      // proposal's per-mask ordinal sets must EQUAL the plan's.
      for (let cell = 0; cell < pose.multipliers.length; cell++) {
        const v = pose.multipliers[cell];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(SLICE_GHOST_FLOOR);
      }
      for (let mask = 0; mask < PLAN.cdfByWallMask.length; mask++) {
        // SET equality, not order: buildLatticeCdf sorts ascending by weight
        // (the plan by u_k, the proposal by u_k * v_k), so the sequences
        // legitimately differ while the retained-cell sets cannot.
        expect(
          Array.from(pose.proposal.cdfByWallMask[mask].cellOrdinals).sort(
            (a, b) => a - b,
          ),
        ).toEqual(
          Array.from(PLAN.cdfByWallMask[mask].cellOrdinals).sort(
            (a, b) => a - b,
          ),
        );
      }
      console.log(
        `[flame-tiling-4d] ${pose.label}: ceiling min=${Math.min(...pose.multipliers).toExponential(3)} max=${Math.max(...pose.multipliers).toFixed(4)} sum(u*v)=${pose.proposal.cdfByWallMask[0].upperTotal.toFixed(4)} sum(u)=${PLAN.cdfByWallMask[0].upperTotal.toFixed(4)}`,
      );
    }
  });

  it("measures A0 and A1 against exhaustive replication at both poses", () => {
    const rows: Record<string, string | number>[] = [];
    // The threshold asserts run AFTER the whole matrix is collected and
    // printed: a threshold failure must fail the sheet loudly, but it must
    // never hide the other rows' measurements behind an early throw.
    const asserts: (() => void)[] = [];
    for (const pose of POSES) {
      const ref = runReference(pose, ATTEMPTS);
      REF_BY_POSE.set(pose.label, { hist: ref.hist, classes: ref.classes });
      const a0 = runShippedArmCosted(pose, ATTEMPTS, undefined);
      const a0Track = runTracker(pose, ATTEMPTS, undefined);
      const a1 = runShippedArmCosted(pose, ATTEMPTS, pose.proposal);
      const a1Track = runTracker(pose, ATTEMPTS, pose.proposal);

      // Stream identity: the shipped call's orbit/cursor must be REF's (same
      // seeded stream, same acceptance), and each tracker pass must replay
      // its shipped arm bit for bit.
      expect(a0.hist.pointTiling).toBeDefined();
      expect(a1.hist.pointTiling).toBeDefined();
      expect(a0.hist.pointTiling!.attempts).toBe(ref.stats.attempts);
      expect(a0.hist.pointTiling!.accepted).toBe(ref.stats.accepted);
      expect(a0Track.hist.hits).toEqual(a0.hist.hits);
      expect(a0Track.hist.sumRGB).toEqual(a0.hist.sumRGB);
      expect(a0Track.hist.maxHits).toBe(a0.hist.maxHits);
      expect(a0Track.cursor).toEqual(a0.hist.pointTiling);
      expect(a1Track.hist.hits).toEqual(a1.hist.hits);
      expect(a1Track.hist.sumRGB).toEqual(a1.hist.sumRGB);
      expect(a1Track.hist.maxHits).toBe(a1.hist.maxHits);
      expect(a1Track.cursor).toEqual(a1.hist.pointTiling);
      // The proposal must not change HOW MANY images are selected, only
      // which ones (equal candidates per mask -> equal credit spends).
      expect(a1Track.stats.selected).toBe(a0Track.stats.selected);

      const mA0 = hitsMetric(a0.hist.hits, ref.hist.hits);
      const mA1 = hitsMetric(a1.hist.hits, ref.hist.hits);
      const ratio = mA1.l1 / mA0.l1;
      const rel0 = relMass(a0.hist, ref.hist);
      const rel1 = relMass(a1.hist, ref.hist);
      const toneRef = tonemapFlame(ref.hist, TONEMAP);
      const toneA0 = tonemapFlame(a0.hist, TONEMAP);
      const toneA1 = tonemapFlame(a1.hist, TONEMAP);
      const toneL0 = tonemapRgbL1(toneA0, toneRef);
      const toneL1 = tonemapRgbL1(toneA1, toneRef);
      // The pinned variant: all three arms tonemapped against REF's maxHits,
      // so a maxHits renormalization cannot masquerade as a structure change.
      const refMaxHits = ref.hist.maxHits;
      const toneL0Pinned = tonemapRgbL1(
        tonemapPinned(a0.hist, refMaxHits),
        tonemapPinned(ref.hist, refMaxHits),
      );
      const toneL1Pinned = tonemapRgbL1(
        tonemapPinned(a1.hist, refMaxHits),
        tonemapPinned(ref.hist, refMaxHits),
      );
      const meanSlice0 =
        a0Track.stats.sliceSum / Math.max(a0Track.stats.emitted, 1);
      const meanSlice1 =
        a1Track.stats.sliceSum / Math.max(a1Track.stats.emitted, 1);
      const primary = pose.label.startsWith("P1");
      const goVerdict =
        ratio <= GO_L1_RATIO
          ? "GO"
          : ratio <= NOGO_L1_RATIO
            ? "MARGINAL"
            : "NO-GO";

      // ---- predeclared thresholds (asserted after the table prints) ----
      asserts.push(() => {
        expect(mA0.l1).toBeLessThanOrEqual(MAX_NORMALIZED_L1);
        expect(mA1.l1).toBeLessThanOrEqual(MAX_NORMALIZED_L1);
        if (primary) {
          expect(ratio).toBeLessThanOrEqual(NOGO_L1_RATIO);
        } else {
          // Sanity band [0, 1.10] after the 2026-09-03 amendment (see the
          // threshold note in the header): the worsening direction only.
          expect(ratio).toBeLessThanOrEqual(P0_RATIO_MAX);
        }
        expect(rel1).toBeLessThanOrEqual(UNBIAS_ABS_TOLERANCE);
        expect(a1.accumulateMs).toBeLessThanOrEqual(
          a0.accumulateMs * COST_FACTOR,
        );
      });

      rows.push({
        pose: pose.label,
        l1Raw_A0: fixed(mA0.l1),
        l1Raw_A1: fixed(mA1.l1),
        ratio_A1_over_A0: fixed(ratio, 4),
        primaryVerdict: primary ? goVerdict : "sanity",
        rmse_A0: mA0.rmse.toExponential(3),
        rmse_A1: mA1.rmse.toExponential(3),
        relMass_A0: rel0.toExponential(3),
        relMass_A1: rel1.toExponential(3),
        refMs: ref.stats.accumulateMs,
        accumulateMs_A0: a0.accumulateMs,
        accumulateMs_A1: a1.accumulateMs,
        costRatio_A1_over_A0: fixed(
          a1.accumulateMs / Math.max(a0.accumulateMs, 1),
          3,
        ),
        selected_A0: a0Track.stats.selected,
        selected_A1: a1Track.stats.selected,
        meanSliceWeight_A0: fixed(meanSlice0, 4),
        meanSliceWeight_A1: fixed(meanSlice1, 4),
        maxHits_REF: ref.hist.maxHits,
        maxHits_A0: a0.hist.maxHits,
        maxHits_A1: a1.hist.maxHits,
        tonemapL1_A0: fixed(toneL0),
        tonemapL1_A1: fixed(toneL1),
        tonemapL1Pinned_A0: fixed(toneL0Pinned),
        tonemapL1Pinned_A1: fixed(toneL1Pinned),
        refAccepted: ref.stats.accepted,
        refEmitted: ref.stats.emitted,
        refDeposits: ref.stats.deposits,
        maxSource: fixed(ref.stats.maxSource, 6),
        sourceViolations: ref.stats.sourceViolations,
      });
    }
    console.log(
      "[flame-tiling-4d] A0 (shipped u_k CDF) vs A1 (slice-aware proposal) against exhaustive REF, 256x256 histogram, uniform color",
    );
    console.table(rows);
    for (const assert of asserts) assert();
  });

  it("prices unbiasedness at attempts/8 on the shared source set", () => {
    const attempts = Math.max(1, Math.floor(ATTEMPTS / 8));
    const rows: Record<string, string | number>[] = [];
    const asserts: (() => void)[] = [];
    for (const pose of POSES) {
      const ref = runReference(pose, attempts);
      const a0 = runShippedArm(pose, attempts, undefined);
      const a1 = runShippedArm(pose, attempts, pose.proposal);
      const rel0 = relMass(a0.hist, ref.hist);
      const rel1 = relMass(a1.hist, ref.hist);
      rows.push({
        pose: pose.label,
        attempts,
        refMass: totalHits(ref.hist).toExponential(6),
        a0Mass: totalHits(a0.hist).toExponential(6),
        a1Mass: totalHits(a1.hist).toExponential(6),
        relMass_A0: rel0.toExponential(3),
        relMass_A1: rel1.toExponential(3),
        tolerance: UNBIAS_ABS_TOLERANCE,
      });
      asserts.push(() => {
        expect(ref.stats.attempts).toBe(a0.hist.pointTiling!.attempts);
        expect(ref.stats.accepted).toBe(a0.hist.pointTiling!.accepted);
        expect(rel1).toBeLessThanOrEqual(UNBIAS_ABS_TOLERANCE);
      });
    }
    console.log(
      "[flame-tiling-4d] unbiasedness on the shared source set (same seeded stream, total deposited mass against exhaustive replication)",
    );
    console.table(rows);
    for (const assert of asserts) assert();
  });

  it("sweeps the source budget against the full-budget exhaustive REF", () => {
    const BUDGETS = [0.25, 0.5, 1, 2];
    const rows: Record<string, string | number>[] = [];
    for (const pose of POSES) {
      const snapshot = REF_BY_POSE.get(pose.label);
      if (!snapshot) {
        throw new Error("sweep requires the main matrix's stored REF");
      }
      const refHist = snapshot.hist;
      // The comparison target for EVERY budget is the main run's
      // full-budget exhaustive REF — the same truth both arms converge to.
      const refMaxHits = refHist.maxHits;
      const toneRef = tonemapFlame(refHist, TONEMAP);
      for (const factor of BUDGETS) {
        const attempts = Math.max(1, Math.round(ATTEMPTS * factor));
        for (const [arm, proposal] of [
          ["A0", undefined],
          ["A1", pose.proposal],
        ] as const) {
          const { hist, accumulateMs } = runShippedArm(
            pose,
            attempts,
            proposal,
          );
          const metric = hitsMetric(hist.hits, refHist.hits);
          const toneOwn = tonemapRgbL1(tonemapFlame(hist, TONEMAP), toneRef);
          const tonePinned = tonemapRgbL1(
            tonemapPinned(hist, refMaxHits),
            toneRef,
          );
          rows.push({
            pose: pose.label,
            arm,
            budget: `${factor}x`,
            attempts,
            l1Raw: fixed(metric.l1),
            tonemapL1: fixed(toneOwn),
            tonemapL1Pinned: fixed(tonePinned),
            maxHits: hist.maxHits.toFixed(1),
            accumulateMs,
          });
        }
      }
      // SCALE CONTROL (report-only): REF's own histogram with hits AND
      // sumRGB doubled — a zero-noise 2x-exposure image of the SAME truth.
      // Tonemapped against REF itself, whatever this scores is the log1p
      // curve's scale non-invariance ALONE (2x counts reshape the density
      // curve), with no estimation error and no proposal — bounding how
      // much of any 2x-budget row's tonemapped L1 is instrument rather
      // than estimator quality. The pinned variant is the control for the
      // pinned 2x rows.
      const doubled = new Float64Array(refHist.hits.length);
      const doubledRGB = new Float64Array(refHist.sumRGB.length);
      for (let i = 0; i < doubled.length; i++) {
        doubled[i] = refHist.hits[i] * 2;
      }
      for (let i = 0; i < doubledRGB.length; i++) {
        doubledRGB[i] = refHist.sumRGB[i] * 2;
      }
      const scaleOwn = tonemapRgbL1(
        tonemapFlame(
          viewFlameHistogram(
            refHist.width,
            refHist.height,
            doubled,
            doubledRGB,
            refHist.maxHits * 2,
          ),
          TONEMAP,
        ),
        toneRef,
      );
      const scalePinned = tonemapRgbL1(
        tonemapPinned(
          viewFlameHistogram(
            refHist.width,
            refHist.height,
            doubled,
            doubledRGB,
            refHist.maxHits,
          ),
          refMaxHits,
        ),
        toneRef,
      );
      console.log(
        `[flame-tiling-4d] ${pose.label} scale control (zero-noise 2x exposure vs REF): tonemapL1=${fixed(scaleOwn)} tonemapL1Pinned=${fixed(scalePinned)}`,
      );
    }
    // REPORT-ONLY since 2026-09-03: the two load-bearing checks this test
    // used to carry (the cross-budget raw doubling check and the
    // cross-budget pinned display check) were superseded by the
    // decomposition test's same-budget checks — see the threshold note in
    // the header.
    console.log(
      "[flame-tiling-4d] convergence sweep: A0/A1 at 0.25x/0.5x/1x/2x budgets against the main run's full-budget exhaustive REF (tonemap own vs pinned; report-only)",
    );
    console.table(rows);
  });

  it("answers the ship question: decomposes the P1 display regression into visible and ghost classes", () => {
    const poseP1 = POSES[1];
    const poseP0 = POSES[0];
    const refP1 = REF_BY_POSE.get(poseP1.label);
    const refP0 = REF_BY_POSE.get(poseP0.label);
    if (!refP1 || !refP0) {
      throw new Error("decomposition requires the main matrix's stored REF");
    }
    // The same-budget 2x exhaustive REF at P1 (4M attempts, class split
    // included). The brief's 4x rung was DROPPED for runtime — an 8M
    // exhaustive pass alone would cost ~4x the entire 2M sheet; see the
    // header note.
    const refP1x2 = runReference(poseP1, 2 * ATTEMPTS);
    console.log(
      `[flame-tiling-4d] P1 2x REF: attempts=${refP1x2.stats.attempts} accepted=${refP1x2.stats.accepted} emitted=${refP1x2.stats.emitted} ms=${refP1x2.stats.accumulateMs} maxHits=${refP1x2.hist.maxHits.toFixed(1)}`,
    );

    const rows: Record<string, string | number>[] = [];
    const asserts: (() => void)[] = [];
    const cells = new Map<
      string,
      { l1RawVisible: number; tonemapGhost: number; tonemapL1Full: number }
    >();

    /**
     * One (pose, refBudget, arm) decomposition cell. Every class metric is
     * compared against the REF snapshot's SAME class (each class pair
     * normalized by its own REF-class mass — hitsMetric normalizes each
     * array by its own total). The class tonemaps are the instrument; they
     * are only produced where the REF anchor is same-budget (cross-budget
     * class tonemaps inherit the log1p scale floor the scale control
     * measured) — the P0 2x cell anchors on the 1x REF for the
     * scale-clean RAW classes only.
     */
    const decompose = (
      pose: Pose,
      ref: { hist: FlameHistogram; classes: ClassHits },
      refBudget: string,
      sameBudget: boolean,
      attempts: number,
    ): void => {
      const toneRefFull = tonemapFlame(ref.hist, TONEMAP);
      const toneRefVisible = tonemapClass(ref.classes.visible);
      const toneRefGhost = tonemapClass(ref.classes.ghost);
      for (const [arm, proposal] of [
        ["A0", undefined],
        ["A1", pose.proposal],
      ] as const) {
        const track = runTracker(pose, attempts, proposal);
        const fullMetric = hitsMetric(track.hist.hits, ref.hist.hits);
        const visMetric = hitsMetric(
          track.classes.visible,
          ref.classes.visible,
        );
        const ghostMetric = hitsMetric(track.classes.ghost, ref.classes.ghost);
        const toneFull = sameBudget
          ? tonemapRgbL1(tonemapFlame(track.hist, TONEMAP), toneRefFull)
          : Number.NaN;
        const toneVis = sameBudget
          ? tonemapRgbL1(tonemapClass(track.classes.visible), toneRefVisible)
          : Number.NaN;
        const toneGhost = sameBudget
          ? tonemapRgbL1(tonemapClass(track.classes.ghost), toneRefGhost)
          : Number.NaN;
        const refFull = totalHits(ref.hist);
        const refVis = totalHitsClass(ref.classes.visible);
        const refGhost = totalHitsClass(ref.classes.ghost);
        const cell = {
          l1RawVisible: visMetric.l1,
          tonemapGhost: toneGhost,
          tonemapL1Full: toneFull,
        };
        cells.set(`${pose.label}|${refBudget}|${attempts}|${arm}`, cell);
        rows.push({
          pose: pose.label,
          arm,
          attempts,
          refBudget: `${refBudget} ${sameBudget ? "(same-budget)" : "(cross-budget anchor)"}`,
          l1RawFull: fixed(fullMetric.l1),
          l1RawVisible: fixed(visMetric.l1),
          l1RawGhost: fixed(ghostMetric.l1),
          tonemapL1Full: sameBudget ? fixed(toneFull) : "n/a",
          tonemapVisible: sameBudget ? fixed(toneVis) : "n/a",
          tonemapGhost: sameBudget ? fixed(toneGhost) : "n/a",
          refMassVisible: refVis.toExponential(3),
          refMassGhost: refGhost.toExponential(3),
          refMidShare: fixed(
            (refFull - refVis - refGhost) / Math.max(refFull, 1e-300),
            4,
          ),
          maxHits_full: track.hist.maxHits.toFixed(1),
          maxHits_visible: classMaxHits(track.classes.visible).toFixed(1),
          maxHits_ghost: classMaxHits(track.classes.ghost).toFixed(1),
        });
      }
    };

    // P0: 1x same-budget decomposition; 2x with the scale-clean RAW
    // classes against the 1x REF anchor (no class tonemap — cross-budget).
    decompose(poseP0, refP0, "1x", true, ATTEMPTS);
    decompose(poseP0, refP0, "1x", false, 2 * ATTEMPTS);
    // P1: the ship-question cells — 1x and 2x, both same-budget.
    decompose(poseP1, refP1, "1x", true, ATTEMPTS);
    decompose(poseP1, refP1x2, "2x", true, 2 * ATTEMPTS);

    const p1x1A0 = cells.get(`${poseP1.label}|1x|${ATTEMPTS}|A0`)!;
    const p1x1A1 = cells.get(`${poseP1.label}|1x|${ATTEMPTS}|A1`)!;
    const p1x2A0 = cells.get(`${poseP1.label}|2x|${2 * ATTEMPTS}|A0`)!;
    const p1x2A1 = cells.get(`${poseP1.label}|2x|${2 * ATTEMPTS}|A1`)!;

    // ---- predeclared ship-question checks (asserted after the table
    // ---- prints; they supersede the sweep's two cross-budget checks —
    // ---- see the header note) ----
    asserts.push(() => {
      expect(p1x1A1.l1RawVisible).toBeLessThanOrEqual(p1x1A0.l1RawVisible);
      expect(p1x2A1.l1RawVisible).toBeLessThanOrEqual(p1x2A0.l1RawVisible);
    });

    console.log(
      "[flame-tiling-4d] class decomposition (visible = slice >= 0.5, ghost = slice < 0.1, mid = full - visible - ghost); class tonemaps are the instrument, tonemapL1Full the shipped-behavior metric",
    );
    console.table(rows);
    for (const assert of asserts) assert();

    // RECORD (not asserted): whether the ghost-class tonemap regresses —
    // expected to worsen for A1; visible-raw-improves + ghost-tonemap-
    // worsens together = "the regression is ghost-confined".
    const ghostAt = (cell: { tonemapGhost: number }): string =>
      Number.isFinite(cell.tonemapGhost) ? fixed(cell.tonemapGhost) : "n/a";
    console.log(
      `[flame-tiling-4d] ghost record: tonemapGhost(A1) vs A0 at P1 1x = ${ghostAt(p1x1A1)} vs ${ghostAt(p1x1A0)} (${p1x1A1.tonemapGhost > p1x1A0.tonemapGhost ? "worsens" : "does not worsen"}); at P1 2x = ${ghostAt(p1x2A1)} vs ${ghostAt(p1x2A0)} (${p1x2A1.tonemapGhost > p1x2A0.tonemapGhost ? "worsens" : "does not worsen"})`,
    );
    // RECORD (not asserted): the same-budget full-display ladder ratios —
    // whether the P1 display gap closes with budget.
    console.log(
      `[flame-tiling-4d] P1 same-budget ladder tonemapL1Full A1/A0: 1x = ${fixed(p1x1A1.tonemapL1Full / p1x1A0.tonemapL1Full, 4)}, 2x = ${fixed(p1x2A1.tonemapL1Full / p1x2A0.tonemapL1Full, 4)} (the 1x row decides the direction; these rows establish whether the gap closes)`,
    );
  });
});
