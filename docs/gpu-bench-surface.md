# GPU Bench: Surface (`npm run bench:surface`)

This is the full measurement record behind `npm run bench:surface`. CLAUDE.md's
Commands section points here rather than carrying these numbers inline.

## What the bench pins

`npm run bench:surface` is the WebGPU fold-DE kernel agreement/timing bench.
It pins `surface-de-gpu.ts` — both the eval/march baselines and the app
path's march-unproject/shade — to the CPU estimator.

The condensation addition appends two Gearworks gates without changing any
existing fixture or timing baseline. `gearworksCondensation` runs the normal
700-query affine agreement comparator against a dedicated WGSL program with
the gear SDF generated into it. `marchUnprojectCondensation` then uses the
same bounded 96x54 app-ray march and per-ray CPU emulator as the established
fold/lens/balloon legs. Either compilation failure, truncation or unexcluded
agreement failure fails the section.

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

For the condensation landing, run the static gates before adapter evidence:

```bash
npx vitest run src/app/gpu-bench/condensation.test.ts \
  src/fractal/condensation-de.test.ts src/fractal/surface-de-gpu.test.ts \
  src/app/surface-compute.test.ts src/app/surface-eligibility.test.ts \
  src/app/surface-material.test.ts src/app/surface-material-4d.test.ts \
  src/fractal/surface-grid.test.ts src/fractal/balloon-de.test.ts
npx tsc --noEmit
npm run bench:surface -- --display=:0
```

The benchmark run is accepted only when the Gearworks eval row reports
`fail=0`, the condensation unproject row completes with `fail=0`, and the
section verdict is `pass`. The JSON artifact remains the evidence record;
do not infer real-driver timing from SwiftShader.

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
