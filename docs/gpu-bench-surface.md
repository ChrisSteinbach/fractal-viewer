# GPU Bench: Surface (`npm run bench:surface`)

This is the full measurement record behind `npm run bench:surface`. AGENTS.md's
Commands section points here rather than carrying these numbers inline.

## What the bench pins

`npm run bench:surface` is the WebGPU fold-DE kernel agreement/timing bench.
It pins `surface-de-gpu.ts` — both the eval/march baselines and the app
path's march-unproject/shade — to the CPU estimator.

Pure swirl final lenses add `lensSwirlPostOverAffine`,
`lensSwirlPostOverFold`, `lens4SwirlPostOverAffine` and
`lens4SwirlPostOverFold` to the existing lens rows. Their nonzero translation,
unequal pre-scales, signed weight and post-affine pin inverse order in both
dimensions; the 4D views also rotate through w. The CPU primary-ray references
divide their complete hit epsilon by the same stored global certificate as
the shader. Eval, march and hit-info retain the existing comparators and caps.
The [swirl qualification record](swirl-surface-lens.md) separates these numeric
checks from the fixed-geometry fidelity and production-browser gates.

`marchUnprojectSwirl` additionally pins eight primary-ray rows (four cores,
plain and Balloon), and `computeFrameSwirl` runs four small patterned Balloon
frames to execute hit-info, source coordinates and shade probes. Balloon eval
rows require both union terms to win. Eight additional `stride:balloon(...)`
eval rows cover all four swirl cores at radii 0.35 and 1.6 through the same
scalar readback and existing comparator. They compare the paired CPU stride,
including the echo's empty-ball certificate, against the WGSL stride; their
activation check compares against the primary global-G stride actually used
by the union. Normal scalar eval and hit-info continue to use global-G
acceptance. The march rows additionally exercise the echo's near-hit
transition with a nonzero cutoff. Every real-driver production frame must
finish with hits and misses, no exhausted or active rays, and the existing CPU
sanity tolerance; an empty slice cannot pass merely by matching background.

Finite chamber tiling adds a mandatory compact ABI/agreement gate across all
seven kernel cores. Each core must compile, bind a params buffer at its exact
legal byte length, dispatch, and agree with the matching `tiling-de.ts` CPU
wrapper at three probes: a chamber crossing, an active analytic clip and, for
F4, a genuinely w-dependent fold. This is deliberately one all-or-nothing
gate rather than seven benchmark rows: its purpose is to keep every core and
every trailing uniform layout live, including the aligned 16-byte tiling tail.

The condensation addition appends two Gearworks gates without changing any
existing fixture or timing baseline. `gearworksCondensation` runs the normal
700-query affine agreement comparator against a dedicated WGSL program with
the gear SDF generated into it. `marchUnprojectCondensation` then uses the
same bounded 96x54 app-ray march and per-ray CPU emulator as the established
fold/lens/balloon legs. Either compilation failure, truncation or unexcluded
agreement failure fails the section.

The mandatory `condensation-emitter-only.ts` leg separately pins finite
emitter unions in 3D and 4D through eval, hit-info and the production shade
entry. Its rows cover zero requested depth, scheduled B, xaos, symmetry,
a five-way final B expansion and both branching-prefix capacity boundaries.
Independent posed-shape distances, authored material colors and distinct
palette coordinates are the references; shader agreement alone cannot
certify the newly admitted CPU path. See the
[emitter-only qualification](emitter-only-surface.md).

Trap-as-geometry adds one 3D and one 4D agreement row. Each uses a finite
level band, recomputes the f64 oracle and its f32 stability twin with the same
posed shape, and compares a dedicated geometry-enabled WGSL program. This
pins post-link sampling, `drAfter`, the 0.9 shape safety factor, the inclusive
band and the min-union without weakening or replacing the existing escape
classifiers. There is deliberately no bulb row: geometry is refused for power
maps while the trap's color channel stays available.

The scheduled-hybrid addition appends two eval-agreement rows and one app-ray
row without weakening an existing cap. `scheduledSpongeOfFerns3` runs the
affine core; `scheduledSpongeOfFerns4Flat` lifts the same document through the
affine4 core at the identity/flat view. Both use the shipped composition —
four weighted Barnsley A maps, twenty Menger B maps, depth 2 — so the physical
wire is exactly full at 24 records. Each eval row compares the scheduled WGSL
against the CPU oracle and gates at `fail=0`; the 4D row additionally keeps the
existing oracle-continuity exclusion ceiling.

`marchUnprojectSchedule` runs `scheduledSpongeOfFerns3` through the bounded
app-ray march. It gates at `fail=0`, no truncation and at least one pass, and
requires both CPU and GPU hit counts strictly between zero and the ray count.
Those activation checks keep an all-background, all-surface or
compilation-only result from passing numerically. Do not substitute the
GPU-bench app's older point-mode `schedule-sponge` / `schedule-4d` scenarios:
those pin the Flame plot-time post-word, not Surface's level-dependent inverse
descent.

`computeFrameSchedule` takes that same 3D fixture through the production
`SurfaceComputeRenderer`, beyond a bare eval/march pipeline. Every adapter must
dispatch at least one pass and produce at least one hit. A completed
real-adapter frame must additionally contain a background miss and finish with
zero exhausted and zero active rays. Only a software-diagnostic frame may use
the bench's budget-truncated convention, and it still needs dispatch plus a
scheduled hit; a real-adapter truncation, null frame or throw fails. Its
evidence note begins
`compute frame schedule scheduledSpongeOfFerns3` and records passes, the four
terminal counts, truncation and the derived activation/geometry/settled gates.

`surface-schedule.test.ts` remains the independent finite-word oracle: it pins
`k=1`/`k=2`, last-B-first inverse order, lens-outside ordering, weighted
support and the all-zero uniform fallback, every child-level bound, no B
symmetry, the condensation depth shift, sampled-cloud lower bounds and flat
3D/4D parity. The material and GPU tests then pin GLSL/WGSL source selection,
`[A][B][emitters]` packing, combined params sizes, the 24-record cap and exact
feature-off bytes; `surface-compute.test.ts` pins renderer resource selection
and allocation, while `surface-eligibility.test.ts` pins app routing/refusal.

The separate browser verifier, `scripts/surface-schedule.verify.mjs`, covers
the presentation seam rather than duplicating those numeric comparators. It
runs compute/off, compute/on, WebGL/off and WebGL/on legs, proves the requested
engine actually activated and settled, records the ray census, then requires a
structural on/off pixel delta within each engine (`schedule-effect`).

Graph-directed descent adds `xaosFernSponge3` and
`xaosFernSponge4Flat`. Both use the shipped 24-state block-diagonal Fern |
Sponge preset and compile dedicated graph-aware WGSL, so a classic all-paths
kernel cannot satisfy either row. Their query cloud comes from the xaos-aware
point sampler; the flat 4D row reuses the identical rounded 3D query set. The
ordinary agreement gate requires `fail=0`, and the 4D continuity-exclusion cap
is unchanged.

`marchUnprojectChaos` and `computeFrameChaos` apply the schedule rows' same
anti-vacuity discipline to that graph. The march must dispatch, complete,
agree on every included ray and produce a nonempty/non-full hit mix on both
CPU and GPU. The production frame must dispatch and hit geometry; on a real
adapter it must also complete with a HIT/MISS mix and no EXHAUSTED or ACTIVE
rays. Only a software diagnostic may report an activated, geometry-bearing
truncation. `scripts/surface-chaos.verify.mjs` independently runs compute and
WebGL with xaos removed/present, proves xaos is the only document difference,
then gates settlement, ray census, temporal stability, within-engine
`chaos-effect` and cross-engine agreement.

## Running it

Add `--display=:0` for real-driver timing. Run it on a QUIET machine, never
concurrently with the test suite or other heavy CPU load: a contended
software device corrupts mid-run readbacks, which the contended-device
canary reports as `verdict=device-unreliable` (exit 2, rerun) instead of
plausible numeric fails.

Judge the escape rows on `--display=:0` — this is already this file's
standing advice, and the reason is the known SwiftShader false failure
documented below. Do not raise the escape agreement cap to make a
SwiftShader run green.

For the condensation, escape-geometry, scheduled-hybrid and graph-directed
landings, run the static gates before adapter evidence:

```bash
npx vitest run src/app/gpu-bench/condensation.test.ts \
  src/app/gpu-bench/chaos.test.ts \
  src/app/gpu-bench/schedule.test.ts \
  src/fractal/condensation-de.test.ts src/fractal/surface-de-gpu.test.ts \
  src/fractal/surface-schedule.test.ts src/fractal/surface-chaos.test.ts \
  src/fractal/shape-trap.test.ts src/fractal/escape-de.test.ts \
  src/fractal/escape-de-4d.test.ts \
  src/app/surface-compute.test.ts src/app/surface-eligibility.test.ts \
  src/app/surface-material.test.ts src/app/surface-material-4d.test.ts \
  src/fractal/surface-grid.test.ts src/fractal/balloon-de.test.ts \
  src/fractal/tiling.test.ts
npx tsc --noEmit
npm run bench:surface -- --display=:0
```

Run both construction presentation verifiers against a separately served
production build:

```bash
npm run build
npm run preview
# In another shell:
node scripts/surface-schedule.verify.mjs --mode=x11::0
node scripts/surface-chaos.verify.mjs --mode=x11::0
```

Each real-display form exits 0 only after all four engine/variant legs and its
construction-effect comparisons pass. `--mode=sw` is a software diagnostic: a
successful diagnostic deliberately exits 2 and is not release evidence.

The benchmark run is accepted only when the Gearworks eval row, the
condensation unproject row, both trap-geometry agreement rows and both
`scheduledSpongeOfFerns*` and `xaosFernSponge*` eval rows report `fail=0`;
`marchUnprojectSchedule` must also satisfy its completion/pass/hit-mix gate,
`computeFrameSchedule` must satisfy the production-frame gate above, and the
two corresponding chaos rows must satisfy the graph gates above. The section
verdict must be `pass`. The JSON artifact remains the evidence record; do not
infer real-driver timing from SwiftShader.

The 2026-08-31 real-Iris run passed the finite-tiling gate: all seven cores
compiled, bound exact-size params, dispatched, and agreed with their CPU
wrappers at all three probes. The adapter reported Intel gen-12lp and the full
Surface section verdict was `pass`.

Measured on real Iris (gen-12lp), both geometry rows passed with `fail=0`.
`escChainPair+trap-geometry` reported `maxAbs=7.34e-7`, 71 excluded and
113/700 samples where geometry won the min-union;
`esc4ChainWRot+trap-geometry` reported `maxAbs=5.81e-7`, 77 excluded and
125/700 geometry-winning samples. The activation count gates at 32 samples,
so a fixture that accidentally exercises only the classic escape term fails
even if its numerical comparator is green. The complete Surface section and
the existing 5,184-ray condensation unproject leg also passed with `fail=0`.

The 2026-08-25 real-Iris construction run passed the full section. The 3D/4D
schedule rows reported `maxAbs=3.44e-7` / `2.45e-7`, `fail=0`, with zero 4D
exclusions; the corresponding xaos rows reported `maxAbs=3.85e-7` in both
dimensions, `fail=0`, again with zero 4D exclusions. The schedule march
completed six passes with 985/5,184 CPU and GPU hits; the xaos march completed
seven with 966/5,184 on both sides. Neither truncated and both reported zero
failures. Their production frames completed at 20 passes, 7,023 hits and
29,841 misses for schedule, and 23 passes, 6,863 hits and 30,001 misses for
xaos, with zero exhausted/active rays in both.

The real production verifiers passed too. Schedule changed 38.659% of eligible
compute pixels and 37.561% of WebGL pixels. Xaos changed 43.211% / 42.661%,
with 97.856% overlap between engine effect masks; strong cross-engine
disagreement stayed at 3.577% for the control and 2.895% for xaos. Every leg
reported the real Intel/ANGLE backend, settled, drew foreground/background and
had zero exhausted rays.

## The known SwiftShader false failure

The default (no `--display`) run fails the ESCAPE agreement leg on
`escChainKaleido` — "21 verified chaotic flips (> 7)" — and it is spurious.
Measured on the same commit: SwiftShader failures=5, chaoticFlips=21,
maxAbsErr 1.333, bit-identical across a busy box and a quiet one (so it is
deterministic, not contention); real Iris `--display=:0` verdict PASS,
failures=0, chaoticFlips=1, maxAbsErr 3.4e-06 — a ~400,000x difference in
agreement, with `excluded` identical at 97/700 on both, so the ensemble
pre-filter is behaving and only the post-hoc flip count moves.

ESTABLISHED: the failure is ADAPTER-SPECIFIC and deterministic — a compiler
realisation difference in the forward orbit, amplified by ~8x/iteration
noise growth into a binary escape decision.

REFUTED BY MEASUREMENT: that the authored fold lengths' `10bc444` caused it.
That commit turned the sphere fold's numerator from a literal `1.0` into a
uniform load, which is the right CLASS of change and predicts exactly this
shape — but the leg at `10bc444^` returns chaoticFlips 21, bit-identical to
HEAD on every field, and `10bc444` is the ONLY functional change to
`surface-de-gpu.ts` in that span (the other two commits there are
comment-only). So the cause is EARLIER, and no part of the
authored-fold-lengths work is implicated.

AND THERE IS NO REGRESSION AT ALL: measured at `0570354` — the commit that
INTRODUCED `escChainKaleido`, the one that gave the chain its shader mirrors
(one uniform slot / `GpuMap` per link) — the row already fails with
chaoticFlips 21, bit-identical to HEAD on every field. It has never passed
on a software rasteriser. That work records verification in the app on both
engines but no SwiftShader `bench:surface` run, and the flips figure quoted
above was the escape compute port's on real Iris, so this fixture reached
this leg on a software adapter for the first time during the run that added
the opt-in ground-plane frame-agreement leg.

THE OPEN QUESTION IS THEREFORE CALIBRATION, NOT A BUG: the cap is one number
applied to every adapter, and a software rasteriser is a different
realisation of the same kernel. Either it becomes adapter-aware or the
escape rows are simply judged on `--display=:0`, which is already this
file's standing advice.

`esc4ChainKaleido` IS THE SAME FALSE FAILURE ONE DIMENSION UP (measured
2026-08-19, in the session that landed environment-lit shading, the shared
background-shape function and the radial backdrop shape). A SwiftShader run
fails BOTH kaleidoscope escape rows, not one, and this file previously
recorded only the 3D row's software figures — so a session reading it would
have found one documented failure and one apparently new. The 4D row's
SwiftShader reading is `fail=11 maxAbs=1.33e+0 maxRel=6.67e+0 p99Abs=1.33e+0
excluded=69 flips=35 over=10`, against the real-Iris verdict recorded below
of `maxAbs 6.33e-7 / excluded 69 / flips 2` — the identical shape as the 3D
row: `excluded` unmoved between adapters (so the ensemble pre-filter is
behaving), only the post-hoc flip count moving, and by the same six orders
of magnitude in `maxAbs`. Both rows are the wedge fold's forward orbit
realised differently by a software compiler; a fold kaleidoscope is simply
the fixture in this family whose orbit sits nearest a sector seam, in either
dimension.

MEASURED AS A CONTROL rather than assumed: the same two rows fail at
`ec3a611`, BIT-IDENTICALLY on every field — fail 5/11, maxAbs 1.33e+0 both,
p99 7.84e-4 and 1.33e+0, excluded 97/69, flips 21/35, over 4/10 — which is
how that session cleared its own `ShadeParams` growth (160 -> 208 bytes
across the environment-light, background-shape and radial-shape work) of
having caused either. Running the base commit in a throwaway worktree is the
cheap way to separate "my change" from "this adapter", and it is worth doing
whenever a surface kernel change lands on a machine with no `--display=:0`.

A BONUS RESULT worth keeping from the same runs: `excluded`, `maxAbsErr` and
`p99AbsErr` are bit-identical for this fixture across all of `0570354..HEAD`
— 104 lines of `escape-de.ts` and 66 of `surface-de-gpu.ts`, the authored
fold radii included — which is the authored fold lengths' "byte-identity at
the defaults is by CONSTRUCTION" verified empirically on the CPU and GPU
sides at once, rather than argued.

DO NOT raise the cap to make it green — 7 is calibrated for the driver this
leg gates, and the layered classifier exists precisely so a real
disagreement could not hide inside the chaotic-orbit excuse: it was built
for the escape compute port after real Iris flipped march-unproject rows a
SwiftShader-clean run had called stable. Judge the escape rows on
`--display=:0`.

## Cross-family rows (the chain's power links)

Four fixtures cover a power link in the chain's TAIL (`escChainBulb`,
`escChainQsquare` — a kernel reading the params block's frozen HEAD link for
every step fails here), in the MIDDLE of a 3-cycle between two folds of
different kinds (`escChainPowerMid` — the per-link guard, and the fold
links' radii lanes surviving past a link that reads none), and in the HEAD
(`escChainBulbPair`, two power links, rotated so a cycle is distinguishable
from one map re-applied). All four carry `logEstimate: true` and so pin
`escParams.w` at offset 268; the nine fold-only rows pin the 0 case.

ALL FOUR GATE CLEAN ON BOTH ADAPTERS, fail=0, and NO CAP MOVED — real Iris
maxAbs 2.98e-6 / 7.70e-6 / 2.51e-6 / 1.53e-5 at excluded 72 / 57 / 1 / 22 of
700 and flips 1 / 0 / 0 / 3, against caps of 140 and 7; SwiftShader's
`excluded` is identical (the classifier is CPU-only) and its flips are 0.

THE FEARED EXCLUSION BLOWOUT DID NOT HAPPEN, and the mechanism is worth
keeping: `8·r⁷` noise growth is real for the ORBIT and wrong about the
CLASSIFIER, because a power orbit escapes super-exponentially, membership is
decided in one or two steps, and the marginal population the ensemble
exists to bracket is SMALLER — three of the four cross-family rows sit
BELOW the fold controls (`escMandelbox` 58, `escChainPair` 71).

The pre-scales were CHOSEN off that: `excluded` is knowable on the CPU
without a GPU run, so the budget was measured first and the fixture picked
from it (`bulb(0.5)` rejected at 10/700 because its boundary shell collapses
to 16 queries — a nearly free row that tests nothing; `bulb(0.3)` legal at
96/700 but dearer). Reach for that method before guessing.

A `computeFrameEscapeXfam` arm was added beside the eval rows NOT as a
fallback but for the one thing they cannot reach: the HIT-INFO body's power
branch and its degree-selected escape count, which has no value-body
counterpart. It reads GPU 0.223 vs CPU 0.226 on Iris (0.223 vs 0.202 on
SwiftShader) — DENSER than its fold sibling `escMandelbox`'s 0.153/0.158,
one more datum against the stiffness prediction. CI is unaffected (it runs
`bench:gpu`, not this).

`estimateEscapeDistanceF32`'s mutation-testing story is recorded below,
under "Mutation-testing the f32 twins".

## The 4D escape rows (the escape chain's 4D lift)

M7 pins `core:"escape4"` against `escape-de-4d.ts` on six 4D fixtures,
gating on the UNCHANGED escape caps rather than escape4 twins of them — and
the exclusion census said that was measured rather than assumed (44-78 of
700, inside the 3D controls' own band).

MEASURED at the lift on real Iris `--display=:0`, verdict PASS, all six
fail=0: `esc4ChainWRot` maxAbs 5.81e-7 excluded 78, `esc4ChainParameterized`
6.96e-6 / 78, `esc4ChainQsquare` 9.83e-7 / 58 flips 1, `esc4ChainKaleido`
6.33e-7 / 69 flips 2, `esc4ChainSlice` 9.02e-7 / 44, `esc4ChainSliceRot`
1.18e-5 / 70 flips 2 — and every pre-existing 4D row (aff4Final/aff4Slab/
fold4*/lens4*) and the balloon/lens unproject legs still clean on the same
run.

`estimateEscapeDistance4F32`'s mutation-testing story, run before this lift
measurement, is recorded below under "Mutation-testing the f32 twins".

## The sphere-inversion rows (`core:"sphereInv"` / `"sphereInv4"`)

The eighth and ninth cores are pinned by two modules. `src/app/gpu-bench/sphere-inversion.ts`
holds the fixtures, query mixes, comparators and the f64 CPU march emulator, and is
unit-tested without a device. `sphere-inversion-legs.ts` holds the device legs,
called before the section verdict. `--surface-sphere-inversion-only=1` runs just
these legs after the canary arms. Its verdict is `fail` or `skipped`, never
`pass`, because a run that skips every other leg certifies nothing about the
section. The plan and fixture rationale are in `docs/sphere-inversion-gpu.md`.

What gates:

- **Compile matrix.** Both cores in eval, the app's unproject march with
  `statusOut`, and shade in four forms: plain, finish, ground plane + finish, and
  lighting rig.
- **Eval agreement**, twelve rows of 700 queries each (the twelfth appended
  2026-09-22):
  - The query mix is 300 points uniform in the row's query-space ball, 250
    deep-word points (a point just off a seed sphere, carried through a random
    reduced word of length up to six) and 150 points a CPU sphere tracer
    evaluated from the row's camera.
  - `surfaceEvalTol` at `fail = 0` on CLAMPED values `max(v, 0)`. A return
    `<= 0` is the CPU estimator's folded-coordinate member signal, not a
    distance, and its size legitimately differs in f32 at fold depth 6–7. The
    f32 twin already showed that on 8/700 cube8 shell queries before any device
    ran. Sign disagreements are disclosed as `signFlips`.
  - The ONE-SIDED gate `max(gpu − cpu64) <= 1e-6` over CPU-positive queries.
  - Per-row anti-vacuity floors on fold depth `k >= 3`, copy-term wins and
    gap-term wins, each at about half the measured census. A floor is 0 where
    the row measures none: pearls, kissing and the snowflake have no copy wins.
  - Hit-info attribution (generation and seed member), read through a probe
    entry appended to the shade kernel, on queries both sides call positive and
    agree on.
- **Flat reduction.** `siFlat4` runs the oct6 pearls embedded at `w = 0` through
  the 4D kernel on `siOct6Pearls3`'s queries, and must agree with the 3D kernel
  within `1e-6`.
- **March agreement.** A 96×54 unproject march, compared per ray against the CPU
  emulator, for `siOct6Kiss3` (exterior orbit camera) and `si600Vault4@XW.3W.1`
  (the 4D search sheet's interior vault camera). It needs `fail = 0`, no
  truncation, and both hit counts strictly between zero and the ray count.
  Exclusions (boundary flips and rounding-at-acceptance flips) are capped at 1%
  of the rays.
- **Production frames.** `SurfaceComputeRenderer` on `siOct6Pearls3` over the
  ground plane, and on the 600-cell medallion at `WKISS` then `XW.4YW.3ZW.2` on
  ONE renderer (the per-frame view4 repack). A real adapter must finish
  untruncated with hits, misses, no exhausted or active rays, and a hit rate
  within 0.15 of a strided CPU march.

MEASURED on 2026-09-15:

- Adapter: Intel Iris Xe. `glxinfo` reports Mesa Intel Iris Xe Graphics (TGL
  GT2); WebGPU reports `intel gen-12lp`, `software=false`.
- Quiet baseline `quiet=YES` on all four sphere-inversion-only runs.
- The agreement, march and frame rows were identical across the four runs.
- Every gate passed on the first device compile. No kernel or packer change was
  needed.

| Row                            | Core | maxAbs  | f32 overshoot before the slack (queries) | signFlips | k≥3 / copy / gap (floors)        | attribution mismatches |
| ------------------------------ | ---- | ------- | ---------------------------------------- | --------: | -------------------------------- | ---------------------- |
| `siOct6Pearls3`                | 3D   | 1.15e-6 | 9.59e-8 (558)                            |        19 | 177 / 0 / 429 (88 / 0 / 214)     | 0 of 558               |
| `siOct6Kiss3`                  | 3D   | 1.23e-6 | 2.00e-7 (547)                            |        24 | 188 / 0 / 425 (94 / 0 / 212)     | 0 of 547               |
| `siCube8Shell3`                | 3D   | 1.68e-6 | 1.79e-7 (611)                            |        26 | 192 / 244 / 39 (96 / 122 / 19)   | 0 of 611               |
| `siIco12Vault3`                | 3D   | 1.38e-6 | 4.82e-7 (663)                            |         3 | 214 / 274 / 178 (107 / 137 / 89) | 0 of 663               |
| `siFlat4`                      | 4D   | 1.15e-6 | 9.59e-8 (558)                            |        19 | 177 / 0 / 429 (88 / 0 / 214)     | 0 of 558               |
| `siCell24Shell4` xw .3 w0 .15  | 4D   | 1.62e-6 | 1.40e-7 (677)                            |         0 | 22 / 198 / 225 (11 / 99 / 112)   | 0 of 677               |
| `si600Vault4@W.08`             | 4D   | 1.20e-6 | 1.51e-7 (674)                            |         0 | 41 / 191 / 267 (20 / 95 / 133)   | 0 of 674               |
| `si600Vault4@XW.3W.1`          | 4D   | 1.48e-6 | 5.35e-7 (644)                            |         0 | 28 / 196 / 275 (14 / 98 / 137)   | 0 of 644               |
| `si600Medallion4@WKISS`        | 4D   | 1.10e-6 | 1.25e-7 (675)                            |         0 | 41 / 122 / 324 (20 / 61 / 162)   | 0 of 675               |
| `si600Medallion4@XW.4YW.3ZW.2` | 4D   | 1.13e-6 | 2.14e-7 (681)                            |         0 | 24 / 132 / 371 (12 / 66 / 185)   | 0 of 681               |
| `si600Snowflake4@W.06`         | 4D   | 1.09e-6 | 5.87e-8 (694)                            |         0 | 50 / 0 / 662 (25 / 0 / 331)      | 0 of 694               |

**Appended 2026-09-22: `siIcosidodec30Star3`**, the Icosidodecahedral Star
preset's construction (icosidodec30, rf .99, ball .64, D8): 30 generators,
past both the old 12-generator 3D cap and the WebGL fragment arm's 29. The
first 3D row at a generator count no earlier row reached, so it is the one
that exercises the kernel's per-eval `gd` scratch and the unit-arrangement
search at 30. Measured on the AMD box (RX 7900 XTX, `:0`, radeonsi, WebGPU
`amd rdna-3`, `software=false`), `quiet=YES`,
`--surface-sphere-inversion-only=1`, build on the preset branch:

| Row                   | Core | maxAbs  | f32 overshoot before the slack (queries) | signFlips | k≥3 / copy / gap (floors)    | attribution mismatches |
| --------------------- | ---- | ------- | ---------------------------------------- | --------: | ---------------------------- | ---------------------- |
| `siIcosidodec30Star3` | 3D   | 1.08e-6 | 5.90e-8 (463)                            |        79 | 172 / 1 / 337 (86 / 0 / 168) | 0 of 463               |

`fail = 0`, no one-sided failures, 0 generation or seed mismatches. Its 79
sign flips are three times any earlier row's (26 at most). They are disclosed
and never gate: a flip is a sign disagreement on a query at or below zero,
the folded-coordinate member signal, not a distance. This row has the fewest queries both sides call positive (463, against
547–694; 542 are CPU-positive), so more of its 700 queries sit at the member
boundary, where f32 and f64 can split on the sign.
The copy floor is 0, the ball rows' convention, where the row measures a
single copy win. Eval costs 0.037 µs/query against the 6-generator pearls'
0.036 in the same run, so 30 generators do not cost more per query here. The
generator-count cost sweep is a separate measurement and not this row's.
The other eleven rows reran on the same device with `fail = 0`, 0 one-sided
failures and 0 attribution mismatches.

All rows have `fail = 0` and no one-sided failures. On every CPU-positive query
`gpu − cpu64 <= 0`, so the plan's stricter form of the gate holds as well as
the gated `<= slack` form. The largest errors are the slack itself plus f32
noise, because the kernel subtracts `1e-6` from every positive bound.

READ THE OVERSHOOT COLUMN, NOT A MARGIN. The kernel returns `max(0, v − slack)`,
so a query whose CPU value is below `1e-6` reads `gpu − cpu = −cpu`. That pins
`slack − max(gpu − cpu64)` near the slack no matter what the f32 error is, so
that margin says nothing. The overshoot column is `max(gpu + slack − cpu64)`
over queries both sides call positive, which is what the slack actually absorbs.
It peaks at `5.35e-7` on the 600-cell vault at the rotated pose, which also
carries the f32 view lift. That is above the CPU emulation's `3.3e-7`, as the
plan expected a real driver might be, and still 1.9× under the slack.

The flat reduction agreed to `maxDelta = 0` on all 700 queries.

March rows:

- `siOct6Kiss3`: 189/189 GPU/CPU hits of 5,184 rays, `maxAbsT` 6.49e-3.
- `si600Vault4@XW.3W.1`: 4,466/4,466 hits, `maxAbsT` 1.89e-3.
- Both had zero status mismatches, zero exclusions and zero exhausted rays, and
  both `maxAbsT` values sit inside the per-ray `t` tolerance.

Production frames at 256×144, with no exhausted or active rays anywhere, 21–25
passes and 186–280 ms of GPU time each:

| Frame                       |  Hits | Misses |  Plane | Hit rate GPU / CPU |
| --------------------------- | ----: | -----: | -----: | ------------------ |
| Pearls over the floor       | 1,268 | 12,330 | 23,266 | 0.034 / 0.038      |
| Medallion at `WKISS`        | 7,285 | 29,579 |      0 | 0.198 / 0.201      |
| Medallion at `XW.4YW.3ZW.2` | 7,487 | 29,377 |      0 | 0.203 / 0.205      |

Shader compiles on a cold driver cache took 874–1,609 ms for the 3D shade
variants and 986–1,824 ms for 4D, against 51–75 ms for eval and march. With a
warm cache they took 9–23 ms.

Timing is informational and never gates. It measures µs per query over WHOLE
TILES of each row's 700-query mix, in submissions sized from a pilot spread
across the mix. Whole tiles matter because the mix is ordered by class, so a
batch cut from its front measures one class. An earlier sizing read the fold
subject at 3,022 µs on a jittered-only 256-query batch, and its fast rows were
dominated by submission overhead. The existing cores run on the same harness
with their own 700-query mixes. Measured in the third and fourth certified runs:

| Subject                        | Core            | µs/query, run 3 / 4 | Submission |
| ------------------------------ | --------------- | ------------------: | ---------: |
| `siOct6Pearls3`                | `sphereInv`     |       0.042 / 0.052 |    262,144 |
| `siOct6Kiss3`                  | `sphereInv`     |       0.046 / 0.044 |    262,144 |
| `si600Vault4@XW.3W.1`          | `sphereInv4`    |       0.204 / 0.230 |   ≥111,360 |
| `si600Medallion4@XW.4YW.3ZW.2` | `sphereInv4`    |       0.282 / 0.283 |    262,144 |
| `si600Snowflake4@W.06`         | `sphereInv4`    |       0.296 / 0.317 |    262,144 |
| `esc4ChainWRot`                | `escape4`       |       0.052 / 0.045 |    262,144 |
| `mandelboxKifs`                | `fold` width 12 |     10,309 / 10,261 |         64 |

These are throughput figures (wall time over a parallel dispatch), not the
per-ray figures the other timing rows report, and each subject runs its own
query mix. Readings:

- The 3D family costs about what the 4D escape chain does per query.
- The 600-cell's 120 generators cost 4–7.5× the 3D rows, the snowflake the most.
  That is the ordering the CPU plan predicted.
- On its own on-attractor-heavy mix, the production-width fold frontier costs
  35,000–50,000× the 600-cell rows.
- The 96×54 march rows spent 21–74 ms of GPU time across the four runs
  (4.0–14.3 µs per ray, including host-loop overhead at that tiny raster), so
  no row is near a budget.

**The full section on this machine.** Two full `--display=:0` runs on the same
certified-quiet Iris ended `device-unreliable`. Both lost the device at the
untouched `compute frame swirl lens4SwirlPostOverFold` leg, before the
sphere-inversion legs run. `docs/surface-slice-thickness.md` records the same
loss for every full run on this machine, including an unmodified baseline. No
gating row failed before the loss in either run; the only nonzero `fail=` counts
were the non-gating w4 `info` rows. The sphere-inversion rows above therefore
come from the sphere-inversion-only runs, which share the section's device
acquisition and canary. A full-section `pass` with these legs is still owed, on
a machine where that swirl leg survives.

**The AMD box (2026-09-22): the owed full-section pass.** On an RX 7900 XTX
(`:0`, radeonsi, WebGPU `amd rdna-3`, `software=false`, `quiet=YES`) a full
`npm run bench:surface -- --display=:0` ended **`surfaceDe: verdict=pass`**
with the sphere-inversion legs included (`sphere-inversion: failed=false`):
this card holds the device through the swirl leg the Iris loses it at, and
`escChainKaleido` agrees there (`fail=0`).

The same box's timing leg, widened for the generator-count cost record
(`docs/sphere-inversion-family.md`, "Cost against generator count"): three
more 3D rows and the 24-generator 4D row, and every row timed a second time
with `uniformUnit` cleared (the linear first-containing scan, on the same
tables and queries), `--surface-sphere-inversion-only=1`:

| Subject                        |   n | Core         | µs/query, unit arm | µs/query, linear arm |
| ------------------------------ | --: | ------------ | -----------------: | -------------------: |
| `siOct6Pearls3`                |   6 | `sphereInv`  |              0.031 |                0.027 |
| `siOct6Kiss3`                  |   6 | `sphereInv`  |              0.025 |                0.026 |
| `siCube8Shell3`                |   8 | `sphereInv`  |              0.032 |                0.024 |
| `siIco12Vault3`                |  12 | `sphereInv`  |              0.024 |                0.023 |
| `siIcosidodec30Star3`          |  30 | `sphereInv`  |              0.026 |                0.029 |
| `siCell24Shell4`               |  24 | `sphereInv4` |              0.024 |                0.023 |
| `si600Vault4@XW.3W.1`          | 120 | `sphereInv4` |              0.045 |                0.048 |
| `si600Medallion4@XW.4YW.3ZW.2` | 120 | `sphereInv4` |              0.058 |                0.057 |
| `si600Snowflake4@W.06`         | 120 | `sphereInv4` |              0.056 |                0.061 |

Per query the family is FLAT across 3D (6 to 30 generators) on this card,
and the 600-cell costs about 2× a 3D row (4–7.5× on the Iris). The linear arm
lands inside the timing's ~15% run-to-run spread on every row, so on this
card the unit arrangement's early exit does not show in throughput. The
`linear` rows are informational like every timing row and never gate.

## The sphere-inversion glass transport rows (`opticsBackend: "sphereInversion"`)

The curved-glass backend's agreement legs ride the transport agreement runner
beside the closed-solid ones, and `--surface-sphere-inversion-only=1` runs them
after the family's own legs, so iterating on the family's optics does not need
the whole section. Four legs, both dimensions:

- **Ball (3D oct6, 4D cross8), the ANALYTIC control.** The depth-0 construction
  whose orbit IS the seed ball: generators at distance 1 with radius 0.7 reach
  in to 0.3, and the seed is 0.28. The shadow probe straight up through the
  origin must pay `(1 − F0)²·Beer` over the 0.56 chord, independent of the
  kernel and the twin.
- **Orbit (3D oct6 ball .28, 4D cross8 ball .42; radius fraction 0.99, depth
  3).** The look gate's near-kissing subject. The canonical grid finds one
  primary hit on this sparse set, so three NAMED extra probes carry the
  family's geometry:
  - the POLE, a ray down a generator's axis onto its centre;
  - the near-CUSP between two generators, which the unanchored arm marches
    back through;
  - a seed-tangent WINDOW ray, a graze along the seed's silhouette in 3D.

What each leg pins, beyond the closed-solid arms it shares (the anchored inside
traversal, the reversed outside query, the replay trace, the straight shadow
visibility and the terminal displacement):

- **The chain-replay arm.** The twin's OWN boundary-query chain while it traces
  each probe, up to the leg's whole path budget, replayed on the GPU query by
  query. A trace chains dozens of queries, so a trace mismatch names nothing;
  the first disagreeing chain query names the divergence. Every probe's
  boundaries are compared BEFORE its trace, for every backend, so the narrowest
  failure is the one reported.
- **The membership invariant.** Every boundary the GPU reports must have exact
  f64 membership flip across its own landing (`t + 2·eps`). This catches a
  kernel that dropped the gate even where the twin happened to agree with it.
- **Normals as a function.** A sphere-inversion boundary's GPU normal is
  compared with the twin's taps AT THE GPU'S OWN LANDING. Near a seam of this
  union-of-pieces field the normal turns about 4e-3 per 1e-4 of t, so a landing
  inside the t tolerance still taps a visibly different normal. The landing is
  pinned separately by the t check.
- **Misses by position.** A sphere-inversion miss's t is wherever the march
  first stood past the domain edge. The field reads ~1 there, so an f32 sample a
  hair short takes one more ~1-wide stride the f64 one did not (measured 2.87
  vs 1.88, both misses). The pin is that both engines' miss is at or past the
  domain exit.
- **The field arm (mode 4).** The GPU's signed field and membership bit at 600
  sampled members plus 1,200 points bisected toward the boundary, against f64.
  Hard gates: membership agrees outside a 4-slack band, and the GPU never
  claims more interior clearance than f64. Disclosed: the worst PRE-SLACK
  interior excess.

MEASURED on 2026-09-23 on the RX 7900 XTX (`:0`, radeonsi navi31, WebGPU
`amd rdna-3`, `software=false`), `quiet=YES`, `--surface-sphere-inversion-only=1`.
All four legs agree, and the family's own legs reran green:

| Leg                          | Queries | Max radiance Δ | Max residual Δ | Max normal Δ | Max shadow Δ | Pre-slack interior excess (interior samples) |
| ---------------------------- | ------: | -------------- | -------------- | ------------ | ------------ | -------------------------------------------- |
| `sphereInversionGlassBall3`  |      13 | 2.6e-9         | 4.1e-12        | 2.0e-4       | 2.1e-8       | 3.85e-8 (1196)                               |
| `sphereInversionGlassBall4`  |      13 | 2.6e-9         | 4.1e-12        | 2.0e-4       | 2.1e-8       | 3.85e-8 (1196)                               |
| `sphereInversionGlassOrbit3` |     295 | 7.5e-5         | 3.2e-4         | 4.6e-4       | 4.3e-6       | 5.53e-8 (1172)                               |
| `sphereInversionGlassOrbit4` |      78 | 1.9e-6         | 1.0e-6         | 2.6e-4       | 6.5e-6       | 1.03e-7 (1124)                               |

The real-driver interior excess peaks at 1.03e-7, about 10× under the 1e-6
slack. That is the figure the f32 argument owed; the CPU emulation's was
1.39e-7 on a different fixture set.

WHAT THE LEGS FOUND, both fixed in the kernel AND the twin before these rows
(the record is `docs/sphere-inversion-family.md`'s agreement section):

1. The kernel's primary split tapped the UNSIGNED estimator for its normal.
2. The query could step past a real exit near a cusp, which is what the look
   gate's inside-miss mass was.

### The glass continuation leg (the resumable trace)

A glass trace here can outrun the watchdog from a single workgroup, so the
transport pauses every `SPHERE_INVERSION_TRANSPORT_CHUNK_PATHS` processed paths
and resumes the same trace next submission (`docs/sphere-inversion-family.md`,
"The resumable trace lifts the generator cap"). A pause changes the SCHEDULE,
never the arithmetic, so the family legs' fifth leg renders one small glass
frame per row through the production `SurfaceComputeRenderer` at several
quanta and requires pixels AND the transport census to match the row's first
quantum byte for byte. Each chunked arm must actually pause. Each row also
runs an `adaptive` arm, the production schedule with no quantum pinned: the
host's refill pool and its quantum ladder (`docs/surface-compute-renderer.md`).
The adaptive schedule is pinned byte-identical too.

The 600-cell row cannot have an uninterrupted control: at quantum 0 its 16×9
glass frame lost the device (`VK_ERROR_DEVICE_LOST`) on this card, which is
the defect itself. Its reference is quantum 1, the finest schedule.

MEASURED on 2026-09-23 on the RX 7900 XTX (`:0`, WebGPU `amd rdna-3`,
`software=false`), `quiet=YES`, `--surface-sphere-inversion-only=1`, verdict
`skipped` (that mode's pass):

| Row                     | Raster | Quanta (first is the reference) | Resolved / unresolved | Resumes at the finest | All identical |
| ----------------------- | ------ | ------------------------------- | --------------------- | --------------------- | ------------- |
| `siOct6Pearls3`         | 32×18  | 0, 1, 32                        | 19 / 2                | 12,288                | yes           |
| `siCell24Shell4`        | 32×18  | 0, 1, 32                        | 54 / 10               | 3,763                 | yes           |
| `si600Medallion4@WKISS` | 16×9   | 1, 8, 32                        | 16 / 10               | 5,920                 | yes           |

RERUN after the failure-is-final replay rule, the refill pool and the
quantum ladder, same card, `quiet=YES`. The resumes fell because a failed
trace is no longer re-traced at later passes (12,288 was six passes of the
same 2,048-path failure). The adaptive arm pauses 13 times where quantum 32
pauses 64 on the pearls row. It stays at the base on the 600-cell, whose
heavy full-width chunk caps it there:

| Row                     | Quanta (first is the reference) | Resolved / unresolved | Resumes: finest / 32 / adaptive | All identical |
| ----------------------- | ------------------------------- | --------------------- | ------------------------------- | ------------- |
| `siOct6Pearls3`         | 0, 1, 32, adaptive              | 19 / 2                | 2,048 / 64 / 13                 | yes           |
| `siCell24Shell4`        | 0, 1, 32, adaptive              | 54 / 10               | 749 / 23 / 18                   | yes           |
| `si600Medallion4@WKISS` | 1, 8, 32, adaptive              | 16 / 10               | 633 / 19 / 19                   | yes           |

### The glass envelope (opt-in, measured not gated)

`--surface-sphere-inversion-only=1 --surface-si-glass-envelope=1` adds the
renderer-envelope leg's curved-glass arms: the `glassPearls`/`glassPearls4`
starters as the menu loads them (Glass block, saved view, room, studio), at the
envelope's 256×144 1-spp preview (the app's 2 s budget), its 512×288 4-spp
settle, a mid-flight cancel and computed retained state. They are followed by
a depth-versus-cost curve (depths 1–8, 256×144 1-spp, unbudgeted). It rides
the heavy-leg wait cap. Each row's missed lines are printed as `MISS` and do
NOT fail the run, because this record measures the envelope rather than gating
it. A leg that throws does fail it. The preview line here is the curved-glass
epic's 1 s, not the finite direction's 1.5 s. Measured rows and the verdict:
`docs/sphere-inversion-family.md`, "The glass envelope", and the rows since
the transport's schedule changed, "The transport's cost".
`--surface-si-exact-normal=1` builds the envelope's renderers with the
exact Möbius normal arm (`?surfacesinormal=exact`'s pin). It is the cost
half of a look A/B, not the shipped normal. That record is "Two more
levers, both refuted" in the same doc. `--surface-si-joint-off=1` keeps one
transport pool per supersample (`?surfacesijoint=0`'s pin), the joint pool's
schedule A/B: no pixel moves, so the two arms' settle PNGs diff to zero. The
retained-state row counts the joint arenas wherever the renderer takes them.
Record: "The joint pool closes the 3D settle" in the same doc.

## Mutation-testing the f32 twins

A stale f32 twin does not disagree with its f64 CPU oracle — it makes the
agreement ensemble exclude everything. Two twins were checked this way.

`estimateEscapeDistanceF32` (the cross-family power-link leg's twin) had to
learn the two power kinds and the estimate form along with the f64 oracle. A
stale twin here makes the ensemble exclude everything (the authored fold
lengths measured 251/700 that way) — and the fold-only rows stay
bit-identical by construction and were confirmed so, `escChainKaleido`
included, at excluded 97 / flips 21 / maxAbs 1.333 to the digit.

`estimateEscapeDistance4F32` (the 4D escape chain's twin) was
MUTATION-TESTED before the lift measurement above, on the same premise: each
mutation moves exactly the row written for it —

- classic radii: 78 -> 301
- dropping `-w^2` from the quaternion square: 58 -> 203
- forcing the linear form: 58 -> 538
- the descents' COLLAPSED plane code: 69 -> 220
- dropping the rotor: 58 -> 276
- dropping w0: 44 -> 511
- adding w0 AFTER the rotor instead of inside it: 70 -> 559 — caught by
  `esc4ChainSliceRot` ALONE, which is why that sixth row is not redundant

— while folding only x/y/z in the box fold moves ALL SIX rows 321-407, i.e.
every fixture is genuinely 4D by measurement rather than by having a `w`
field.
