# Surface GPU kernels (`src/fractal/surface-de-gpu.ts`)

This is the full record behind CLAUDE.md's `surface-de-gpu.ts` bullet under
`src/fractal/`. CLAUDE.md keeps the rules, the frozen offsets and a
condensed description of each core; this document keeps the measured
verdicts, the bench-leg/classifier design, and the historical
(including refuted) narrative.

## Overview

`surface-de-gpu.ts` is the WGSL fold-DE compute kernel — a spike, gated in
by the beam-width occupancy verdict and integrated as the app's compute
surface path. It mirrors `estimateDistance`'s `refine=false` fold path term
for term (the estimator the fold GLSL marches) under the `flame-gpu.ts`
oracle discipline. It is source-generated per config: frontier width,
workgroup-SHARED (banked, transposed) vs private frontier storage, and
stage-2 branch-and-bound on/off (WGSL has no Mesa link cliff, so there's no
reason to strip source the way the GLSL side must).

## Condensation shape term

The affine/fold and affine4/fold4 descent cores can compile Barnsley
condensation geometry. `buildSurfaceDE` / `buildSurfaceDE4` separate active,
samplable emitters from recursive maps, symmetry-expand their inverse poses,
and append those emitter records after the ordinary-map prefix. `mapCount`
therefore remains the recursive alphabet size; the appended control block is
four `u32`s `(emitterCount, minDepth, maxDepth, shadeCount)`. The depth band is
inclusive, root depth is 0, and an unbounded maximum is packed as `0xffffffff`.

The params sizes are append-only. In 3D, base/lens grows 288 -> 304 bytes,
balloon 320 -> 336 and plane 336 -> 352. In 4D condensation forces the shared
576-byte variant prefix even without a lens, then ends at 592 bytes; balloon
ends at 624 and plane at 640. Feature-off buffers retain every pre-existing
size and byte. Emitter inverse records reuse the 7-vec4 `GpuMap` or 9-vec4
`GpuMap4` stride, and the low-level guard caps both total records and unique
shade slots at 24. Symmetry copies keep their base emitter's shade index, so
geometry can expand without inventing material slots.

The generated shader bakes one SDF function per unique authored emitter
shape, then evaluates `0.9 * sigmaAcc * sigmaEmitter * sdShape(local)` at the
root and every visited descendant admitted by the band. In 4D the local term
is `hypot(max(sdShape(local.xyz), 0), local.w)`: the authored 3D solid is
embedded at local w=0 rather than extruded. Condensation-aware pruning uses
the analytic invariant ball for the full recursive closure and folds its
subtree certificate for an in-ball dropped branch whenever a deeper enabled
level can still contribute.

The codegen refuses condensation on the three forward cores; the 4D packer
and CPU oracle also refuse nonzero slab thickness for a condensation system.
Eligibility refuses unsamplable or nearly-flat emitters, emitter-only systems
and final-transform emitters before packing. Balloon needs no kernel fork: it
wraps the same public estimator, and the existing balloon/plane mutual
exclusion still applies. The separate 3D fragment-side grid also samples that
public estimator; it is not a WGSL compute path. Absent condensation emits the
pre-feature WGSL source byte for byte.

## The fold's authored lengths

The fold's authored lengths ride a dedicated `fold` lane in both map
layouts — `GpuMap` grew 6 -> 7 vec4, `GpuMap4` grew 8 -> 9 vec4 — carrying
`resolveFoldRadii`'s own output `(mR, fR, wall)`. A generated
`foldRadiiOf` re-derives the branch algebra from that lane
(`surfaceFoldRadii` field for field), once per map per descent level,
outside a branch loop that runs up to 81 times.

The ESCAPE core's lane says something different: `(mR², fR², wall)`, the
form `EscapeLink` keeps and the form `fR²/clamp(r², mR², fR²)` wants —
exactly as its `p0` already differs. Each packer transfers its OWN
oracle's numbers rather than recomputing them.

The 3D LENS needed a params slot and its block was full, so the lens
fold's lengths take the frozen offset 272 and the shared plane/balloon
block moves to 288, with the escape and bulb cores declaring a matching
pad so that block keeps ONE offset across every 3D core:

- params: 272 -> 288
- balloon: 320
- plane: 336
- shape trap: 336 -> 400 (`SURFACE_GPU_PARAMS_TRAP_BYTES` = 400)
- 4D lens: 576
- 4D shape trap: 624 -> 688 (`SURFACE_GPU_PARAMS4_TRAP_BYTES` = 688)

`foldRadiiOf` is emitted only where a fold branch reads it — the fold
cores, or ANY core under the lens wrapper — so affine kernels stay
byte-identical.

### The 4D tail has the same shape (the three 4D lifts)

One decision serves all three: the shared plane/balloon block lands at
the frozen offset 576 for EVERY 4D core, which the lens4 block being
declared unconditionally under either core is what buys — the 3D
`lens || balloon || groundPlane` rule one dimension up, zero-filled by
the packer when there is no lens (4D balloon -> 608, 4D plane -> 624).

The ground plane's own 4D lift put that hazard on record: a block appended
at offset 560 lands INSIDE the authored fold lengths' `lens4Fold` quartet
and corrupts it.

The escape family's shape-trap color channel appends after that shared
plane region. The 3D forward cores keep the plane declaration beneath it
even without a floor, so the trap starts at the frozen 336 and the params
buffer ends at 400. `core:"escape4"` follows the same rule one dimension
up: its trap starts at the frozen 624 and ends at 688. Both plane regions
are zero-filled when unused; a conditional declaration would make the trap
offset depend on the floor toggle and split one document across two wires.

## Seven kernel cores

The lens wrapper added the second core, the escape port the third and — its
4D cut — the fourth, the 4D fold-branch port the fifth, the Mandelbulb the
sixth, the 4D escape chain the seventh.

### `core:"affine"`

Emits the width-4 A/B + validity-slot REFINED ladder (mirrors
`estimateDistanceRefined`, the affine GLSL's estimator; width /
sharedFrontier / bnbStage2 / shadeDeWidth are inert) beside the fold
frontier, picked off `deHasFolds` exactly like the CPU.

### `core:"escape"`

Not a descent at all — it emits `escape-de.ts`'s
`estimateEscapeDistance`, the FORWARD fold orbit with the
Buddhi/Rrrola scalar derivative, in the `SURFACE_ESCAPE` GLSL arm's f32
formulation, for exactly the systems `analyzeEscapeSystem` admits.

The session's marching quantities ride the params uniform via
`packEscapeGpuParams`: the bailout ball packed as both bounding AND
visible sphere, `ESCAPE_STEP_SCALE`, `maxDepth` as the orbit's iteration
budget in PASSES through the same preview door the descents use,
`mapCount` the LINK COUNT, and `symOrder`/`symPlane` the query-space
wedge fold — with the head link still in the 208-271 VARIANT block as
frozen ballast, mutually exclusive with the lens block by construction
(escape+lens throws).

The orbit CYCLES the document's whole formula chain — link `i mod n`, `+ p`
and the bailout test after EACH link, `maxDepth * n` single-link steps —
reading one `GpuMap` per link off the maps storage binding
(`packEscapeGpuMaps`), so the escape core DOES declare buffer 1, and
`core:"bulb"` is the one bindingless core left.

A link's `kind` may be a POWER map (4 = triplex, 5 = quaternion square), so
the fold pair's negative `kind != 2u` / `kind != 1u` dispatch sits behind a
`kind < 4u` GUARD in both bodies — this file's own doc names an unguarded
new kind as the reason the Mandelbulb became a sixth core, and the guard is
what makes a fourth and fifth kind safe here. `bulbPow8` is HOISTED to one
definition emitted for the two forward cores rather than copied (declared in
the body block, so both the value body and the entry's hit-info see it, and
affine/fold kernels stay byte-identical), and the block's `escParams.w` at
offset 268 turned from pad into the ONE live word of the head-link ballast:
`EscapeDE.logEstimate`, the chain-level choice between `r/dr` and the
Böttcher `0.5·r·ln r/dr`. Its hit-info gained the matching second
interpolant, off the DEGREE of the link that produced the terminal radius (a
pre-scaled power link has `growth < 1`, which failed the old guard and
dropped the trap back to the raw integer confetti the Mandelbrot form
removed).

`width`/`sharedFrontier`/`bnbStage2`/`shadeDeWidth` are all inert, and its
hit-info reports the trap as the CONTINUOUS escape fraction: `escapedAt`
minus `log(r/R)/log(growth)` for the link that produced the escaping radius,
over the PASS budget `maxDepth`. The raw integer count is a step function of
position and painted the real Mandelbox as palette confetti — it looked fine
only while the escape set was a blob with one count everywhere; smoothed, it
is the canonical Mandelbox palette coordinate.

The denominator is the pass budget and NOT the chain's own `maxDepth * n`
step budget: `escapedAt` counts single-link steps and an orbit escapes after
a handful of them however long the chain is, so dividing by a budget that
multiplied with the link count shrank the reachable ramp per link added and
a chain painted in the bottom of its palette.

**MEASURED TWICE**, and the two populations disagree about the size of
the win. Over the whole surface, the median trap at 2/3/6 links went
0.180/0.110/0.056 -> 0.360/0.331/0.333. At the PIXELS chain-speckle's own
pose hits, it went 0.132/-/0.072 -> 0.265/-/0.431. Both agree on the
claim — n = 1 identical to the bit (the same expression), and the
SYSTEMATIC per-link collapse gone — but not on whether the result is
flat, so "no per-link trend" is what this normalizer buys, not
chain-invariance.

Cost is the clamp, and the corrected clamp-cost record moved it a long way:
6.78 / 10.59 / 31.44% of really-hit pixels at one / two / six links, up to
15.8% over the whole surface. The 1.9-8.6% this line used to quote was wrong
three ways — the two populations' labels were swapped where
`surface-material.ts` records them, 1.9% is the TWO-link row rather than
anything at six, and the pixel figures predate the set-extent correction.

**THE PIXEL-POPULATION ROW IS POSE-DEPENDENT AND ITS POSE MOVED** (the
set-extent correction): `chain-speckle` fits its marching ball to the set's
reach, that fit was inflated by a halo of near-boundary escapers, and on the
corrected fit the shipped normalizer's median trap reads 0.430 at two
links and 0.710 at six against the recorded 0.265 and 0.431. Same
direction, same claim — no per-link collapse — measured on an object
that is no longer drawn smaller than it is, and the clamp share rose for
the same reason the median did: a smaller object in a larger frame
spends its hit pixels on the SILHOUETTE, where orbits escape early, and
the corrected frame fills with interior pixels whose orbits survive the
budget.

The sheet PRINTS that share now rather than leaving it to be quoted (it was
unfalsifiable for one release), and the same run bounds it twice: the raw
integer count clamps the identical pixels (6.78 / 10.61 / 31.44%), so the
saturation is the coordinate's own and not the continuous trap's smoothing,
and box-averaged over 16 sub-samples the rows read 0.16 / 0.00 / 0.00%, so
the flat top-of-ramp PATCHES are sub-pixel rather than regions of the object
— DIRECTIONAL for the shipped settle rather than its own figure, since this
averages the TRAP over 16 where both engines' supersampling averages the
shaded COLOUR over 8.

The trap drives COLOR ONLY (the convention `core:"bulb"` always used),
with rings/sheets over the orbit's closest radial / y-plane approaches —
the descent cores' colors-only convention.

### `core:"bulb"`

The escape core's SIBLING, one formula over: `bulb-de.ts`'s
`estimateBulbDistance` — the forward triplex-power orbit
`y <- M V(y) + y_0` with the Böttcher log estimate `0.5·|y|·ln|y| / dr` —
for the systems `analyzeBulbSystem` admits, in the `SURFACE_BULB` GLSL
arm's f32 formulation.

A sixth CORE and not a fourth `foldKind`, because the escape bodies
dispatch on `kind != 2`/`kind != 1` and an unrecognized kind would
silently run both folds. Everything structural is escape's (208..271
variant block via `packBulbGpuParams`, no maps binding, every frontier
knob inert, `maxDepth` as the orbit budget, lens/balloon throw); the
wire's one asymmetry is that the ORBIT bailout and the QUERY-space
marching ball are different numbers here, so `bulbParams.y` carries the
bailout and the frozen `boundingRadius` stays the marching ball.

Its trap is the continuous escape count in the POWER-map form
(`log(log r / log R)/log n`, not the fold arm's constant-factor
`log(r/R)/log(growth)`).

Three terms an identity-or-rotation fixture cannot see — the
`sigma_max(M)` `dr` seed, the trailing `+ sigma_max(M)`, and the `ln|y|`
clamp below 1 — are what the bench's uniformly SCALED fixture exists
for. MEASURED: dropping either sigma term is BIT-IDENTICAL on the two
sigmaMax = 1 systems and fails 545/700 and 259/700 queries on
`bulbScaled`.

### `core:"affine4"` (the 4D cut)

The refined ladder ONE DIMENSION UP — `surface-de-4d.ts`'s
`estimateDistance4Refined` behind the app's view lift, the estimator
`surface-material-4d.ts` marches. The body's prologue does `rotorInv ·
vec4f(p, w0)` (the GLSL's `uInvRotor` line), the slab rides one vec4f
half-extent register beside every point (linear parts alone, gated on the
dynamically uniform `sliceHalfW > 0`), and the kaleidoscope sweeps ONE
backward-step 4×4 where 3D swept a `(cos, sin)` pair.

Its params variant tail (208..463, `SURFACE_GPU_PARAMS4_BYTES` 464,
`packSurface4GpuParams` + a per-frame `SurfaceGpu4View`) holds
rotor/stepBack/4D-lens rows as row-vec4 quartets — the buffer always stores
the ROW-MAJOR bytes of the matrix the body applies, the packer performing
the one real transpose (pose rotor → world-to-attractor, `setSurfaceView4`'s
exact dance) — plus w0/sliceHalfW/`visRadius4` and the radius-ramp band
(`SurfaceDE4.radiusBand` as center4/minD/invRange); maps are the `GpuMap4`
layout (`packSurfaceGpuMaps4`, 128-byte 4D stride).

Two frozen slots carry 4D semantics: `visibleRadius` packs the
SLICE-ADJUSTED `sliceVisR` so the shared march entry's sphere gate is
the 4D GLSL's textually unchanged, while the tail's `visRadius4` keeps
the FULL radius for the height color source and the radius source
normalizes its center-relative distance over the band — both
slice-invariant, the 4D GLSL mirrored (those two shade lines are the one
core-conditional interpolation in the shared entry text).

Fixed width 4 (inert knobs like `"affine"`); nonzero `footprint` THROWS
at pack (the 4D oracle has no cone cap).

### `core:"fold4"` (the 4D fold-branch port)

The FOLD frontier one dimension up — 4D fold base maps (`deHasFolds4`)
marched as the same width-configurable frontier as 3D `"fold"`,
slab(`ext`)-aware, sharing `GpuMap4` and the affine4 tail; no stage-2 B&B
emission by the 3D measured verdict, and `lens:true` wraps either 4D core in
`descendLens4`'s branch sweep (that port's second phase — the appended lens4
params block at 464..575, `SURFACE_GPU_PARAMS4_LENS_BYTES` 576 — 464..559 as
the port shipped it, plus the authored fold lengths' `lens4Fold` quartet at
560; nothing follows the block, so it grew in place — packed exactly when
the DE carries a `foldFinal`; the old "4D lens throws" rule is gone).

Bench legs `fold4Boxfold`/`Mandelbox`/`Kaleido`/`Slab` + a fold4
compute-frame leg pin it.

A `mapsUniform` codegen option (a 4D kernel-cost probe) moves the 4D cores'
maps binding to a fixed 24-slot uniform array. REFUTED for production —
0.99-1.02x at every kaleidoscope order on Iris, values bit-identical — and
kept as the refutation's executable record, agreement-gated by the extended
opt-in `--surface-aff4-sweep` leg (5 arms x orders 1-6, pilot-sized
watchdog-safe batches); that leg plus `scripts/aff4-order-cpu.harness.ts`
carry that investigation's closing verdict: the order superlinearity is the
ALGORITHM's own depth growth, CPU-oracle-matched, not kernel realization.

The affine4 eval-agreement leg (M3) gates fail=0 under a pure
ORACLE-CONTINUITY classifier — the f64 oracle at the query's six ±1-ULP
axis neighbors within tol/2 — because chord-bisected queries can park
exactly ON a beam-selection discontinuity (~3e-2 value step ~1 ULP wide)
where both sides are valid conservative bounds and pointwise comparison
is the wrong question. Measured: the oracle itself returns the GPU's
value 1-2 query-ULPs away. Exclusions are disclosed per system (5/2800
on SwiftShader) and capped at 3% — the escape leg's ensemble shape minus
the GPU modeling a ladder doesn't need.

All five descent-shaped cores share the public `surfaceDE(pIn, cutoff,
li)` signature, so the Modes described below are textually identical
whichever core is picked. And `lens:true` wraps EITHER descent core in
`descendLens`'s fold-FINAL branch sweep — the body token-renames to
`surfaceDECore` (hit-info to `surfaceDEHitInfoCore` behind the argmin
sweep, probe to `surfaceDEProbeCore` under the same sweep text renamed)
and the wrapper owns the public names, entries untouched; params grew
208 -> 272 (0-207 frozen) with the lens block zero-filled when absent,
and footprint+lens is refused at pack time (descendLens's per-branch
innerFootprint would need a core signature change; the app passes 0).

M1 lens rows gate at ~2e-7 (81-branch mandelbox worst case included); the
field class marched 5184 unproject rays fail=0, hits 812/811 — that leg and
the fold-pair leg each carry ONE status mismatch on the real Iris driver
where SwiftShader has none, excluded as `silhouetteFlips`: the two marches
reached the same point on the same trajectory and straddled `d < eps` by
0.6%/2% of eps, which the older same-terminal-`t` rule could never recognize
because a miss runs on to the sphere exit while a hit stops at the surface.

**Re-verify surface kernel changes on `--display=:0`, not SwiftShader
alone** — the escape port re-proved it: the escape eval leg's first
classifier (a single fround twin of the oracle) passed SwiftShader clean,
then real Iris flipped 6 "stable" rows at maxAbs 0.41. A forward orbit is
chaotic (~8x/iteration noise growth into the escape-decision dichotomy; the
folds themselves are C0-continuous, so there is no boundary-proximity
predictor), and which rounding seeds flip is realization-dependent — so the
leg gates in LAYERS:

- pre-hoc, a seven-orbit ENSEMBLE classifier (`forwardQueryStable` — the
  fround twin at the query and its six one-ULP axis neighbors must all
  agree with the f64 oracle; exclusions disclosed per row and pinned
  under 20%, the structural not-eating-the-leg cap);
- post-hoc, a residual failure is absolved only if
  `forwardShadowFlipVerified` proves some 1..4-ULP neighbor orbit
  REPRODUCES the GPU's value within tolerance (the march legs'
  per-mismatch discipline lifted to eval; `flips=` in the row, capped at
  7).

Measured on real Iris AT the escape port, on the FOUR escape systems that
existed then: fail=0, worst row excluded=74/700 with flips=2, gated maxAbs
2.1e-6. That is a dated reading and not a standing baseline — the fixture
set is NINE systems now (the chain's shader mirrors added the three chain
rows, landing at 10.1/10.1/13.9% exclusions, and the authored fold lengths
added the parameterized one), so a later row's numbers have no business
being compared against it. The `escChainKaleido` SwiftShader false failure
was reported out of exactly that confusion, and closed on the standing
advice rather than on a cap change: judge the escape rows on `--display=:0`
(`docs/gpu-bench-surface.md` carries both adapters' figures).

A `computeFrameEscape` leg runs one production frame through
`SurfaceComputeRenderer` with a `{kind:"escape"}` target and checks it
against a strided CPU sanity march as HIT RATES rather than the per-pixel
status-exclusion tiers — the march entry text is shared across every core
(test-pinned) and the escape DE is eval-pinned, so a rate band absorbs the
same chaotic-orbit flips without duplicating that machinery for a second DE
type. Measured on real Iris: 256x144 in 136ms wall, 33 passes, 0 exhausted,
GPU hit rate 0.153 vs CPU 0.158 — the rates roughly halved at the Mandelbrot
form, which replaced a blob that filled 89.4% of its own ball with an object
that fills 3.5% (the set-extent correction's figures — the record read 94%
and 10% off a grid thresholding the estimate); the gate is the GAP between
the two rates, so it moved with them.

### `core:"escape4"`

The escape core ONE DIMENSION UP — `escape-de-4d.ts`'s
`estimateEscapeDistance4` — and the first core that is BOTH 4D and
FORWARD, which is the whole of its novelty: it takes the rotor prologue
and the `GpuMap4` maps layout from the descent cores and the orbit, the
params scalars and the colors-only hit-info from `core:"escape"`.

Three things fall away with the dimension and NOTHING is added:

- no `bulbPow8` (the gate refuses a triplex power);
- no slab (a forward orbit cannot thread a segment, so the packer THROWS
  on a nonzero `sliceHalfW`);
- no lens (an escape chain has no final transform, which is what lets
  its params block reuse lens4's 464..575 region).

Its wedge fold reads `SYM_PLANE_CODE4` — the index into
`SYMMETRY_PLANES` — and NOT the descents' `SYM_PLANE_CODE`, which
deliberately collapses `xw`/`yw`/`zw` onto their w-free twins: sound
where the kaleidoscope is a swept matrix, wrong where a fold picks its
two axes by name.

`lens`/`balloon` throw, `groundPlane` composes, and there is no fragment
mirror at all.

## Ground plane

Ground plane is an orthogonal `groundPlane` option, not a core of its own —
it composes with every descent/escape core, in both dimensions and with the
lens wrapper. It adds a fifth ray status, `SURFACE_GPU_RAY_PLANE` (4), that
the march classifies a sphere-gate/sphere-exit MISS into when a downward ray
crosses the floor inside its fade band (EXHAUSTED never planes); the shade
entry lights the crossing with the hit path's penumbra/AO probe-width
discipline under two analytic ball certificates.

Params append a 48-byte block at the frozen offset 288
(`SURFACE_GPU_PARAMS_PLANE_BYTES` 336; the 4D cores' own frozen 576,
`SURFACE_GPU_PARAMS4_PLANE_BYTES` 624), SHARED with the balloon block —
the two throw at codegen/pack together (no horizon inside the balloon's
shell).

THE 4D LIFT NEEDED NO NEW SHADER TEXT: the march classifier and the
shade entry are already shared across every core, so it is just the
params block, the struct splice, and deleting the throw. The floor is a
world-space plane in the SLICED 3D space, so every 3D certificate holds
verbatim once a ball is chosen; the app chooses the origin and the FULL
4D visible radius, so the floor does not slide as the slice scrubs (an
off-centre slice shows a smaller object floating above it, which is
honest — it IS a smaller slice).

`surface-compute.ts` prices PLANE terminals in the hit-priced queue, not
the miss path.

## Environment-lit ambient

`ShadeParams.envStrength` (`f32`, offset 152 — the former struct
alignment pad between `pixelJitter` at 144 and the 160-byte end, so
`SURFACE_GPU_SHADE_BYTES` is unchanged) is the WGSL mirror of the GLSL
tracers' `uEnvLight`: how far the shade entry's light is tinted toward the
backdrop sampled along the shading normal, hue-normalized so strength
moves color and never brightness. It is inlined at both `lit` sites (the
ground-plane arm's fixed `+y` normal, and the hit path's `n`) rather than
emitted as a WGSL helper function — WGSL has no source-size limit to save
against here, and inlining means a kernel mode that never shades pays
nothing extra by construction, with no risk of a stray function landing
in one it shouldn't:

```
let envE = mix(shade.bgBottom, shade.bgTop, n.y * 0.5 + 0.5);
let envTint = mix(vec3f(1.0), envE / max(max(envE.r, max(envE.g, envE.b)), 1.0e-4), shade.envStrength);
let lit = (shade.ambient * ao + (1.0 - shade.ambient) * diffuse * shadow) * envTint;
```

THE TINT MULTIPLIES THE WHOLE `lit` TERM, NOT JUST THE AMBIENT HALF — a
first cut that scaled only `shade.ambient * ao` by `envTint` and left the
diffuse half alone was MEASURED indistinguishable from strength 0 at
strength 1, the maximum, on both built-in backdrops (a real-browser A/B on
the GLSL mirror, since the tint math and the built-in dark/haze stop pairs
are shared with this kernel; see `docs/surface-glsl-tracers.md` for the
numbers). The reason travels: ambient is a quarter of the light by default
(`DEFAULT_SOLID_AMBIENT`, 0.25, shared by surface and solid), and this
app's dark (`#0d0d18`/`#1f2039`)
and haze (`#3c4a72`/`#5d6d9b`) stop pairs sit close in hue, so a
directional sample between them barely varies — a small slice of a nearly
uniform color is imperceptible. Specular is deliberately OUTSIDE the
product at every call site (added after `lit`, never multiplied through
it) — an untinted highlight is what keeps a strongly tinted render from
reading monochrome.

Absent/0 is the bit-exact pre-environment-light identity — `mix(a, b, 0)`
returns `a`, so `envTint` is `vec3f(1.0)` and `lit` reduces to the old
scalar formula (the product of a scalar and `vec3f(1.0)` is that scalar per
component). `packSurfaceGpuShade` defaults `envStrength` to 0 when omitted,
exactly like `fogTintStrength` and `pixelJitter` before it.

The compute-frame bench legs (`npm run bench:surface`) deliberately run
over a BLACK backdrop (`bgTop = bgBottom = [0, 0, 0]`) and never set
`envLight` on their specs, so `SurfaceComputeFrameSpec.envLight` stays
`undefined` and packs to `envStrength: 0` — the bit-exact identity, so
the shade path's agreement legs are unaffected by this change. Had a
bench spec set a nonzero strength over that backdrop, `envTint`'s
`max(..., 1e-4)` guard would still keep the ambient term from going
`NaN` (it would just read `vec3f(0.0)` and black out the ambient half),
but no shipped spec reaches that case.

## Shared background shape

`ShadeParams` grows two `vec2f` — `bgOffset` at offset 160, `bgExtent` at
168, `SURFACE_GPU_SHADE_BYTES` 160 → 176 — the WGSL half of
`fractal/background-shape.ts`'s coordinate contract: every tracer now
evaluates the backdrop shape at the pixel's FULL-IMAGE normalized
coordinates, `(px + 0.5 + bgOffset) / bgExtent`, rather than at a stop
pair pre-remapped for its own raster. `BACKGROUND_SHAPE_WGSL` emits the
shared `backgroundShapeT` body inside the shade-mode entry template only
(kernels that never shade — `eval`, `march` — stay byte-identical); the
shade entry's `bg` local becomes:

```
let imageUv = (vec2f(f32(px), f32(py)) + vec2f(0.5) + shade.bgOffset) / shade.bgExtent;
let bg = mix(shade.bgBottom, shade.bgTop, backgroundShapeT(imageUv));
```

Both fields are REQUIRED on `SurfaceGpuShadeParams` (unlike `envStrength` et
al.) — there is no safe default, since an absent extent divides by zero or
by one and silently renders the wrong shape rather than failing loudly. An
ordinary frame packs offset `(0, 0)` and extent equal to its own raster
size, which is bit-identical to the expression it replaced: `imageUv.y`
reduces to `(f32(py) + 0.5 + 0.0) / f32(rasterHeight)`, and adding an exact
`0.0` is exact in IEEE754. A capture band (`surface-compute.ts`) packs
offset `(0, bandBottom)` and extent equal to the FULL image — this is what
retired `surfaceComputeBandStops`, the old affine remap of the two stops
onto a band's own sub-range: that remap worked only because a LINEAR ramp
restricted to a sub-rectangle is still linear, where re-deriving `imageUv`
per pixel from the full extent works for any shape.

## Radial vignette

`ShadeParams` grows a further `vec2f` + `vec2f` + `u32` — `bgCenter` at
176, `bgScale` at 184, `bgShape` at 192 — `SURFACE_GPU_SHADE_BYTES` 176 ->
208 (192 + 4 = 196, rounded up to the struct's 16-byte alignment). These
carry `fractal/background-shape.ts`'s second shape, `"radial"`: `bgShape`
is `backgroundShapeCode`'s numeric kind (0 linear, 1 radial), `bgCenter`
the shape's normalized-image centre, `bgScale` `backgroundRadialScale` of
whatever full image `bgExtent` names — the per-axis correction that keeps
the vignette circular in real pixels rather than elliptical in normalized
UV space. All three are REQUIRED on `SurfaceGpuShadeParams`, the same
precedent as `bgOffset`/`bgExtent`: there is no universally-safe default
for a field whose meaning depends on a sibling field's (`bgShape`) value.

The shared `backgroundShapeT` body itself stops being LITERALLY
byte-identical between the GLSL and WGSL emissions here: the radial branch
reads `bgShape`/`bgCenter`/`bgScale` through each dialect's own
`BackgroundShapeDialect.field` accessor, and WGSL's `shade.bgCenter`
struct-field spelling cannot match GLSL's flat `uBgCenter` uniform. The two
emitted bodies diverge in exactly four tokens (the field accessor prefix,
the local-declaration keyword — WGSL's `let r` has no GLSL equivalent, a
type-prefixed local declaration has no WGSL one — the `float`/`f32` type
spelling, and WGSL's mandatory `u` suffix on the `bgShape == 1`
comparison); `background-shape.test.ts` pins the two bodies identical once
those tokens are normalized away, so the shared arithmetic still cannot
drift between dialects.

Every kernel core that shades (mode `"shade"` and march's `"unproject"`
rays arm) reads the new fields through the same `ShadeParams` binding as
`bgOffset`/`bgExtent` — no core-specific change, since the shade entry's
`imageUv`/`bg` computation is shared text across all seven cores.

## Balloon echo tint

`ShadeParams` grows a `vec3f` + `f32` — `balloonTint` at offset 208,
`balloonTintStrength` at 220 — `SURFACE_GPU_SHADE_BYTES` 208 -> 224, and
this time with NO tail pad: 220 + 4 = 224 is already a multiple of the
struct's 16-byte alignment. The radial vignette's own rounding (192 + 4 =
196, rounded up to the 16-byte multiple 208) left a 196..207 pad behind
`bgShape`'s trailing `u32`, and the environment-light precedent above is
filling a pad IN PLACE rather than growing the struct — but a `vec3f`'s
`AlignOf` is 16, and 196 % 16 != 0, so that trick does not repeat here: the
pair has to land at the next 16-aligned offset instead. It rides
`ShadeParams` and not the frozen balloon DE params block — 288/320/336 in
3D, 464/576/608/624 in 4D — because it LIGHTS a hit rather than moving
geometry: the march reads only the DE params block and never touches
`ShadeParams`, so a tint living there would be invisible to every mode but
`shade`.

A balloon-only `shell: f32` member joins `SurfaceHitInfo` right beside
`colorPos`, added by the same balloon-only branch that already emits it.
WGSL value constructors are all-or-none, so every core's own full-member
constructor grows a matching zero
(`SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0, vec3f(0.0), 0.0)`) — and a zeroed
`shell` reads as the FRACTAL term, the safe direction: an untinted hit.
Only `surfaceDEHitInfo`'s balloon wrapper writes a live value, mirroring
the oracle's own `BalloonDistance.shell` attribution — 1.0 when the echo
term wins the argmin STRICTLY (`dS < dF`) and 0.0 otherwise, so a tie goes
to the fractal exactly as the CPU convention does:

```
if (dS < dF) {
  var hi = surfaceDEHitInfoFractal(inv.xyz, li);
  hi.colorPos = inv.xyz;
  hi.shell = 1.0;
  return hi;
}
var hi = surfaceDEHitInfoFractal(p, li);
hi.colorPos = p;
hi.shell = 0.0;
return hi;
```

The shade entry mixes at the base-albedo site — right after the color source
resolves `base` (map / trap / height / radius / rings / sheets) and before
the normal is even sampled, so before the sRGB decode and the lighting
product: `base = mix(base, shade.balloonTint, shade.balloonTintStrength *
hi.shell)`. That ordering is the same rule the `envTint` block states above
— the shell still shades as geometry (its normal/shadow/AO taps read the
same DE), and specular stays untinted, added to the lit product after the
fact rather than multiplied through. Strength 0 — the packer's default and
the document's absent-field value — is `mix(x, y, 0.0)` = x exactly: today's
frame byte for byte, and `hi.shell` restricts the mix to the echo term
alone, so a fractal-term hit inside a balloon scene is untouched at any
strength.

A `balloon: false` kernel emits NOTHING new but the two unconditional
`ShadeParams` members — `packSurfaceGpuShade` defaults both to the identity
([0, 0, 0] and 0) when omitted, exactly like `envStrength` and
`fogTintStrength` before them — since no non-balloon core declares
`hi.shell` and nothing outside a balloon shade entry ever reads
`shade.balloonTint`/`shade.balloonTintStrength`. Both dimensions reach it
from ONE emission: the shade entry's color-resolve block is shared text
across all seven cores, so the mix and the `shell` member cost the 4D cores
nothing beyond what the 3D ones already pay — the packer was already shared
across dimensions before the tint landed. And NO FORWARD KIND EVER BALLOONS:
`core:"escape"`/`"bulb"`/`"escape4"` all throw on `balloon: true` (the
balloon's IFS-only rule), so those three cores carry none of this.

## Surface finish lanes (the `finish` codegen flag)

`finish: true` swaps the shade entry's fixed Blinn-Phong lines — `diffuse`
through the `linBase * lit + specular` encode — for one call into
`finishShade`, the function `surface-finish.ts`'s
`surfaceFinishShadeSource(SURFACE_FINISH_WGSL)` emits verbatim (Blinn-Phong
with an authored specular/shininess pair, metalness tinting the highlight
and damping the diffuse, Schlick fresnel driving an image-based reflection
off the backdrop's two stops, and a thin-shell transmission mix after the
encode). It is spliced ONCE, immediately ahead of `shadeRays`, for all
seven cores — the shade entry is shared text, which is why the 4D half of
the feature costs no second emission (the balloon tint's own precedent one
section up).

THE WIRE IS THE `shadeMaps` STRIDE AND NOTHING ELSE. Under shade + finish
the buffer grows 1 -> 3 `vec4f` per slot: `[0]` keeps (rgb, trapIndex)
unchanged, `[1]` = (specular, shininess, metalness, reflect), `[2]` =
(transmit, reflectionTint, patternConfig, scale). The lane order is
`surfaceMaterialLanes`' single definition, shared with the GLSL tracers'
`uMapFinishA`/`uMapFinishB` uniform pair, so the two shader dialects cannot
disagree about which field rides which component. The finish landing's
zero-filled reserved tail is now the live patterned-material wire; the stride
remains three. `packSurfaceGpuShadeMaps`
grows the matching optional `finishes` argument (absent -> today's
1-vec4-stride buffer byte for byte; a length mismatch against `colors`
throws `RangeError`), and the binding declaration stays a runtime-sized
`array<vec4f>`, so keeping the packed stride in sync with the compiled flag
is a host contract, `slabExt`'s shape. Deliberately NO `ShadeParams` append
(`SURFACE_GPU_SHADE_BYTES` stays 224) and NO frozen params-block change at
any offset in either dimension: the finish is per-SLOT data, and the
per-slot buffer already existed.

SHADE-MODE EMISSION ONLY. March/eval kernels never read `shadeMaps`, so
their source is byte-identical even with the flag on — one options object
can build a session's march and shade kernels, and the bench's baselines
stay the kernels they were. Inside shade-mode text every `shadeMaps` read
site gains its `* 3` through one interpolated stride token — the four
hit-info trap reads (fold/affine/affine4/fold4) and the base-color read,
which also hoists its slot clamp into an `fSlot` local the two lane
fetches share; a site spelled without the token would silently read a
finish lane as a trap index, and a codegen test regexes the emitted source
so a missed site fails rather than miscolors.

BYTE IDENTITY IS A COMPILE GATE, NOT A DEFAULT-VALUES CLAIM. `pow(x, 32.0)`
with a literal exponent -> `pow(x, fa.y)` with a per-slot value is NOT an
exact identity (the classic params reproduce the fixed formula's VALUES,
never its bytes), so the parametric path is gated on the flag and an
unauthored document compiles literally today's program text —
`foldVariationFn`'s same-function-object philosophy applied to shaders.
Absent or `false` reproduces today's source byte for byte across every
mode, core and wrapper, pinned by the same omitted-vs-explicit sweep the
lens, balloon and plane flags carry.

Three composition rules, each inherited rather than invented:

- FORWARD CORES (escape/bulb/escape4) leave `hi.firstChoice` at its
  constructed 0, so slot 0 IS their wire — the HEAD transform's finish is
  the scene's, deterministic and disclosed, exactly as their hit-info
  already reads the head link's growth before a step has run.
- BALLOON: a shell hit's `firstChoice` comes from the hit-info descent at
  the INVERTED point, so the echo inherits its source map's finish for
  free; `balloonTint`'s albedo-side mix keeps its ordering (the tint
  applies to `base` BEFORE `finishShade` sees it), so a tinted shell
  shades under its own map's finish.
- GROUND PLANE STAYS MATTE: `shadeGroundPlane` is untouched by the flag —
  its own recorded "lighting minus specular" decision — so the floor
  carries no finish at any authoring.

No new throws anywhere: `finish` composes with every core and with
lens/balloon/groundPlane.

## Surface pattern lanes (the `pattern` codegen flag)

`pattern: true` compiles the pattern ALBEDO arm into the shade entry — the
WGSL twin of the GLSL tracers' `SURFACE_PATTERN` body, emitted from the
SAME template (`surface-pattern-shade.ts`'s dialect emission, the
`surfaceFinishShadeSource` discipline one feature over) so the two GLSL
tracers and the WGSL kernel cannot drift on the arithmetic; a test
collapses both dialect texts onto one canonical character stream. One
splice, immediately ahead of `shadeRays` (beside `finishShade`), serves
all seven cores — the shade entry is shared text.

THE SOURCE IS THE HIT-INFO, NOT THE SHADE ENTRY. The frame oracle's
`source4` member joins `SurfaceHitInfo` under the gate, and each core's
hit-info fills it with the raw attractor-frame point, reversing the
render's remaps in the surface-pattern-frame.ts order:

- 3D descent cores (fold, affine) fill their final-applied query `q`
  (`finalM * p + finalT`, the packed final INVERSE; identity under a fold
  final) — the GLSL `patternSource` after the `uFinalInvM` apply.
- The forward cores (escape, bulb) fill the plain hit `p`: no final
  transform can exist on a forward chain.
- The 4D descent cores (affine4, fold4) RE-LIFT the hit at its OWN w —
  `finalApply4(rotorInvApply4(vec4f(p, w0 + sStar * sliceHalfW)))` — the
  hit's w inserted BEFORE the inverse rotor (doing it after would
  screen-lock any w-mixing pose), then the affine final inverse.
- escape4 fills the plain rotor lift `liftEscape4(p)` (its slab is pinned
  0 and no final lens can exist; `finalApply4` is not even emitted for
  forward cores).
- The 4D LENS wrapper overwrites the core's fill with the WINNING BRANCH
  TUPLE `bestQ + sStar * bestExt` (the oracle's fold-final source; `bestQ`
  alone without a slab). The 3D lens and the balloon wrapper need NO
  splice: the core call already runs at the winning query (bestQ; the
  balloon argmin's `inv.xyz`/`p`), so the core's own fill IS the GLSL
  `patternFoldLensSource` / `cpos` value.

THE SHADE ENTRY NORMALIZES AND CALLS. 3D reads `(source4.xyz -
boundCenter) / boundingRadius` (the shared bound centre); 4D reads
`source4.xyz / boundingRadius` (the raw radius, implicit zero centre —
never the live slice radius). The footprint is the TIER-INDEPENDENT
acceptance epsilon at the hit depth: `params.pixelEps * t /
boundingRadius`, where `params.pixelEps` is the host-packed
`acceptPixelEps` (native-height derived — a preview coarsens sampling,
never acceptance), the GLSL `uAcceptPixelEps * t / uBoundingRadius` twin;
`tracePixelEps` stays the normal probe's own scale. The call reads the
hit slot's shared B lane (`fb`), the calibration quartet and the sheets
carrier, and lands in the document's order — colour source -> balloon
tint -> pattern -> lighting -> fog — with `shadeGroundPlane` untouched
(the floor stays unpatterned).

THE CALIBRATION RIDES SHADEPARAMS, SHADE-MODE ONLY. The rings/sheets
clamp quartet `(ringsLow, ringsInvSpan, sheetsLow, sheetsInvSpan)` —
`shade.patternCalibration` at offset 224, closing the struct at 240
(`SURFACE_GPU_SHADE_PATTERN_BYTES`) — is declared ONLY under shade +
pattern: a pattern-enabled MARCH kernel's text must stay byte-identical
(the acceptance sweep), and the march never reads the member. The host
sizes ONE buffer at 240 for both pipelines of a patterned session (a
struct never reads past its own size) and packs the quartet from the
session's materials.

BYTE IDENTITY IS A COMPILE GATE, as with finish: absent or `false`
reproduces today's source byte for byte across every mode, core and
wrapper, march/eval stay byte-identical under the flag, and the shade
stride (1 -> 3 under finish OR pattern) is the centralized token the
finish sweep already regexes.

MEASURED (this tree, 640x360, the .6 compute gate): the pattern body adds
a uniform ~11.7-11.8 KB to every shade kernel (fold 29799 -> 41546 B,
affine 26374 -> 38121, escape 21017 -> 32760, bulb 13920 -> 25663,
affine4 33679 -> 45471, fold4 38453 -> 50245, escape4 17923 -> 29644).
Real-driver (Intel Iris Xe / Mesa, `intel gen-12lp`) settle wall times for
a patterned session are within run-to-run noise of the strength-0 control
on the same kernel (e.g. lens3 3212 vs 3061 ms; escape4 667 vs 662 ms),
and the ray census is IDENTICAL across the unauthored/patterned/
strength-0 legs — the pattern changes shading, never geometry.

## Modes

`eval` (per-query distances) and `march` (bounded-dispatch ray march,
host-compacted active list) are the bench baselines, byte-identical since
the spike. `march` + `rays:"unproject"` swaps the ray derivation to the GLSL
tracer's `uInvProjView` unproject (+ flag-gated start dither) for the app
path, and `shade` runs the GLSL tracer's FULL shading (greedy width-1
hit-info descent, tetra normal, penumbra shadow, AO, linear-space lighting,
fog, LUT color sources) over host-compacted batches of TERMINAL rays.

March and shade are separate entries by measured verdict, not taste: the v1
megakernel shaded rays inside the march pass that terminated them and LOST
THE DEVICE on Iris (shading = ~40 zero-cutoff on-surface DE evals/hit — the
i915 watchdog through the shading door; numbers in the measured verdicts
below).

`shadeDeWidth` routes exactly those probe taps (normal/shadow/AO — they
LIGHT a hit the full-width march already certified, never decide geometry)
to a second narrow descent `surfaceDEProbe`, derived from the same body
template by token rename so the two cannot drift; app ships width 1.

### `statusOut` — the march's status side channel

The host compacts the active list from ONE field of the ray state, the
status. Reading it out of the `states` buffer costs 16 B per FRAME ray
per sweep — the whole buffer, however short the active list has become —
where 4 B per ACTIVE ray answers the same question. `statusOut: true`
(march mode only) declares
`@group(0) @binding(5) var<storage, read_write> statusOut: array<u32>`
and writes `u32(st.y)` there at EVERY exit of `marchRays`: the two
sphere-gate early-outs, the defensive non-ACTIVE guard, and the
fall-through. The index is the ray's SLOT in the active list, not its ray
id — the array being rebuilt — so a host that dispatches the sweep in
slices reads slice `k`'s answers at slice `k`'s own offsets. The
out-of-range guard (`slotI >= params.itemCount`) is the one exit that
must NOT write, and a codegen test pins that.

It is a pure side channel: nothing on the device reads it, so the ray
states, the pixels, and every measured quantity are what they were. Absent
or `false` reproduces the pre-side-channel source byte for byte, which is
what keeps the bench's own march legs (leg A's agreement march, the timing
sweep) the kernels they have always been — they never set it, and their
4/5-entry bind group layouts are untouched. Outside march mode it THROWS
rather than being ignored: a host that binds a status buffer to an eval or
shade pipeline has a contract bug.

Pinned end to end without a single bench edit, which is the nice part: leg B
(`runSurfaceComputeFrameLeg` and its escape/plane/4D siblings) drives the
PRODUCTION `SurfaceComputeRenderer`, and its gate is `frame.counts.hit`
against a CPU sanity march's hit rate — a tally that, is derived from this
side channel. Mis-index the slots and the hit rate diverges.

**MEASURED VERDICTS** (Iris Xe, real driver):

- march traces mandelboxKifs at width 12 in 49µs/ray primary (private
  frontier, stage 2 off) where the WebGL fragment tracer was unbounded
  (>1300µs/ray, measured by the fold-DE cost instrumentation);
- width superlinearity GONE (w12/w4 ≈ 3.3x);
- compiles ~0.1-0.3s vs the ~25s GLSL link cliff;
- workgroup-shared frontier 2-3.3x SLOWER than private;
- stage-2 B&B 1.4-1.6x slower GPU-side at BOTH far-field and
  near-surface poses — config stays stage-1-only;
- shading DOMINATED end-to-end cost after the app integration (full-width
  probes: 740s/frame at 96x54, unable to converge a 900s budget at a
  hit-dominated pose); the width-1 probes shade the identical 660-hit
  frame in 31s (23.8x, thermally understated) with
  eyeball-identical images — differences are a slight lightening of
  deep-crease shadow/AO from the greedy DE's overshoot, no structural
  artifacts.

## Consumed by / pinned by

Consumed by `src/app/surface-compute.ts` (the fold- and escape-shaped
surface sessions' preferred tracer) and pinned by `src/app/gpu-bench/`'s
surface section (`npm run bench:surface`; real-driver timing via
`--display=:0`; `--surface-shade-width=N` reruns the probe-width A/B).
The appended `gearworksCondensation` agreement row uses the same 700-query
CPU oracle gate as the affine core, but compiles a dedicated gear-SDF pipeline;
`marchUnprojectCondensation` then runs the bounded app-ray march against the
CPU emulator. The established fold/lens/balloon fixtures and timing rows are
unchanged.
