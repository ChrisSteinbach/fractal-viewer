# Surface GPU kernels (`src/fractal/surface-de-gpu.ts`)

This is the full record behind CLAUDE.md's `surface-de-gpu.ts` bullet under
`src/fractal/`. CLAUDE.md keeps the rules, the frozen offsets and a
condensed description of each core; this document keeps the measured
verdicts, the bench-leg/classifier design, and the historical
(including refuted) narrative.

## Overview

`surface-de-gpu.ts` is the WGSL fold-DE compute kernel (fr-q1f8 spike,
gated in by fr-ck0w's occupancy verdict; app integration fr-tzdg). It
mirrors `estimateDistance`'s `refine=false` fold path term for term (the
estimator the fold GLSL marches) under the `flame-gpu.ts` oracle
discipline. It is source-generated per config: frontier width,
workgroup-SHARED (banked, transposed) vs private frontier storage, and
fr-kidj stage-2 branch-and-bound on/off (WGSL has no Mesa link cliff, so
there's no reason to strip source the way the GLSL side must).

## The fold's authored lengths (fr-s9ll)

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
- 4D lens: 576

`foldRadiiOf` is emitted only where a fold branch reads it — the fold
cores, or ANY core under the lens wrapper — so affine kernels stay
byte-identical.

### The 4D tail has the same shape (fr-vag4 / fr-qxxw / fr-h0c3)

One decision serves all three: the shared plane/balloon block lands at
the frozen offset 576 for EVERY 4D core, which the lens4 block being
declared unconditionally under either core is what buys — the 3D
`lens || balloon || groundPlane` rule one dimension up, zero-filled by
the packer when there is no lens (4D balloon -> 608, 4D plane -> 624).

fr-h0c3's bead had recorded exactly the hazard this avoids: a block
appended at offset 560 lands INSIDE fr-s9ll's `lens4Fold` quartet and
corrupts it.

## Seven kernel cores

fr-55s1 added the second core, fr-dlxh the third and — its 4D cut — the
fourth, fr-rsp6 phase 2A the fifth, fr-7u8t.9 the sixth, fr-vag4 the
seventh.

### `core:"affine"`

Emits the width-4 A/B + fr-jkpn-validity-slot REFINED ladder (mirrors
`estimateDistanceRefined`, the affine GLSL's estimator; width /
sharedFrontier / bnbStage2 / shadeDeWidth are inert) beside the fold
frontier, picked off `deHasFolds` exactly like the CPU.

### `core:"escape"` (fr-dlxh)

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

Since fr-s04t the orbit CYCLES the document's whole formula chain — link
`i mod n`, `+ p` and the bailout test after EACH link, `maxDepth * n`
single-link steps — reading one `GpuMap` per link off the maps storage
binding (`packEscapeGpuMaps`), so the escape core DOES declare buffer 1
now, and `core:"bulb"` is the one bindingless core left.

Since fr-j231 a link's `kind` may be a POWER map (4 = triplex, 5 =
quaternion square), so the fold pair's negative `kind != 2u` /
`kind != 1u` dispatch sits behind a `kind < 4u` GUARD in both bodies —
this file's own doc names an unguarded new kind as the reason the
Mandelbulb became a sixth core, and the guard is what makes a fourth and
fifth kind safe here. `bulbPow8` is HOISTED to one definition emitted
for the two forward cores rather than copied (declared in the body
block, so both the value body and the entry's hit-info see it, and
affine/fold kernels stay byte-identical), and the block's `escParams.w`
at offset 268 turned from pad into the ONE live word of the head-link
ballast: `EscapeDE.logEstimate`, the chain-level choice between `r/dr`
and the Böttcher `0.5·r·ln r/dr`. Its hit-info gained the matching second
interpolant, off the DEGREE of the link that produced the terminal
radius (a pre-scaled power link has `growth < 1`, which failed the old
guard and dropped the trap back to the raw integer confetti fr-7u8t.8
removed).

`width`/`sharedFrontier`/`bnbStage2`/`shadeDeWidth` are all inert, and
its hit-info reports the trap as the CONTINUOUS escape fraction
(fr-7u8t.8): `escapedAt` minus `log(r/R)/log(growth)` for the link that
produced the escaping radius, over the PASS budget `maxDepth`. The raw
integer count is a step function of position and painted the real
Mandelbox as palette confetti — it looked fine only while the escape set
was a blob with one count everywhere; smoothed, it is the canonical
Mandelbox palette coordinate.

The denominator is the pass budget and NOT the chain's own `maxDepth * n`
step budget, since fr-byxb: `escapedAt` counts single-link steps and an
orbit escapes after a handful of them however long the chain is, so
dividing by a budget that multiplied with the link count shrank the
reachable ramp per link added and a chain painted in the bottom of its
palette.

**MEASURED TWICE**, and the two populations disagree about the size of
the win. Over the whole surface, the median trap at 2/3/6 links went
0.180/0.110/0.056 -> 0.360/0.331/0.333. At the PIXELS chain-speckle's own
pose hits, it went 0.132/-/0.072 -> 0.265/-/0.431. Both agree on the
claim — n = 1 identical to the bit (the same expression), and the
SYSTEMATIC per-link collapse gone — but not on whether the result is
flat, so "no per-link trend" is what this normalizer buys, not
chain-invariance.

Cost is the clamp, and fr-8fii moved it a long way: 6.78 / 10.59 /
31.44% of really-hit pixels at one / two / six links, up to 15.8% over
the whole surface. The 1.9-8.6% this line used to quote was wrong three
ways — the two populations' labels were swapped where
`surface-material.ts` records them, 1.9% is the TWO-link row rather than
anything at six, and the pixel figures predate fr-azjk.

**THE PIXEL-POPULATION ROW IS POSE-DEPENDENT AND ITS POSE MOVED**
(fr-azjk): `chain-speckle` fits its marching ball to the set's reach,
that fit was inflated by a halo of near-boundary escapers, and on the
corrected fit the shipped normalizer's median trap reads 0.430 at two
links and 0.710 at six against the recorded 0.265 and 0.431. Same
direction, same claim — no per-link collapse — measured on an object
that is no longer drawn smaller than it is, and the clamp share rose for
the same reason the median did: a smaller object in a larger frame
spends its hit pixels on the SILHOUETTE, where orbits escape early, and
the corrected frame fills with interior pixels whose orbits survive the
budget.

The sheet PRINTS that share now rather than leaving it to be quoted
(fr-8fii — it was unfalsifiable for one release), and the same run
bounds it twice: the raw integer count clamps the identical pixels
(6.78 / 10.61 / 31.44%), so the saturation is the coordinate's own and
not fr-7u8t.8's smoothing, and box-averaged over 16 sub-samples the rows
read 0.16 / 0.00 / 0.00%, so the flat top-of-ramp PATCHES are sub-pixel
rather than regions of the object — DIRECTIONAL for the shipped settle
rather than its own figure, since this averages the TRAP over 16 where
fr-vpbq/fr-jf9y average the shaded COLOUR over 8.

The trap drives COLOR ONLY (the convention `core:"bulb"` always used),
with rings/sheets over the orbit's closest radial / y-plane approaches —
the descent cores' colors-only convention.

### `core:"bulb"` (fr-7u8t.9)

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

### `core:"affine4"` (fr-dlxh's 4D cut)

The refined ladder ONE DIMENSION UP — `surface-de-4d.ts`'s
`estimateDistance4Refined` behind the app's view lift, the estimator
`surface-material-4d.ts` marches. The body's prologue does
`rotorInv · vec4f(p, w0)` (the GLSL's `uInvRotor` line), the fr-wa6o slab
rides one vec4f half-extent register beside every point (linear parts
alone, gated on the dynamically uniform `sliceHalfW > 0`), and the
fr-u91x kaleidoscope sweeps ONE backward-step 4×4 where 3D swept a
`(cos, sin)` pair.

Its params variant tail (208..463, `SURFACE_GPU_PARAMS4_BYTES` 464,
`packSurface4GpuParams` + a per-frame `SurfaceGpu4View`) holds
rotor/stepBack/4D-lens rows as row-vec4 quartets — the buffer always
stores the ROW-MAJOR bytes of the matrix the body applies, the packer
performing the one real transpose (pose rotor → world-to-attractor,
`setSurfaceView4`'s exact dance) — plus w0/sliceHalfW/`visRadius4` and
the fr-skhv radius-ramp band (`SurfaceDE4.radiusBand` as
center4/minD/invRange); maps are the `GpuMap4` layout
(`packSurfaceGpuMaps4`, 128-byte 4D stride).

Two frozen slots carry 4D semantics: `visibleRadius` packs the
SLICE-ADJUSTED `sliceVisR` so the shared march entry's sphere gate is
the 4D GLSL's textually unchanged, while the tail's `visRadius4` keeps
the FULL radius for the height color source and the radius source
normalizes its center-relative distance over the band — both
slice-invariant, the 4D GLSL mirrored (those two shade lines are the one
core-conditional interpolation in the shared entry text).

Fixed width 4 (inert knobs like `"affine"`); nonzero `footprint` THROWS
at pack (the 4D oracle has no cone cap).

### `core:"fold4"` (fr-rsp6 phase 2A)

The FOLD frontier one dimension up — 4D fold base maps
(`deHasFolds4`) marched as the same width-configurable frontier as 3D
`"fold"`, slab(`ext`)-aware, sharing `GpuMap4` and the affine4 tail; no
stage-2 B&B emission by the 3D measured verdict, and `lens:true` wraps
either 4D core in `descendLens4`'s branch sweep (fr-rsp6 phase 2B — the
appended lens4 params block at 464..575, `SURFACE_GPU_PARAMS4_LENS_BYTES`
576 — 464..559 as fr-rsp6 shipped it, plus fr-s9ll's `lens4Fold` quartet
at 560; nothing follows the block, so it grew in place — packed exactly
when the DE carries a `foldFinal`; the old "4D lens throws" rule is
gone).

Bench legs `fold4Boxfold`/`Mandelbox`/`Kaleido`/`Slab` + a fold4
compute-frame leg pin it.

A `mapsUniform` codegen option (fr-b72d probe) moves the 4D cores' maps
binding to a fixed 24-slot uniform array. REFUTED for production —
0.99-1.02x at every kaleidoscope order on Iris, values bit-identical —
and kept as the refutation's executable record, agreement-gated by the
extended opt-in `--surface-aff4-sweep` leg (5 arms x orders 1-6,
pilot-sized watchdog-safe batches); that leg plus
`scripts/aff4-order-cpu.harness.ts` carry fr-b72d's closure verdict: the
order superlinearity is the ALGORITHM's own depth growth, CPU-oracle-
matched, not kernel realization.

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

M1 lens rows gate at ~2e-7 (81-branch mandelbox worst case included);
the field class marched 5184 unproject rays fail=0, hits 812/811 — that
leg and the fold-pair leg each carry ONE status mismatch on the real
Iris driver where SwiftShader has none (fr-7tl3), excluded as
`silhouetteFlips`: the two marches reached the same point on the same
trajectory and straddled `d < eps` by 0.6%/2% of eps, which the older
same-terminal-`t` rule could never recognize because a miss runs on to
the sphere exit while a hit stops at the surface.

**Re-verify surface kernel changes on `--display=:0`, not SwiftShader
alone** — fr-dlxh re-proved it: the escape eval leg's first classifier
(a single fround twin of the oracle) passed SwiftShader clean, then real
Iris flipped 6 "stable" rows at maxAbs 0.41. A forward orbit is chaotic
(~8x/iteration noise growth into the escape-decision dichotomy; the
folds themselves are C0-continuous, so there is no boundary-proximity
predictor), and which rounding seeds flip is realization-dependent — so
the leg gates in LAYERS:

- pre-hoc, a seven-orbit ENSEMBLE classifier (`escapeQueryStable` — the
  fround twin at the query and its six one-ULP axis neighbors must all
  agree with the f64 oracle; exclusions disclosed per row and pinned
  under 20%, the structural not-eating-the-leg cap);
- post-hoc, a residual failure is absolved only if
  `escapeShadowFlipVerified` proves some 1..4-ULP neighbor orbit
  REPRODUCES the GPU's value within tolerance (fr-7tl3's per-mismatch
  discipline lifted to eval; `flips=` in the row, capped at 7).

Measured on real Iris AT fr-dlxh, on the FOUR escape systems that
existed then: fail=0, worst row excluded=74/700 with flips=2, gated
maxAbs 2.1e-6. That is a dated reading and not a standing baseline — the
fixture set is NINE systems now (fr-s04t added the three chain rows,
landing at 10.1/10.1/13.9% exclusions, and fr-s9ll added the
parameterized one), so a later row's numbers have no business being
compared against it. fr-jtd4 is open on exactly that confusion.

A `computeFrameEscape` leg runs one production frame through
`SurfaceComputeRenderer` with a `{kind:"escape"}` target and checks it
against a strided CPU sanity march as HIT RATES rather than the
per-pixel fr-7tl3 status-exclusion tiers — the march entry text is
shared across every core (test-pinned) and the escape DE is eval-pinned,
so a rate band absorbs the same chaotic-orbit flips without duplicating
that machinery for a second DE type. Measured on real Iris: 256x144 in
136ms wall, 33 passes, 0 exhausted, GPU hit rate 0.153 vs CPU 0.158 — the
rates roughly halved at fr-7u8t.8, which is the Mandelbrot form replacing
a blob that filled 89.4% of its own ball with an object that fills 3.5%
(fr-azjk's corrected figures — the record read 94% and 10% off a grid
thresholding the estimate); the gate is the GAP between the two rates,
so it moved with them.

### `core:"escape4"` (fr-vag4)

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

## Ground plane (fr-rhn5)

Ground plane is an orthogonal `groundPlane` option, not a core of its
own — it composes with every descent/escape core, in both dimensions
since fr-h0c3, and with the lens wrapper. It adds a fifth ray status,
`SURFACE_GPU_RAY_PLANE` (4), that the march classifies a
sphere-gate/sphere-exit MISS into when a downward ray crosses the floor
inside its fade band (EXHAUSTED never planes); the shade entry lights
the crossing with the hit path's penumbra/AO probe-width discipline
under two analytic ball certificates.

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

## Modes

`eval` (per-query distances) and `march` (bounded-dispatch ray march,
host-compacted active list) are the fr-q1f8 bench baselines,
byte-identical since the spike. `march` + `rays:"unproject"` swaps the
ray derivation to the GLSL tracer's `uInvProjView` unproject (+
flag-gated start dither) for the app path, and `shade` runs the GLSL
tracer's FULL shading (greedy width-1 hit-info descent, tetra normal,
penumbra shadow, AO, linear-space lighting, fog, LUT color sources) over
host-compacted batches of TERMINAL rays.

March and shade are separate entries by measured verdict, not taste: the
v1 megakernel shaded rays inside the march pass that terminated them and
LOST THE DEVICE on Iris (shading = ~40 zero-cutoff on-surface DE
evals/hit — fr-096u's watchdog through the shading door; numbers on
fr-tzdg).

`shadeDeWidth` (fr-p8bc) routes exactly those probe taps
(normal/shadow/AO — they LIGHT a hit the full-width march already
certified, never decide geometry) to a second narrow descent
`surfaceDEProbe`, derived from the same body template by token rename so
the two cannot drift; app ships width 1.

### `statusOut` — the march's status side channel (fr-si66)

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
states, the pixels, and every measured quantity are what they were.
Absent or `false` reproduces the pre-fr-si66 source byte for byte, which
is what keeps the bench's own march legs (leg A's agreement march, the
timing sweep) the kernels they have always been — they never set it, and
their 4/5-entry bind group layouts are untouched. Outside march mode it
THROWS rather than being ignored: a host that binds a status buffer to an
eval or shade pipeline has a contract bug.

Pinned end to end without a single bench edit, which is the nice part:
leg B (`runSurfaceComputeFrameLeg` and its escape/plane/4D siblings)
drives the PRODUCTION `SurfaceComputeRenderer`, and its gate is
`frame.counts.hit` against a CPU sanity march's hit rate — a tally that,
since fr-si66, is derived from this side channel. Mis-index the slots and
the hit rate diverges.

**MEASURED VERDICTS** (Iris Xe, real driver):

- march traces mandelboxKifs at width 12 in 49µs/ray primary (private
  frontier, stage 2 off) where the WebGL fragment tracer was unbounded
  (>1300µs/ray, fr-ck0w);
- width superlinearity GONE (w12/w4 ≈ 3.3x);
- compiles ~0.1-0.3s vs the ~25s GLSL link cliff;
- workgroup-shared frontier 2-3.3x SLOWER than private;
- stage-2 B&B 1.4-1.6x slower GPU-side at BOTH far-field and
  near-surface poses — config stays stage-1-only;
- shading DOMINATED end-to-end cost after fr-tzdg (full-width probes:
  740s/frame at 96x54, unable to converge a 900s budget at a
  hit-dominated pose); fr-p8bc's width-1 probes shade the identical
  660-hit frame in 31s (23.8x, thermally understated) with
  eyeball-identical images — differences are a slight lightening of
  deep-crease shadow/AO from the greedy DE's overshoot, no structural
  artifacts.

## Consumed by / pinned by

Consumed by `src/app/surface-compute.ts` (the fold- and, since fr-dlxh,
escape-shaped surface sessions' preferred tracer) and pinned by
`src/app/gpu-bench/`'s surface section (`npm run bench:surface`;
real-driver timing via `--display=:0`; `--surface-shade-width=N` reruns
the fr-p8bc probe-width A/B).
