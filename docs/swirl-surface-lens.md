# Swirl final transforms in Surface

The supported operation is one pure, nonzero-weight `swirl` **final
transform**, in 3D and 4D. It wraps the existing IFS estimator once. It does
not admit swirl as a recursive map or a weighted variation blend. A thick
4D slice remains refused: the inverse of its straight segment is curved,
so the straight-segment certificate used by `slabExact4` does not apply.

The supported pre-swirl radius is **rho <= 0.5**. This permits up to
`rho² = 0.25` radians (14.32 degrees) of radius-dependent twist beyond
the fixed xy quarter-turn. Its ideal constant is G = 2; the shared f32
coefficient is `2.000000238418579`. The cap is a measured march-budget
decision after correcting acceptance, not an assertion that stronger
swirl loses its inverse.

**This is not an absolute high-resolution silhouette pass for thin 4D
slices.** The accepted policy adds no acceptance shell to the raw oracle,
and the measured 128/256/512 panels finish within 160 steps. Nevertheless,
TESS-TILT has 14 coarse hits more than two coarse pixels from the finer
reference, with a maximum of 12.083 pixels. The finite ambient-4D hit
tolerance still draws some near-miss pieces that disappear as tolerance
shrinks. The separate evidence below preserves that limitation.

The CPU source of the shared constants, inverse and radius rule is
[`src/fractal/swirl-lens.ts`](../src/fractal/swirl-lens.ts). The numerical and
visual record is [`scripts/swirl-lens.harness.ts`](../scripts/swirl-lens.harness.ts).

## Separate march stride and hit acceptance

March queries have a paired `{stride, d}` form. `d` retains the original global-G
distance, and the primary cutoff remains `max(pixelSlope*t, numericFloor)/G`.
Scalar evals, normals, AO and hit-info attribution retain that same original
distance. A faster stride therefore cannot make a fixed query accept a thicker
surface or choose a different Balloon material.

Production retains the established global-G stride for the primary fractal,
including scenes without Balloon. The faster pair is used for the echo's
inverse query. Applying the local stride to both terms finished the production
frames but failed the existing CPU/GPU trajectory gate on three 3D rows;
rounding the CPU inputs or step accumulator to f32 did not fix those failures.
Those alternatives were rejected, with no tolerance changes. Retaining the
primary stride and damping extra echo travel near a hit qualifies both the
existing ray-agreement gate and all four default-radius production cases.

Let `f = sigma_min(post) * abs(weight) * sigma_min(preAffine)`, `u` be the
un-posted and unweighted query, and `D` the existing raw core result after
inverse swirl and inverse affine. A lens sample uses:

```
d      = max(visibleSphereFloor, f*D/G)
stride = max(visibleSphereFloor, f*D/L)
```

`L` is the minimum of G and the segment, chord and saturated-rotation
certificates below, each valid against **every** point of the source ball.
The last certificate is `1 + 2*rho/(|u|-rho)` when `|u|>rho`; it tends to one
for remote inverse queries. The smaller bounds carry a relative `2^-20`
rounding margin, and nonfinite query radii fall back to G. The full radius
includes z and w; the inverse order and signed weight are unchanged.

Inside the visible ball, `d < epsilon/G` is exactly `f*D < epsilon`.
Outside it, the unchanged sphere floor can only reject extra queries.
Positive Balloon scaling and the minimum act independently on each component:
the acceptance minimum remains the old predicate even when the two query
certificates differ. Analytic clip and lattice floors act componentwise by
maximum, so they cannot enlarge it either. The acceptance argmin still owns
the shell flag; the stride argmin is allowed to differ.

The cutoff contract needs two guards. A visible floor already at or above
cutoff forces a full raw query: an inexact raw early return must not become
a longer usable stride. A returned acceptance below cutoff carries
`stride=d`, because no primary step is taken there. If an outer clip rejects
that sample, its floor dominates **both** components and is itself the safe
stride. Each union term still evaluates its raw core once. Pixel footprints
continue to scale by f, independently of either certificate.

### Transporting the empty ball through Balloon

The local swirl certificate alone did not finish the default-radius 3D
cases. The second improvement transports the inner estimator's **empty ball**
through inversion, supplementing Balloon's original enclosing-set bound.
For `a=I(p)`, `r=|p-c|`, `s=|a-c|=R²/r`, and a full certified inner stride
`h <= distance(a,S)`, every source point y satisfies:

```
|p-I(y)| = r*|a-y|/|y-c|
         >= r*|a-y|/(s+|a-y|)
         >= r*h/(s+h).
```

Thus the shell stride is `max(r*h/rho, r*h/(R²/r+h))`, with the same small
rounding margin on the second certificate. This remains valid when the empty
ball reaches the inversion centre; it does not assume that its image is a
bounded ball. `inversionDistanceLowerBound` and its shared GLSL/WGSL expression
own this dimension-independent arithmetic in `inversion.ts`. The 4D Surface
wrapper still slices before inversion and therefore uses this same 3D bound.
The extra certificate is disabled on cutoff-shortened inner hits and in the
numeric centre-floor region. Acceptance and the original `r*d/rho` term stay
unchanged. Non-swirl systems retain their existing strides.
Before taking the stride minimum, the echo transitions continuously back to
its original stride over the last quarter of an inner cutoff. With inner
acceptance `dI`, cutoff `cI` and the new shell certificate `sNew`:

```
a = clamp(4*(dI/cI - 1), 0, 1)       when cI > 0; otherwise 1
sOld = (r/rho)*dI
shellStride = sOld + a*(sNew-sOld)
stride = min(dFractal, shellStride)
d = min(dFractal, sOld)
```

This convex combination cannot exceed the certified new bound or fall below
the old one. It changes travel only; the complete epsilon, cutoff, hit
predicate and shell attribution remain unchanged. The shared
`SWIRL_BALLOON_STRIDE_TRANSITION` owns the quarter-width in CPU and shader
mirrors. No new document field or GPU wire lane is needed.

Undamped echo travel completed the default frames but used 10 hit-corridor
exceptions where the existing GPU gate permits 7. Keeping half the extra
advance at the boundary used 15. A transition one full cutoff wide passed ray
agreement but left 5/2 exhausted 3D compute/WebGL rays; half-width left 1/0.
Quarter-width passes both gates. Applying even the damped local stride to the
primary term reintroduced a divergent CPU-hit/GPU-miss ray, so that term keeps
G. These are stride-policy measurements, not changes to comparison limits.

### Fixed camera and Balloon ball controls

The production-browser baseline was preserved before any renderer edit.
`surface-swirl-stride-control.verify.mjs` verifies a frozen source tree and
exactly three diagnostic-only primary-advance substitutions. It replays the
same production-copied document and checks equal camera, rotor, raw/visible
bounds, lens coefficients, G, step scale and Balloon centre/rho/R. Multiplying
only the advance by G is an **unsound counterfactual**, never a candidate or a
qualification pass. It isolates the stride cost without changing geometry,
the primary epsilon, cutoff or fixed-query predicate.

AMD Radeon RX 7900 XTX, 960×540, eighth settle pass, default Balloon radius
1.6; every row has 518,400 rays:

| Scene / engine | Original exhausted | Unsound stride × G | Local swirl only | Qualified echo stride |
| -------------- | -----------------: | -----------------: | ---------------: | --------------------: |
| 3D compute     |              2,872 |                  5 |               74 |                     0 |
| 3D WebGL       |              2,213 |                  4 |               43 |                     0 |
| 4D compute     |                112 |                  0 |                0 |                     0 |
| 4D WebGL       |                118 |                  0 |                0 |                     0 |

The local-only column used local certificates on both terms. Keeping G for
all swirl strides while adding only the empty-ball inversion
still left 15/5 exhausted 3D compute/WebGL rays. Allowing the smaller swirl
certificate only outside the source ball left 14/4. Both were rejected.
The paired echo composition and near-hit transition are needed; the march budget and comparison
tolerances are unchanged. The production gate now includes these near-cap,
default-radius fixtures alongside the existing visible early-echo fixtures.
`--measure` saves the whole failing census and always exits 2; it cannot pass
the qualification accidentally.

## Paired-stride qualification record

Measured on the AMD Radeon RX 7900 XTX (WebGPU `amd rdna-3`,
`software=false`; WebGL ANGLE/radeonsi), with the existing comparison limits:

- `npm run bench:surface -- --display=:0 --chrome=bundled --surface-timing=0`
  passes all 90 gating eval rows among 105 measured rows, including eight new
  stride eval rows, and all eight swirl app-ray rows. Optional timing sweeps
  are disabled; every numeric and production-frame gate still runs. The 3D
  Balloon ray row uses 5 of the existing 7 permitted hit-corridor matches.
- `node scripts/swirl-glsl.verify.mjs --display=:0` passes 2,800 actual
  float-target queries through the production 3D/4D materials and packers,
  with scalar acceptance, paired stride, cutoff and clip-floor comparisons.
  Both Balloon rows exercise the transition (30/29 queries) as well as hits
  and misses; all shader/console errors and numeric failures are zero.
- `node scripts/surface-swirl.verify.mjs --display=:0` passes all 16
  production captures at 960×540 after eight settle passes: plain scenes,
  visible early echoes, near-cap default-radius echoes and menu showcases,
  through both engines. Every capture completes all 518,400 rays with zero
  exhausted rays; copy/reload, preset-final clearing and slab refusal also
  pass. The saved same-camera baseline comparison above holds its document,
  camera and Balloon ball fixed.

The fixed-geometry gate is:

```bash
SWIRL_MARCH_QUALIFY=1 npx vitest run --config scripts/vitest.harness.config.ts scripts/swirl-lens.harness.ts -t 'qualifies paired stride'
```

It uses the shared renderer, at pre-swirl radius 0.5, with the original fixed
camera and tilted zero-thickness slices. The Balloon reference uses radius
0.35 and a fixed observation ball reaching the far-cap radius, so both the
primary set and a visible echo participate. Its separate un-divided raw
predicate uses exactly the same stride, camera, geometry and bounds.

| Fixture          | Plain max steps, 128/256/512 | Balloon max steps, 128/256/512 | Coarse Balloon echo / primary hits |
| ---------------- | ---------------------------- | ------------------------------ | ---------------------------------- |
| Tetrahedron      | 60 / 84 / 115                | 68 / 92 / 123                  | 477 / 2,142                        |
| Tilted pentatope | 67 / 75 / 108                | 76 / 87 / 116                  | 336 / 294                          |
| Tilted tesseract | 70 / 101 / 132               | 84 / 110 / 141                 | 215 / 1,603                        |

All eighteen panels have zero exhaustion. All six coarse masks equal their
matched raw-acceptance controls exactly, with zero newly joined control gaps.
The largest actual step count is 141, below the unchanged 160-step cap; the
600-step reference allowance only measures exhaustion beyond that cap and
cannot turn such a row into a pass.

The finer panels also disclose the raw predicate's resolution sensitivity.
Balloon coarse-to-fine outward maxima are 0.725, 6.769 and 13.158 coarse
pixels for the three fixtures, respectively. These differences remain visible
in the contact sheets and carry no relaxed passing threshold. The fixed-query
proof and exact matched-raw masks establish acceptance equivalence separately.
Measurements and contact sheets regenerate under `scripts/out/swirl-march-*`.

## Discoverable presets

**Swirl Tetrahedron** sits beside the Surface showcases in the preset menu;
**Swirl Pentatope** sits in its 4D group. Both reuse the ordinary sibling's
maps and install one final through `PRESET_FINALS`, with a Surface render
hint. Their uniform pre-scales are 0.27 and 0.47, with reciprocal variation
weights preserving visible size. A pre-rotation cancels swirl's fixed
quarter-turn so the radius-dependent bend is clear; the Pentatope also has
a fixed xw tilt of 0.45 radians for its opening zero-thickness slice.

The actual builders give pre-swirl radii 0.478877 and 0.484906. Unit tests
check the complete compositions against the same eligibility and radius
rules used by the app. The browser gate selects both from the real menu,
requires their Surface hints to activate, checks that an ordinary preset
clears the final, reselects each showcase and reloads its copied link before
capturing it through both engines. Existing user look settings, including
Balloon, retain the preset loader's ordinary behavior; these showcases are
composed with Balloon off.

## Editing the radius

**Transforms → Final Transform → Variations → Swirl → Radius** exposes the
derived bound directly, beside the Swirl weight. **Fit for Surface** sets an
oversized radius to the supported endpoint. The range has an exact numeric
companion, and an unsupported blend or raw system keeps the control disabled
with its reason. Its Scene / Look placement and per-renderer edit timing follow
the ordinary final-transform editor.

`swirl-lens-edit.ts` derives the radius with the same raw builders, symmetry,
schedule and 3D fitted / 4D origin-centered balls used by Surface. To change
radius from `rho` to `target`, it multiplies the final's entire pre-affine
matrix and translation by `target/rho`, then divides the Swirl weight by that
ratio. This changes the radius-dependent xy turn while preserving the
pre-post output norm and carried z/w coordinates. Rotations, shear, signed
scales, signed weights and the post-affine remain intact. Explicit W scale and
position follow the edit; inherited W scale remains inherited. Radius is an
authoring convenience over existing fields, not a new variation parameter.

The numeric domain respects the scene codec's weight and explicit W limits.
An automatic W scale may be smaller than the explicit W range; its readout
stays automatic, invalid materialization is refused with an adjacent reason,
and valid explicit W edits remain available before mirroring.
At exactly 0.5 the setter uses a tiny inward floating-point margin and the app
rechecks the actual candidate before accepting it. The scene encoder retains
full precision for radius-affecting geometry while a pure Swirl final is
active, including base maps, fold lengths, emitter shapes and scheduled B.
Keeping only the final precise would be insufficient: rounding a base map
changes the raw ball too. Other scenes keep their existing compact encoding.

Opening the original showcases also exposed an editor defect: their
reciprocal weights exceed the ordinary variation range of ±2. Numeric bounds
now expand to the authored value, including coupled scales below the guide
range. Weight-only updates retain their DOM controls so a compensated radius
edit keeps focus and reaches the delegated commit once.

The production authoring gate is
`node scripts/final-swirl-radius.verify.mjs --display=:0` after build/preview.
It exercises manual construction and both showcases through trusted touch and
keyboard input, checks the copied document after editing, undo and reload,
then captures the resulting 3D/4D scenes through compute and WebGL.

Measured on 2026-09-08 with the AMD RX 7900 XTX: all four authoring cases
and eight resulting captures passed at 320×727, each capture completing
518,400 rays with zero exhausted rays. The first 393px run had passed, but a
320px follow-up caught a 46.19px field clipping its 57px content. Reclaiming
the unused remove-button column widened the final field and track to 89.19px;
the field remains 44px high and the corrected panels were visually inspected.
The existing numeric-control gate also passed at 393px across 84 states and
100 distinct sliders, including trusted touch, keyboard and refusal checks.

## Inverse and distance certificate

Write `S(x)` for rotation of xy by `pi/2 - |x|²`, carrying every other
coordinate unchanged. Radius is the **full** 3D or 4D radius, including w.
The map preserves it, so `S⁻¹(u)` is the opposite rotation evaluated at
that same radius. With `s = sin(|u|²)` and `c = cos(|u|²)`, its xy result is
`(u.x*s + u.y*c, -u.x*c + u.y*s)`. Its z and w remain unchanged. No branch
enumeration or numerical inverse is needed.

Let `J` rotate xy by pi/2 and annihilate z/w. Up to an orthogonal factor,
the derivative is `I ± 2 Jx xᵀ`. Since `Jx` is perpendicular to `x`, its
nontrivial singular values are those of a shear with magnitude
`2 |x_xy| |x|`. Its norm is

```
sqrt(1 + |x_xy|² |x|²) + |x_xy| |x|
    <= sqrt(1 + r⁴) + r²       when |x| <= r.
```

For a query u and any point y of a set enclosed in `ball(0,rho)`, the
connecting segment lies in `ball(0,max(|u|,rho))`. Integrating this
derivative bound therefore certifies the whole segment; evaluating a
Jacobian only at u would not.

A second bound follows independently by adding and subtracting the
rotation of y through u's angle. The rotation difference has norm at most
the absolute angle difference, which is bounded by
`(|u| + |y|) |u-y|`. Only y's xy component moves, and it is at most rho.
Consequently

```
L(u,rho) = min(
  sqrt(1 + max(|u|²,rho²)²) + max(|u|²,rho²),
  1 + rho*(|u| + rho)
)

|S⁻¹(u) - S⁻¹(y)| <= L(u,rho) |u-y|.
```

Both inequalities hold for **every** set point, so taking their minimum
and then the infimum over the set is valid. A lower bound d on distance
to the raw set becomes `d/L` through the inverse swirl. This wrapper
inherits the existing estimator's finite-depth and beam approximations;
the certificate does not turn those approximations into exact membership.

This query-dependent L is the original spike's certificate. It remains in
the harness as a refused acceptance policy: dividing distance by L while
keeping the usual hit epsilon activates extra near-miss pieces of a thin
4D slice. Merely reducing rho did not remove those false pieces on the
tesseract fixture, even at rho 0.15.

The executable proof uses the production **forward** variation, not the
inverse under test, and known exact singleton distances. It covers 60,000
3D/4D pairs, including near-coincident points and exact flat-dimensional
parity. The original run's maximum round-trip residual was `9.75e-15` and
maximum lower-bound / true-distance ratio was `0.99710`.

## Original global-G policy and retained acceptance

The original certificate, retained for acceptance, is a constant bound for every query
against a set enclosed in `ball(0,rho)`:

```
G(rho) = 1 + rho² + rho*sqrt(rho²+2).
```

Set `R = sqrt(rho²+2)`. Inside query radius R, the original chord bound is
at most `1 + rho*(R+rho)`. Outside R, use the saturated rotation bound
`|(Ru-Ry)y| <= 2|y_xy| <= 2rho` instead of an unbounded angle difference:

```
|S⁻¹(u)-S⁻¹(y)| <= |u-y| + 2rho
|u-y| >= |u|-rho > R-rho.
```

The ratio is therefore at most `1 + 2rho/(R-rho)`. This is exactly the
inside bound because `(R-rho)*(R+rho)=2`. Hence G works for **every query
radius**, including points produced by an anisotropic post inverse or by
Balloon near its inversion centre. This is a bound on pairs with one
endpoint in the bounded set, not a claim that swirl's unbounded derivative
has a global norm bound over all space.

The constant matters to composition. Divide the certified distance by G
and divide the **whole primary-hit epsilon** by the same G. A finite raw
distance is then accepted at exactly its ordinary affine-scaled tolerance,
without the additional shell introduced by the inverse certificate. G
commutes with the positive scale and minimum in Balloon's two terms, and
with the minimum over tiling copies. Existing sphere and region floors
can only make acceptance stricter outside their own bounds. No separate
per-query hit-distance API or bound on the inversion query was needed for
that original policy. The paired API above now separates travel to recover
its compositional march cost, while preserving this acceptance argument.

`swirlGlobalInverseLipschitz` evaluates the formula with a 32-f64-epsilon
relative margin and rounds **up** to f32. The lens stores that exact f32
number once, so CPU distance, GPU upload and acceptance use the same
coefficient. The primary cutoff is
`max(pixelSlope*t, numericRadiusFloor)/G`: leaving the numeric floor
unscaled would restore enlargement as the view gets finer. Normal-probe
spacing, material pattern footprints and start dither keep their original
pixel units.

A second 60,000-pair proof includes queries up to 1,000 units away from
the set, as well as near pairs, exact radius-zero isometry and both
dimensions. It also checks that packing G to f32 cannot shrink it below
the unrounded formula. The displayed qualification uses the production
helper, while exact singleton distances and the production forward map
remain independent of the distance wrapper.

## Composition, bounds and cutoff

For a final transform `F = P ∘ (w*S(Mx+t))`, a visible query must pass
through these operations in this order:

1. Undo the post-affine P.
2. Divide every coordinate by the **signed** variation weight w.
3. Invert swirl using this unweighted point's full radius.
4. Undo the pre-variation affine Mx+t.

The existing core then evaluates the raw set. Its distance is multiplied
by `sigma_min(P) * |w| * sigma_min(M) / G`. The lens descriptor's
`sigmaMin` already holds the separated product of the two affine minima;
the post minimum must not be multiplied a second time.

If the raw set is enclosed in `ball(b,R)`, the pre-swirl radius is
`rho = |Mb+t| + sigma_max(M)*R`. In 4D the raw enclosing ball is centred
at the origin, so b is zero. Swirl preserves this radius. The output
radius is bounded by `sigma_max(P)*|w|*rho + |P.translation|`. A large
weight changes output size but cannot reduce twist strength: it occurs
**after** the nonlinear map. The analyser and builder use the same raw
enclosing-ball calculation and radius rule.

The existing cutoff contract scales exactly. If the affine/weight factor
is f, the march's compensated outer cutoff `e/G` becomes
`(e/G)/(f/G) = e/f` in the core. A returned value at or above the supplied
outer cutoff is the full result; an early return below it certifies that
the full result is also below it. The visible-radius floor must guard
the early-return path just as it does for the other final lenses.

The existing lens-only tag and bound lanes carry this operation. Old
field offsets do not move. Tag 4 is a **lens** tag, not a new recursive
fold kind. The swirl-only quartet lanes hold rho and G; older fold kinds
keep their original meaning and layout.

## Why a local Jacobian is not the chosen fix

A local alternative can be certified, but it needs more than a pointwise
derivative. For candidate visible distance D, the ball `B(u,D)` has
`|x| <= |u|+D` and `|x_xy| <= |u_xy|+D`. Thus

```
A(D) = (|u|+D) (|u_xy|+D)
Llocal(D) = sqrt(1+A(D)²) + A(D)
D * Llocal(D) <= d
```

certifies D as a lower bound: otherwise a closer set point and its
connecting segment would contradict the raw bound d. The left side is
monotone, so a bounded root solve is possible, and a cutoff e maps through
`e*Llocal(e)`. A prematurely stopped root solve must return its lower
bracket, not an unconstrained Newton iterate.

This removes dependence on the whole set's radius near the query, but
the limiting derivative norm still grows at outer set points. It therefore
does not eliminate anisotropic hit-tolerance enlargement at strong
twists. No production shader loop or changed hit-acceptance semantics is
justified by that derivation alone. The present qualification instead
uses the global constant and compensated primary-hit epsilon, then
measures an explicit supported radius against the existing step budget.

## Fixed-geometry visual instrument

The opt-in qualification leg freezes each raw estimator, affine scale,
weight, slice, rotor, camera, descent depth and step budget across output
resolutions. A pre-scale k and weight `1/k` preserve visible size while
`k*R = rho` controls twist. It renders through the shared
[`de-preview.ts`](../scripts/de-preview.ts), with normal lighting but no
AO, shadow or fog. Its 128-pixel previews are compared with 512-pixel
references of the final policy and, for the refused policies, 1024-pixel
references of **the same geometry**. Changing resolution does not change
the estimator's geometry or depth. It only changes pixel tolerance.

The 128-pixel same-geometry control evaluates `raw(S⁻¹(query))` in these
length-preserving fixtures and damps steps by a constant safe `1/Lmax`,
while keeping the raw oracle's ordinary hit epsilon. It isolates the
extra acceptance shell caused by division by L. `Lmax` covers the entire
march sphere: an offset 4D slice has maximum full query radius
`rho*sqrt(1+sliceFraction²)`. At the supported low radii `Lmax < 2`, so
the marcher's fixed minimum step remains below the damped estimate until
hit acceptance. The strong-radius control where `Lmax > 2` is diagnostic
only: its minimum step can skip a thinner acceptance shell.

The globally compensated leg sets the shared marcher's additive
`minimumStepFraction: 0`, matching production's unclamped certified
stride. Its historical default remains 0.5 for every other consumer.
This avoids a retained coarse minimum step skipping a narrower hit
shell. The final leg multiplies the displayed certificate by G and uses
`stepScale=1/G`, which keeps the certified stride and implements the
compensated hit rule through the shared renderer without duplicating it.

The report keeps absolute hit coverage, nearest reference-hit distances
in coarse pixels, and counts beyond one and two pixels. It subtracts
only the known centre misalignment of an even-factor fine grid
(`sqrt(0.5)/factor`), and also reports the uncorrected centre distance.
The same-resolution control has exactly aligned centres and no such
subtraction. Newly connected control components are reported separately
through their minimum spanning forest of nearest gaps; a centre distance
of 2 means one empty row of pixels. No image-wide IoU or backdrop dilution
can make a new blob or closed gap disappear from these instruments. The
128-pixel acceptance gate requires **exactly identical hit masks** against
the raw-acceptance control with the same stride, no newly joined control
components and nonempty output. All selected 128/256/512 final-policy
panels must finish within 160 steps. The renderer allows 600 steps so a
failed candidate can still produce a complete, reviewable reference;
the gate examines actual step counts and rejects a 160-step overrun.
Larger optional references report their overruns without claiming an
unbounded-resolution budget guarantee.

## Measured qualification on 2026-09-08

Three claims remain separate: the algebra removes the added acceptance
shell; matched-stride pictures test that acceptance operation; finer
pixel grids show the remaining geometry/tolerance behaviour. Identical
matched masks alone do not prove a high-resolution silhouette claim.

The final G-plus-epsilon policy and its matched-stride raw control have
**identical 128-pixel masks**, with no added pixels, lost pixels or newly
joined components. Removing epsilon compensation while retaining the
same G produces the following extra support:

| Fixture    | Final/control hits | G without epsilon compensation | Maximum added support, pixels | Newly joined control components |
| ---------- | -----------------: | -----------------------------: | ----------------------------: | ------------------------------: |
| TETRA      |              2,589 |                          2,809 |                         1.414 |                               0 |
| PENTA-TILT |                437 |                            699 |                         2.236 |                               1 |
| TESS-TILT  |              1,639 |                          2,250 |                        10.198 |                               4 |

The final uncached reproduction measured step maxima of 60/67/70 at
128 pixels, 84/75/101 at 256, and 115/108/132 at 512, in the same
fixture order. Every one of these nine panels completed within 160 steps.

With the same correction at rho 0.6, TETRA and PENTA completed their
512-pixel references in at most 129 and 102 steps. TESS needed up to 171,
with four rays reaching 160 out of 262,144. This selected the smaller
0.5 cap; it was not hidden in a percentage or repaired by raising the
step budget. The 0.6 sweep used a slightly more conservative `1+2^-20`
coefficient margin before the production ceil-to-f32 helper landed. The
final 0.5 figures use the actual production coefficient.

The global-constant proof passed 60,000 independent singleton pairs.
The largest ratio was `1.0000000000000004` in the exact radius-zero
isometry cases; the largest nonzero-radius ratio was `0.97496748`.

### Stride sampling in the first control

The earlier unit-hit control used a faster, query-ball-safe stride.
It is retained, but it cannot isolate acceptance when compared directly
with the slower global-G stride. On TESS at rho 0.5, it missed a narrow
already-accepted interval at pixel `(54,46)`:

| Sample                                |        Ray t | Raw distance / ordinary epsilon |
| ------------------------------------- | -----------: | ------------------------------: |
| Faster control before the interval    | 3.9786271401 |                    1.0072602234 |
| Global-stride hit inside the interval | 3.9817505266 |                    0.9773944098 |
| Faster control after the interval     | 3.9933648796 |                    1.0105057458 |

The resulting diagonal discrepancy was 1.414 pixels in both directions.
No threshold was relaxed. The trace establishes that the accepted point
was already below the **ordinary raw** epsilon; the faster control never
sampled it. The acceptance experiment now holds stride fixed while
changing the hit rule. The original comparison and its opt-in
`SWIRL_TRACE=1` reproduction remain in the harness.

### Finer fixed geometry and the ambient-4D limitation

Each final 512-pixel reference has the same estimator depth, geometry,
slice and camera as its 128-pixel panel. These are the final-policy
references, never a higher-resolution picture of a rejected policy.

| Fixture    | 128 hits | 512 hits | Coarse → fine maximum, coarse pixels | Coarse hits >1 / >2 pixels | Fine → coarse maximum, coarse pixels |
| ---------- | -------: | -------: | -----------------------------------: | -------------------------: | -----------------------------------: |
| TETRA      |    2,589 |   35,900 |                                0.725 |                      0 / 0 |                                0.729 |
| PENTA-TILT |      437 |    2,549 |                                1.727 |                      5 / 0 |                                0.530 |
| TESS-TILT  |    1,639 |   14,098 |                               12.083 |                    52 / 14 |                                0.729 |

Coarse → fine uses the stated fine-grid alignment correction, not a
feature tolerance. Fine → coarse measures exact pixel-centre distances:
no fine hit in any reference is more than one coarse pixel from coarse
support. The failure is excess finite-tolerance support in the thin 4D
panels, not a missing resolved branch hidden by an image-wide score.

The worst surviving TESS coarse point, pixel `(43,52)`, is a direct
witness. Undoing the final map gives raw query
`(0.23450428, 0.65061169, 0.23662885, -0.19642187)`. The untouched ambient
4D oracle returns `0.01669537566`. At that world point the 128-pixel
epsilon is `0.01749859499`; the 512-pixel epsilon is `0.00437464875`.
The raw oracle is at **0.9541 of the coarse epsilon but 3.8164 times the
fine epsilon**. G has cancelled out. This identifies the existing
ambient-4D finite-tolerance behaviour responsible for the disappearing
piece, without claiming that a differently posed rigid scene must lose
the same pixels. The harness emits this `finiteEpsilonWitness` from its
actual worst displayed hit. It is consistent with the standing slice
caveat in the `surface-de-4d.ts` module record.

The final images were viewed, including the fine references. Relative to
the rigid quarter-turn control, final rho 0.5 changes 411 TETRA, 271 PENTA
and 1,107 TESS silhouette pixels at 128, visibly bending triangular voids
and rearranging slice islands. The effect was not reduced to an
imperceptible near-zero twist to obtain the bound.

The original rho 1.8 spike remains a decisive negative control:
PENTA-TILT's 128-pixel support reaches 28.57 pixels beyond the 1024
reference, with 993 coarse hits beyond two pixels. Its zero exhausted
rays were never sufficient evidence of fidelity.

Reproduce the complete qualification (CPU load; run separately from GPU
agreement):

```bash
SWIRL_QUALIFY=1 SWIRL_REUSE=0 npx vitest run \
  --config scripts/vitest.harness.config.ts \
  scripts/swirl-lens.harness.ts -t 'global constant|qualifies fixed'
```

Reproduce the rejected strong query-dependent policy explicitly (its
`comparison` records use the old-policy 1024-pixel reference):

```bash
SWIRL_QUALIFY=1 SWIRL_REUSE=0 SWIRL_FIXTURES=PENTA-TILT \
  SWIRL_TWISTS=1.8 SWIRL_SIZES=128,512,1024 SWIRL_GLOBAL_SIZES=128 \
  npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/swirl-lens.harness.ts -t 'qualifies fixed'
```

For the refused 0.6 global-budget candidate, select
`SWIRL_FIXTURES=TESS-TILT SWIRL_TWISTS=0.6 SWIRL_SIZES=128
SWIRL_GLOBAL_SIZES=128,512`; its reported `raysAt160Steps` is the deciding
instrument. Both rejected candidates remain outside the production cap.

`SWIRL_FIXTURES`, `SWIRL_TWISTS`, `SWIRL_SIZES` and `SWIRL_GLOBAL_SIZES`
accept comma-separated subsets. Defaults select the named production
cap (0.5), all three fixtures, 128-pixel controls, and final 128/256/512
references. `SWIRL_REUSE=1` reuses the versioned,
gitignored raw panel caches
from the current checkout for editing reports; normal reproduction
rerenders them. Global-policy contact sheets place the rigid rotation,
old acceptance, final acceptance, same-resolution unit-hit control and
downsampled fine reference side by side. High-resolution references are
not substituted for the actual low-resolution render in those sheets.
Elapsed times in the current qualification were recorded while other CPU
tests could run; they are diagnostic, not calibrated performance claims.

## Shader integration and source size

The frozen WGSL lens tag remains at byte 256 in 3D and 544 in 4D. Tag 4
selects swirl; its existing quartet at 272/560 carries `(rho, G, 0,
postSigma)`. No old offset moves. Affine/fold and affine4/fold4 eval,
hit-info and probe wrappers share the inverse shader emitter. Both GLSL
mirrors consume the same inverse, and all three primary marchers scale
the complete epsilon after taking its numeric floor. The optional CPU
cone-footprint parameter retains its original affine/weight scaling;
dividing that footprint by G would silently coarsen the raw geometry.

The 4D GLSL arm previously had no nonlinear final wrapper. It now wraps
the affine ladder for swirl only. Folded 4D bases retain their existing
compute requirement. Installing swirl clears a previous slab uniform;
attempting to upload a new nonzero slab throws. The UI keeps the authored
slab dormant and explains the refusal beside its disabled control.

These posted, finish-enabled source sizes were measured before/after the
existing source resolver. Both pattern selections stay below the
65,536-byte emitted-source limit. Classic non-lens source hashes remain
unchanged; the 3D lens-only hashes change because their wrapper gains the
new branch.

| Dimension / scene | Pattern off, raw → emitted bytes | Pattern on, raw → emitted bytes |
| ----------------- | -------------------------------: | ------------------------------: |
| 3D plain          |                  91,984 → 32,111 |                104,177 → 41,331 |
| 3D Balloon        |                 101,827 → 34,111 |                114,020 → 43,331 |
| 3D floor          |                 100,850 → 36,333 |                113,043 → 45,553 |
| 4D plain          |                  66,707 → 19,131 |                 78,409 → 28,424 |
| 4D Balloon        |                  73,768 → 20,844 |                 85,561 → 30,214 |
| 4D floor          |                  76,543 → 23,353 |                 88,245 → 32,646 |

## Production browser and remaining Balloon budget limit

`scripts/surface-swirl.verify.mjs` drives the built app through its own
Copy Link encoder and a fresh-context reload, then enters Surface from the
UI. It checks every final field, the disabled 4D slab and its explanation,
the requested engine, the shared eight-pass settle latch, stable screenshots
and the full ray census. A hardware request fails if the disclosed backend
is software. The X11 launcher explicitly selects X11 so a Wayland desktop
cannot silently invalidate that request.

The 2026-09-08 machine is an AMD Radeon RX 7900 XTX, independently confirmed
by `glxinfo -B`. Compute reports `amd rdna-3`; WebGL reports ANGLE on the
same AMD device with OpenGL 4.6. These are AMD measurements; the historical
Iris machine was not available. All twelve 960×540 captures completed all
518,400 rays, with zero exhausted rays and a nonempty hit/miss mix.

| Scene                    | Compute hits | WebGL hits | Compute / WebGL screenshot draw |
| ------------------------ | -----------: | ---------: | ------------------------------: |
| 3D swirl                 |       33,959 |     33,956 |                13.385 / 13.389% |
| 4D swirl                 |        5,837 |      5,769 |                  2.406 / 2.406% |
| 3D swirl + Balloon       |       49,155 |     49,121 |                19.242 / 19.242% |
| 4D swirl + Balloon       |        9,900 |      9,889 |                  4.036 / 4.037% |
| Swirl Tetrahedron preset |       31,288 |     31,280 |                12.470 / 12.466% |
| Swirl Pentatope preset   |        5,836 |      5,823 |                  2.463 / 2.463% |

Draw counts pixels in the overlay-free central strip whose RGB exceeds the
entire pinned dark gradient's per-channel bound. The initial edge-column
comparison was rejected: the right edge contains the scrollbar, and the
left edge is darkened by the DOM vignette. The corrected metric rejects a
backdrop-only image with a vignette and detects an inserted foreground patch.
It was also reapplied to the first eight retained screenshots, before the
complete twelve-row live run passed with the corrected metric. The threshold is
only a nonempty-render check; it makes no silhouette-fidelity claim.

The plain scenes exercise near-cap pre-swirl radii. Balloon uses the
established radius 0.35 and a milder nonzero pre-affine: 0.2 times the 3D
plain scene's scale/translation and 0.4 times the 4D scene's, with reciprocal
signed weights retaining visible extent. The displayed echo was inspected.

This smaller deformation is a disclosed performance limit. At the default
Balloon radius 1.6, near-cap 3D/4D swirl exhausted 2,873/111 rays while the
affine-final and plain controls completed. Radius 0.35 still exhausted
9,550/160 rays. The gate header retains the radius-0.6 diagnosis too. Each
control uses its own production ball and opening pose, so these counts
demonstrate the app's budget difference without isolating G as its sole
cause. Any tighter march proposal must first pin those balls and cameras,
preserve the full compensated acceptance rule, and handle both Balloon
terms in both dimensions. The 0.5 support cap alone does not guarantee
completion for arbitrary compositions, views or raster sizes.

## GPU agreement on the same AMD driver

The full Surface section passed with 82 mandatory eval-agreement rows and
zero failures, including all existing families. Its 25 device-canary checks
remained reliable. The command was:

```bash
npm run bench:surface -- --display=:0 --surface-timing=0 --diagnostics \
  --out=scripts/out/swirl-surface-bench-final
```

Only optional timings were disabled; all agreement and production-frame gates
ran. Four mandatory pure-swirl rows cover affine/fold and affine4/fold4.
Eight more cover Balloon radii 0.35 and 1.6; each requires both union terms to
win among its 700 queries. All twelve passed with zero failures (a thirteenth,
width-4 fold4 diagnostic passed too).

The eight appended unproject rows each marched 5,184 rays and had zero
unexcluded disagreement. GPU/CPU hit counts were 238/238 and 1541/1540 for
3D affine without/with Balloon, 6/6 in both 3D fold rows, 41/41 and 73/73 in
4D affine, and 6/6 in both 4D fold rows. The one 3D affine Balloon difference
is reported by the existing silhouette-flip classifier; its cap was unchanged.
That retained near-cap stress row can agree on exhausted terminals, so its
numerical pass is not a promise that every ray hits or misses within budget.

Four 96×54 production frames then enabled Balloon, tint, wood patterns,
normal probes, AO and shadows. Their affine/fold/affine4/fold4 hit counts were
1,494/6/73/6; every frame had misses, zero exhausted or active rays, and zero
sampled CPU sanity mismatches. These execute hit-info, `source4` and the
fold cores' cheap probes in the shipped renderer.

The initial folded 4D view had no hits on either CPU or GPU and was correctly
rejected by the anti-vacuity gate. Its fixed replacement uses a zw rotation
of 1.4 and slice `-0.275 * visibleBoundingRadius`. The initial near-cap 3D
affine Balloon frame exhausted 30 rays; its production-frame-only replacement
is explicitly named `lensSwirlPostOverAffineBalloonMild`, with pre-affine
scale/translation multiplied by 0.4 and reciprocal weight. The near-cap eval
and unproject rows remain unchanged. Completion and comparison gates were
not loosened for either fixture correction.
