# Julia sets by Inverse Iteration

The classic Julia set of `f(z) = z² + c` is completely invariant: `J = f⁻¹(J)`.
Writing the two inverse branches as `w±(z) = ±√(z − c)`, that becomes
`J = w+(J) ∪ w−(J)` — Hutchinson's IFS fixed-point equation, just with
non-affine maps. Running the chaos game on the branches (pick `±` at random
each step) is the classical **Inverse Iteration Method (IIM)** for plotting
Julia sets, and it falls straight out of this codebase's existing
vocabulary: `variations.ts`'s `julia` variation IS flam3's
`juliaN(power=2, dist=1)` — half the angle, square-root the radius, and a
random half-turn drawn from the RNG — which is exactly `w±`. No new render
mode, no new document field; the flame's plotted-point pipeline (`docs/
architecture.md`'s "The chaos game") already does the rest.

## The recipe

One transform, weight 1:

```
position   [-c.x, -c.y, 0]     // pre-affine translation by -c
rotation   [0, 0, 0]
scale      [1, 1, 0]           // z-scale 0 pins the sheet at z = 0
variations [{ type: "julia", weight: 1 }]
```

`stepOrbit` applies a transform as `V(Mv + t)` (see `chaos-game.ts`): with
`rotation` and `scale.x/y` at their identity values, `M` is the identity and
`t` is `position`, so this is `julia(v − c)` — the pre-affine translation
IIM needs before the branch map. `julia` itself carries `z` through
unchanged, so `scale.z = 0` is what actually flattens the cloud onto the
`z = 0` plane; without it the sheet would sit at whatever `z` the seed
point's warm-up happened to land on, not at `0`.

`presets.ts`'s `juliaSet` and `juliaDust` are this recipe at two different
constants. Those are the BUILDER function names, which is how the rest of
this document refers to them; the menu ids differ for one of the pair —
`juliaSet` is selected as `julia` ("Julia Set" in the menu, `#v1=` documents
and `<option value>` alike), while `juliaDust` is its own id — see below for why two, and `presets.test.ts` for the tests that
pin the recipe (both the boundary-concentration property and the `z = 0`
pin) so it cannot silently rot if `julia` or the affine application order
ever changes.

## Two presets, one recipe

**`juliaSet`** (menu id `julia`; `c = −0.123 + 0.745i`, Douady's rabbit — the center of `M`'s
period-3 hyperbolic component) renders a dense, richly detailed curve. It is
genuinely and robustly connected: the critical orbit of `z² + c` never
escapes, settling instead onto its attracting 3-cycle (confirmed bounded
over 50,000 iterations in `presets.test.ts` — not merely "hasn't escaped
yet within some arbitrary budget"). Measured 93.84% of 50,000 IIM-plotted
points land within 0.01 of the escape boundary of `z² + c` (8 probe
directions, 40-iteration forward test), against 8.39% for a uniform sample
of the same disk.

**`juliaDust`** (`c = 0.36 + 0.6i`) renders an unambiguous, visibly
separated Cantor dust — the same measurement gives only ~11%. This `c` is
verified outside `M` (the critical orbit of `z² + c` escapes at iteration
27, checked directly in `presets.test.ts` rather than assumed) with real
margin from `∂M`, not a near-boundary coin flip. The margin matters: a
disconnected Julia set's Cantor gaps shrink continuously to zero as `c`
approaches `∂M` from outside, so a `c` only technically outside `M` would
render a dust indistinguishable from `juliaSet`'s connected curve — the
whole contrast this pair of presets exists to show would vanish.
`juliaDust`'s clean, fast escape at iteration 27 is exactly that margin.

## Three showcases beside the two proofs

The pair above is deliberately austere, and it costs them: a LONE transform
parks the flame's colour coordinate at `derivedColorIndex(0, 1) = 0.5`
forever, so `juliaSet`/`juliaDust` are structurally incapable of colour
variation whatever palette they are given (measured hue entropy 0.04 against
`radiolarian`'s 0.80). They stay that way because what they exist to pin is
the RECIPE, which a blend or a second constant would put out of reach of the
tests above. `scripts/julia-flame.harness.ts` searched for what the recipe
can do when it is allowed to be an artwork, and three of its panels ship:

**`juliaIsland`** — the same exact IIM map at TWO constants, Douady's rabbit
and `−0.4 + 0.6i` (deep in `M`'s period-2 disc, whose Julia set is the
classic many-whorled spiral). Each alone is a genuine Julia set; both
together are the attractor of FOUR inverse branches, which is no
polynomial's Julia set — an island carrying the rabbit's dendrites and the
spiral's whorls at once. The second map is also the whole fix for the
monochrome defect: colour now tracks which branch the orbit took last
(hue 0.28).

**`juliaSnowflake`** — the island seen through a final `julia` LENS. The
plot-time map halves every angle and square-roots every radius, folding the
island into a two-fold star whose dendritic boundary wraps the origin. The
lens never feeds back, so the attractor under it is byte-for-byte the
island's.

**`juliaPinwheel`** — a counter-rotating `swirl` pair flattened to the
plane, through a final `julia` lens turned 1.1 rad, which doubles the spiral
and pulls its arms around the origin.

Any `c` is reachable and no other affine freedom is: a transform applies
`V(Mv + t)`, so a `julia` map behind a uniform scale and in-plane rotation
is still an exact inverse branch — of `λ(z² + c)`, linearly conjugate to
some `z² + C`. Scale and rotation only re-coordinate the picture, which is
why these presets spend their freedom on constants rather than on affine
noise.

The contrast is the textbook fact about the parameter `c`: for `c` outside
the Mandelbrot set, both inverse branches map a suitable disk containing `J`
into _disjoint_ sub-disks, so `J` is a genuine, totally disconnected Cantor
dust — a conformal IFS in the fullest textbook sense. For `c` inside `M`,
the branches are only locally defined (monodromy around the critical value)
and the "IFS" reading holds in a generalized conformal sense; the Julia set
is connected, exactly `juliaSet`'s case.

## Coverage bias: tips over fjords

The equal-weights chaos game equidistributes to the **balanced measure**
(Brolin 1965), which for polynomials is harmonic measure seen from
infinity — exponentially thin in fjords and spirals, thick at tips and
convex bulges. Naive IIM therefore draws a Julia set's tips well and starves
its recessed regions. This is _why_ the measured straddle fractions above
fall short of 100%: the residual is coverage bias plus the finite
(40-iteration) forward escape test used to probe it, not an error in the
recipe or an artifact of this implementation, and it applies equally to
`juliaSet` (connected) and `juliaDust` (disconnected) — harmonic measure
doesn't care which case a `c` falls in. It is the same bias flagged in
`docs/quaternion-julia-brief.md`'s Part 1, reproduced here because it
applies directly to what `juliaSet`/`juliaDust` render.

**Out of scope**: the real fix for the coverage bias is **MIIM**
(Modified Inverse Iteration Method) — breadth-first preimage trees pruned
by local derivative or cell occupancy, so the search spends its budget
where the naive method starves (Peitgen–Saupe, _The Science of Fractal
Images_; Fractint shipped this as its inverse-Julia mode). MIIM is a
different iterator, not a preset over the existing chaos game — it would
need its own accumulation loop, not a `Transform`. Deliberately not
attempted here; file a follow-up if the coverage gap becomes a real problem
for some use of these presets rather than a documented characteristic of
them.

## Related, but a different object

The **quaternion square** in the surface/escape-time pipeline
(`qjulia-de.ts`) is a different fractal by a different method:
`q ← q² + c` iterated forward in the quaternions and ray-marched with a
distance estimator, one dimension up from the plane. It shares the
`z² + c` (or `q² + c`) family and the letter `c`, but nothing else here —
no inverse iteration, no chaos game, no flame render. Alone it is not
rendered at all (measured smooth and detail-free); it reaches
the screen only as a LINK in an escape-time chain beside a fold,
which is what the **Hybrid Chain Quaternion** preset loads. See that
module's doc and `docs/quaternion-julia-brief.md` for the relationship
between the two.
