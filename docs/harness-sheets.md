# Harness Sheets

This is the catalogue `CLAUDE.md`'s Commands section points to. It is the
full per-sheet record — every measured number, every verdict, every refuted
hypothesis — for this project's executable measurement records.

## What a harness sheet is

A harness sheet (`scripts/*.harness.ts`) is this project's executable
measurement record — the argument for a decision, kept runnable rather than
summarized. Run one with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>
```

Output lands under `scripts/out/`, which is gitignored. PNGs, manifests, keys,
and frozen review responses in that tree are run-local evidence, not repository
artifacts; archive a release run outside the checkout if it must remain
independently inspectable. Regeneration is appropriate for machine evidence,
but a human review cannot be reconstructed from its prose summary.

## The two shared instruments

`scripts/de-preview.ts` is the SHARED renderer eight of them import
(`renderPreview`, `writeContactSheet`, `encodePng`, and the
`DistanceEstimator`/`PanelStats` vocabulary): a CPU sphere-marcher with
AO/shadow switches, a settable step budget and an always-counted `exhausted`,
so a new sheet writes its estimator and its panel list, never a ninth
marcher.

`scripts/set-extent.ts` is the other shared instrument: the ONE
definition of "how much of a ball does this set fill, and how far out does
it reach", against a MEMBERSHIP oracle the caller supplies and never a
threshold on a distance, volume-uniform for fill (`probeEscapeFill`'s own
draw, term for term, and pinned bit-equal to it) and a shell walk from the
outside in for reach. Five sheets had each grown their own copy and all five
were wrong the same two ways — a grid aliases against a fold's walls, and
`de(p) < eps` is not membership in either direction — which corrected
figures in four module docs and cost two claims: the Juliabox's "narrow
usable band" does not exist, and `qjulia-beauty`'s "a deformed M never wins"
was the instrument.

## The surface DE's sheets

### surface-beam

The beam-width sheet, and the one that decided a shipped default. Width-1
greedy descent OVERSHOOTS the true distance not just on the doubleRotation
profile the 4D surface DE spike found (~19% of R) but on plain shipped
presets — default
10.8%R, spiral 8.6%R, pyramid 6.2%R, jerusalem 6.1%R — at per-map
`sigma_max` as low as 0.4, while other systems at the SAME sigma stay
clean. So no gating predicate exists and `buildSurfaceDE`/`buildSurfaceDE4`
always build width 2. Width 2 collapses the violations to the
deep-descent fp-noise floor everywhere except three disclosed residual
profiles (kaleidoscope copies of a near-isometric map, m >= 3 slow-map
systems, `sigma_max >= 0.96`), improves tightness, and costs ~1.7-1.8x
inverse applications. Its tables are the ones `surface-de.ts`'s beam
comment points at.

A later pass widened the beam again: widths 3/4 are validity slots
(rank-3/4 chains, live only while in-sphere) that close the width-2
residual above, and `buildSurfaceDE`/`buildSurfaceDE4` now always
build width 4, not 2 — the width-1/2 rows survive only as the
bit-exactness regression of the pre-slot beam. The depth-ceiling
raise then took the shared cap 48 -> 128 (the old cap clamped
sigma-0.93 systems at 0.031R of unresolved feature size), and
section (4) extended the same width-invariance check to
PURE-FOLD systems, whose fixed-width branch frontier ignores
`beamWidth` entirely (0 mismatches across 5 profiles) — though its
bound is far looser than the affine one (median DE/D 0.13-0.20 vs
0.61-0.84). A later addendum then pinned the PRODUCTION estimator
per system class as the one that gates (base for fold, refined for
affine).

### fold-cost-split

The fold-DE cost instrumentation's experiment 2: the fold DE's cost,
factored as march steps per ray times inverse applications per call, on the
same rays — the split `docs/fold-de-performance-brief.md` §4 needed before
choosing between shrinking the branch fan and shrinking the bound. Counts
map VISITS through `harness-profiles.ts`'s shared `countingDE`, so its
numbers are
comparable 1:1 with the beam and grid sheets rather than with raw branch
arithmetic.

MEASURED VERDICT: factor A (apps/call, branch fan-out) dominates, not
factor B (steps/ray) — apps/call spans ~5.8 to ~275 across systems
(~47x) while steps/ray spans only ~3.8 to ~17.0 (~4.5x), confirming
the brief's branch-and-bound-first order. mandelboxKifs measures
~17.3k branch evaluations per DE call, ~98.7k per ray, matching the
brief's back-of-envelope estimate to within an order of magnitude.
The branch-and-bound follow-up's finer per-transform counter confirmed this
EXACTLY (1.000x against the apps x branch-fan-out reconstruction),
and found the counting Proxy itself expensive enough (~86x slower on
mandelboxKifs) to force a hard wall-clock cap into the harness's own
ray loops.

### lens-branch-cost

The heavy-lens class, and both halves of its own hypothesis came back
wrong. Branch survival through `descendLens`'s three value-exact prunes is 5.5%
(archetype) / 8.4% (the user's field class) of 81, not "most", and per EVAL
the field class costs only ~1.4x the archetype (262 vs 195 transforms) —
which cannot explain a ~15x/ray field gap, so the rest is framing and ray
count, with exhaustion ZERO at every framing tested. BEST-FIRST BRANCH
ORDERING WAS IMPLEMENTED AND REVERTED: it cut core descents/call 4.46 ->
2.26 and 6.83 -> 5.94 and was worth 9-15% of CPU wall, but measured a
1.46-1.54x REGRESSION on real Iris — the same trade the fold descent's
stage-2 B&B lost one level down. The remaining prize needs a stronger
IN-BALL certificate, not a cheaper route to the existing one.

### surface-grid-cost

The grid build-cost measurement: what a `buildSurfaceGrid` enter actually
costs on a pure-fold system, where every descent level fans one visited map
into 27/3/81 branches. It is why `surfaceGridEstimator` picks `"plain"` for
fold systems and `"refined"` for affine, and why the worker sizes its own
resolution off
a measured pilot slab. Rows whose PROJECTION past resolution 32 exceeds
240s print the projection instead of spending the minutes — which answers
the "does this take minutes" question without paying it.

MEASURED VERDICT: real in direction, not magnitude — mandelboxKifs
costs 55.8s refined vs 37.5s plain at 64^3 (~1.5x, tracking the
visit-count ratio), the 2-map fold pairs 0.3-13.4s with plain and
refined within noise, affine presets 0.13-0.29s. Floor quality is
estimator-invariant in practice (positive-floor fraction within ~0.6
points, median floor within ~0.7%R at every resolution), and
per-cell cost spans ~40x across systems, tracking descent depth plus
branch count rather than fold-kind alone.

### fold-phantom

The acceptance-eps fix's NEGATIVE CONTROL, kept for exactly that. The
suspect was `descendFold`'s region floors: a mixed affine+fold system evicts
in-sphere tuples constantly, and a folded near-zero floor in a genuine void
would put a sphere tracer onto the fold's own validity plane — a rendered
box face that is not attractor. The oracle pins CLEAN on every probe here,
so the mechanism was elsewhere (tier-scaled hit acceptance, the acceptance-eps
fix), and the sheet stays because a future regression that IS a true DE
plateau hit will fire in it.

### fold-radii-seam

The deferred-teardown crash hunt's exoneration of the authored fold
lengths. Across the whole admissible band and both box-limit extremes every
DE value is
finite, the bounding radius never moves off 1.77, per-eval cost stays
inside a factor of ~10 with no trend toward the seam, and `maxDepth`
saturates politely at 128 from `mR/fR ~ 0.73` down. The real defect was a
synchronous `device.destroy()` under an in-flight compute frame; this sheet
is the record of why the radii were ruled out on the way to it, plus a map
of the eligibility seam's exact arithmetic.

### erosion-repro

The eroded-detail bug, and it drove the shipped fix. The DE, the cutoff and
sphere-floor exits
and the grid floors are all sound (0 violations in 14k+ cell samples, 0
cutoff-contract mismatches); the erosion is pure MARCH-BUDGET EXHAUSTION,
because the skip loop charged every cheap grid skip against the same
96-step budget as a full descent and starved exactly the rays that thread
gaps or graze faces. Sizing the fix here took the worst-pose loss from
44/5508 true hits to 0 on sierpinski and 65/24418 to 5 on menger:
`SURFACE_GRID_SKIP_CAP` 256 as its own whole-ray cap plus a full-tier march
budget of 160.

### balloon-inversion

The balloon spike's sheet: is the balloon's inverted union marchable with the
SHIPPED estimators untouched? Its reference distance to the ECHO goes
through inversion's exact distortion identity rather than through inverted
f32 samples (inverting them would amplify their storage rounding by the
local conformal factor), and section 0 pins that identity against directly
inverted f64 points so the wrapper and its own reference cannot share a
bug.

MEASURED VERDICT: PROCEED — 0 off-set conservativeness violations
across 36 rows (6 systems x 3 R regimes x 2 estimators), provenance
(sampleMax/rho) holding 0.95-0.96 at 37x the ball probe's own
density, and erosion that TRANSPORTS rather than amplifies (the
shell term matches the un-inverted outer decile's own tail
everywhere). The one violation ever seen (a dev-run mandelboxKifs
refined tail) traced to the plain field rather than the balloon, and
reproduced unmodified on `surface-beam.harness.ts`. Conservative at every R
measured — the verdict
`balloon-de.ts` ships on.

Section (4) answers a different question: re-enabling the
empty-space grid in balloon mode (shipped OFF) would skip 18.6-33.2%
of a march's FRACTAL-term steps at res 64, realizing 48.7-76.3% of
what the identical grid buys the plain march over the same rays —
the SHELL term (11.3-27.5%, a second grid read plus a rescale) is a
real but separate, uncosted opportunity. Safety holds too: under the
correct per-cell sufficient condition
(`floor + cellRadius <= distToShellBound`), 0 violations over
115k-140k positive-floor cells at res 64 (13k-18k at res 32), 42-62%
margin at the tightest cell.

### aff4-order-cpu

The 4D kernel-cost attribution sheet, and it closed the question. The 4D
kaleidoscope's cost growth over ORDER is ALGORITHMIC, not a kernel
realization: CPU mean/query normalized to order 1 reads affine4 x1.8 / x4.9
/ x6.4 / x13.5 at orders 2/3/4/6 against the GPU's measured x14.4, and
fold4 x4.5 / x12.7 / x24.7 / x58.9 against the GPU's x76.4 — far above the
6x naive sweep-work ratio, with the p95 curve shifting the same way, so
SIMD max-over-lanes adds little. Nothing kernel-shaped is left to chase;
the residual app-level gap is the arms' march loops.

### slice-cost

The off-centre-slice measurement, and it answers a question
`surface-de-4d.ts` had carried open since the 4D spike minted THE SLICE
CAVEAT. Measured against a 600k-point
chaos-game GROUND TRUTH rather than against another bound, the slice
penalty `dist4 / dist3(slab)` reads p50 0.91 -> 0.82 across `plain4`'s whole
`w0` sweep and 0.94 -> 0.85 across `kaleido4`'s, with p10 0.58-0.83
throughout and the medians moving at most 0.03 when the truth slab shrinks
4x. The 4D distance is already ~90% of the in-slice distance AT EVERY
OFFSET — the estimator's own conservativeness is three times larger and
just as flat (`DE / dist4` 0.66-0.72). The march agrees: steps/ray
2.04-2.17 and 2.42-2.86 across the sweep with ZERO exhausted rays at every
row. So the reported 20-40x cliff is not DE looseness, and the slice-aware
certificate written for it — chains carrying the pulled-back slice normal,
off-slab branches dropped, the rest priced against the disc the slab cuts —
was measured at ~10% fewer march steps for 1.4-2.4x the work per
evaluation and NOT shipped. Its app-level half is
`scripts/slice-cliff.probe.mjs`.

## The surface finish's sheet

### finish-pattern

The pre-wire refusal gate for the replacement hybrid coordinate stack. The
old result remains useful but narrow: using `rings` directly as Wood's macro
coordinate produced 74-79% ordinary-view edges and read as corrosion. The
accepted V3 prototype instead makes material identity object-attached: Wood
uses cylindrical latewood plus longitudinal grain, Marble uses sparse
non-periodic macro veins plus one dominant flowing detail vein and softly
gated mineral branches, and Strata uses plateau beds and narrow seams. A
source-space footprint selects and crossfades completed outputs from dyadic,
material-specific detail octaves. Deterministic p03/p97 `sheets`
calibration can bend those coherent fields by at most 0.08-0.10 of one cycle;
it never becomes the texture itself, and a degenerate span disables the warp.
Macro-only and world-space controls expose the expected zoom plateau.

Every run writes labeled diagnostics and a JSON manifest under a run-specific
`scripts/out/finish-pattern-<run>/` directory and refuses to overwrite it.
The legacy V3 CPU harness can reproduce its historical five-reviewer evidence:
its blinded decks are default-off and require a separate all-system 288 px hero
run that names a prior passing machine run. The current release decision uses
the production-browser owner gate documented below.
Geometry is cached once per system/rung, so the 28 material/control panels per
system cost only four CPU marches. The lighting-independent metric is
pre-lighting albedo-luminance residual; its edge and box-pyramid energy
calculations keep disconnected source-space components separate instead of
calling a geometry seam pattern speckle.

V2 MACHINE VERDICT (`20260821-hybrid-v2`, 96 px ladders): PROCEED to the human
semantic gate. Menger (affine), mandelbox-pair (fold), and a Menger affine
final lens render every Wood/Marble/Strata 1x/4x/16x/64x rung with zero
exhausted rays. The unchanged all-rung contract measures 9.3-34.9% residual
edge density (allowed 8-45%), 12.1-58.0% fine energy (ceiling 60%), and
27.3-66.8% 4-16 px energy (floor 25%). The weakest rung-to-rung residual
variance retention is 0.602 and the weakest 64x/1x ratio is 0.671 (required
0.60 and 0.50). Macro/world controls still collapse toward zero variance at
64x while the structured-detail rows retain material-scale variation.

V3 MACHINE VERDICT (`20260821-hybrid-v3-machine`, 96 px ladders): PASS. The
complete unchanged Menger, mandelbox-pair fold, and Menger final-lens matrix
passes every Wood/Marble/Strata rung at 1x/4x/16x/64x with zero exhausted rays.
Residual edge density is 9.3-30.0% (allowed 8-45%), fine energy is 11.4-58.0%
(ceiling 60%), and 4-16 px energy is 27.3-67.8% (floor 25%). The weakest
rung-to-rung residual-variance retention is 0.616 and the weakest 64x/1x
retention is 0.507, above the unchanged 0.60 and 0.50 floors. The passing
machine run emitted no blinded decks.

The historical V3 blinded-review fixtures were rendered at 288 px with one
mask-derived, pattern-independent camera per system. Every fixture had at least
10,000 object pixels, at least 55% object bounding-box width, no clipping, and
zero exhausted rays. Five decks received independent hidden permutations; the
key, unblinded sheet, manifest, and class counts stayed unavailable to those
reviewers until their choices and confidence scores were frozen.

Exact accepted V3 constants live in `src/fractal/surface-pattern.ts` (re-exported
by `finish-pattern-model.ts` for the harness) and the manifest:
Wood/Marble/Strata scales remain 3/1.35/2.6; all families crossfade fully to
structured detail; detail scale multipliers are 1/1.25/1; maximum dyadic octave
is 8; footprint full/off thresholds are 0.009/0.012; and native sheet warp caps
remain 0.08/0.10/0.08 cycles. Marble's detail uses one primary warped vein, a
low-frequency-gated 0.82 branch, a broad cloudy field, and fixed 2.25 ramp
contrast under light gray halo/core factors `[0.80,0.78,0.76]` and
`[0.40,0.43,0.49]`. The scored presentation uses the production shading
function with one fixed neutral studio finish (specular 0.1, shininess 16,
ambient 0.45) for every family and topology. Its fold-only eye/target/frame was
selected from the plain geometry mask and passes 288 px coverage, width,
clipping, and exhaustion checks without changing the machine camera.

Downstream calibration must sample finite native carriers deterministically,
retain p03/p97 low plus inverse-span, and disable spans below 0.02. It must not
replace the object-space Wood/Marble macro coordinates with rings or sheets.
The CPU cost contract remains three value-noise octaves: macro samples cost
48/48/24 lattice hashes and two-sample detail LOD costs 96/96/48 for
Wood/Marble/Strata.

The production coordinate/calibration contract landed in `fr-cmtl.3`.
`surface-pattern-frame.ts` names the raw-attractor source hit and its exact
reverse-routing order (balloon source, inverse 4D view at
`w0 + sStar*sliceHalfW`, then the affine or winning fold-final inverse).
`SurfaceDE`, `SurfaceDE4`, `EscapeDE`, `BulbDE`, and `EscapeDE4` each carry one
camera-independent `patternCalibration` with the shader-ready order
`(ringsLow, ringsInvSpan, sheetsLow, sheetsInvSpan)`; zero inverse-span is the
only disable bit. IFS builders reuse 256 evenly strided points of their
existing seeded 8192-point raw probe, while forward families use 256 seeded
uniform queries of their existing origin-centred ball. Final lenses therefore
leave calibration exactly unchanged. A dedicated session-entry gate builds a
12-map, depth-100 4D mandelbox system (eight 243-branch Mandelbox maps plus four
81-branch boxfold maps) in about 0.6-0.7 s on the development host and enforces
a 2.5 s developer-host ceiling, including the existing extent probe. The
wall-clock assertion is skipped on the shared coverage runner, where measured
contention inflated the same build to 4.1 s. Its exact finite-coordinate hot
loop uses the shader's `sqrt(sum-of-squares)` length arithmetic. No camera,
rotor, slice, visible radius, or duplicate bound enters calibration.

For comparison, the exact V2 constants were: scales
Wood/Marble/Strata 3/1.35/2.6, three noise octaves, detail scale multipliers
1/2.5/1, maximum dyadic octave 8, footprint full/off thresholds 0.009/0.012,
and native-warp caps 0.08/0.10/0.08 cycles. Macro samples cost 48/48/24 value-
noise lattice hashes; a two-octave detail LOD sample costs 96/96/48. Shader
feasibility therefore remains a downstream budget question, not a claim made
by this CPU gate.

V3 SEMANTIC VERDICT (`20260821-hybrid-v3-review`): PASS. Five fresh reviewers
received independently permuted 288 px lit-only decks after the machine pass.
The strict scorer accepted 43/45 decisions (95.6%, required 80%). Every fold
hero reached 5/5; Menger and final-lens Marble each reached 4/5 with median
confidence 4; all other Wood and Strata heroes reached 5/5 with median
confidence 4 or 5. Thus every hero clears 4/5 and median confidence 3. The
review key names `20260821-hybrid-v3-machine`; deck hashes and exact frozen
responses were stored beside the review manifest in that run's gitignored
artifact directory. They are not implied to be present in a fresh checkout.

HISTORICAL V2 SEMANTIC VERDICT (`20260821-hybrid-v2`): REFUSE. Five fresh reviewers using
independently permuted decks scored 31/45 cards correctly (68.9%, required
80%). Menger and final-lens Wood/Strata each reached 5/5, while Menger and
final-lens Marble each reached only 3/5 and was twice called
noise/corrosion. The fold heroes scored Wood 1/5, Marble 3/5, and Strata 1/5;
the failed answers split among plain, noise/corrosion, and the wrong material.
Per system this is 13/15 Menger, 13/15 final lens, and 5/15 fold. Thus the V2
machine pass is real progress but cannot approve any product family across
the required topology matrix. Exact responses and confidences were preserved
as `review-results.json` beside that historical run manifest; like all
`scripts/out/` contents, that file is external/run-local evidence rather than
a tracked repository artifact.

HISTORICAL V1 SEMANTIC VERDICT (`20260821-hybrid-v1`): REFUSE. Five
independent blinded reviewers scored only 18/45 cards correctly (40%, required
80%). Only cards 01 and 02 reached 4/5 recognition; the remaining per-card
correct counts were 2/5, 0/5, 0/5, 0/5, 2/5, 1/5, and 3/5. The V1 native ramp
also replaced 94% of the family macro at close-up, allowing retained variance
to mask corrosion-like detail. Those results remain evidence and were not
reinterpreted or waived; V2 keeps every numeric threshold unchanged and
requires a fresh blinded semantic verdict.

### pattern-release production-browser gate

`scripts/pattern-release.verify.mjs` is the production proof that follows the
CPU refusal gate. It reuses a healthy preview on port 4173 or starts and owns
one when needed, drives persisted `#v1` documents through the real app at
960×540/DSF 1, waits only for the eight-pass settled latch, and reads the
active session's exact engine, adapter, and terminal-ray census from
`?surfacestate`. A release-eligible run uses `--mode=x11::0` and refuses
software adapters; `--mode=sw` is diagnostic and exits inconclusive even if
its arithmetic passes.

Run candidate camera/pose calibration first:

```bash
npm run verify:pattern-release -- --phase=preflight --mode=x11::0
```

The 32-cell preflight covers 1×, 4×, 16×, and 64× on both engines, including
both 4D slices. Every rung is required because exhaustion is not monotonic as
the camera travels through a self-similar object; endpoint-only evidence once
missed a real 16× grazing-ray cliff. It emits `calibrations.json` only when
every cell has at least 5% object coverage, at least 10,000 eroded interior
pixels, and zero exhausted rays. During calibration,
`--only-hero=affine3|fold3|affine4` runs a bounded single-hero diagnostic but
deliberately cannot emit calibrations. The full machine run consumes the
complete preflight's exact, git-SHA-bound file:

```bash
npm run verify:pattern-release -- \
  --phase=machine \
  --mode=x11::0 \
  --calibrations=scripts/out/pattern-release-<run>/calibrations.json
```

The full hero matrix is 128 settled captures: pattern-none plus
Wood/Marble/Strata at 1×/4×/16×/64× for affine3, base-fold3, and two affine4
slices, on compute and WebGL. Compatibility pairs cover lens/fold-final,
escape, bulb, kaleido4/fold4 refusal, escape4, balloon, LUT, and by-transform
color. Effect-metric contract V2 keeps the 8–45% edge-density and 60% maximum
fine-energy checks at every rung, and applies the anti-speckle midscale floor
at the ordinary 1× view where it was specified. The production normalized
post-light residual uses a 22.5% midscale floor; this replaces the prototype's
25% floor measured on 96px pre-lighting CPU panels. Zoom ladders retain at
least 55% variance rung-to-rung and 50% from 1× to 64×, allowing one bounded
transition dip only when the end-to-end detail recovers.

The verifier compares lighting-normalized signed effect maps, not beauty
frames: correlation must be at least 0.85, effect-mask IoU at least 0.70, and
scalar metrics must agree within 15%. Engine parity is eligible only after
both arms pass the 5%/10,000-pixel coverage gate. The manifest includes the git
SHA, persisted hash and pose, stage, exact active backend, ray census,
threshold version, raw/effect/mask hashes, sheets, parity, and variance
retention.

A real-driver machine pass emits one permuted nine-card blinded owner deck and
a null-valued results template. It never supplies answers or a verdict. Show
the owner only `review-deck-01.png`, the five allowed choices, and the response
template. The key, unblinded sheet, manifest, and class counts remain hidden
until all nine choices, confidence scores, and the explicit owner verdict are
frozen. The verdict is one of `approve`, `request-changes`, or
`downgrade-name`; a downgrade also names the current family and a non-empty
replacement label. Then validate the frozen response with:

```bash
npm run verify:pattern-release-review -- \
  --key=scripts/out/<run>/review/review-key.json \
  --results=/path/to/frozen-review-results.json \
  --out=/path/to/review-score.json
```

The shared validator requires schema 3, the exact run and owner deck, one
response for every card, allowed choices, integer confidence from 1 through 5,
and a complete explicit verdict. Choice accuracy is reported as evidence, not
turned into a synthetic multi-reviewer threshold. Only the owner's explicit
`approve` passes the naming gate. `request-changes` and `downgrade-name` refuse
the current names, and malformed or pending input fails closed. A machine pass
remains pending, never a material-name release verdict, until that blinded
owner decision passes.

## The Surprise Me generator's sheet

### surprise-residual

The Surprise Me residual: how often a FLAT "Surprise Me" system that
cleared `randomSystem`'s
generation-time quality gate re-probes BELOW `MIN_OCCUPIED_CELLS` on fresh,
independently-seeded streams — the residual a finite-sample gate must have.
It measures the rate rather than ruling on it, so gate tuning can be A/B'd
against numbers; `SEEDS`/`PROBE`/`STREAMS` are env knobs.

## The escape-time family's sheets

### escape-form-sweep

The retired Julia form, still executable — the ORBIT form, not to be
confused with `escape-estimate-form` below.

### escape-estimate-form

The log-form refutation: swapping the fold family to the Böttcher log form
`0.5·|y|·ln|y|/dr` that `bulb-de.ts` and `qjulia-de.ts` use looks like a win
and is not a different bound at all. `log/linear` IS `0.5·ln r`, and an
escaping fold orbit lands just outside the radius-4 bailout ball, so the
ratio is pinned near `0.5·ln 4` — measured p50 0.744-0.819 across seven
fixtures. The control the original observation lacked is `linear x k`, one
constant, and it reproduces the log arm's whole result to within 0.00-0.45
hit points, beating it on `mandelboxCube`. Not boundary-adaptive either —
the near/far decile medians are flat on six of seven. And DIMENSIONALLY
WRONG once the fold's lengths are authorable: the fold family is
uniform-rescale equivariant, so an
estimator must satisfy `DE_λ(λp) = λ·DE(p)`; linear does BIT-EXACTLY, log
measures 44.8% median relative error, worst 107x, because `ln r` needs `r`
dimensionless and a fold's escape is asymptotically linear so the
Green's-function limit never arrives. `bulb-de.ts`/`qjulia-de.ts` differing
from `escape-de.ts` is correct BY CONSTRUCTION, not drift. Its docblock also
carries the live follow-up: the ~0.75 damping is reachable as
`ESCAPE_STEP_SCALE` 0.35 -> ~0.26 plus the acceptance epsilon, but that
re-opens the Mandelbrot-form cost/quality pick rather than winning
anything free.

### escape-chain

The formula chain's shipped cycling estimator, and the rejected per-pass
CHAINING arm beside it.

### hybrid-chain

The CROSS-FAMILY sheet: the prototype that asked whether the escape-time
family composes, now measuring the shipped answer against itself — it
cross-validates `estimateEscapeDistance` on bulb/qsquare chains
BIT-EXACTLY against its own independently-written orbit, and it is where
the power-link work's two verdicts are executable: that cycling dissolves
the power-link stiffness the prediction blocked on, and that the Böttcher
form is boundary-adaptive on a power-dominated chain where the log-form
sweep measured it flat on a fold one.

### chain-speckle

The supersampling and palette-ramp evidence: the speckle is sub-pixel, the
ramp is bottom-heavy.

### slab-ball-slack

The segment+ball-slack certificate's verdict, and the sheet whose INSTRUMENT
is the argument: a
BOXFOLD-ONLY system answers a spherefold question, because its two arms are
the two ENDPOINTS of the lift under test — the shipped exact segment IS the
segment+ball-slack state with no mid crossing ever, and `max(0, DE(p) - h)`
IS the same state with the crossing at depth 0, so the gap between them
BRACKETS everything the lift could ever buy.

Verdict NEITHER, keep the refusal: the cheap form is a DILATION and not a
slab — a crisp fractal becomes the bare marching ball at the slider's own
ceiling, 44.4% of rays at 0.0 steps/px — it is FURTHER from the exact slab
than doing nothing on two of four controls, it floats the whole surface
toward the camera rather than adding a rind (mean depth error 16.9-68.8% of
the marching ball against the point query's 0.8-15.2%), and it overcharges
the bound by one to two orders of magnitude through DIRECTION-BLINDNESS (a
true slab costs 0.3-15%, a ball 29-100%). Both forms are SOUND — 0
violations in 9600 checks — which settles nothing. And the threaded design
cannot be justified from outside the descent: its ceiling is reached only
where no mid crossing happens, i.e. on the systems that ALREADY have the
exact slab, while every system it is FOR crosses that branch. Two named
instruments would reopen it.

### escape-4d

The 4D chain's own measure-before-building sheet, and the one that
CONTRADICTS a prior record: an earlier sweep took the quaternion square's
`k` component — a `w` TRANSLATION — and found pure EROSION off the `w = 0`
slice, containment 94-98% and a blank frame by `w0 = 0.8`; a `w` ROTATION
reads containment 52-61% and still draws 16% of its rays at `w0 = 1.2`, so
roughly half of every offset slice is a genuinely different cut. That is the
empirical case for the 4D lift, and it is why the shipped 4D presets ROTATE
rather than translate.

Three more results: WHICH LINK carries the rotation decides everything — on
the head link it flattens the set along the rotated axis, x-extent
3.99 -> 1.29, and costs a third of the rays, where a POWER link costs
essentially nothing (47.9% -> 43.7%); a W-PLANE KALEIDOSCOPE has no visible
rosette, its symmetry plane containing `w` rather than lying in the
rendered slice, and is a measurable NO-OP at EVEN order — 1 point of 262144
differs at 2/4/6/8 against ~3700 at 3/5, so a preset authored at order 4
would silently be its 3D twin; and a pose ROTOR can CANCEL the document's
own `w` rotation, handing `mandelboxCube + xw = 1` back exact cube
proportions. Its refuted-in-sheet hypothesis is kept too: the entry-pose
hit drop is NOT sub-pixel structure the 8x settle supersampling would
repay — doubling the panel leaves the gap unchanged.

### bulb-preview

The Mandelbulb oracle's step-scale sweep.

### escape-family-preview

The three estimators side by side.

### qjulia-preview

Companion to `qjulia-beauty` below.

### qjulia-beauty

The quaternion Julia oracle's proof, and the twenty panels that demoted its
own WGSL/GLSL cores and its 4D lift to won't-do.

### flame-balloon

The flame balloon echo's histogram-weight decision, measured instead of
copying the Points arm's additive-blend dim constant. Three shipped systems
(tetrahedral, fern, and nonlinear radiolarian) render at weight 0.25 / 0.5 /
1.0 beside an echo-off control, with the same seed, enclosing ball, camera,
palette, and tone map in every column.

MEASURED VERDICT: weight 1.0. Echo-only/source mean-luminance ratios climbed
from 0.85 / 0.51 / 0.69 at weight 0.25, through 0.95 / 0.59 / 0.75 at 0.5,
to 1.04 / 0.67 / 0.78 at 1.0. No candidate produced a near-white pixel and
source-support luminance was effectively unchanged, so halving the deposited
weight bought no highlight safety; one source splat plus one full echo splat
was the clearest and most balanced histogram semantics.

The same sheet measured the Points arm's radial fade against no fade at the
frozen Flame frustum. At the 0.9x comparison radius it touched 0 of 31,570 /
47,031 / 80,000 visible echo samples. At the persisted 1.6x rest radius,
fade-on/off visible mass was 0.987449 / 0.115876 / 1.000000 (tetra / fern /
radiolarian): the fade erased 88.4% of the fern cave wall that still projected
on-screen. A Flame never re-fits its frozen camera, so those deposits cannot
drag bounds; the shipped histogram path deliberately keeps them and drops the
fade.

### julia-flame

The compositions three flame presets were picked from.

### spherefold-radius-sweep

The ratio sweep: the sphere fold's frozen `mR`/`fR` and the box wall, swept
as the
two DIMENSIONLESS RATIOS that survive conjugation — its conjugation-control
arm, exact at IoU 1.000 / relief 0.0000 over a 4x apparatus span, is what
makes the other columns shape differences rather than zooms; verdict: both
ratios are real, and the ONE-SHOT final-transform lens is the most
sensitive role of the three.

A follow-up added four arms where that sheet stopped, its estimator now taking
one parameter record PER LINK and cycling the chain like `runEscapeOrbit`,
wedge fold included, pinned bit-exact on 2-link, 3-link, order-5 and
order-3 systems: a chain DAMPS its own links 3.8-6.4x — the same map alone
against itself as link 0 of three — and the links barely interact
(0.72-0.91x at four of five arms); the BARE sphere fold has no escape-time
object at all, structurally, since without a box fold to bring points back
in the orbit is empty above `|w| ~ 1.2` and a heuristic-invisible smooth
solid below it, so the control runs through the LENS instead — where the
box must be pre-scaled into biting or the two rows agree at IoU exactly
1.000; the kaleidoscope is orthogonal to the ratio; and the ELIGIBILITY
SEAM (`SPHEREFOLD_LIPSCHITZ` IS the magnification ratio, so it moves both
gates) is reached by exactly ONE shipped system — `mandelboxKifs`, 9% away,
`mR` 0.478 instead of 0.500 — while the three escape presets would need
`mR > fR` and all three chains are unreachable at any ratio behind a
box-fold link that expands regardless.
