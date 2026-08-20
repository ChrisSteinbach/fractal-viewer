# The escape-time family (`escape-de.ts` / `escape-de-4d.ts`)

This is the full measurement record behind `src/fractal/escape-de.ts`. CLAUDE.md's
`escape-de.ts` bullet points here for the evidence; this document carries every
measured number, every table and every refuted claim.

## What the mode is and what it gates on

`escape-de.ts` is the escape-time fold render's CPU oracle, and now a HYBRID
FORMULA CHAIN: the canonical Mandelbox/Juliabox object and its
hybrids, for exactly the systems the IFS gate refuses — one or more flat maps of
which at least one does NOT contract, no final transform, no kaleidoscope that
rotates out of 3D. `analyzeEscapeSystem` is the deliberate COMPLEMENT of
`analyzeSurfaceSystem` on that shape, which admits exactly when EVERY map
contracts.

## The formula chain: cycling vs chaining

THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`): orbit step `i`
applies link `i mod n`, `+ p` and the bailout test after EACH link, and a PASS is
one full cycle. So `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the
GPU's `maxDepth` keep meaning "how many times is each link applied."

The rejected alternative, CHAINING (all n links inside one pass, i.e. the
per-PASS offset — the same fork under the prototype's other name), was measured
fattening toward a solid ball as links were added: 37.1% of the bailout ball at
six links against cycling's 0.2%, a 186x gap that widens with every link, the
near-sphere defect returning. It lives on as an executable local in
`scripts/escape-chain.harness.ts`, the sheet the SHIPPED estimator draws
(`scripts/hybrid-chain.harness.ts` is the prototype that asked the question
first, on the cross-family links this gate still refuses).

The cycle rides both shader mirrors too, so a CHAIN now renders what
this module estimates on every path: GLSL as one `uEscM`/`uEscT`/`uEscParams`
slot per link (24-slot cap — the descent's own, and the mode's, since
eligibility is one answer for both engines), WGSL as one `GpuMap` per link on
the maps storage binding. `EscapeDE extends EscapeLink` survives as the head
link's flat wire, now frozen layout ballast nothing reads to render.
ONE-LINK, UNSYMMETRISED SYSTEMS ARE BIT-IDENTICAL to the original
single-fold loop (pinned in `escape-de.test.ts` against a frozen copy of it).

## Power links

A LINK NEED NOT BE A FOLD: the chain admits the escape-time
family's two POWER maps beside its three folds — the triplex 8th power
(`bulb`, the Mandelbulb's map) and the quaternion square (`qsquare`) — so one
document can hold a Mandelbox and a Mandelbulb in ONE formula chain, which is
where Mandelbulber gets its range and the last thing this mode was missing.

Nothing structural moved: a link contributes its forward map and its LOCAL
Lipschitz factor, and both were already written down in the modules that render
those maps alone (`8·|y|⁷` from `bulb-de.ts`, a heuristic; `2·|y|` from
`qjulia-de.ts`, EXACT because quaternion norms multiply), so the chain composes
the shipped bounds and inherits their status rather than adding a new one.

A LONE power map is refused — the Mandelbulb render owns one and
`qjulia-de.ts`'s object is a measured-dull won't-do — which is what
keeps this gate DISJOINT from `analyzeBulbSystem` rather than merely ordered
before it, and costs no range because two power links ARE a chain. A power
link's WEIGHT is free (unlike `analyzeBulbSystem`'s lone map, which refuses
anything but 1: there is no textbook object here to deform away from, and `dr`
accounts for `w` exactly).

The orbit stays in `v` space with the literal `+ 1` — the power modules work in
`y` space and seed `dr` at `sigma_max(M)`; the two are the same recurrence in
different coordinates, but that factoring needs ONE `M` and a chain has n, so
staying in `v` is how a chain avoids choosing.

## The estimate form: linear vs Böttcher

THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW (`EscapeDE.logEstimate`, ONE
flag per chain resolved at build and carried on both wires rather than
re-decided in six mirrors): folds escape exponentially and read the linear
`r/dr`; a power link makes the chain super-exponential and it reads the
Böttcher `0.5·r·ln r/dr`, `bulb-de.ts`'s and `qjulia-de.ts`'s own form.

That does NOT reopen the sweep that refused the log form for the FOLD family —
its dimensional argument (the folds are uniform-rescale equivariant) cannot
reach a map with `V(λy) = λ^d V(y)` — and its decisive empirical control was
re-run here rather than waved past: the log/linear ratio's near/far decile
medians are FLAT for a fold chain (0.738 / 0.734, 1.00x) and for a
fold-TERMINATED cross chain, and reach 0.55x on a power-dominated one (1.347 /
0.735).

The rows where the ratio is not flat are exactly the rows where the form wins
big — on `mbox2 -> bulb(0.5)` the bound/step overshoot goes 7.4/1.0% -> 2.0/0.9%,
a 3.7x cut, against the 1.2x it buys where the ratio IS flat, which is the
constant that sweep already refused. It wins on all eleven measured rows, and at
frame level renders MORE surface for FEWER steps (52.68% -> 54.95% of rays at
22.2 -> 19.5 steps/ray), which is what "tighter near the surface, looser far
away" looks like.

## The stiffness prediction and its refutation

THE PREDICTED STIFFNESS HAZARD DOES NOT REPRODUCE, and it is the power-link
work's most useful result. The prediction blocked on it: a mandelbox step
leaves `|v|` near 7, a
triplex 8th power sends 7 to 5.8e5, so `mandelbox w=2 -> bulb` measured 0.01%
ball fill — a blank frame for the first thing anyone tries — and a second
prediction rode beside it, that CYCLING would not rescue it.

Both figures are the PROTOTYPE's CHAINING arm's, and the shipped orbit CYCLES:
`+ p` re-enters after every link, so a power link is applied to a point the
query has just tethered and its output is tested before any fold can compound
it. BOTH ARMS were re-measured at EQUAL WORK (30 passes each, one bailout ball,
one seeded 131072-point sampler — NEVER a grid, see below),
`scripts/hybrid-chain.harness.ts`, ball fill at pre-scale 1 / 0.6 / 0.5 / 0.4 /
0.3 / 0.2:

```
        mbox2 -> bulb     cycling  0.29 / 1.57 / 2.78 / 6.32 / 22.89 / 64.56 %
                          chaining 0.01 / 0.11 / 0.23 / 2.26 / 69.08 / 98.29 %
                          rays hit 11.0 / 26.9 / 39.1 / 55.0 / 64.8  / 14.4  %
        mbox2 -> qsquare  cycling  0.01 / 0.33 / 1.59 / 5.01 / 17.61 / 44.41 %
                          chaining 0.00 / 0.36 / 6.77 / 27.60 / 64.18 / 88.99 %
                          rays hit 15.8 / 40.7 / 49.8 / 50.6 / 55.9  / 28.5  %
```

The untuned pre-scale 1 — the exact case called blank — draws 11.0% of its
rays. Pushed the other way it stays renderable: 27x past the closed-form bound
(`escapeLinkStiffnessLimit`, kept executable as the refuted prediction's own
record) it still draws 0.75%, against 0.095% for the blank-frame notice's
degenerate system
through the same marcher.

AND CHAINING HAS NO USABLE RANGE AT ALL, which the fold-only chain sheet could
not see: it is 12-29x EMPTIER than cycling from pre-scale 1 down to 0.5 and
then, one step later, 3.0x and 1.5x FATTER at 0.3 and 0.2 — 69% and 98% of its
own bailout ball, the Julia form's "the rendered object WAS its own bounding
sphere"
returning intact. Nothing to a solid ball with no window between, where cycling
climbs smoothly and reaches neither failure.

SO NO AUTO-SCALE AND NO NEW SIGNAL — a hint computed from that bound was
written and then DELETED, because it fires on every row of that table and every
one of them renders, which is the blank-frame notice's second-cut lesson
verbatim.

The volume figures are the same trap one layer down, and the qsquare row is the
sharpest case this family has produced: 0.012% fill for a system that draws a
SIXTH of its rays, beside `mandelboxRings` reading 0.000% at the same sample
count while drawing 44.9% of them; the shipped `hybridChainCraters` preset
reads 0.011% while drawing 18.5%.

## Measuring emptiness: the instrument matters

THE INSTRUMENT MATTERS AND A FIRST DRAFT OF THIS RECORD GOT IT WRONG: ball fill
must be a seeded uniform sample against `escapeSetContains`, never a grid. A
fold's structure sits on its own walls — the integers, at the classic
`boxLimit` — so a grid whose planes land there over-samples them, and over
`[-4, 4]` the aligned resolutions are exactly `n - 1` in {8, 16, 24, 32, 40,
48}. On `mandelboxClassic`, n = 23..49 reads 4.54 / 9.33 / 3.44 / 4.63 / 3.60 /
7.96 / 5.98 / 5.61% — a 2.72x spread, no convergence, every aligned resolution
high — where the sampler reads 3.540 / 3.548 / 3.568% at 4k / 64k / 128k. THIN
sets only (a 22%-fill chain is 22.4-22.9% at every n), which is why it is easy
to miss: it bites exactly the rows a blank-frame question is about.

AND A DISTANCE THRESHOLD IS NOT A MEMBERSHIP ORACLE IN EITHER DIRECTION, which
is the larger of the two defects and is what manufactured the record's phantom
collapse: a small estimate means "near a boundary" for an ESCAPER too
(`escapeSetContains`' own doc), and CHAINING floors `dr` once per PASS, so a
hard-contracting chain keeps `dr` near 1 and returns O(1) distances at points
whose orbits never leave the ball — the recorded 0.47% at pre-scale 0.2 was a
set filling 98% of its own bailout ball, read as almost empty. Held at that
same 16-pass budget so the instrument is the only difference, its chaining row
re-reads 0.01 / 0.12 / 0.24 / 6.40 / 72.88 / 98.32% against the recorded 0.01 /
0.05 / 2.09 / 10.30 / 5.09 / 0.47 — 8.7x high at 0.5, then 14x and 209x LOW at
0.3 and 0.2, a different SHAPE rather than a precision error. The set-extent
correction carries both findings back to the sheets that predate this one.

EMPTY CHAINS ARE REACHABLE inside the gate — a big enough pre-scale escapes
everywhere on the first pass and the mode renders a blank frame — so
`escapeSetContains` (membership, from the same orbit the estimate reads) and
`probeEscapeFill` (a seeded sample of the bailout ball) exist to say so.
`probeEscapeFill` measures VOLUME and must not be read as "will it render": an
escape-time set is often a thin fractal, and the shipped `mandelboxRings` reads
0.0000% fill at 65536 samples while rendering ~38k surface hits — the
blank-frame notice's first cut toasted "looks empty" over one of the app's
own presets on exactly that confusion.

The quaternion k-component sweep turned up a STRICTLY STRONGER case, worth
quoting because 0.0000% still
reads as rounding: a `w = 0.4` slice of `hybridChainQuaternion` has LITERALLY
ZERO members in 524288 samples of its own bailout ball and still draws 20.9% of
its rays as a coherent shaded object with creases and highlights. A slice
through a set of shells is a set of surfaces, and no volume statistic can see
one. (`scripts/hybrid-chain.harness.ts` section 6, arm (e).)

The blank-frame signal fires off the FIRST completed settle's own hit count
instead (main.ts's `surfaceBlankNotice`, off BOTH engines' —
the compute arm counts ray statuses, the WebGL strip arm counts the COVERAGE
flag its tracer writes into alpha, which is invisible to the user, agrees with
the compute arm on ground-plane pixels, and is free to read in the full-frame
readback the strip arm's supersampling accumulator already pays for): a
frame that drew essentially nothing at the entry pose — where the camera has
just glided to frame the whole bounding ball — IS blank by the renderer's own arithmetic,
so it cannot disagree with what the user sees. The bar is
`SURFACE_BLANK_HIT_FRACTION` (0.001) and NOT zero, because the marcher accepts
at `uAcceptPixelEps` and a few rays catch even a degenerate system: measured at
1024x640, the nine shipped presets hit 5.0-10.3% of rays and a Mandelbox
pre-scaled by 8 hits 0.019%, a ~260x gap this sits inside. It reports, never
refuses, and covers the lone-spherefold empty set and the bulb arm by the same
evidence. Neither probe is wired into `analyzeEscapeSystem` or
`buildEscapeDE`, which stay cheap.

## Bailout, step scale and cost

`estimateEscapeDistance` iterates the maps FORWARD with ONE shared scalar
running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's standard
heuristic, not a certified bound), mirrored by `surface-material.ts`'s
`SURFACE_ESCAPE` variant and `surface-de-gpu.ts`'s
`core:"escape"` kernel. `ESCAPE_STEP_SCALE` is the one marcher-damping
definition both the GLSL variant and the WGSL packer import, and it stays 0.35
at EVERY chain length, MEASURED rather than assumed: the chain work predicted
chains
would need heavier damping, and both harnesses refute it (the single map's
hit-coverage curve is the steepest of eight fixtures, and as a fraction of its
own 0.05 asymptote 0.35 reaches 96.6% for a chain against 95.7% for the
control). Cycling floors `dr` after every link, so no two folds compound
between floors and the slack per step is the single map's. Composition in fact
BUYS bound quality: bound/damped-step violation rates over a common bailout
ball run 13.4%/6.6% for the shipped single map against 4.3%/1.5% (two links)
down to 1.5%/0.6% (six).

Bailout stays 4 for the same measured reason it always was — raising it at a
fixed budget inflates the set rather than revealing it (control fill 3.6% ->
51.5% -> 53.2% at 4/8/16 over a FIXED radius-4 reference ball, against the
set-extent correction's reading of 2.9% -> 57.7% -> 65.6%: a 14x inflation
on the first doubling and a plateau after it). What it is NOT is a ball the
chains strain against — that claim inverted on re-measurement: cycled chains reach 1.96-2.94
where the single map reaches 3.06, so 4 is generous for a chain and right for
the map it was chosen against.

Phone-cheap by construction (~30 branchless folds per link per eval; measured
over the BAILOUT ball the marcher actually enters, 0.18 us/eval at one link and
0.07-0.23 across eight chains — at or BELOW the single map on every row,
because the n-times budget is a ceiling only a non-escaping orbit pays and
every extra link is another chance to escape). The set-extent correction's
figures had to separate the DOMAIN out first: priced over each row's own
fitted ball instead, which crowds queries against the set, the same rows
read 0.22 and 0.28-1.27 — the record's 0.25 / 0.27-1.10 / 0.60 was that column, taken when
the fit came from the aliased instrument. Both are printed now.

A CROSS-FAMILY CHAIN CAN ALSO BE CHEAPER THAN THE SINGLE MAP, the same result
from the cost side: priced as ratios in one run, `mbox2 -> bulb(1)` is 0.54x
`mandelboxClassic` and `bulb -> bulb rot20` 0.95x, against 1.26-1.80x for the
rest — a stiff link means most orbits leave on the first pass and never reach
the second link, let alone the 30-pass ceiling.

f32 is safe on the GPU mirrors too (worst `dr/r` 2.6e13 over 200k queries,
twenty-five orders under 3.4e38, zero non-finite): the bailout test bounds
`|v|` entering every link and the per-link `+ 1` floors `dr`.

## Kaleidoscope

KALEIDOSCOPE is a query-space wedge fold (`foldQueryIntoSector`), not an orbit
operation: `g` is 1-Lipschitz and an isometry per sector, the orbit is seeded
AND offset by `g(p)`, so the set is exactly `g^-1(M)` — dihedral rather than the
chaos game's cyclic (a cyclic fold is discontinuous and would certify empty
balls across the seam), free per orbit step, and `SymmetryParams.blend` is
deliberately unread exactly as in `surface-de.ts`.

## Per-link fold lengths

EACH LINK CARRIES ITS OWN FOLD LENGTHS (`EscapeLink`'s
`boxLimit`/`minRadius2`/`fixedRadius2`, resolved once at build), so a chain may
hold a different sphere/box apparatus per link, and `foldLipschitz` tests the
real magnification `fR²/mR²` rather than the frozen 4 — which is what keeps
this gate the exact COMPLEMENT of the IFS one as the knob moves. Pinned against
an INDEPENDENT oracle: `scripts/spherefold-radius-sweep.harness.ts`'s own
parameterized copy of `runEscapeOrbit`, written for the ratio sweep's sheet
and pinned
at the classic lengths before any of this existed, agrees bit-exactly over 12k
queries including a two-link chain whose links carry DIFFERENT radii.

## The Mandelbrot form and the retired Julia form

The rendered set is the MANDELBROT-form set — the per-iteration offset is the
QUERY POINT, which is what makes it the object published Mandelbox
renders show. The mode had originally shipped the Julia form (offset = the
document's
`t`), and it rendered a near-SPHERE: 89.4% of the bounding ball non-escaping at
the bench fixture's own constant, against the shipped form's 3.5%.

`t` survives as the PRE-fold offset — a live deformation knob, classic
Mandelbox at `t = 0` — so the mode still adds NO document state and stays a
render MODE over the existing vocabulary (morphs/mutations/persistence
untouched).

The Julia form was measured, not merely argued away, and lives on as a local in
`scripts/escape-form-sweep.harness.ts`: at weight 2 it fills 87.2 / 71.8 /
32.6 / 2.1 / 0.005% of the bailout ball as |t| runs 0.5 / 1 / 1.5 / 2 / 2.5, so
it does not merely thin late — it goes from a third of the ball to a
measure-zero dust in one step, with no usable band in between, and is a pitted
ball even at its best. It does not earn the permanent document flag it would
cost.

## The 4D lift's presets

`escape-de-4d.ts` reaches three shipped presets, from the 4D menu group
rather than the Escape-time one. `mandelboxBrick` and `mandelboxColumn` are
the same map (`mandelboxCube`'s) turned in `xw` and in `yw` — a pair chosen
to show that the rotation plane picks the long axis: measured per-axis
extents 3.13/2.00/2.00 for the `xw` turn and 2.00/2.49/2.00 for the `yw`
turn, against the 3D cube's own 2.00/2.00/2.00. That is a 4D rotation
legible as a 3D proportion, and the one place the rotor slider reads as
geometry rather than as a tumble — posing the view with an `xw` rotor
CANCELS the brick's own `xw` turn and hands back the exact cube
proportions.

`hybridChainShells` is `hybridChainQuaternion` with the rotation placed on
its POWER link rather than its head link, chosen because that measured the
cheapest link position to rotate: 43.7% of rays render against the 3D
twin's 47.9%, where the same rotation placed on the head link instead costs
a third of the rays that would otherwise render.
