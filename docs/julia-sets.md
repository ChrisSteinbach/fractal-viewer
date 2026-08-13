# Julia sets by Inverse Iteration (fr-7u8t.1)

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
constants — see below for why two, and `presets.test.ts` for the tests that
pin the recipe (both the boundary-concentration property and the `z = 0`
pin) so it cannot silently rot if `julia` or the affine application order
ever changes.

## Two presets, one recipe

**`juliaSet`** (`c = −0.123 + 0.745i`, Douady's rabbit — the center of `M`'s
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

The **quaternion Julia set** rendered by the surface/escape-time pipeline
(`qjulia-de.ts`, epic fr-7u8t) is a different fractal by a different method:
`q ← q² + c` iterated forward in the quaternions and ray-marched with a
distance estimator, one dimension up from the plane. It shares the
`z² + c` (or `q² + c`) family and the letter `c`, but nothing else here —
no inverse iteration, no chaos game, no flame render. See that module's doc
and `docs/quaternion-julia-brief.md` for the relationship between the two.
