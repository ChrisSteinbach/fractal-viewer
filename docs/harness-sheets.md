# Harness Sheets

This is the catalogue `CLAUDE.md`'s Commands section points to. It is the
full per-sheet record — every measured number, every verdict, every bead id,
every refuted hypothesis — for this project's executable measurement records.

## What a harness sheet is

A harness sheet (`scripts/*.harness.ts`) is this project's executable
measurement record — the argument for a decision, kept runnable rather than
summarized. Run one with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>
```

Output lands under `scripts/out/`, which is gitignored — regenerate rather
than commit megabytes of PNG.

## The two shared instruments

`scripts/de-preview.ts` is the SHARED renderer eight of them import
(`renderPreview`, `writeContactSheet`, `encodePng`, and the
`DistanceEstimator`/`PanelStats` vocabulary): a CPU sphere-marcher with
AO/shadow switches, a settable step budget and an always-counted `exhausted`,
so a new sheet writes its estimator and its panel list, never a ninth
marcher.

`scripts/set-extent.ts` is the other shared instrument (fr-azjk): the ONE
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

## The escape-time family's sheets

### escape-form-sweep

fr-7u8t.8's retired Julia form, still executable — the ORBIT form, not to be
confused with `escape-estimate-form` below.

### escape-estimate-form

fr-282c's refutation: swapping the fold family to the Böttcher log form
`0.5·|y|·ln|y|/dr` that `bulb-de.ts` and `qjulia-de.ts` use looks like a win
and is not a different bound at all. `log/linear` IS `0.5·ln r`, and an
escaping fold orbit lands just outside the radius-4 bailout ball, so the
ratio is pinned near `0.5·ln 4` — measured p50 0.744-0.819 across seven
fixtures. The control the original observation lacked is `linear x k`, one
constant, and it reproduces the log arm's whole result to within 0.00-0.45
hit points, beating it on `mandelboxCube`. Not boundary-adaptive either —
the near/far decile medians are flat on six of seven. And DIMENSIONALLY
WRONG since fr-s9ll: the fold family is uniform-rescale equivariant, so an
estimator must satisfy `DE_λ(λp) = λ·DE(p)`; linear does BIT-EXACTLY, log
measures 44.8% median relative error, worst 107x, because `ln r` needs `r`
dimensionless and a fold's escape is asymptotically linear so the
Green's-function limit never arrives. `bulb-de.ts`/`qjulia-de.ts` differing
from `escape-de.ts` is correct BY CONSTRUCTION, not drift. Its docblock also
carries the live follow-up: the ~0.75 damping is reachable as
`ESCAPE_STEP_SCALE` 0.35 -> ~0.26 plus the acceptance epsilon, but that
re-opens fr-7u8t.8's deliberate cost/quality pick rather than winning
anything free.

### escape-chain

fr-za0n's shipped cycling estimator, and the rejected per-pass CHAINING arm
beside it.

### hybrid-chain

The CROSS-FAMILY sheet: the prototype that asked whether the escape-time
family composes, now measuring the shipped answer against itself — it
cross-validates `estimateEscapeDistance` on bulb/qsquare chains
BIT-EXACTLY against its own independently-written orbit, and it is where
fr-j231's two verdicts are executable: that cycling dissolves the
power-link stiffness the bead blocked on, and that the Böttcher form is
boundary-adaptive on a power-dominated chain where fr-282c measured it flat
on a fold one.

### chain-speckle

fr-vpbq's and fr-byxb's evidence: the speckle is sub-pixel, the ramp is
bottom-heavy.

### slab-ball-slack

fr-v7ca's verdict, in two rounds. The FIRST could only BRACKET the lift
under test, and the sheet's instrument was that argument: a BOXFOLD-ONLY
system answers a spherefold question, because its two arms are the two
ENDPOINTS of the segment+ball-slack state — the shipped exact segment IS
that state with no mid crossing ever, and `max(0, DE(p) - h)` IS the same
state with the crossing at depth 0. It established that the CHEAP form is a
DILATION and not a slab: a crisp fractal becomes the bare marching ball at
the slider's own ceiling (44.4% of rays at 0.0 steps/px), on two of four
controls it lands FURTHER from the exact slab than doing nothing, it floats
the whole surface toward the camera rather than adding a rind (mean depth
error 16.9-68.8% of the marching ball against the point query's 0.8-15.2%),
and it overcharges the bound by 4-335x through DIRECTION-BLINDNESS (a true
slab costs 0.3-15%, a ball 29-100%). Both forms sound, 0 violations in 9600
checks, which settled nothing.

THE SECOND ROUND BUILT THE THREADED STATE and closed the bracket. The
capsule `(q, e, rho)` now ships in `surface-de-4d.ts` — exact until the
first spherefold MID crossing, a ball from there down, floored at the public
entry by `DE(p) - h` — and section 4 scores it directly on the two systems
it exists for, one SHARP (two boxfolds under one spherefold) and one smooth.
It lands next to the cheap form: hit-mask IoU 0.78-0.91 between the two arms
on the sharp system, where a REAL slab shares only 0.27-0.57 of its pixels
with that arm; the ball's overcharge cut from 4-335x to 1.1-1.7x and no
further; 2-8x the render, and a kernel would also pay a per-slot f32 in the
2.2x register band fr-b72d/fr-d0nn measured. 0 soundness violations in 4800
checks and 0 queries below the floor, so the verdict is a COST one, not a
correctness one.

The STRUCTURAL reason it cannot do better is what makes this permanent, and
it is why the crossing-depth instrument the first round named as a wake
condition was never built: branch enumeration is UNCONDITIONAL, so a
mid-crossed chain exists at depth 0 on every map, and crossing only LOWERS a
chain's certificate — so the crossed chain competes for the min from the
first level on every spherefold system there is. The lift ships in the CPU
oracle and in NO renderer; `slabExact4` still gates every mirror and the
app's thickness row. One design remains unscored: a per-system THICKNESS CAP
over the cheap form, which needs no register and no second descent.

### escape-4d

fr-vag4's own measure-before-building sheet, and the one that CONTRADICTS a
prior record: fr-wuuu swept the quaternion square's `k` component — a `w`
TRANSLATION — and found pure EROSION off the `w = 0` slice, containment
94-98% and a blank frame by `w0 = 0.8`; a `w` ROTATION reads containment
52-61% and still draws 16% of its rays at `w0 = 1.2`, so roughly half of
every offset slice is a genuinely different cut. That is the empirical case
for the 4D lift, and it is why the shipped 4D presets ROTATE rather than
translate.

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

fr-7u8t.7's step-scale sweep.

### escape-family-preview

The three estimators side by side.

### qjulia-preview

Companion to `qjulia-beauty` below.

### qjulia-beauty

fr-7u8t.4's proof, and the twenty panels that demoted fr-7u8t.5/.6.

### julia-flame

The compositions three flame presets were picked from.

### spherefold-radius-sweep

fr-qi9c: the sphere fold's frozen `mR`/`fR` and the box wall, swept as the
two DIMENSIONLESS RATIOS that survive conjugation — its conjugation-control
arm, exact at IoU 1.000 / relief 0.0000 over a 4x apparatus span, is what
makes the other columns shape differences rather than zooms; verdict: both
ratios are real, and the ONE-SHOT final-transform lens is the most
sensitive role of the three.

fr-77oy added four arms where that sheet stopped, its estimator now taking
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
