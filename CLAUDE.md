# CLAUDE.md

**Fractal Explorer** — an interactive 3D/4D IFS (Iterated Function System) fractal
explorer. A set of affine transforms is rendered with the "chaos game" into a live
Three.js point cloud. Built with TypeScript + Vite, packaged as a PWA, deployed to
GitHub Pages. Reference docs in `docs/`.

## Dimensional Parity — the 4D half is not a follow-up

**The site is fractal-4d.com. A capability that exists only in 3D is not
finished, and a session that leaves it that way is not done.**

The standing failure mode is shipping the 3D half, filing a "4D lift" bead and
closing the epic. fr-rhn5's ground plane (lift: fr-h0c3) and fr-5wlv's balloon
(lift: fr-qxxw) both did exactly that; the escape-time CHAIN was worse than
either — `analyzeEscapeSystem` refused every non-flat map outright (`map N
extends into 4D`), no 4D oracle, kernel core or GLSL arm stood behind that
refusal, and until fr-vag4 nothing tracked the lift at all, in the family whose
own `qjulia-de.ts` describes its object as "the one the site is named after: a
genuinely 4D set, of which a 3D render is a SLICE".

ALL THREE ARE CLOSED as of the fr-vag4/fr-h0c3/fr-qxxw session, and what that
session measured is the argument for the rule rather than an anecdote beside
it. The three lifts cost ONE structural decision between them — where the 4D
params tail's appended blocks land — and once that was made (576, the 3D
cores' frozen 288 one dimension up), the ground plane needed NO new shader text
at all (the march classifier and shade entry were already shared across cores),
the balloon needed NO new wrapper text (every core shares
`surfaceDE(pIn: vec3f, …)` over a MARCHED point, so wrapping a 4D core inverts
in the sliced space for free), and the escape chain's oracle duplicated only
the five maps' arithmetic while IMPORTING every constant and link code from its
3D twin. The expensive part was none of the algebra; it was that fr-h0c3's own
bead had to warn a future session away from offset 560, where a block appended
without reading fr-s9ll's lens4Fold quartet would have landed INSIDE it. So:

- **Both halves are scoped up front.** Work touching a twinned pair —
  `affine`/`affine4`, `chaos-game`/`chaos-game-4d`, `flame`/`flame-4d`,
  `flame-gpu`/`flame-gpu-4d`, `voxel`/`voxel-4d`, `variations`/`variations4`,
  `surface-de`/`surface-de-4d`, `surface-material`/`surface-material-4d`, or
  the WGSL `affine`/`fold` cores against `affine4`/`fold4` — carries the 4D
  twin in its own plan, its own estimate and its own PR. Say it in the plan,
  not in the retro.
- **3D-only is a decision that owes evidence, never a default.** It ships only
  with the reason written in the module doc AND a bead carrying the lift's
  ACTUAL shape (which params offset, which kernel core, which oracle) — the
  shape fr-h0c3 and fr-qxxw both had, and the reason both were cheap to close
  when someone finally did. "3D first, 4D later" is not a reason.
  `surface-grid.ts` is the model REFUSAL (a live rotor/slice invalidates a grid
  per frame — stated, not implied), `bulb-de.ts` its sibling one family over
  (triplex numbers are R³ with a spherical-coordinate product and no fourth
  component to give meaning to, so `variations4.ts`'s `bulb` carries `w` through
  untouched — honest for the chaos game, useless to an estimator), and
  fr-7u8t.6 the model WON'T-DO (closed on twenty measured panels, not on a hunch
  about cost).
- **The lift costs more later, and the cost is structural.** The 3D half
  freezes wire layout the 4D half must then append past — fr-h0c3 records a
  plane block appended at 4D offset 560 landing INSIDE lens4 and corrupting it
  — and a lift written months later re-derives shared algebra instead of
  importing it, which is how two renderers start drawing different objects from
  one document. `variations4.ts` importing `resolveFoldRadii` rather than
  restating it is the standing counter-example, and `escape-de-4d.ts`
  importing every constant, link code and estimate form from `escape-de.ts` is
  the second: what a chain IS has one definition across both dimensions, and
  only the maps' arithmetic is duplicated under the twin-file convention.
  fr-v7ca's Möbius-ball note is the same hazard still open — fr-qxxw did NOT
  need it (slice-then-invert keeps the inversion 3D and the slab rides both
  terms untouched), so the helper the two beads agreed to share is still
  unwritten and still owed to whichever slab port lands first.
- **An unlifted gap is disclosed, not quietly filed.** A session that ends
  3D-only says so in the PR description and in its closing summary, as
  unfinished work. The bead is the tracking; it is not the disclosure.

## Commands

```bash
npm test              # Lint + tests (runs npm run lint, then vitest run)
npm run test:watch    # Tests in watch mode
npm run test:coverage # Tests with coverage report
npm run lint          # Type-check + ESLint + Stylelint + Prettier check
npm run lint:fix      # Auto-fix ESLint + Stylelint + Prettier issues
npm run lint:eslint   # ESLint only (no type-check)
npm run lint:stylelint # Stylelint only (CSS)
npm run format        # Prettier check only
npm run format:fix    # Prettier auto-fix only
npm run dev           # Start Vite dev server (HTTPS, binds 0.0.0.0 for phones)
npm run build         # Production build → dist/app/
npm run preview       # Preview the production build locally
npm run smoke         # Headless WebGL smoke test (SwiftShader) — boots the app, asserts it renders
npm run bench:gpu     # Headless WebGPU flame agreement/bench (real Chrome) — pins the WGSL kernels to their CPU oracles; run after touching flame-gpu*.ts kernels (CI runs it on SwiftShader)
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (eval/march baselines + fr-tzdg's march-unproject/shade app path) to the CPU estimator; add --display=:0 for real-driver timing; run it on a QUIET machine, never concurrently with the test suite or other heavy CPU load — a contended software device corrupts mid-run readbacks, which the fr-76pp canary reports as verdict=device-unreliable (exit 2, rerun) instead of plausible numeric fails. KNOWN SWIFTSHADER FALSE FAILURE (fr-jtd4): the default (no `--display`) run fails the ESCAPE agreement leg on `escChainKaleido` — "21 verified chaotic flips (> 7)" — and it is spurious. Measured on the same commit: SwiftShader failures=5, chaoticFlips=21, maxAbsErr 1.333, bit-identical across a busy box and a quiet one (so it is deterministic, not contention); real Iris `--display=:0` verdict PASS, failures=0, chaoticFlips=1, maxAbsErr 3.4e-06 — a ~400,000x difference in agreement, with `excluded` identical at 97/700 on both, so the ensemble pre-filter is behaving and only the post-hoc flip count moves. ESTABLISHED: the failure is ADAPTER-SPECIFIC and deterministic — a compiler realisation difference in the forward orbit, amplified by ~8x/iteration noise growth into a binary escape decision. REFUTED BY MEASUREMENT: that fr-s9ll's 10bc444 caused it. That commit turned the sphere fold's numerator from a literal `1.0` into a uniform load, which is the right CLASS of change and predicts exactly this shape — but the leg at `10bc444^` returns chaoticFlips 21, bit-identical to HEAD on every field, and 10bc444 is the ONLY functional change to `surface-de-gpu.ts` in that span (the other two commits there are comment-only). So the cause is EARLIER, and no part of fr-s9ll is implicated. AND THERE IS NO REGRESSION AT ALL: measured at 0570354 (fr-s04t), the commit that INTRODUCED `escChainKaleido`, the row already fails with chaoticFlips 21 — bit-identical to HEAD on every field. It has never passed on a software rasteriser. fr-s04t records verification in the app on both engines but no SwiftShader `bench:surface` run, and the flips figure in the paragraph below was fr-dlxh's on real Iris, so this fixture reached this leg on a software adapter for the first time in fr-qjae's run. THE OPEN QUESTION IS THEREFORE CALIBRATION, NOT A BUG: the cap is one number applied to every adapter, and a software rasteriser is a different realisation of the same kernel. Either it becomes adapter-aware or the escape rows are simply judged on `--display=:0`, which is already this file's standing advice. A BONUS RESULT worth keeping from the same runs: `excluded`, `maxAbsErr` and `p99AbsErr` are bit-identical for this fixture across all of `0570354..HEAD` — 104 lines of `escape-de.ts` and 66 of `surface-de-gpu.ts`, fr-s9ll's authored fold radii included — which is fr-s9ll's "byte-identity at the defaults is by CONSTRUCTION" verified empirically on the CPU and GPU sides at once, rather than argued. DO NOT raise the cap to make it green — 7 is calibrated for the driver this leg gates, and fr-7tl3/fr-dlxh built the layered classifier precisely so a real disagreement could not hide inside the chaotic-orbit excuse. Judge the escape rows on `--display=:0`. CROSS-FAMILY ROWS (fr-j231): four fixtures cover a power link in the chain's TAIL (`escChainBulb`, `escChainQsquare` — a kernel reading the params block's frozen HEAD link for every step fails here), in the MIDDLE of a 3-cycle between two folds of different kinds (`escChainPowerMid` — the per-link guard, and the fold links' radii lanes surviving past a link that reads none), and in the HEAD (`escChainBulbPair`, two power links, rotated so a cycle is distinguishable from one map re-applied). All four carry `logEstimate: true` and so pin `escParams.w` at offset 268; the nine fold-only rows pin the 0 case. ALL FOUR GATE CLEAN ON BOTH ADAPTERS, fail=0, and NO CAP MOVED — real Iris maxAbs 2.98e-6 / 7.70e-6 / 2.51e-6 / 1.53e-5 at excluded 72 / 57 / 1 / 22 of 700 and flips 1 / 0 / 0 / 3, against caps of 140 and 7; SwiftShader's `excluded` is identical (the classifier is CPU-only) and its flips are 0. THE FEARED EXCLUSION BLOWOUT DID NOT HAPPEN, and the mechanism is worth keeping: `8·r⁷` noise growth is real for the ORBIT and wrong about the CLASSIFIER, because a power orbit escapes super-exponentially, membership is decided in one or two steps, and the marginal population the ensemble exists to bracket is SMALLER — three of the four cross-family rows sit BELOW the fold controls (`escMandelbox` 58, `escChainPair` 71). The pre-scales were CHOSEN off that: `excluded` is knowable on the CPU without a GPU run, so the budget was measured first and the fixture picked from it (`bulb(0.5)` rejected at 10/700 because its boundary shell collapses to 16 queries — a nearly free row that tests nothing; `bulb(0.3)` legal at 96/700 but dearer). Reach for that method before guessing. `estimateEscapeDistanceF32`, the leg's f32 twin, had to learn the two power kinds and the estimate form with them — a STALE twin does not disagree, it makes the ensemble exclude everything (fr-s9ll measured 251/700 that way) — and the fold-only rows stay bit-identical by construction and were confirmed so, `escChainKaleido` included at excluded 97 / flips 21 / maxAbs 1.333 to the digit. A `computeFrameEscapeXfam` arm was added beside the eval rows NOT as a fallback but for the one thing they cannot reach: the HIT-INFO body's power branch and its degree-selected escape count, which has no value-body counterpart. It reads GPU 0.223 vs CPU 0.226 on Iris (0.223 vs 0.202 on SwiftShader) — DENSER than its fold sibling `escMandelbox`'s 0.153/0.158, one more datum against the stiffness prediction. CI is unaffected (it runs `bench:gpu`, not this). THE 4D ESCAPE ROWS (fr-vag4): M7 pins `core:"escape4"` against `escape-de-4d.ts` on six 4D fixtures, gating on the UNCHANGED escape caps rather than escape4 twins of them — and the exclusion census said that was measured rather than assumed (44-78 of 700, inside the 3D controls' own band). MEASURED at the lift on real Iris `--display=:0`, verdict PASS, all six fail=0: `esc4ChainWRot` maxAbs 5.81e-7 excluded 78, `esc4ChainParameterized` 6.96e-6 / 78, `esc4ChainQsquare` 9.83e-7 / 58 flips 1, `esc4ChainKaleido` 6.33e-7 / 69 flips 2, `esc4ChainSlice` 9.02e-7 / 44, `esc4ChainSliceRot` 1.18e-5 / 70 flips 2 — and every pre-existing 4D row (aff4Final/aff4Slab/fold4*/lens4*) and the balloon/lens unproject legs still clean on the same run. Its f32 twin `estimateEscapeDistance4F32` was MUTATION-TESTED before that run because a stale twin does not disagree, it excludes everything: each mutation moves exactly the row written for it (classic radii 78->301, dropping `-w^2` from the quaternion square 58->203, forcing the linear form 58->538, the descents' COLLAPSED plane code 69->220, dropping the rotor 58->276, dropping w0 44->511, and adding w0 AFTER the rotor instead of inside it 70->559 — caught by `esc4ChainSliceRot` ALONE, which is why that sixth row is not redundant), while folding only x/y/z in the box fold moves ALL SIX rows 321-407, i.e. every fixture is genuinely 4D by measurement rather than by having a `w` field
```

Run a single test file: `npx vitest run src/fractal/chaos-game.test.ts`

The escape-time family's in-app gate (fr-tdin, not an npm script — it drives a
real build in a real browser): `npm run build && npm run preview &` then
`node scripts/escape-family.verify.mjs --mode=x11::0`. It loads every preset in
the Escape-time menu group FROM THE MENU, enters Surface, waits on the fr-opgk
settle latch and checks four things no unit test reaches: that each preset
enters unaided; that the members of each trio render DIFFERENT objects (a knob
that never reaches the DE renders the same picture three times); that
`PRESET_FINALS` installs and clears in both directions, read out of the `#v1=`
document hash rather than the panel (the transform list hides outside explorer
mode, so a DOM probe passes vacuously); and WHICH ENGINE each session takes —
measured compute for all nine, which is what keeps the `core:"bulb"` WGSL
kernel from being dead code. It also gates fr-17qu's empty-set toast and
fr-vpbq's `antialiasing pass k/8` disclosure. `--mode=sw` runs everything but
the engine question without a display.

The 4D lifts' gate (fr-vag4/fr-h0c3/fr-qxxw, same prerequisites):
`node scripts/surface-4d-lift.verify.mjs --display=:0`. Eight scenes as
`#v1=` hashes rather than presets — so it needs no preset table and
survives one changing under it — each driven into Surface FROM THE UI
and asked the four questions no unit test reaches: does the session
ENTER, does it reach a COMPLETED settle (the fr-opgk latch), does it
DRAW (non-backdrop share of a real screenshot; a canvas READBACK reads
empty for a WebGL context outside its own rAF and measures 0% for a
frame that is plainly there), and WHICH ENGINE took it — which is what
keeps `core:"escape4"` and the 4D plane/balloon blocks from being dead
code. MEASURED at the lift, real Iris, 1024x640, 8/8: the 4D chain
44.6%, under an xw kaleidoscope 44.5%, with the floor 88.9%; a 4D IFS
attractor with the floor 89.2% and with the balloon 41.1%;
kaleidoscope-4D through the FRAGMENT arm 67.4% / 32.3%; and the 3D
Mandelbox-with-floor control 89.2%. Its kaleidoscope fixture is
deliberately LIGHT (2 maps at order 3) and that is a measurement too — a
four-map order-5 4D system settles neither with the floor NOR without it
inside 200s on this hardware, which is fr-b72d's superlinear order cost
and not anything a lift did. Without `--display` the engine column is
reported rather than gated.

**Harness sheets** (`scripts/*.harness.ts`, run with
`npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>`)
are this project's executable measurement records — the argument for a
decision, kept runnable rather than summarized. `scripts/de-preview.ts` is
the SHARED renderer eight of them import (`renderPreview`,
`writeContactSheet`, `encodePng`, and the `DistanceEstimator`/`PanelStats`
vocabulary): a CPU sphere-marcher with AO/shadow switches, a settable step
budget and an always-counted `exhausted`, so a new sheet writes its
estimator and its panel list, never a ninth marcher. `scripts/set-extent.ts`
is the other shared instrument (fr-azjk): the ONE definition of "how much of
a ball does this set fill, and how far out does it reach", against a
MEMBERSHIP oracle the caller supplies and never a threshold on a distance,
volume-uniform for fill (`probeEscapeFill`'s own draw, term for term, and
pinned bit-equal to it) and a shell walk from the outside in for reach. Five
sheets had each grown their own copy and all five were wrong the same two
ways — a grid aliases against a fold's walls, and `de(p) < eps` is not
membership in either direction — which corrected figures in four module docs
and cost two claims: the Juliabox's "narrow usable band" does not exist, and
`qjulia-beauty`'s "a deformed M never wins" was the instrument. Output lands
under `scripts/out/`, which is gitignored — regenerate rather than commit
megabytes of PNG. The escape-time family's sheets:
`escape-form-sweep` (fr-7u8t.8's retired Julia form, still executable —
the ORBIT form, not to be confused with the sheet below),
`escape-estimate-form` (fr-282c's refutation: swapping the fold family to
the Böttcher log form `0.5·|y|·ln|y|/dr` that `bulb-de.ts` and
`qjulia-de.ts` use looks like a win and is not a different bound at all.
`log/linear` IS `0.5·ln r`, and an escaping fold orbit lands just outside
the radius-4 bailout ball, so the ratio is pinned near `0.5·ln 4` —
measured p50 0.744-0.819 across seven fixtures. The control the original
observation lacked is `linear x k`, one constant, and it reproduces the
log arm's whole result to within 0.00-0.45 hit points, beating it on
`mandelboxCube`. Not boundary-adaptive either — the near/far decile
medians are flat on six of seven. And DIMENSIONALLY WRONG since fr-s9ll:
the fold family is uniform-rescale equivariant, so an estimator must
satisfy `DE_λ(λp) = λ·DE(p)`; linear does BIT-EXACTLY, log measures 44.8%
median relative error, worst 107x, because `ln r` needs `r` dimensionless
and a fold's escape is asymptotically linear so the Green's-function
limit never arrives. `bulb-de.ts`/`qjulia-de.ts` differing from
`escape-de.ts` is correct BY CONSTRUCTION, not drift. Its docblock also
carries the live follow-up: the ~0.75 damping is reachable as
`ESCAPE_STEP_SCALE` 0.35 -> ~0.26 plus the acceptance epsilon, but that
re-opens fr-7u8t.8's deliberate cost/quality pick rather than winning
anything free),
`escape-chain` (fr-za0n's shipped cycling estimator, and the rejected
per-pass CHAINING arm beside it), `hybrid-chain` (the CROSS-FAMILY
sheet: the prototype that asked whether the escape-time family composes,
now measuring the shipped answer against itself — it cross-validates
`estimateEscapeDistance` on bulb/qsquare chains BIT-EXACTLY against its
own independently-written orbit, and it is where fr-j231's two verdicts
are executable: that cycling dissolves the power-link stiffness the bead
blocked on, and that the Böttcher form is boundary-adaptive on a
power-dominated chain where fr-282c measured it flat on a fold one),
`chain-speckle` (fr-vpbq's and fr-byxb's evidence: the speckle is
sub-pixel, the ramp is bottom-heavy),
`slab-ball-slack` (fr-v7ca's verdict, and the sheet whose INSTRUMENT is
the argument: a BOXFOLD-ONLY system answers a spherefold question,
because its two arms are the two ENDPOINTS of the lift under test — the
shipped exact segment IS the segment+ball-slack state with no mid
crossing ever, and `max(0, DE(p) - h)` IS the same state with the
crossing at depth 0, so the gap between them BRACKETS everything the
lift could ever buy. Verdict NEITHER, keep the refusal: the cheap form
is a DILATION and not a slab — a crisp fractal becomes the bare marching
ball at the slider's own ceiling, 44.4% of rays at 0.0 steps/px — it is
FURTHER from the exact slab than doing nothing on two of four controls,
it floats the whole surface toward the camera rather than adding a rind
(mean depth error 16.9-68.8% of the marching ball against the point
query's 0.8-15.2%), and it overcharges the bound by one to two orders of
magnitude through DIRECTION-BLINDNESS (a true slab costs 0.3-15%, a ball
29-100%). Both forms are SOUND — 0 violations in 9600 checks — which
settles nothing. And the threaded design cannot be justified from
outside the descent: its ceiling is reached only where no mid crossing
happens, i.e. on the systems that ALREADY have the exact slab, while
every system it is FOR crosses that branch. Two named instruments would
reopen it),
`escape-4d` (fr-vag4's own measure-before-building sheet, and the one
that CONTRADICTS a prior record: fr-wuuu swept the quaternion square's
`k` component — a `w` TRANSLATION — and found pure EROSION off the
`w = 0` slice, containment 94-98% and a blank frame by `w0 = 0.8`; a `w`
ROTATION reads containment 52-61% and still draws 16% of its rays at
`w0 = 1.2`, so roughly half of every offset slice is a genuinely
different cut. That is the empirical case for the 4D lift, and it is why
the shipped 4D presets ROTATE rather than translate. Three more results:
WHICH LINK carries the rotation decides everything — on the head link it
flattens the set along the rotated axis, x-extent 3.99 -> 1.29, and
costs a third of the rays, where a POWER link costs essentially nothing
(47.9% -> 43.7%); a W-PLANE KALEIDOSCOPE has no visible rosette, its
symmetry plane containing `w` rather than lying in the rendered slice,
and is a measurable NO-OP at EVEN order — 1 point of 262144 differs at
2/4/6/8 against ~3700 at 3/5, so a preset authored at order 4 would
silently be its 3D twin; and a pose ROTOR can CANCEL the document's own
`w` rotation, handing `mandelboxCube + xw = 1` back exact cube
proportions. Its refuted-in-sheet hypothesis is kept too: the entry-pose
hit drop is NOT sub-pixel structure the 8x settle supersampling would
repay — doubling the panel leaves the gap unchanged),
`bulb-preview` (fr-7u8t.7's step-scale
sweep), `escape-family-preview` (the three estimators side by side),
`qjulia-preview` and `qjulia-beauty` (fr-7u8t.4's proof, and the twenty
panels that demoted fr-7u8t.5/.6), `julia-flame` (the compositions three
flame presets were picked from), `spherefold-radius-sweep` (fr-qi9c: the
sphere fold's frozen `mR`/`fR` and the box wall, swept as the two
DIMENSIONLESS RATIOS that survive conjugation — its conjugation-control
arm, exact at IoU 1.000 / relief 0.0000 over a 4x apparatus span, is what
makes the other columns shape differences rather than zooms; verdict: both
ratios are real, and the ONE-SHOT final-transform lens is the most
sensitive role of the three. fr-77oy added four arms where that sheet
stopped, its estimator now taking one parameter record PER LINK and
cycling the chain like `runEscapeOrbit`, wedge fold included, pinned
bit-exact on 2-link, 3-link, order-5 and order-3 systems: a chain DAMPS
its own links 3.8-6.4x — the same map alone against itself as link 0 of
three — and the links barely interact (0.72-0.91x at four of five arms);
the BARE sphere fold has no escape-time object at all, structurally, since
without a box fold to bring points back in the orbit is empty above
`|w| ~ 1.2` and a heuristic-invisible smooth solid below it, so the
control runs through the LENS instead — where the box must be pre-scaled
into biting or the two rows agree at IoU exactly 1.000; the kaleidoscope
is orthogonal to the ratio; and the ELIGIBILITY SEAM
(`SPHEREFOLD_LIPSCHITZ` IS the magnification ratio, so it moves both
gates) is reached by exactly ONE shipped system — `mandelboxKifs`, 9%
away, `mR` 0.478 instead of 0.500 — while the three escape presets would
need `mR > fR` and all three chains are unreachable at any ratio behind a
box-fold link that expands regardless).

Requires **Node.js 18+** (ES2022 target; developed on Node 22).

Reproduce the COOP/COEP first-visit reload locally:
`node scripts/isolation-reload.verify.mjs` (fr-su3r, not an npm script) —
serves the production build over a plain static server with no COOP/COEP
and a deliberately delayed `sw.js`, widening the reload window on demand;
`npm run preview` can trigger the same dance, but only at real,
easy-to-miss localhost timing.

The WebGPU compute-surface teardown gate (fr-uec4, not an npm script — it
needs a real Firefox build with WebGPU enabled on a display, and it gates
renderer LIFECYCLE rather than built output, so the dev server hosts it):
`npm run dev &` then
`node scripts/surface-teardown.verify.mjs --lens --toggleId=__modeExit
--toggles=20`. It restarts or exits a live surface session while
`SurfaceComputeRenderer` still has a frame parked on submitted GPU work —
the widest trigger, a mode exit, is what undo/redo, a preset load and
clicking Points all reach — which used to take down the whole Firefox
process rather than the tab; exit 0 is a clean sweep, exit 3 means it
reproduced.

Its flame sibling (fr-mxkk, same prerequisites, same dev server):
`node scripts/flame-teardown.verify.mjs --toggles=12`. It storms the
palette select — `setPalette` has no equality guard, so every toggle
reaches `startAccumulation` and therefore `backend.destroy()` — against a
2B-iteration accumulation, so each teardown lands on an op parked on
`mapAsync`/`onSubmittedWorkDone`. Same 0/3 verdicts plus exit 2 for
INCONCLUSIVE, which is the one this gate needs and the surface one does
not: a run that fell back to CPU (or a software adapter), or never caught
a restart, never exercised the path and must not read as a pass — so it
counts `Flame GPU: backend up on` lines rather than trusting
`#flameProgress`, whose percentage stays rounded at 0% through a storm
this fast. `--toggleId=` also takes `flameSupersampleSlider`,
`symmetryOrderSlider`, and the sentinel `__modeExit` — that last one is
INFORMATIONAL, not a gate on fr-mxkk: leaving flame mode never calls
`destroy()` at all, since main.ts kills the worker with
`worker.terminate()`, orphaning a live map a different way. MEASURED: the
crash does not reproduce on this stack in either direction (pre-fix module
12/12 clean, fixed module 12/12 clean), so this is a regression gate
rather than a reproduction — the script's header carries the full
numbers.

The flame Save-PNG gate (fr-61a2, not an npm script — it asserts what a
downloaded IMAGE contains, which no unit test reaches):
`npm run build && npm run preview &` then
`node scripts/flame-export.verify.mjs https://localhost:4173`. It saves a
POINTS reference and a converged FLAME reference from one pinned camera and
then asks of every later PNG only which of the two it is closer to (mean
absolute difference over a 64x64 grayscale downscale) — a comparison rather
than a tuned "is this smooth" heuristic, and exactly the question the bug
was about. Blobs are read through a `URL.createObjectURL` hook, each stamped
with the moment it appeared, so the second assertion — did the PNG land only
once the accumulation FINISHED — is answerable at all. Runs on SwiftShader
(the flame takes its CPU backend, so the quality slider is pinned to its 1M
floor). SOLID's phase asks the same question of the TRACE instead — its
`#solidProgress` reads 0% until the worker's grid lands — because the
explorer RE-SEEDS its chaos game on every mode switch, so a points reference
does not survive one (measured: the two distances came out 5.1 vs 5.1 when
the image test was tried there). MEASURED at the fix: 16/16 on the fixed
build, and on the pre-fix build 6 failures naming every symptom — phase 2's
2x save right after the Capture-size restart came back the POINTS EXPLORER
at 1640x1080 (distance 3.4 to the points reference against 13.5 to the
flame; the SIZE was right, which is how it evaded notice), phase 3 pressed
at 5% and saved at 5%, phase 5's Save on solid's entry landed with its
readout at 0%, and neither flame wait was disclosed at all. That run also
killed the report's open "the 2x restart is failing outright" hypothesis:
the 2x session converges fine, so the export was racing a first-frame gap,
not a broken render.

## Pre-commit Hooks

Husky runs lint-staged on every commit, auto-fixing ESLint + Prettier on staged
`.ts` files and Stylelint + Prettier on staged `.css` files. Hooks are installed by
`npm install` (via the `prepare` script). The beads integration block in each hook
keeps issues synced with git.

## Architecture

The codebase deliberately separates the **pure fractal core** from the **rendering
and UI**, so the interesting math is unit-tested without a browser:

- **`src/fractal/`** — Dependency-free core. No Three.js, no DOM.
  - `affine.ts` — Euler-XYZ rotation matrix + TRS compose/apply, matched to
    Three.js conventions.
  - `affine4.ts` — 4D affine group (4×4 + translation), `toTransform4` (lift
    3D→4D), `systemIsFlat`/`systemPartsAreNonFlat` predicates (derived from
    transforms, never stored).
  - `balloon-de.ts` — the balloon inverted-union DE (fr-5wlv): the scene as
    the UNION of the attractor and its sphere-inverted echo
    `I(p) = c + R²(p−c)/|p−c|²`, bounded by
    `min(DE(p), (|p−c|/rho)·DE(I(p)))` over the UNTOUCHED public estimators —
    the `descendLens` idiom one wrapper further out, conservative at every R
    (fr-5wlv.1's measured verdict; module doc carries the certification
    argument against the DE's own fr-pjqw ball, margined by
    `BALLOON_RHO_MARGIN`). The fr-55r5 cutoff contract survives through the
    inverse-scaled inner cutoff; `BALLOON_FAR_CAP_RHO` is the march-entry far
    cap every arm shares (capped rays fall to background; the grid stays off
    in balloon mode). CPU oracle for the `SURFACE_BALLOON` GLSL variant
    (`surface-material.ts`) and the `balloon: true` WGSL kernels
    (`surface-de-gpu.ts`, bench-pinned by `balloonEval`/`balloonMarch` legs);
    the explorer echo (`scene.ts`'s shared-geometry echo Points) reuses only
    the inversion + the far-cap vocabulary. IFS systems only: both
    FORWARD-ORBIT modes render plain — a filled solid's interior reaches
    the ball center, so its echo swallows the camera (fr-5wlv.4's measured
    verdict for the escape folds; fr-tdin re-measured it on the Mandelbulb
    rather than inheriting it — DE(0) = 0 with 100% of a 0.1R neighbourhood
    of the centre interior, union DE exactly 0 at the session's own opening
    eye for R = 0.35 and 0.9 raw-ball radii, and a flat featureless frame at
    every R) — and the estimator composed under the union must be far-field
    SOUND (a true lower bound outside the ball; the escape heuristic's `|q|`
    is not).
    Balloon on/`R` persist in the scene document; `R` is authored NORMALIZED
    (multiples of the raw ball radius, `buildBalloon`'s `rMult`), one
    continuous parameter across the explorer echo and the surface balloon.
    THE 4D LIFT (fr-qxxw) is a semantic decision and a ball choice, no new
    algebra: `estimateBalloonDistance4` inverts in the SLICED 3D space and
    hands the estimator `(q, w0)` on both terms — SLICE THEN INVERT, so the
    echo is the inversion of exactly what is drawn (the explorer echo's
    precedent), where inverting in 4D and slicing the result would draw the
    echo of a DIFFERENT slice (`I₄({w = w0})` is a 3-sphere; the two agree
    exactly at `w0 = 0` for this origin-anchored ball). The 3D bound then
    applies word for word, because a 4D estimate lower-bounds the 4D
    distance and hence the IN-SLICE one. `balloonBall4` takes the ORIGIN
    (`SurfaceDE4` has no `boundCenter` — it is origin-anchored, and
    `buildSurfaceDE4`'s own comment warns against copying 3D's centred fit
    blindly) and the FULL `visibleBoundingRadius`, not a slice-adjusted
    one: the slice sits inside `ball(0, R4)`, so the bound stays certified
    and the shell does not pulse as the slider scrubs. A `halfExtent` rides
    both terms untouched — the inversion never touches `w` — so the
    Möbius-ball helper fr-qxxw and fr-v7ca agreed to share was NOT needed
    here and is still owed to whichever slab port lands first. The WGSL 4D
    wrapper is the 3D text UNCHANGED, which is the same decision seen from
    the kernel side.
  - `chaos-game.ts` — IFS iterator: warm-up, escape-reset, bounds tracking.
    Injected RNG for reproducibility; optional `IterationRng` keeps morphs
    point-for-point correspondent. `SymmetryParams.blend` fades kaleidoscope
    weights continuously.
  - `chaos-game-4d.ts` — 4D twin (`runChaosGame4`), same loop unrolled to four
    coords. Kaleidoscope copies rotate in a PLANE, optionally with a `twist`
    (a double rotation — `affine4.ts`'s `symmetryRotation4`, which reproduces
    the 3D `symmetryRotation` entry for entry on the w-free planes).
  - `color.ts` — HSL→RGB and five color-mode palettes.
    `buildColorModeLUT`/`writePaletteRampColor` is the ONE ramp definition the
    explorer, solid render, and legend share (4D radius mode included).
    `writePositionColor` is the ONE custom-position definition `buildColors`
    and `accumulateVoxels` share.
  - `flame.ts` — CPU fractal-flame: `accumulateFlame` (2D histogram) +
    `tonemapFlame` (exposure/gamma/vibrancy). CPU oracle for `flame-gpu.ts`.
  - `flame-4d.ts` — 4D twin (`accumulateFlame4`), CPU oracle for
    `flame-gpu-4d.ts`; slices with `0.06` ghost floor (not solid's `0`).
  - `flame-gpu.ts` — WebGPU flame kernel (WGSL) + packing/dispatch/histogram
    layer. Pinned against CPU oracle by `src/app/gpu-bench/` (`npm run bench:gpu`).
    The fold family's AUTHORED lengths (fr-s9ll) ride a per-TYPE Slot lane —
    `foldRadii: array<vec4f, 3>` indexed by variation type minus 12,
    `(mR², fR², wall)` — not a per-LANE one: `packVariations`' own invariant
    is that a transform carries at most one entry per type, so three lanes
    cover every fold a slot can hold where seventeen would be needed to
    cover every lane. Squared because that is the form `foldVariationFn`'s
    closure computes once. Mirroring flame was not optional: the mode has
    TWO backends over one document (`flame.ts` reaches the fold through
    `composeVariations`, which reads the lengths), so leaving the kernel
    frozen would render one object with a WebGPU adapter and another
    without.
  - `flame-gpu-4d.ts` — 4D WGSL kernel (4x4+t affines, `variations4`,
    rotor+camera projection, four `FourDRenderColor` modes). Same agreement
    harness, and the 3D Slot's fold lane verbatim.
  - `morph.ts` — pure interpolation (`lerpSystem`): endpoint-exact at t=0/1,
    rotation lerped nearest-turn, transform-count mismatches fade surplus by
    weight, flat↔4D continuous via derived w-scale, kaleidoscope crossfade
    (identity tuple = order/plane/twist; twist never interpolates). The
    fold's three lengths (fr-s9ll) ride the file's existing `lerpOptional`
    with the CLASSIC length as the absent side's fallback, never a
    synthesized 0 — so `minRadius: 0.3` against a side that omits it (the
    field OR the whole variation entry) morphs 0.3 -> 0.5, and both sides
    absent stays absent.
  - `mutate-system.ts` — mutation grid perturbation (`mutateSystem`): seeded
    nudge of every field, clamps mirror sliders, optional keys preserved
    exactly; `wildcard` option adds structural kicks. Quality-gated by
    `scoreSystem`.
  - `palette.ts` — Iq cosine-gradient palettes (`buildPaletteLUT` → 256×3 LUT)
    - user-authored `CustomPalette` (2–8 stops). `PaletteSelection` = UI/state,
      `PaletteSpec` = worker/GPU wire, `resolvePalette` = bridge.
  - `presets.ts` — default + named systems + add-transform, plus five
    `Partial<Record<Preset, …>>` SIDE TABLES main.ts's preset handler
    consumes: `PRESET_SCAFFOLDS` (4D wireframes), `PRESET_RENDER_HINTS`
    (the renderer a preset was authored for), and — fr-7u8t.1 —
    `PRESET_FINALS` (the plot-time lens a composition is built around;
    ABSENT MEANS CLEAR, so no lens survives a preset load into a system
    whose gate refuses one) and `PRESET_PALETTES` (the flame palette a
    composition was chosen with — built-in ids only, flame-hinted presets
    only); fr-za0n added `PRESET_SYMMETRIES` (the kaleidoscope a
    composition IS — today only `foldChainFlower`, whose subject is the
    five-fold query fold — on `PRESET_FINALS`'s ABSENT-MEANS-OFF rule,
    load-bearing in both directions since `analyzeBulbSystem` refuses any
    order above 1 and `analyzeEscapeSystem` refuses one that rotates into
    4D; main.ts also clears the twist, and no entry may carry one). Five
    tables rather than a wider `PRESETS` signature, so no preset has to
    declare what it does not carry.
  - `project4.ts` — SO(4) rotor→matrix + camera projection, `FourDView`,
    `sliceWeight`, `SLICE_GHOST_FLOOR` (`0.06`).
  - `random-system.ts` — "Surprise Me" generator: rolls random IFS (2–4 maps,
    optional kaleidoscope, 25% 4D), quality-gated by chaos-game probes,
    rerolls up to 40×. Injected `Rng`.
  - `rng.ts` — seedable mulberry32 PRNG.
  - `surface-de.ts` — surface render's CPU oracle: `analyzeSurfaceSystem`
    (eligibility gate: eligible/degraded/ineligible + reasons),
    `buildSurfaceDE` (BASE inverse maps + the kaleidoscope the descent
    SWEEPS around them — fr-x029 replaced the old symmetry expansion, so
    slots are base maps at any order; the module doc carries the validity
    argument and why a single wedge FOLD is unsound here — + seeded
    bounding-radius probe), `estimateDistance` (width-4 beam inverse-map
    descent + sibling certificates: the fr-v6yg chain pair — width 1 = the
    old greedy descent, measured overshooting, kept for tests — plus
    fr-jkpn's two validity slots, rank-3/4 chains live only while
    in-sphere, closing the 3+-simultaneous-branch drops; tables in
    `scripts/surface-beam.harness.ts`) + production
    `estimateDistanceRefined` (fr-1z6p: fr-beck's extra Hutchinson level on
    folded sibling certificates, ported down from 4D — kills the balloon
    ghosts plain certificates rendered across voids; lazily guarded,
    measured void-false-hits 0 on every preset; fr-55r5's march-epsilon
    cutoff + fr-zkt2's value-exact sphere-floor pin exit the descent
    early, both mirrored in the GLSL bodies; fr-kidj branch-and-bounds
    the fold branch enumeration with dual bit-identical no-op skips —
    floor prune moved ahead of the child transform, then sigma-form +
    directional child-radius lower bounds — measured 75x fewer
    transforms/call on mandelboxKifs; fr-pjqw descends a probe-fit
    centered bounding ball where it beats the origin ball, axis-projected
    under kaleidoscope; fr-3c0k caps descent depth per query from an
    optional cone-footprint parameter, previewMaxDepth's argument
    per-step). A pure-fold FINAL transform
    is eligible via `descendLens` (fr-g58b): the fr-5rvk branch
    vocabulary lifted one level — each lens branch seeds a root descent
    through the UNTOUCHED cores (`final` stays null when `foldFinal` is
    set), with region floors, value-exact sphere/floor prunes and the
    visible-sphere pin; no contraction gate (an un-iterated lens needs
    none).
    THE FOLD'S RADII ARE AUTHORED, NOT BAKED IN, since fr-s9ll: the branch
    algebra's constants became expressions of the map's own lengths
    (inner inverse `×0.25 -> ×mR²/fR²` and its sigma `4 -> fR²/mR²`, inner
    output region `r <= 2 -> r <= fR²/mR`, mid shell `[1,2] -> [fR, fR²/mR]`
    with inversion `u/|u|² -> fR²u/|u|²` and certified factor
    `|u| -> |u|/fR`, box preimages `±2 − u -> ±2·wall − u` and in-box region
    `[-1,1] -> [-wall, wall]`), derived ONCE per map into `SurfaceFoldRadii`
    (these sit inside a per-candidate, per-branch loop) and carried on
    `SurfaceDEMap.foldRadii` and the lens. `SPHEREFOLD_LIPSCHITZ` survives
    only as the CLASSIC value the docs and tests quote — the live bound is
    `variations.ts`'s `sphereFoldLipschitz`, which the contraction gate and
    the depth cap read, so the knob moves the Surface/escape-time seam
    (fr-77oy: exactly one shipped system, `mandelboxKifs`, is close enough
    to cross it). `SPHEREFOLD_MID_MIN_R` SCALES WITH `fR`, NOT `fR²` — it
    guards the mid inversion's image `fR²/|u|`, so holding that to `1e3·fR`
    makes the threshold `1e-3·fR`; `fR²` would be a length² where a length
    belongs and would break the uniform-rescale equivariance the fold family
    has (the two are indistinguishable at the classic `fR = 1`, which is why
    the bead's own sketch proposed the wrong one). Byte-identity at the
    defaults is by CONSTRUCTION — at the classic lengths every expression
    reduces to the literal that shipped. Oracle for
    `surface-material.ts`, the `flame.ts` <-> `flame-gpu.ts` discipline one
    render mode over — and since fr-3pcu EVERY GPU MIRROR READS THE
    AUTHORED LENGTHS, so fr-xb8o's divergence is closed and the feature is
    reachable: `ui.ts` gives each fold variation the lengths that fold
    actually reads. The wire is the three AUTHORED lengths everywhere, not
    this struct's eight derived fields — three numbers a reader can check
    against the document beat eight combinations, which would be eight
    chances to disagree — and each kernel re-derives the branch algebra
    from them (`foldRadiiOf`, this file's `surfaceFoldRadii` field for
    field). Two producers still leave the fields alone, now by CHOICE
    rather than as fr-xb8o's mitigation: `random-system.ts` does not roll
    them (no evidence they improve the generator, and rolling `minRadius`
    would move systems across the eligibility seam behind the user's
    back), and `mutate-system.ts` perturbs a present one but never
    materializes an absent one (so a mutation grid stays a grid of the
    system you brought it).
  - `surface-de-4d.ts` — `surface-de.ts` one dimension up (born as the
    fr-beck spike): Jacobi `singularValues4`, `analyzeSurfaceSystem4`,
    `buildSurfaceDE4` (final-transform lens included; also derives
    `radiusBand` — the visible set's probe-seeded 4D center + [minD,
    maxD] distance band, fr-skhv: the radius color source's normalizer,
    matching `buildColors4`'s radius convention so the full ramp is in
    play, slice/rotor-invariant), beam
    `estimateDistance4` + ghost-free `estimateDistance4Refined` — the 4D
    surface render's CPU oracle, mirrored by `surface-material-4d.ts`.
    Reads the fold's authored radii at all three of its own branch sites
    since fr-s9ll, SHARING `SurfaceFoldRadii`/`surfaceFoldRadii` with 3D
    rather than redefining them (the resolved lengths are dimension-free,
    and two copies of "what does an absent field mean" is how a 3D system
    and its 4D lift start rendering different objects); the one genuinely
    new part is the FOURTH box axis, whose `pw0/pw1/pw2` and `dwUp/dwDn`
    take the same treatment as x/y/z and whose visible-radius bound's `+ 4`
    — the axis COUNT — becomes `4·wall²`.
    Measured verdict + numbers in the module doc. Both estimators take an
    optional `halfExtent` (fr-wa6o): the query becomes the SEGMENT
    `p ± halfExtent`, which turns the marched hyperplane into a SLAB of
    half-thickness `h` — same contract (conservative bound, exact zero set),
    just looser, because affine maps take segments to segments. One extra
    4-vector per chain/candidate (moved by each inverse map's LINEAR part),
    `segmentRadius` in place of every `|q|`, and `chainScale · |e| <= h`
    caps what the bound can lose at every level. `null`/zero — the default
    and the shipped slider position — is the point query value for value.
  - `surface-de-gpu.ts` — WGSL fold-DE compute kernel (fr-q1f8 spike, gated
    in by fr-ck0w's occupancy verdict; app integration fr-tzdg): mirrors
    `estimateDistance`'s refine=false fold path term for term (the
    estimator the fold GLSL marches) under the `flame-gpu.ts` oracle
    discipline, source-generated per config — frontier width,
    workgroup-SHARED (banked, transposed) vs private frontier storage,
    fr-kidj stage-2 B&B on/off (WGSL has no Mesa link cliff).
    THE FOLD'S AUTHORED LENGTHS (fr-s9ll) ride a dedicated `fold` lane in
    both map layouts — `GpuMap` 6 -> 7 vec4, `GpuMap4` 8 -> 9 — carrying
    `resolveFoldRadii`'s own output `(mR, fR, wall)`, from which a
    generated `foldRadiiOf` re-derives the branch algebra
    (`surfaceFoldRadii` field for field, once per map per descent level,
    outside a branch loop that runs up to 81 times). The ESCAPE core's
    lane says something different — `(mR², fR², wall)`, the form
    `EscapeLink` keeps and the form `fR²/clamp(r², mR², fR²)` wants —
    exactly as its `p0` already differs; each packer transfers its OWN
    oracle's numbers rather than recomputing them. The 3D LENS needed a
    params slot and its block was full, so the lens fold's lengths take
    the frozen 272 and the shared plane/balloon block moves to 288, with
    the escape and bulb cores declaring a matching pad so that block keeps
    ONE offset across every 3D core (params 272 -> 288, balloon -> 320,
    plane -> 336, 4D lens -> 576). `foldRadiiOf` is emitted only where a
    fold branch reads it — the fold cores, or ANY core under the lens
    wrapper — so affine kernels stay byte-identical.
    THE 4D TAIL NOW HAS THE SAME SHAPE (fr-vag4 / fr-qxxw / fr-h0c3, one
    decision serving all three): the shared plane/balloon block lands at
    the frozen 576 for EVERY 4D core, which the lens4 block being declared
    unconditionally under either is what buys — the 3D `lens || balloon ||
groundPlane` rule one dimension up, zero-filled by the packer when
    there is no lens (4D balloon -> 608, 4D plane -> 624). fr-h0c3's bead
    had recorded exactly the hazard this avoids: a block appended at 560
    lands INSIDE fr-s9ll's `lens4Fold` quartet and corrupts it.
    SEVEN
    KERNEL CORES (fr-55s1 added the second, fr-dlxh the third and — its
    4D cut — the fourth, fr-rsp6 phase 2A the fifth, fr-7u8t.9 the
    sixth, fr-vag4 the seventh):
    `core:"affine"` emits the width-4 A/B + fr-jkpn-validity-slot
    REFINED ladder (mirrors `estimateDistanceRefined`, the affine GLSL's
    estimator; width/sharedFrontier/bnbStage2/shadeDeWidth inert) beside
    the fold frontier, picked off `deHasFolds` exactly like the CPU;
    `core:"escape"` (fr-dlxh) is not a descent at all — it emits
    `escape-de.ts`'s `estimateEscapeDistance`, the FORWARD fold orbit
    with the Buddhi/Rrrola scalar derivative, in the `SURFACE_ESCAPE`
    GLSL arm's f32 formulation, for exactly the systems
    `analyzeEscapeSystem` admits; the session's marching quantities ride
    the params uniform via `packEscapeGpuParams` (bailout
    ball packed as both bounding AND visible sphere, `ESCAPE_STEP_SCALE`,
    `maxDepth` as the orbit's iteration budget in PASSES through the same
    preview door the descents use, `mapCount` the LINK COUNT and
    `symOrder`/`symPlane` the query-space wedge fold), with the head link
    still in the 208-271 VARIANT block as frozen ballast, mutually
    exclusive with the lens block by construction (escape+lens throws).
    Since fr-s04t the orbit CYCLES the document's whole formula chain —
    link `i mod n`, `+ p` and the bailout test after EACH link,
    `maxDepth * n` single-link steps — reading one `GpuMap` per link off
    the maps storage binding (`packEscapeGpuMaps`), so the escape core
    DOES declare buffer 1 now and `core:"bulb"` is the one bindingless
    core left. Since fr-j231 a link's `kind` may be a POWER map (4
    triplex, 5 quaternion square), so the fold pair's negative
    `kind != 2u`/`kind != 1u` dispatch sits behind a `kind < 4u` GUARD in
    both bodies — this file's own doc names an unguarded new kind as the
    reason the Mandelbulb became a sixth core, and the guard is what
    makes a fourth and fifth safe here — `bulbPow8` HOISTED to one
    definition emitted for the two forward cores rather than copied
    (declared in the body block, so both the value body and the entry's
    hit-info see it, and affine/fold kernels stay byte-identical), and
    the block's `escParams.w` at offset 268 turned from pad into the ONE
    live word of the head-link ballast: `EscapeDE.logEstimate`, the
    chain-level choice between `r/dr` and the Böttcher `0.5·r·ln r/dr`.
    Its hit-info gained the matching second interpolant, off the DEGREE
    of the link that produced the terminal radius (a pre-scaled power
    link has `growth < 1`, which failed the old guard and dropped the
    trap back to the raw integer confetti fr-7u8t.8 removed).
    width/sharedFrontier/
    bnbStage2/shadeDeWidth are all inert, and its hit-info reports the
    trap as the CONTINUOUS escape fraction (fr-7u8t.8: `escapedAt` minus
    `log(r/R)/log(growth)` for the link that produced the escaping radius,
    over the PASS budget `maxDepth` — the raw integer count is a
    step function of position and painted the real Mandelbox as palette
    confetti; it looked fine only while the escape set was a blob with one
    count everywhere — smoothed, it is the canonical Mandelbox palette
    coordinate. The denominator is the pass budget and NOT the chain's own
    `maxDepth * n` step budget since fr-byxb: `escapedAt` counts
    single-link steps and an orbit escapes after a handful of them however
    long the chain is, so dividing by a budget that multiplied with the
    link count shrank the reachable ramp per link added and a chain
    painted in the bottom of its palette. MEASURED TWICE, and the two
    populations disagree about the size of the win: over the whole
    surface the median trap at 2/3/6 links went 0.180/0.110/0.056 ->
    0.360/0.331/0.333, and at the PIXELS chain-speckle's own pose hits it
    went 0.132/-/0.072 -> 0.265/-/0.431. Both agree on the claim — n = 1
    identical to the bit (the same expression), and the SYSTEMATIC
    per-link collapse gone — but not on whether the result is flat, so
    "no per-link trend" is what this normalizer buys, not
    chain-invariance. Cost is the clamp, and fr-8fii moved it a long way:
    6.78 / 10.59 / 31.44% of really-hit pixels at one / two / six links,
    up to 15.8% over the whole surface. The 1.9-8.6% this line used to
    quote was wrong three ways — the two populations' labels were swapped
    where `surface-material.ts` records them, 1.9% is the TWO-link row
    rather than anything at six, and the pixel figures predate fr-azjk.
    THE PIXEL-POPULATION
    ROW IS POSE-DEPENDENT AND ITS POSE MOVED (fr-azjk): `chain-speckle`
    fits its marching ball to the set's reach, that fit was inflated by a
    halo of near-boundary escapers, and on the corrected fit the shipped
    normalizer's median trap reads 0.430 at two links and 0.710 at six
    against the recorded 0.265 and 0.431. Same direction, same claim — no
    per-link collapse — measured on an object that is no longer drawn
    smaller than it is, and the clamp share rose for the same reason the
    median did: a smaller object in a larger frame spends its hit pixels
    on the SILHOUETTE, where orbits escape early, and the corrected frame
    fills with interior pixels whose orbits survive the budget. The sheet
    PRINTS that share now rather than leaving it to be quoted (fr-8fii —
    it was unfalsifiable for one release), and the same run bounds it
    twice: the raw integer count clamps the identical pixels (6.78 /
    10.61 / 31.44%), so the saturation is the coordinate's own and not
    fr-7u8t.8's smoothing, and box-averaged over 16 sub-samples the rows
    read 0.16 / 0.00 / 0.00%, so the flat top-of-ramp PATCHES are
    sub-pixel rather than regions of the object — DIRECTIONAL for the
    shipped settle rather than its own figure, since this averages the
    TRAP over 16 where fr-vpbq/fr-jf9y average the shaded COLOUR over 8.
    The trap drives COLOR ONLY (the convention
    `core:"bulb"` always used), with rings/sheets over the orbit's
    closest radial / y-plane approaches — the descent cores' colors-only
    convention.
    `core:"bulb"` (fr-7u8t.9) is the escape core's SIBLING, one formula
    over: `bulb-de.ts`'s `estimateBulbDistance` — the forward triplex-power
    orbit `y <- M V(y) + y_0` with the Böttcher log estimate
    `0.5·|y|·ln|y| / dr` — for the systems `analyzeBulbSystem` admits, in
    the `SURFACE_BULB` GLSL arm's f32 formulation. A sixth CORE and not a
    fourth `foldKind`, because the escape bodies dispatch on
    `kind != 2`/`kind != 1` and an unrecognized kind would silently run
    both folds. Everything structural is escape's (208..271 variant block
    via `packBulbGpuParams`, no maps binding, every frontier knob inert,
    `maxDepth` as the orbit budget, lens/balloon throw); the wire's one
    asymmetry is that the ORBIT bailout and the QUERY-space marching ball
    are different numbers here, so `bulbParams.y` carries the bailout and
    the frozen `boundingRadius` stays the marching ball. Its trap is the
    continuous escape count in the POWER-map form
    (`log(log r / log R)/log n`, not the fold arm's constant-factor
    `log(r/R)/log(growth)`). Three terms an identity-or-rotation fixture
    cannot see — the `sigma_max(M)` `dr` seed, the trailing
    `+ sigma_max(M)`, and the `ln|y|` clamp below 1 — are what the bench's
    uniformly SCALED fixture exists for (measured: dropping either sigma
    term is BIT-IDENTICAL on the two sigmaMax = 1 systems and fails
    545/700 and 259/700 queries on `bulbScaled`).
    `core:"affine4"` (fr-dlxh's 4D cut) is the refined ladder ONE
    DIMENSION UP — `surface-de-4d.ts`'s `estimateDistance4Refined`
    behind the app's view lift, the estimator `surface-material-4d.ts`
    marches: the body's prologue does `rotorInv · vec4f(p, w0)` (the
    GLSL's uInvRotor line), the fr-wa6o slab rides one vec4f
    half-extent register beside every point (linear parts alone, gated
    on the dynamically uniform `sliceHalfW > 0`), and the fr-u91x
    kaleidoscope sweeps ONE backward-step 4×4 where 3D swept a
    (cos, sin) pair. Its params variant tail (208..463,
    `SURFACE_GPU_PARAMS4_BYTES` 464, `packSurface4GpuParams` + a
    per-frame `SurfaceGpu4View`) holds rotor/stepBack/4D-lens rows as
    row-vec4 quartets — the buffer always stores the ROW-MAJOR bytes of
    the matrix the body applies, the packer performing the one real
    transpose (pose rotor → world-to-attractor, `setSurfaceView4`'s
    exact dance) — plus w0/sliceHalfW/`visRadius4` and the fr-skhv
    radius-ramp band (`SurfaceDE4.radiusBand` as center4/minD/invRange);
    maps are the
    `GpuMap4` layout (`packSurfaceGpuMaps4`, 128-byte 4D stride). Two
    frozen slots carry 4D semantics: `visibleRadius` packs the
    SLICE-ADJUSTED sliceVisR so the shared march entry's sphere gate is
    the 4D GLSL's textually unchanged, while the tail's `visRadius4`
    keeps the FULL radius for the height color source and the radius
    source normalizes its center-relative distance over the band —
    both slice-invariant, the 4D GLSL mirrored (those two shade
    lines are the one core-conditional interpolation in the shared
    entry text). Fixed width 4 (inert knobs like "affine"); nonzero
    `footprint`
    THROWS at pack (the 4D oracle has no cone cap).
    `core:"fold4"` (fr-rsp6 phase 2A) is the FOLD frontier one
    dimension up — 4D fold base maps (`deHasFolds4`) marched as the
    same width-configurable frontier as 3D "fold", slab(`ext`)-aware,
    sharing `GpuMap4` and the affine4 tail; no stage-2 B&B emission by
    the 3D measured verdict, and `lens:true` wraps either 4D core in
    `descendLens4`'s branch sweep (fr-rsp6 phase 2B — the appended
    lens4 params block at 464..575, `SURFACE_GPU_PARAMS4_LENS_BYTES`
    576 — 464..559 as fr-rsp6 shipped it, plus fr-s9ll's `lens4Fold`
    quartet at 560; nothing follows the block, so it grew in place —
    packed exactly when the DE carries a `foldFinal`; the old
    "4D lens throws" rule is gone). Bench legs fold4Boxfold/Mandelbox/
    Kaleido/Slab + a fold4 compute-frame leg pin it. A `mapsUniform`
    codegen option (fr-b72d probe) moves the 4D cores' maps binding to a
    fixed 24-slot uniform array — REFUTED for production (0.99-1.02x at
    every kaleidoscope order on Iris, values bit-identical) and kept as
    the refutation's executable record, agreement-gated by the extended
    opt-in `--surface-aff4-sweep` leg (5 arms x orders 1-6, pilot-sized
    watchdog-safe batches); that leg + `scripts/aff4-order-cpu.harness.ts`
    carry fr-b72d's closure verdict — the order superlinearity is the
    ALGORITHM's own depth growth, CPU-oracle-matched, not kernel
    realization. The affine4
    eval-agreement
    leg (M3) gates fail=0 under a pure ORACLE-CONTINUITY classifier —
    the f64 oracle at the query's six ±1-ULP axis neighbors within
    tol/2 — because chord-bisected queries can park exactly ON a
    beam-selection discontinuity (~3e-2 value step ~1 ULP wide) where
    both sides are valid conservative bounds and pointwise comparison
    is the wrong question (measured: the oracle itself returns the
    GPU's value 1-2 query-ULPs away); exclusions disclosed per system
    (5/2800 on SwiftShader) and capped at 3% — the escape leg's
    ensemble shape minus the GPU modeling a ladder doesn't need. All
    five share the public `surfaceDE(pIn, cutoff, li)` signature, so the
    Modes below are textually identical whichever core is picked. And
    `lens:true` wraps EITHER descent core in `descendLens`'s fold-FINAL
    branch sweep — the body token-renames to `surfaceDECore` (hit-info to
    `surfaceDEHitInfoCore` behind the argmin sweep, probe to
    `surfaceDEProbeCore` under the same sweep text renamed) and the
    wrapper owns the public names, entries untouched; params grew
    208→272 (0-207 frozen) with the lens block zero-filled when absent,
    and footprint+lens is refused at pack time (descendLens's per-branch
    innerFootprint would need a core signature change; the app passes 0).
    M1 lens rows gate at ~2e-7 (81-branch mandelbox worst case included);
    the field class marched 5184 unproject rays fail=0, hits 812/811 —
    that leg and the fold-pair leg each carry ONE status mismatch on the
    real Iris driver where SwiftShader has none (fr-7tl3), excluded as
    `silhouetteFlips`: the two marches reached the same point on the same
    trajectory and straddled `d < eps` by 0.6%/2% of eps, which the older
    same-terminal-`t` rule could never recognize because a miss runs on to
    the sphere exit while a hit stops at the surface. Re-verify surface
    kernel changes on `--display=:0`, not SwiftShader alone — fr-dlxh
    re-proved it: the escape eval leg's first classifier (a single
    fround twin of the oracle) passed SwiftShader clean, then real Iris
    flipped 6 "stable" rows at maxAbs 0.41. A forward orbit is chaotic
    (~8x/iteration noise growth into the escape-decision dichotomy; the
    folds themselves are C0-continuous, so there is no
    boundary-proximity predictor), and which rounding seeds flip is
    realization-dependent — so the leg gates in LAYERS: pre-hoc, a
    seven-orbit ENSEMBLE classifier (`escapeQueryStable` — the fround
    twin at the query and its six one-ULP axis neighbors must all agree
    with the f64 oracle; exclusions disclosed per row and pinned under
    20%, the structural not-eating-the-leg cap); post-hoc, a residual
    failure is absolved only if `escapeShadowFlipVerified` proves some
    1..4-ULP neighbor orbit REPRODUCES the GPU's value within tolerance
    (fr-7tl3's per-mismatch discipline lifted to eval; `flips=` in the
    row, capped at 7). Measured on real Iris AT fr-dlxh, on the FOUR
    escape systems that existed then: fail=0, worst row excluded=74/700
    with flips=2, gated maxAbs 2.1e-6. That is a dated reading and not a
    standing baseline — the fixture set is NINE systems now (fr-s04t
    added the three chain rows, landing at 10.1/10.1/13.9% exclusions,
    and fr-s9ll added the parameterized one), so a later row's numbers
    have no business being compared against it. fr-jtd4 is open on
    exactly that confusion. A `computeFrameEscape` leg
    runs one production frame through `SurfaceComputeRenderer` with a
    `{kind:"escape"}` target and checks it against a strided CPU sanity
    march as HIT RATES rather than the per-pixel fr-7tl3
    status-exclusion tiers — the march entry text is shared across every
    core (test-pinned) and the escape DE is eval-pinned, so a rate band
    absorbs the same chaotic-orbit flips without duplicating that
    machinery for a second DE type (measured on real Iris: 256x144 in
    136ms wall, 33 passes, 0 exhausted, GPU hit rate 0.153 vs CPU 0.158 —
    the rates roughly halved at fr-7u8t.8, which is the Mandelbrot form
    replacing a blob that filled 89.4% of its own ball with an object that
    fills 3.5% (fr-azjk's corrected figures — the record read 94% and 10%
    off a grid thresholding the estimate); the gate is the GAP between the
    two rates, so it moved with them).
    `core:"escape4"` (fr-vag4) is the escape core ONE DIMENSION UP —
    `escape-de-4d.ts`'s `estimateEscapeDistance4` — and the first core
    that is BOTH 4D and FORWARD, which is the whole of its novelty: it
    takes the rotor prologue and the `GpuMap4` maps layout from the
    descent cores and the orbit, the params scalars and the colors-only
    hit-info from `core:"escape"`. Three things fall away with the
    dimension and NOTHING is added — no `bulbPow8` (the gate refuses a
    triplex power), no slab (a forward orbit cannot thread a segment, so
    the packer THROWS on a nonzero `sliceHalfW`), and no lens (an escape
    chain has no final transform, which is what lets its params block
    reuse lens4's 464..575 region). Its wedge fold reads `SYM_PLANE_CODE4`
    — the index into `SYMMETRY_PLANES` — and NOT the descents'
    `SYM_PLANE_CODE`, which deliberately collapses `xw`/`yw`/`zw` onto
    their w-free twins: sound where the kaleidoscope is a swept matrix,
    wrong where a fold picks its two axes by name. `lens`/`balloon` throw,
    `groundPlane` composes, and there is no fragment mirror at all.
    Ground plane (fr-rhn5) is an orthogonal `groundPlane` option, not a
    core of its own — it composes with every descent/escape core, in both
    dimensions since fr-h0c3, and with the lens wrapper. It adds a fifth
    ray status, `SURFACE_GPU_RAY_PLANE` (4), that
    march classifies a sphere-gate/sphere-exit MISS into when a downward
    ray crosses the floor inside its fade band (EXHAUSTED never planes);
    the shade entry lights the crossing with the hit path's penumbra/AO
    probe-width discipline under two analytic ball certificates. Params
    append a 48-byte block at the frozen offset 288
    (`SURFACE_GPU_PARAMS_PLANE_BYTES` 336; the 4D cores' own frozen 576,
    `SURFACE_GPU_PARAMS4_PLANE_BYTES` 624), SHARED with the balloon block
    — the two throw at codegen/pack together (no horizon inside the
    balloon's shell). THE 4D LIFT NEEDED NO NEW SHADER TEXT: the march
    classifier and the shade entry are already shared across every core,
    so it is the params block, the struct splice and deleting the throw.
    The floor is a world-space plane in the SLICED 3D space, so every 3D
    certificate holds verbatim once a ball is chosen; the app chooses the
    origin and the FULL 4D visible radius, so the floor does not slide as
    the slice scrubs (an off-centre slice shows a smaller object floating
    above it, which is honest — it IS a smaller slice).
    `surface-compute.ts` prices PLANE
    terminals in the hit-priced queue, not the miss path.
    Modes:
    `eval` (per-query distances) and `march` (bounded-dispatch ray march,
    host-compacted active list) are the fr-q1f8 bench baselines,
    byte-identical since the spike; `march` + `rays:"unproject"` swaps the
    ray derivation to the GLSL tracer's uInvProjView unproject (+
    flag-gated start dither) for the app path, and `shade` runs the GLSL
    tracer's FULL shading (greedy width-1 hit-info descent, tetra normal,
    penumbra shadow, AO, linear-space lighting, fog, LUT color sources)
    over host-compacted batches of TERMINAL rays. March and shade are
    separate entries by measured verdict, not taste: the v1 megakernel
    shaded rays inside the march pass that terminated them and LOST THE
    DEVICE on Iris (shading = ~40 zero-cutoff on-surface DE evals/hit —
    fr-096u's watchdog through the shading door; numbers on fr-tzdg).
    `shadeDeWidth` (fr-p8bc) routes exactly those probe taps
    (normal/shadow/AO — they LIGHT a hit the full-width march already
    certified, never decide geometry) to a second narrow descent
    `surfaceDEProbe`, derived from the same body template by token
    rename so the two cannot drift; app ships width 1. MEASURED
    VERDICTS (Iris Xe, real driver): march traces mandelboxKifs at
    width 12 in 49µs/ray primary (private frontier, stage 2 off) where
    the WebGL fragment tracer was unbounded (>1300µs/ray, fr-ck0w), width
    superlinearity GONE (w12/w4 ≈ 3.3x), compiles ~0.1-0.3s vs the ~25s
    GLSL link cliff; workgroup-shared frontier 2-3.3x SLOWER than private;
    stage-2 B&B 1.4-1.6x slower GPU-side at BOTH far-field and
    near-surface poses — config stays stage-1-only. Shading DOMINATED
    end-to-end cost after fr-tzdg (full-width probes: 740s/frame at
    96x54, unable to converge a 900s budget at a hit-dominated pose);
    fr-p8bc's width-1 probes shade the identical 660-hit frame in 31s
    (23.8x, thermally understated) with eyeball-identical images —
    differences are a slight lightening of deep-crease shadow/AO from
    the greedy DE's overshoot, no structural artifacts.
    Consumed by `src/app/surface-compute.ts` (the fold- and, since
    fr-dlxh, escape-shaped surface sessions' preferred tracer) and pinned
    by `src/app/gpu-bench/`'s surface section (`npm run bench:surface`;
    real-driver timing via `--display=:0`; `--surface-shade-width=N`
    reruns the fr-p8bc probe-width A/B).
  - `surface-grid.ts` — empty-space skip grid for the 3D surface march:
    conservative distance floors (cell centers, cutoff `cellRadius` — at/above
    the cutoff the return is the exact full-descent value, below it 0 is the
    only safe store — f32-FLOORED so quantization never rounds a bound up),
    priced per-system by `surfaceGridEstimator` (fr-aj4w: `"plain"` for fold
    systems — the estimator the fold GLSL actually marches, measured ~1.5x
    cheaper with near-identical floors — `"refined"` for affine). The 3D march
    samples it before paying a descent; `pickSurfaceGridResolution` sizes the
    build itself from a measured pilot slab, downshifting a 64/48/32 ladder to
    fit a 3s budget (floored at 32, never skipped). Module doc carries the
    validity chain; 3D only (4D's live rotor/slice would invalidate a grid per
    frame).
  - `escape-de.ts` — escape-time fold render's CPU oracle (fr-kltj), and
    since fr-za0n a HYBRID FORMULA CHAIN: the canonical
    Mandelbox/Juliabox object and its hybrids, for exactly the systems
    the IFS gate refuses (one or more flat maps of which at
    least one does NOT contract, no final transform, no kaleidoscope
    that rotates out of 3D — `analyzeEscapeSystem` is the deliberate
    COMPLEMENT of `analyzeSurfaceSystem` on that shape, which admits
    exactly when EVERY map contracts).
    A LINK NEED NOT BE A FOLD since fr-j231: the chain admits the
    escape-time family's two POWER maps beside its three folds — the
    triplex 8th power (`bulb`, the Mandelbulb's map) and the quaternion
    square (`qsquare`) — so one document can hold a Mandelbox and a
    Mandelbulb in ONE formula chain, which is where Mandelbulber gets its
    range and the last thing this mode was missing. Nothing structural
    moved: a link contributes its forward map and its LOCAL Lipschitz
    factor, and both were already written down in the modules that render
    those maps alone (`8·|y|⁷` from `bulb-de.ts`, a heuristic; `2·|y|`
    from `qjulia-de.ts`, EXACT because quaternion norms multiply), so the
    chain composes the shipped bounds and inherits their status rather
    than adding a new one. A LONE power map is refused — the Mandelbulb
    render owns one and `qjulia-de.ts`'s object is fr-7u8t.5's
    measured-dull won't-do — which is what keeps this gate DISJOINT from
    `analyzeBulbSystem` rather than merely ordered before it, and costs
    no range because two power links ARE a chain. A power link's WEIGHT
    is free (unlike `analyzeBulbSystem`'s lone map, which refuses
    anything but 1: there is no textbook object here to deform away
    from, and `dr` accounts for `w` exactly). The orbit stays in `v`
    space with the literal `+ 1` — the power modules work in `y` space
    and seed `dr` at `sigma_max(M)`; the two are the same recurrence in
    different coordinates, but that factoring needs ONE `M` and a chain
    has n, so staying in `v` is how a chain avoids choosing.
    THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW
    (`EscapeDE.logEstimate`, ONE flag per chain resolved at build and
    carried on both wires rather than re-decided in six mirrors): folds
    escape exponentially and read the linear `r/dr`; a power link makes
    the chain super-exponential and it reads the Böttcher
    `0.5·r·ln r/dr`, `bulb-de.ts`'s and `qjulia-de.ts`'s own form. That
    does NOT reopen fr-282c, which refused the log form for the FOLD
    family — its dimensional argument (the folds are uniform-rescale
    equivariant) cannot reach a map with `V(λy) = λ^d V(y)`, and its
    decisive empirical control was re-run here rather than waved past:
    the log/linear ratio's near/far decile medians are FLAT for a fold
    chain (0.738 / 0.734, 1.00x) and for a fold-TERMINATED cross chain,
    and reach 0.55x on a power-dominated one (1.347 / 0.735). The rows
    where the ratio is not flat are exactly the rows where the form wins
    big — on `mbox2 -> bulb(0.5)` the bound/step overshoot goes
    7.4/1.0% -> 2.0/0.9%, a 3.7x cut, against the 1.2x it buys where the
    ratio IS flat, which is the constant fr-282c already refused. It wins on all
    eleven measured rows, and at frame level renders MORE surface for
    FEWER steps (52.68% -> 54.95% of rays at 22.2 -> 19.5 steps/ray),
    which is what "tighter near the surface, looser far away" looks like.
    THE PREDICTED STIFFNESS HAZARD DOES NOT REPRODUCE, and it is
    fr-j231's most useful result. The bead blocked on it: a mandelbox
    step leaves `|v|` near 7, a triplex 8th power sends 7 to 5.8e5, so
    `mandelbox w=2 -> bulb` measured 0.01% ball fill — a blank frame for
    the first thing anyone tries — and the bead recorded a second
    prediction beside it, that CYCLING would not rescue it. Both figures
    are the PROTOTYPE's CHAINING arm's, and the shipped orbit CYCLES:
    `+ p` re-enters after every link, so a power link is applied to a
    point the query has just tethered and its output is tested before any
    fold can compound it. BOTH ARMS re-measured at EQUAL WORK (30 passes
    each, one bailout ball, one seeded 131072-point sampler — NEVER a
    grid, see below), `scripts/hybrid-chain.harness.ts`, ball fill at
    pre-scale 1 / 0.6 / 0.5 / 0.4 / 0.3 / 0.2:

        mbox2 -> bulb     cycling  0.29 / 1.57 / 2.78 / 6.32 / 22.89 / 64.56 %
                          chaining 0.01 / 0.11 / 0.23 / 2.26 / 69.08 / 98.29 %
                          rays hit 11.0 / 26.9 / 39.1 / 55.0 / 64.8  / 14.4  %
        mbox2 -> qsquare  cycling  0.01 / 0.33 / 1.59 / 5.01 / 17.61 / 44.41 %
                          chaining 0.00 / 0.36 / 6.77 / 27.60 / 64.18 / 88.99 %
                          rays hit 15.8 / 40.7 / 49.8 / 50.6 / 55.9  / 28.5  %

    The untuned pre-scale 1 — the exact case called blank — draws 11.0% of
    its rays. Pushed the other way it stays renderable: 27x past the
    closed-form bound (`escapeLinkStiffnessLimit`, kept executable as the
    refuted prediction's own record) it still draws 0.75%, against 0.095%
    for fr-17qu's degenerate system through the same marcher. AND CHAINING
    HAS NO USABLE RANGE AT ALL, which fr-za0n's fold-only sheet could not
    see: it is 12-29x EMPTIER than cycling from pre-scale 1 down to 0.5
    and then, one step later, 3.0x and 1.5x FATTER at 0.3 and 0.2 — 69%
    and 98% of its own bailout ball, fr-7u8t.8's "the rendered object WAS
    its own bounding sphere" returning intact. Nothing to a solid ball
    with no window between, where cycling climbs smoothly and reaches
    neither failure. SO NO
    AUTO-SCALE AND NO NEW SIGNAL — a hint computed from that bound was
    written and then DELETED, because it fires on every row of that table
    and every one of them renders, which is fr-17qu's second-cut lesson
    verbatim. The volume figures are the same trap one layer down, and
    the qsquare row is the sharpest case this family has produced:
    0.012% fill for a system that draws a SIXTH of its rays, beside
    `mandelboxRings` reading 0.000% at the same sample count while drawing
    44.9% of them; the shipped `hybridChainCraters` preset reads 0.011%
    while drawing 18.5%. THE INSTRUMENT MATTERS AND A FIRST DRAFT OF THIS
    PARAGRAPH GOT IT WRONG: ball fill is a seeded uniform sample against
    `escapeSetContains`, never a grid. A fold's structure sits on its own
    walls — the integers, at the classic `boxLimit` — so a grid whose
    planes land there over-samples them, and over `[-4, 4]` the aligned
    resolutions are exactly `n - 1` in {8, 16, 24, 32, 40, 48}. On
    `mandelboxClassic`, n = 23..49 reads 4.54 / 9.33 / 3.44 / 4.63 / 3.60
    / 7.96 / 5.98 / 5.61% — a 2.72x spread, no convergence, every aligned
    resolution high — where the sampler reads 3.540 / 3.548 / 3.568% at
    4k / 64k / 128k. THIN sets only (a 22%-fill chain is 22.4-22.9% at
    every n), which is why it is easy to miss: it bites exactly the rows a
    blank-frame question is about. AND A DISTANCE THRESHOLD IS NOT A
    MEMBERSHIP ORACLE IN EITHER DIRECTION, which is the larger of the two
    defects and is what manufactured the record's phantom collapse: a small
    estimate means "near a boundary" for an ESCAPER too (escapeSetContains'
    own doc), and CHAINING floors `dr` once per PASS, so a hard-contracting
    chain keeps `dr` near 1 and returns O(1) distances at points whose
    orbits never leave the ball — the bead's 0.47% at pre-scale 0.2 was a
    set filling 98% of its own bailout ball, read as almost empty. Held at
    the bead's OWN 16-pass budget so the instrument is the only difference,
    its chaining row re-reads 0.01 / 0.12 / 0.24 / 6.40 / 72.88 / 98.32%
    against the recorded 0.01 / 0.05 / 2.09 / 10.30 / 5.09 / 0.47 — 8.7x
    high at 0.5, then 14x and 209x LOW at 0.3 and 0.2, a different SHAPE
    rather than a precision error. fr-azjk carries both findings back to
    the sheets that predate this one. A CROSS-FAMILY CHAIN CAN ALSO BE
    CHEAPER THAN THE SINGLE MAP, the same result from the cost side:
    priced as ratios in one run, `mbox2 -> bulb(1)` is 0.54x
    `mandelboxClassic` and `bulb -> bulb rot20` 0.95x, against 1.26-1.80x
    for the rest — a stiff link means most orbits leave on the first pass
    and never reach the second link, let alone the 30-pass ceiling. f32 is
    safe on the GPU mirrors too
    (worst `dr/r` 2.6e13 over 200k queries, twenty-five orders under
    3.4e38, zero non-finite): the bailout test bounds `|v|` entering
    every link and the per-link `+ 1` floors `dr`.
    `estimateEscapeDistance` iterates the maps FORWARD with ONE shared
    scalar running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's
    standard heuristic, not a certified bound), mirrored by
    `surface-material.ts`'s `SURFACE_ESCAPE` variant and, since fr-dlxh,
    `surface-de-gpu.ts`'s `core:"escape"` kernel — `ESCAPE_STEP_SCALE`
    is the one marcher-damping definition both the GLSL variant and the
    WGSL packer import, and it stays 0.35 at EVERY chain length, MEASURED
    rather than assumed: fr-za0n predicted chains would need heavier
    damping, and both harnesses refute it (the single map's hit-coverage
    curve is the steepest of eight fixtures, and as a fraction of its own
    0.05 asymptote 0.35 reaches 96.6% for a chain against 95.7% for the
    control). Cycling floors `dr` after every link, so no two folds
    compound between floors and the slack per step is the single map's.
    Composition in fact BUYS bound quality: bound/damped-step violation
    rates over a common bailout ball run 13.4%/6.6% for the shipped single
    map against 4.3%/1.5% (two links) down to 1.5%/0.6% (six). Bailout
    stays 4 for the same measured reason it always was — raising it at a
    fixed budget inflates the set rather than revealing it (control fill
    3.6% → 51.5% → 53.2% at 4/8/16 over a FIXED radius-4 reference ball,
    fr-azjk's corrected reading of 2.9% → 57.7% → 65.6%: a 14x inflation on
    the first doubling and a plateau after it). What it is NOT is a ball
    the chains strain against — that claim inverted on re-measurement:
    cycled chains reach 1.96-2.94 where the single map reaches 3.06, so 4
    is generous for a chain and right for the map it was chosen against. Phone-cheap by
    construction (~30 branchless folds per link per eval; measured over the
    BAILOUT ball the marcher actually enters, 0.18 us/eval at one link and
    0.07-0.23 across eight chains — at or BELOW the single map on every
    row, because the n-times budget is a ceiling only a non-escaping orbit
    pays and every extra link is another chance to escape. fr-azjk's
    corrected figures, and it had to separate the DOMAIN out first: priced
    over each row's own fitted ball instead, which crowds queries against
    the set, the same rows read 0.22 and 0.28-1.27 — the record's 0.25 /
    0.27-1.10 / 0.60 was that column, taken when the fit came from the
    aliased instrument. Both are printed now).
    THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`):
    orbit step `i` applies link `i mod n`, `+ p` and the bailout test
    after EACH link, and a PASS is one full cycle — so
    `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the GPU's
    `maxDepth` keep meaning "how many times is each link applied". The
    rejected alternative, CHAINING (all n links inside one pass, i.e. the
    per-PASS offset — the same fork under the prototype's other name),
    was measured fattening toward a solid ball as links were added — 37.1%
    of the bailout ball at six links against cycling's 0.2%, a 186x gap
    that widens with every link, the fr-7u8t.8 defect returning — and
    lives on as an executable local in
    `scripts/escape-chain.harness.ts`, the sheet the SHIPPED estimator
    draws (`scripts/hybrid-chain.harness.ts` is the prototype that asked
    the question first, on the cross-family links this gate still
    refuses). EMPTY CHAINS ARE REACHABLE inside the gate — a big enough
    pre-scale escapes everywhere on the first pass and the mode renders a
    blank frame — so `escapeSetContains` (membership, from the same orbit
    the estimate reads) and `probeEscapeFill` (a seeded sample of the
    bailout ball) exist to say so. `probeEscapeFill` measures VOLUME and
    must not be read as "will it render": an escape-time set is often a
    thin fractal, and the shipped `mandelboxRings` reads 0.0000% fill at
    65536 samples while rendering ~38k surface hits — fr-17qu's first cut
    toasted "looks empty" over one of the app's own presets on exactly
    that confusion. fr-wuuu turned up a STRICTLY STRONGER case, worth
    quoting because 0.0000% still reads as rounding: a `w = 0.4` slice of
    `hybridChainQuaternion` has LITERALLY ZERO members in 524288 samples
    of its own bailout ball and still draws 20.9% of its rays as a
    coherent shaded object with creases and highlights. A slice through a
    set of shells is a set of surfaces, and no volume statistic can see
    one. (`scripts/hybrid-chain.harness.ts` section 6, arm (e).) The
    signal fires off the FIRST completed settle's own
    hit count instead (main.ts's `surfaceBlankNotice`, and since fr-7k0o
    off BOTH engines' — the compute arm counts ray statuses, the WebGL
    strip arm counts the COVERAGE flag its tracer writes into alpha, which
    is invisible to the user, agrees with the compute arm on ground-plane
    pixels, and is free to read in the full-frame readback fr-jf9y's
    supersampling accumulator already pays for): a frame that drew
    essentially nothing at the entry pose — where the camera has just
    glided to frame the whole bounding ball — IS blank by the renderer's
    own arithmetic, so it cannot disagree with what the user sees. The
    bar is `SURFACE_BLANK_HIT_FRACTION` (0.001) and NOT zero, because the
    marcher accepts at `uAcceptPixelEps` and a few rays catch even a
    degenerate system: measured at 1024x640, the nine shipped presets hit
    5.0-10.3% of rays and a Mandelbox pre-scaled by 8 hits 0.019%, a
    ~260x gap this sits inside. It reports, never refuses,
    and covers fr-kkb9's lone spherefold and the bulb arm by the same
    evidence. Neither probe is wired into `analyzeEscapeSystem` or
    `buildEscapeDE`, which stay cheap.
    KALEIDOSCOPE is a query-space wedge fold
    (`foldQueryIntoSector`), not an orbit operation: `g` is 1-Lipschitz
    and an isometry per sector, the orbit is seeded AND offset by `g(p)`,
    so the set is exactly `g^-1(M)` — dihedral rather than the chaos
    game's cyclic (a cyclic fold is discontinuous and would certify empty
    balls across the seam), free per orbit step, and `SymmetryParams.blend`
    is deliberately unread exactly as in `surface-de.ts`.
    EACH LINK CARRIES ITS OWN FOLD LENGTHS since fr-s9ll (`EscapeLink`'s
    `boxLimit`/`minRadius2`/`fixedRadius2`, resolved once at build), so a
    chain may hold a different sphere/box apparatus per link, and
    `foldLipschitz` tests the real magnification `fR²/mR²` rather than the
    frozen 4 — which is what keeps this gate the exact COMPLEMENT of the IFS
    one as the knob moves. Pinned against an INDEPENDENT oracle:
    `scripts/spherefold-radius-sweep.harness.ts`'s own parameterized copy of
    `runEscapeOrbit`, written for fr-qi9c's sheet and pinned at the classic
    lengths before any of this existed, agrees bit-exactly over 12k queries
    including a two-link chain whose links carry DIFFERENT radii.
    ONE-LINK, UNSYMMETRISED SYSTEMS ARE BIT-IDENTICAL to fr-kltj's loop
    (pinned in `escape-de.test.ts` against a frozen copy of it), and
    fr-s04t carried the cycle into the two shader mirrors, so a CHAIN now
    renders what this module estimates on every path: GLSL as one
    `uEscM`/`uEscT`/`uEscParams` slot per link (24-slot cap, the descent's
    own — and the mode's, since eligibility is one answer for both
    engines), WGSL as one `GpuMap` per link on the maps storage binding.
    `EscapeDE extends EscapeLink` survives as the head link's flat wire,
    now frozen layout ballast nothing reads to render. The rendered set is the MANDELBROT-form set — the
    per-iteration offset is the QUERY POINT (fr-7u8t.8), which is what
    makes it the object published Mandelbox renders show. fr-kltj had
    shipped the Julia form (offset = the document's `t`), and it rendered
    a near-SPHERE: 89.4% of the bounding ball non-escaping at the bench
    fixture's own constant, against the shipped form's 3.5%. `t` survives as the PRE-fold offset — a live
    deformation knob, classic Mandelbox at `t = 0` — so the mode still
    adds NO document state and stays a render MODE over the existing
    vocabulary (morphs/mutations/persistence untouched). The Julia form
    was measured, not merely argued away, and lives on as a local in
    `scripts/escape-form-sweep.harness.ts`: at weight 2 it fills
    87.2 / 71.8 / 32.6 / 2.1 / 0.005% of the bailout ball as |t| runs
    0.5 / 1 / 1.5 / 2 / 2.5, so it does not merely thin late — it goes
    from a third of the ball to a measure-zero dust in one step, with no
    usable band in between, and is a pitted ball even at its best. It does
    not earn the permanent document flag it would cost.

  - `escape-de-4d.ts` — the escape-time chain's 4D half (fr-vag4), for the
    systems whose maps reach out of the `w = 0` hyperplane. Everything
    structural in `escape-de.ts` is dimension-free and carries verbatim —
    cycling, the per-link `+ p`, the shared scalar `dr` with its `+ 1`
    floor, the bailout radius, `ESCAPE_STEP_SCALE`, both estimate forms —
    so this module duplicates only the maps' ARITHMETIC (`variations4.ts`'s,
    bit-exact against the 3D forms at `w = 0`) and IMPORTS every constant
    and link code from its twin: what a chain IS has one definition.
    `qsquare` becomes the FULL quaternion square, whose `2|q|` stays EXACT
    rather than heuristic because quaternion norms multiply on the whole
    algebra — which is the point of the lift, since `variations4.ts` calls
    that map "the only entry whose 4D form is the DEFINITION and whose 3D
    form is the restriction". THREE REFUSALS, each with its own reason: a
    `bulb` link (`bulb-de.ts`'s model refusal, unchanged by dimension —
    triplex numbers have no fourth component, so a lifted triplex power
    carries `w` untouched and its `dr` would be computed on the other
    three); a TWIST (a double rotation's fundamental domain is not a
    wedge, so there is no sector retraction — the `w`-PLANE it admits, and
    `foldQueryIntoSector4` folds all six); and a SLAB at any thickness (a
    forward orbit has no branch enumeration, so a segment straddling a box
    fold's wall maps to a bent polyline in one step — `surface-de-4d.ts`'s
    `slabExact4` refusal for a stronger reason no fold kind escapes). The
    anchor is pinned with `toBe` and its one seam disclosed: the AFFINE
    composition paths agree to ULPs and not to the bit once a transform
    rotates, which is `affine4.ts`'s own rounding and predates this file.
    Oracle for `surface-de-gpu.ts`'s `core: "escape4"`; NO fragment
    mirror, so an escape-shaped 4D session is compute-only exactly as
    fr-rsp6 made fold-shaped ones. THREE PRESETS reach it, from the 4D
    menu group rather than the Escape-time one: `mandelboxBrick` and
    `mandelboxColumn` are the same map (`mandelboxCube`'s) turned in `xw`
    and in `yw`, a PAIR whose subject is that the rotation plane picks the
    long axis — per-axis extents 3.13/2.00/2.00 against 2.00/2.49/2.00
    against the 3D cube's 2.00/2.00/2.00, which is a 4D rotation legible
    as a 3D proportion, and the one place the rotor slider reads as
    geometry rather than as a tumble (an `xw` pose rotor CANCELS the
    brick's own `xw` and hands back exact cube proportions) — and
    `hybridChainShells` is `hybridChainQuaternion` with the rotation on
    its POWER link, the one link position that costs essentially nothing
    (43.7% of rays against the 3D twin's 47.9%, where the same rotation
    on the head link costs a third of them).

  - `qjulia-de.ts` — the quaternion Julia set's CPU oracle (fr-7u8t.4):
    `q <- q^2 + c` (Hart/Sandin/Kauffman 1989) in the project's own
    vocabulary, since `q^2 + c` is conjugate by translation to `(q + c)^2`
    — i.e. `variations.ts`'s `qsquare` with the transform's translation as
    the Julia constant. `analyzeQJuliaSystem` gates, `buildQJuliaDE`
    builds, `estimateQJuliaDistance` returns the Böttcher log form
    `0.5·|y|·ln|y| / dr`. The only CERTIFIED estimator in the escape-time
    family (quaternion norm is multiplicative, so `|dq'| = 2|q|·|dq|`
    EXACTLY, where the folds' and the bulb's are heuristics) and the
    cheapest thing the marcher has ever run — 0.059 us/eval against the
    shipped fold's 0.633, at step scale 1.0 with 0.00% measured overshoot.
    NO RENDERER READS IT, deliberately: it is production-dead by the
    verdict of `scripts/qjulia-beauty.harness.ts`, whose twenty panels
    across rotations, rotor-posed slices, non-zero `w0` and several
    constants are all SMOOTH — shells, whorls and blobs, handsome and
    entirely without fractal detail — and whose zoom sheet resolves
    nothing new at three levels on four systems. Surface mode's central
    promise is that zoom keeps resolving; for this object there is
    nothing there to resolve, which is why fr-7u8t.5 (the WGSL/GLSL
    cores) and fr-7u8t.6 (the 4D lift, the only cut that is NOT a solid
    of revolution — tested among those panels, and smooth too) are CLOSED
    won't-do along with their epic. The module stays for two reasons: it
    is the executable record of the measurement that refused them, and
    it is where the quaternion square's EXACT `2|q|` derivative lives —
    which fr-j231 CASHED IN: the map is now a chain LINK on the escape
    core, needing neither its own kernel nor its own 4D lift, and the
    `hybridChainQuaternion` preset renders it. So this module's own
    prediction came true — the object that is dull alone earns its place
    composed with a fold — while the module stays production-dead in the
    literal sense that no renderer calls `estimateQJuliaDistance`: the
    chain reads the map in `v` space with the linear-or-Böttcher form
    `escape-de.ts` picks, not this file's `y`-space estimator. Its
    step-scale and bailout numbers are still ITS object's, not a
    hybrid's.
  - `bulb-de.ts` — the Mandelbulb's CPU oracle (fr-7u8t.7), third object in
    the escape-time family beside the folds and `qjulia-de.ts`: the triplex
    8th power (`variations.ts`'s `bulb`) iterated in the MANDELBROT form
    fr-7u8t.8 established — `v <- V(Mv + t) + p`, `t` the pre-power offset
    and a live deformation knob, no document state. `dr` seeds at
    `sigma_max(M)` (not 1 — `dy0/dp` IS `M`) and its trailing
    `+ sigma_max(M)` is `escape-de.ts`'s `+ 1` carried through `M`: exact,
    and load-bearing as a FLOOR, since `8|y|^7` shrinks wherever `|y| < 1`,
    which is most of the interior. Estimate is the Böttcher log form off
    `|y|`, never `|v|`, with the `ln|r|` clamp below 1 (a negative DE
    marches backwards). A HEURISTIC unlike the quaternion square: the
    triplex power stretches azimuthally by `8r^7·|U7(cos θ)|`, up to 8x at
    the poles, so `dr` under-estimates there — yet MEASURED step scale 1.0,
    because damping does not clear that residual (it lives in the boundary
    shell) and at frame level the full step loses no geometry. 0.29 us/eval,
    3.5x CHEAPER than the fold mode that already ships, refuting the bead's
    own prediction. `scripts/bulb-preview.harness.ts` is its sheet;
    mirrored by the `SURFACE_BULB` GLSL variant
    (`surface-material.ts`) and the `core: "bulb"` WGSL kernel
    (`surface-de-gpu.ts`) since fr-7u8t.9, bench-pinned by the
    `bulb-forward` eval leg. ROUTED since fr-tdin: `analyzeBulbSystem` is
    the third arm of main.ts's flat surface path (beside
    `analyzeSurfaceSystem` and `analyzeEscapeSystem`), the compute
    renderer's `{kind:"bulb"}` target and the `SURFACE_BULB` GLSL
    fallback carry it, and the `mandelbulbClassic`/`Offset`/`Rotated`
    presets reach it from the Escape-time menu group. Since fr-j231 the
    same map ALSO rides the escape CHAIN as a link (`ESCAPE_LINK_BULB`),
    which is why `analyzeEscapeSystem` refuses a LONE triplex power: this
    module's estimator is the better one for that shape (y space,
    `dr` seeded at `sigma_max(M)`, the Böttcher form) and its gate must
    stay the only one that admits it. Two links is a chain, and the
    chain reads the map in `v` space with the literal `+ 1` instead —
    the same recurrence in different coordinates, and the one thing a
    mirror must be deliberate about.
  - `types.ts` — type vocabulary: `Transform`/`Transform4`, `Vec3`/`Vec4`,
    `Bounds`/`Bounds4`, `WExtension`; `VARIATION_TYPES`/`COLOR_MODES`/
    `FOUR_D_COLOR_MODES`/`SYMMETRY_PLANES` const arrays (single source of
    truth). `Variation` is `{type, weight}` plus — since fr-s9ll — the fold's
    three optional lengths `minRadius`/`fixedRadius`/`boxLimit`, the FIRST
    per-variation parameters in a document every other producer treats as a
    type -> weight MAP; they deliberately break that model rather than
    pretending to fit it (each belongs to two of the seventeen types and the
    rest ignore all three), and ABSENT MEANS THE CLASSIC MANDELBOX VALUES
    (0.5, 1, 1) BYTE-IDENTICALLY — the `weight`/`colorIndex` convention, and
    what keeps every existing document, preset, morph and `.flame` import
    unmoved. There is no fourth SIZE field on purpose: only two dimensionless
    ratios of the three lengths are new shape (fr-qi9c), because a uniform
    rescale is equivariant through both folds and is therefore already what
    the transform's own affine part does.
  - `variations.ts` — seventeen nonlinear flame variations as pure functions:
    a dozen classics, the Mandelbox fold family (`boxfold`/`spherefold`/
    `mandelbox`, fr-p7nu), and the two escape-time POWER maps — `qsquare`
    (fr-7u8t.3, the quaternion square) and `bulb` (fr-7u8t.7, the
    White/Nylander triplex power). Those two exist so their renderers can
    gate on a document shape, and since fr-j231 they are also CHAIN LINKS:
    `escape-de.ts` admits either beside a fold, which is what makes the
    seventeen-variation vocabulary compose instead of merely coexist.
    `bulb` is the triplex
    8th power, `triplexPow8`: a TRIG-FREE closed form via the Chebyshev
    `T8`/`U7` polynomials plus de Moivre, an exact rewrite of the
    `acos`/`atan2`/`sin`/`cos`/`pow` one at 6e-14 and ~11x cheaper. The
    power is baked in because triplex multiplication is not associative —
    `p^8` is NOT `((p^2)^2)^2`, which disagrees on 48.8% of queries — so
    every power would need its own closed form. `composeVariations` blends
    a transform's weighted list.
    THE FOLD'S THREE LENGTHS ARE AUTHORABLE since fr-s9ll, and this module
    owns what that means: `resolveFoldRadii` is the ONE place the
    "absent means classic" rule and the domain live (`fixedRadius` below a
    floor falls back to 1, since `fR² = 0` would divide by zero against this
    module's stated totality guarantee; `minRadius` clamps into
    `[fR·1e-6, fR]` — the upper end is the fold's own domain, where the mid
    shell closes and the fold is exactly the identity, and the floor is
    RELATIVE so the rescale equivariance survives; `boxLimit` 0 is KEPT, the
    point reflection `t -> -t`). `isClassicFoldRadii` recognizes the default
    set and `foldVariationFn` then returns the SHARED classic entry, so an
    unparameterized document runs the same function object it always ran
    rather than merely computing the same numbers. `sphereFoldLipschitz` is
    the magnification `fR²/mR²` — tight, and the expression BOTH surface
    gates multiply through.
  - `variations4.ts` — same variations lifted to 4D, bit-exact at `w = 0`.
    Duplicates the fold ARITHMETIC under the twin-file convention but
    IMPORTS `resolveFoldRadii`/`isClassicFoldRadii`: what an absent field
    means must have one answer across both dimensions, or a 3D system and
    its 4D lift would render different objects (pinned — at `w = 0` the 4D
    fold is bit-exact against the 3D one at NON-classic radii too).
  - `vec.ts` — `clamp`, `clone3`, `to255` helpers.
  - `voxel.ts` — solid render: `accumulateVoxels` → 3D density grid →
    `voxelTextureData` (RGBA8 volume). `buildColorModeLUT` reuses `color.ts`.
  - `voxel-4d.ts` — 4D twin; slices with `0` floor (not flame's `0.06`).
- **`src/app/`** — Three.js + DOM glue. Vite root (`root: "src/app"`).
  - `scene.ts` — Three.js wrapper (scene, camera, renderer, point cloud, guide
    boxes, fog). Three.js confined to this file, `interactions.ts`,
    `voxel-material.ts`, `surface-material.ts`, and `surface-material-4d.ts`.
    `setRightInset` aims
    projection clear of the desktop panel. Captures:
    `captureFrame`/`captureSolidFrame`/`captureSurfaceFrame` render at export
    scale (clamped to device limits + 8192px); flame accumulates at export size so
    `captureFlameFrame` reads native. Renders on demand via `needsRender` flag.
  - `orbit.ts` — spherical orbit-camera math (pure, tested).
  - `camera-tween.ts` — three mutually exclusive camera motions (pure, tested,
    injected clock): smoothstep GLIDE (auto-frame on load), exponential CHASE
    (follow morphing bounds), directed POSE GLIDE to a saved `CameraPose`
    (moves theta/phi, nearest-turn). All honor reduced motion.
  - `framing-bounds.ts` — trimmed-quantile bounds (`frameBounds`/`frameRadius`)
    computed worker-side so nonlinear outliers don't inflate fits. Raw `bounds`
    still used where every point matters (color normalization, culling). Pure, tested.
  - `morph-tween.ts` — replace-load morph driver: per-frame `lerpSystem`
    sampler with pinned seed; main.ts streams intermediates sized by
    `morph-budget.ts`, sends real request on terminal sample. Configurable
    duration. Pure, tested.
  - `morph-budget.ts` — adaptive intermediate point budget: EMA of per-point
    cost sizes each intermediate to ~one frame's chaos game, clamped
    `[MIN, MAX]`. Morph Detail select trades smoothness for density. Pure, tested.
  - `mutation-thumbs.ts` — mutation grid thumbnail renderer: canvas-free
    chaos-game scatter into RGBA buffer, fixed oblique view, additive
    per-transform color. main.ts owns the 3x3 modal grid. Pure, tested.
  - `drift.ts` — ambient "Drift" show: dwell/advance state machine (injected
    clock), fires Surprise-Me rolls or saved-scene legs. Can HOLD awaiting an
    external signal (render convergence). Session-only, stops on user edits.
  - `drift-policy.ts` — show stop/advance conductor: guarded `stop()` (no-op
    during own leg or while idle) + `advance(launchLeg)` with own-leg guard.
    `ConductableShow` surface shared by drift and timeline player. Pure, tested.
  - `build-replay.ts` — "Watch it build" replay: timing/phase state machine
    (hop -> accrete -> spotlight -> done) revealing the cloud in generation
    order. Spotlight tours base maps one at a time. main.ts overlays a
    temporary showcase (By Transform color, guides visible, auto-orbit).
    Pure, tested, injected clock.
  - `background.ts` — the scene backdrop (fr-5ps1): `BACKGROUND_MODES`
    vocabulary (dark/haze/auto/custom, extensible for fr-4vi7's curated
    presets); `resolveBackground` is the ONE mode→(top, bottom) definition
    every renderer/capture/compute-spec path shares. `"auto"` (fr-mz2u) is
    the palette-linked backdrop: `autoBackground` darkens two
    `buildPaletteLUT` samples into disjoint luminance bands
    (`AUTO_BACKGROUND_TUNING` pins the curve; legacy/no-gradient palettes
    keep dark), `state.ts`'s `activeScenePalette`/`resolveSceneBackground`
    pick the tracked palette per render mode (coarse on purpose), and
    main.ts's `trackAutoBackground` re-derives on palette edits and
    render-mode landings — persisted as the MODE alone, never baked colors.
    `lerpBackground` + `BackgroundTween` are the replace-load
    crossfade, a fourth motion beside the system morph/camera/4D rotor
    glides. Persists via `persist.ts`, whose decoder doubles as the legacy
    migration (absent field + aerial style → haze). Pure, tested.
  - `exposure.ts` — `glowExposure`: density-adaptive brightness for the
    `"glow"` render style (not the flame tone-map). Pure, tested.
  - `resolution-governor.ts` — adaptive resolution: frame-time ladder (EMA +
    hysteresis) trades pixels for frame rate; a parked still restores to full
    after ~2s quiet (fr-vxbo, render-on-demand starves the sample stream).
    Exports/flame stay unscaled. Session-only `adaptiveResolution` opt-out.
    Bypassed in surface mode (render-tier.ts owns that cost). Pure, tested.
  - `render-tier.ts` — surface-mode interaction tier (fr-5ne3): invalidated
    frames trace a cheap preview into an offscreen target at an adaptive
    (scale, depth) rung picked from measured trace cost (fr-hith:
    `createPreviewGovernor`, EMA + hysteresis + a ≥250ms panic drop; starts
    at the shipped 0.3, climbs to full scale on capable GPUs — 4D
    auto-tumble sessions, which never settle, now sharpen instead of
    staying pinned soft; depth couples to scale via `previewMaxDepth`, the
    fr-ttg5 contraction-aware clamp, so finer rungs trace deeper and the
    core-ball bug cannot return in adaptive form). March/shadow/AO budgets +
    hit floor per tier — uniform writes only, shader bodies untouched; hit
    ACCEPTANCE is tier-independent (fr-7xgi: `uAcceptPixelEps`, the settle
    frame's pixel footprint, drives the hit test/grid proof/DE cutoff in
    every tier — a preview coarsens sampling, never acceptance; the
    buffer-scaled eps had rendered fold-DE plateau bands as phantom box
    faces at coarse rungs); after `TIER_SETTLE_MS` of quiet the full-quality
    frame renders as an interruptible strip job (see `strip-planner.ts`).
    The ladder's 0.1/0.07 emergency rungs (fr-du81) exist for fold-frontier
    DEs — each buys ~2x fewer rays AND a shallower depth clamp.
    Capture/offline
    `force` frames stay full. Pure, tested, injected clock.
  - `strip-planner.ts` — adaptive scissor-strip sizing for EVERY WebGL surface
    trace (fr-tzdg's compute path bounds its own submissions instead),
    previews included (fr-sjff; fr-du81 removed the preview tier's
    one unbounded draw — the i915-preemption GPU-hang path that killed
    fold sessions outright). Units are PIXELS, not rows (fr-096u): a strip
    is a row-major pixel interval rendered as 1-3 scissor rects under ONE
    fence, so fold strips shrink below a row's cost. The probe is sized
    from a per-px cost prior — the measured preview cost when one exists,
    else a pessimistic fold-class prior, else the legacy rows fraction for
    affine (the unprimed 3-row probe at full resolution was fr-096u's
    kernel-confirmed i915 preemption hang) — then strips scale toward a
    per-tier `targetMs` of measured GPU time each (forced-completion 1x1
    readback — NOT `gl.finish()`, which some command-buffer paths return
    from before execution). Measurement scaling is blind to the fold+grid
    frames' 100-1000x cheap/expensive band bimodality, so every strip is
    ALSO capped at `STRIP_WORST_CASE_CAP_MS` of worst-case predicted cost.
    The price starts at a class-pessimistic ms/px, RATCHETS up as the
    job's own measurements reveal worse pixels, and chains across job
    re-arms via scene.ts with evidence semantics: a COMPLETED job's
    whole-frame observation REPLACES the floor in both directions (x10
    tier-gap safety) — down matters, or a measured-cheap fold system
    (lens over affine) stays pinned at class-floor micro-strips whose
    readback overhead dissolves its settle and poisons the cost gate —
    while partial jobs only raise. Iris measured the mandelboxKifs band
    at ~40-125ms/px with single crease pixels of 1.7-3.1s, so
    post-discovery strips pin at ~1px there, and evidence relaxation
    lives exactly ONE completed-preview->settle handoff (a superseded job
    = the pose moved on = stale evidence dies; a far-pose glide preview
    once relaxed the floor under a parked monster pose).
    fr-id9r closed two remaining holes in that chain: measurements now also
    reach the ratchet through a measurement-time `observe(ms, px)` door, since
    `next()`'s sizing-time door only hears a measurement if another strip is
    still to be planned — a job's LAST measurement (final batch, final drain
    strip, an escaping sync-collapse strip) never reached it, and capture
    frames' final strips are the bottom rows, fold monsters' favorite home.
    The pipelined refill ALSO now bounds its in-flight queue at a queue price
    (the evidence chain on TYPICAL-cost class floors — the fold PRIOR, not
    the fold WORST constant, which rAF-dripped a fresh fold session's first
    preview through its queue at ~10x its real wall — raised live by the
    job's own ratchet, capped at one `STRIP_WORST_CASE_CAP_MS` of mispredicted
    work), so an est-lagged cost-band entry can no longer stall the main
    thread behind seconds of queued monster pixels (was ~3s per crease pixel,
    ~46s at parked monster poses; now ~one worst-capped strip beyond the one
    executing). Measured, Iris Xe real driver: a 180s mandelboxKifs run now
    completes 360/360 responsiveness pings with 0s stalled, kernel silent;
    lens settle 0.87-1.0s; escape 48ms; boxfold settle 793ms vs 212ms at the
    fr-096u tip — the accepted cost: the queue-priced first preview paces
    slower pre-evidence, so its inflated evidence over-strips the settle that
    follows (a documented residual). scene.ts's
    strip pump is PIPELINED (fr-096u's A/B verdict): every sync point on
    the Iris/ANGLE stack costs ~66-90ms REGARDLESS of the work behind it
    (`SURFACE_STRIP_SYNC_TAX_MS` — main's 3.3s lens settle was ~50 strips
    x that tax, and the branch's first per-strip-join cut multiplied it
    by the caps' strip count into a 15x regression), so strips go out as
    individually FLUSHED draw groups (the watchdog's preemption
    boundaries) fenced only per ~`SURFACE_STRIP_FENCE_GROUP_MS` of
    predicted work, batch measurements subtract the tax to price MARGINAL
    trace work (leaving it in re-inflated the evidence 5x -> tighter caps
    -> more strips -> more tax, a vicious cycle), strips of a row or more
    row-snap to a single scissor rect (a ~20-30ms per-DRAW fixed cost
    tripled under 3-rect strips), and the canvas blit rides
    PRESENT-ON-DRAIN gaps (presents share the strips' GL queue; the first
    pipelined cut presented behind the queue and stalled the page's own
    rAF). No-prior jobs (affine) keep the legacy sync-collapse: serial
    joined strips completing whole light jobs in one call, escaping to
    the pipeline past `SURFACE_STRIP_SYNC_ESCAPE_MS`.
    Capture/offline export runs the SAME pump (fr-y6m0). Those drains used
    to join every strip themselves — the pre-fr-096u shape in export
    clothing, multiplying the sync tax by the planner's strip count. Both now
    loop the pump and differ only in how they WAIT between calls — the
    synchronous one (offline export, thumbnails) blocks on ONE whole-queue
    readback per queueful, the yielding one (fr-7mfx's Save-PNG) hands the
    main thread back on rAF (timer-backstopped at a frame, because a page
    whose frame clock runs slow starves the queue — headless SwiftShader
    serves rAF at ~10Hz; a bounded macrotask spin when the page is hidden,
    where rAF stops and timers throttle), so a cancel now lands within a tick
    instead of behind a multi-second crease strip. A
    capture job never presents (the export-scale target must not reach the
    canvas), ADOPTS the fence backlog like the live jobs (a pipelined refill
    has to price the real GL queue), and winds its own queue down before
    returning from an abort so no export leftovers outlive the export.
    The synchronous drain retires its fences WITHOUT polling them, straight
    after its readback: that readback is the stronger barrier, and a sync
    object's signaled state is only refreshed on the page's message loop, so
    a loop that never yields reads TIMEOUT_EXPIRED forever and spins on a
    queue the GPU finished long ago (measured: a 4.3s thumbnail became a
    300s hang with `spentMs` frozen at 0, so even the spend ceiling could
    not end it). MEASURED A/B, SwiftShader, same pose and build otherwise:
    at 1280x720 on a pose neither path can finish, the live settle covered
    38% of a 60s window in both arms while the capture went from 0.4% to 15%
    (~37x); on a cheap 900x560 frame the live settle finishes in 2.6s, where
    main's Save-PNG burned the whole 60s spend ceiling and refused to
    produce a PNG at all — the fix delivers it in 4.7s, cancels in 0.9s
    (main: 2.2s), and renders the collection thumbnail through the sync
    drain in 2.5s (main: 4.3s parked, 6.8s after a drag), byte-identical
    image. `scripts/capture-export.verify.mjs` is that gate;
    `scripts/capture-drain.verify.mjs` is the measurement harness beside it.
    Cost ceilings are the SYNCHRONOUS drain's alone since fr-avf6 — offline
    export and thumbnails, the callers that freeze the tab for a frame's
    whole duration and offer no way to stop it. There, measured evidence
    predicts the frame up
    front — never the class prior, which would refuse every fold export
    sight unseen — and refuses past `SURFACE_CAPTURE_PREDICT_CEILING_MS`
    (120s); the drain itself aborts past `SURFACE_CAPTURE_SPEND_CEILING_MS`
    (60s) of real spend; both throw `SurfaceCaptureCostError` — the offline
    exporter fails the run, the thumbnail path falls
    back to the explorer render. The ceiling's currency changed meaning with
    the drain: `spentMs` is batch-attributed busy wall with the sync tax
    subtracted, so the same 60s now buys tracing where it used to buy joins.
    The INTERACTIVE Save-PNG is refused nothing. Its modal discloses
    measured coverage, its Cancel works, and the drain yields — so a
    prediction (measured ~4x high) deciding for the user is the
    patience-guessing fr-zx34 already reverted for the preview tier, one
    render mode over, and its WebGPU arm had never done it anyway. "Render
    anyway" went with the refusal it escalated past.
    Capture observations raise-only into the
    evidence chain without killing it — the pose hasn't moved, so live
    settle/preview evidence stays valid, and the drain's export-scale
    observation may only tighten that floor, never own it (a
    micro-strip capture priced at pure readback overhead would otherwise pin
    the next settle to dissolved micro-strips). One exception, fr-y1m7: a
    COMPLETED capture may SEED an EMPTY chain, because offline export is the
    one caller that never fills it otherwise (a system upload clears it,
    force frames bypass the preview) — so every frame of a fold-scene video
    priced its queue at the class prior, ~100x above its own pixels, and
    paid a join per ~400px. Seed, never replace, and safe in the direction
    it can be wrong: a capture traces the WHOLE frame at its armed pose, and
    an export-scale trace resolves finer pixels than the live tier, so it
    reads HIGH. fr-24to asked for a
    runtime-mode verdict on monster-pose previews: the floor-rung preview
    at mandelboxKifs's entry ran past 210s/4500px, no terminal state, settle
    never arming. A mode bail and a sub-floor rung were rejected (pose-local
    cost, ~2x/rung against a >=50-150x gap). Two rounds of budget/prediction
    truncation shipped, then REVERTED (fr-zx34): both clipped a completable
    heavy-lens preview, the first a 20-map Menger-lens preview 62% done
    with ~2.5s left. Final verdict, the user's: no automatic give-up —
    `surfaceRenderProgress()` + the surface progress row ("Preview 43%" /
    "Full detail 0.4%", one decimal under 10%, hidden when idle; since
    fr-tmgf the label names its engine — "· WebGL" / "· WebGPU", the
    compute side fed by onProgress ray tallies) disclose
    honest coverage and the user decides; at true monsters the preview may
    grind minutes, settle never arming, safely (120/120 pings, 0s stalled
    — the bounded-strip pump, not truncation, carries safety). Save-PNG's
    refusals gained the "Render anyway" opt-in (300s consented backstop),
    and fr-avf6 later retired both: once the export modal disclosed coverage
    and Cancel worked, the refusal was guessing at a patience the user was
    already expressing. Measured A/B (Iris, real driver, `?surfacegl`): lens-system
    settle 2.5s vs main's 3.2s (total-to-settled 6.8s vs 7.4s), boxfold-pair
    settle 0.2s, escape 45ms — at full safety caps, kernel-silent through
    every monster run. The settle always ARMS, however expensive the frame —
    bounded strips grind visibly and interruptibly (an early fr-096u cut
    gated it on predicted cost and silently blanked legitimate lens
    settles into permanent preview blur: a silent refusal reads as a
    broken render); the same never-refuse discipline now covers the
    preview too — it always runs to completion, with progress
    disclosed rather than bounded. fr-ud7n carried that line across the
    WebGPU seam, where all three affordances had been missed. A compute
    preview is wall-budgeted (main.ts's
    `SURFACE_COMPUTE_PREVIEW_BUDGET_MS`, 2s) so the rung ladder can learn
    during motion — legitimate, and unchanged — but at the FLOOR rung a
    truncated frame was the preview's LAST word: nothing cheaper to drop
    to, so the loop drained and the settle fired over a mostly-backdrop
    pane, undisclosed and unskippable. The budget stays a MEASUREMENT
    device; what changed is the terminal state on a parked view, where a
    floor-rung truncation now re-runs the same rung UNBUDGETED to
    completion — progressive presents, "Preview · WebGPU N%" in the row,
    Skip button live (`skipSurfacePreviewNow`'s compute arm already
    implemented the handoff; only visibility was missing). Bounded
    submissions, not the budget, carry watchdog safety — the settle is
    equally unbudgeted. MEASURED (Playwright Firefox 151 WebGPU,
    ~10-20x slower than Chrome's, 1920x1057, the reporter's 20-map
    Menger + mandelbox fold lens + balloon): two 2.1s truncated floor
    previews resolving 5% of their 9916 rays, then a completion pass
    resolving all of them in 13.8s and disclosing 3.9% -> 97% while it
    did, where the settle behind it was still at 48% after 179s — ~4% of
    the wall for the only whole image of the first several minutes.
    `scripts/surface-preview-completion.verify.mjs` is that gate, Firefox-
    shaped by necessity: Chrome's preview completes inside the budget, so
    the bug is device-speed-dependent (slow adapters, software devices,
    big viewports), never browser-specific. The STRIP path had the mirror
    hole (fr-nl32): `renderSurface("preview")` ARMS a fresh job, so
    re-arming per invalidation discarded the in-flight partial, and on any
    renderer where a preview spans frames the job died before it could
    present — a continuous drag painted essentially NOTHING for its whole
    duration (measured under SwiftShader at a 100ms move cadence: 6s of
    drag, 13 of 15 samples byte-identical at jpeg 69360 with the row
    reading "Preview · WebGL 0%" and previewActive true throughout. The
    two exceptions are the mechanism caught in the act: one sample found a
    job at 19%, and the next — 175ms later — was 0.3% larger and back at
    0%. ONE partial strip present in six seconds, and the job that made it
    re-armed away before it could finish). main.ts's
    tick now COALESCES like the compute loop: while a job is in flight an
    invalidation steps it instead of re-arming, and stays latched in
    `scene.needsRender` so the next arm takes the freshest camera.
    Pose coherence is free — `armSurfacePreview` snapshots the camera into
    uniforms, so a multi-frame job traces ONE pose — and a device that
    completes a preview inside its arming call never reaches the branch.
    `scripts/surface-tier.verify.mjs`'s mid-drag softness check is that
    gate: it had been failing at jpeg ratio 0.99-1.00 (the mid-drag frame
    was the SETTLED one, unchanged) and reads 0.83 with the coalescing.
    Fold surface sessions also
    gate their first frame on `compileAsync` of the fold tracer program
    (~25s links happen off the critical path where the driver offers
    `KHR_parallel_shader_compile`; the compile mesh MUST mirror
    FullScreenQuad's position+uv triangle or the draw links a second
    program variant, and the gate defers activate()'s guide/selection
    refresh so no other re-link joins the driver's compile queue behind
    the fold program). Pure, tested.
  - `state.ts` — `AppState` + pure reducers (pure, tested).
  - `persist.ts` — encode/decode scene to `#v1=<base64url>` hash + localStorage.
    Strict never-throwing decoder. Document carries optional `CameraPose` and
    optional `FourDPose` (rotor pair + w-slice; malformed quietly drops to
    `undefined`). Undo snapshots stay camera/pose-less (history.ts dedupes by
    string equality). A variation's three optional fold lengths (fr-s9ll)
    encode only when present and finite — an unparameterized document is
    byte-identical to one predating them — and decode with two deliberate
    deviations from this file's other optional numbers, both documented at
    the function: NO `Number()` coercion (a numeric string or boolean drops
    rather than becoming a radius) and NO clamp, since the domain belongs to
    `variations.ts`'s `resolveFoldRadii` and persist's job at this leaf is
    fidelity.
  - `viewer-prefs.ts` — per-browser preferences under their own
    `fractal-viewer:prefs` localStorage key, deliberately OUTSIDE the scene
    document (fr-0ya): a pref belongs to the person at this browser, so it
    must never ride the `#v1=` hash a shared link carries. localStorage only,
    never the URL/hash/`history`. Never-throwing load with strict validation
    (`false` is a real choice and survives); writes go through
    `updateViewerPrefs` (merge over stored — a bare save of one field would
    drop the others). Two prefs: `autoMotion` — the shared 3D auto-orbit /
    4D auto-tumble choice, `undefined` = never chosen, so boot follows
    prefers-reduced-motion — and `surfacePreview` (fr-37c6) — the surface
    quick-preview tier on/off; `false` freezes the pane during motion and
    settles straight to full detail on park (both engines), the
    fr-24to/fr-zx34 no-patience-guessing line applied to the preview tier,
    with the progress row's one-shot Skip button as the in-the-moment
    escape (both engines since fr-ud7n). Pure, tested.
  - `history.ts` — session-only undo/redo stacks (pure, tested).
  - `edit-session.ts` — burst-coalescing over `history.ts`: one undo checkpoint
    per slider drag + debounced save. All effects injected; pure, tested.
  - `collection.ts` — persistent multi-slot scene library (localStorage).
    `after(id)` is the drift slideshow's loop cursor. Entries carry optional
    `SavedSceneMode` (on the ENTRY, never inside `encoded`). `importScenes`
    merges backups with dedup + fresh ids. `setThumbnail(id, …)` (fr-r777,
    and its `timeline.ts` twin) replaces ONLY the picture — not `add`,
    which would mint a fresh id and re-bump the entry to the front: a
    correction is not a new save, and the gallery must not reshuffle under
    a user who is only waiting for a render. Pure, tested.
  - `timeline.ts` — animation timeline document: ordered keyframe steps (frozen
    encoded scene + thumbnail + `morphMs`/`holdMs` + optional render mode).
    20-step cap (refuses, never evicts). `legSeed(seed, i)` for deterministic
    playback. Not references into the collection. Pure, tested.
  - `timeline-player.ts` — timeline playback clock: ABSOLUTE schedule against
    start, catch-up fires only LATEST due leg. `hold()`/`resume()` suspend for
    render keyframes (content-dependent realtime clip length). main.ts's
    `launchTimelineLeg` wires the morph + camera pose glide + 4D rotor/slice
    glide per leg. A second `DriftPolicy` conducts it. Export = same run with
    recorder rolling, or the offline path. Pure, tested.
  - `scene-file.ts` — JSON import/export: single-scene + collection backup +
    timeline backup sharing `{app, kind, version}` envelope. `decodeImportFile`
    is the never-throwing trust boundary (entries keep ORIGINAL encoded
    strings). Pure, tested.
  - `flame-file.ts` — flam3/Apophysis `.flame` XML codec (see
    `docs/flame-interop.md`). Import QR-decomposes 2D coefs onto our
    `Transform`, folds pure-linear blends/posts, degrades unsupported features
    to warnings; palette becomes 8-stop `CustomPalette`. Export writes XY
    shadow with kaleidoscope baked into explicit xforms. DOMParser-tied (jsdom
    tests). Pure, tested.
  - `ui.ts` — control panel + transform list (`createElement`). Accordion of
    `<details name="panel-section">` sections, remembers open section per
    render mode. Mode content above the accordion (undo row, render progress).
    A FOLD variation's weight row carries the lengths that fold actually
    reads nested under it (fr-s9ll: box limit for a box fold, the sphere
    pair for a sphere fold, all three for a mandelbox — fr-77oy measured a
    box fold's `mR`/`fR` as inert). Two rules keep `types.ts`'s
    "absent means classic BYTE-IDENTICALLY" true through an editing
    session: a length is written only once its own slider moves, and
    dragging one back to its classic value REMOVES it. The min-radius
    slider's ceiling IS the fixed radius and moves with it — the fold's
    domain `0 < mR <= fR` enforced in the row, so the readout is never a
    length `resolveFoldRadii` would silently clamp.
  - `control-spec.ts` — declarative spec for panel scalar controls. Adding a
    setting = one spec entry + one index.html row (pure, tested).
  - `constants.ts` — shared UI/interaction magic numbers.
  - `interactions.ts` — pointer/touch/wheel handling (Three.js raycasting).
  - `slider-scroll-guard.ts` — PREVENTS the panel sliders' tap-jump on
    touch since fr-xu4u, where fr-zoi repaired it after the fact (tested).
    The repair let the jump commit mid-gesture and fired `input` TWICE —
    two trips through burst coalescing, a possible history checkpoint and
    a cloud regeneration request, for a gesture meant as a scroll. The
    obvious prevention does NOT work and fr-zoi's own doc said it would:
    the jump is the TOUCHSTART default action (Blink's
    `SliderContainerElement`), not pointerdown's, so `preventDefault()`
    there leaves it — and STICKING, with the restore gone. Of four
    measured suppressions only one both kills the jump and keeps the pan:
    flipping `disabled` for that one handler, on in the pointerdown
    listener (dispatched before touchstart) and off in a `requestAnimation
Frame` callback, which runs before paint so the disabled look never
    reaches the screen. That kills the native drag too, so the guard now
    DRIVES it — past `SLIDE_SLOP_PX` of horizontal travel it maps x onto
    the track, quantizes to the slider's own `step`, and fires `input` per
    change plus the trailing `change` fr-2c27's commit-on-release sliders
    hang off (`numPointsSlider` defers its whole regeneration to it, and a
    programmatic `value` assignment fires nothing). TAP-TO-SET IS GONE ON
    TOUCH by design — on a panel of full-width sliders a tap that lands on
    one is a scroll that has not moved yet far more often than it is an
    edit — and desktop click-to-jump is untouched (mouse pointers return
    early). Verified on real Chromium via
    `scripts/panel-touch-scroll.verify.mjs`: `#fogSlider` HAZARD -> SAFE
    from both start positions, pan still -132px. Not verified on WebKit or
    Firefox Android.
  - `capture-cost.ts` — the arithmetic behind a capture's cost memory
    (fr-2q01), out of `scene.ts` so it tests without a WebGL context:
    `solidCaptureMsPerPx` and `predictCaptureMs`. The solid Save-PNG's
    modal is indeterminate (one synchronous raymarch reports no coverage
    and cannot be interrupted), so the only decision left is whether it
    skips the grace period — decided by `exportScale > 1` until this,
    which flashed it for ~270ms over a 274ms export. `scene.ts` keeps the
    clock and `solidCapturePxCostMs`, whose doc carries the invalidation
    rule: the voxel grid and the solid params stale a reading, and the
    POSE deliberately does not. The two errors are not symmetric — an
    under-prediction still arms the 400ms grace timer, so it costs one
    grace period, while an ABSENT reading falls back to export scale and
    flashes every time — so the field survives everything it plausibly can.
  - `main.ts` — entry point; wires state <-> scene <-> ui <-> interactions.
    `?surfacestate` publishes `window.__surfaceState()` (fr-opgk), the
    read-only settle latch `scripts/surface-repro.verify.mjs` — and any
    future visual-regression script — waits on: the surface renderer is
    bit-reproducible run to run once truly settled, PROVIDED the scene
    document pins its camera (a pose-less scene auto-frames from a
    `Math.random()`-seeded cloud and drifts ~0.3%/load, lighting up 1-9%
    of pixels).
    SAVE-PNG'S ARM IS THE RENDER MODE'S, FULL STOP (fr-61a2): a render that
    has not produced its picture yet is WAITED for behind the fr-7mfx export
    modal (`planPngExport`'s `awaitReady`, disclosed and cancellable), never
    swapped for the explorer's — `scene.captureFrame` is reached by being in
    points mode and by nothing else. Each arm used to read
    `renderMode === X && session.hasFirstFrame` and fall THROUGH to the point
    cloud when the gate failed, which the Export-size select reached on
    purpose: its effect restarts the flame session, so switching to 2x/4x and
    saving straight away downloaded the explorer. Flame's wait is the one
    that is not merely a startup gap — it waits for `renderComplete.flame`,
    the accumulation MEETING ITS BUDGET, because the flame canvas IS the
    export (fr-2urv) and the worker's finishing chunk re-filters the
    histogram adaptively (fr-17t) where every progressive frame uses the
    fixed-radius filter; a mid-accumulation PNG is a categorically coarser
    picture, not an early one. Solid and Surface wait only for their first
    frame — both produce the export at capture time by re-tracing.
    `notifyRenderSignal` (was `notifyOfflinePark`) is the shared wake:
    progress, a session's deactivate, a playback stop, an export's Cancel.
    THE FLAME WAIT HAS A SECOND EXIT since fr-2fbs: "Save now (rough)"
    beside Cancel, restoring the "save what is on screen" the pre-fr-61a2
    bug provided by accident, where the wait is longest (the budget scales
    with export AREA, so 4x multiplies it by sixteen). FLAME ONLY —
    solid's wait is the voxel grid with no partial to deliver — and
    enforced structurally: `planRenderWait` returns the
    awaitReady/deliverEarly pair and all three arms spread it, so no arm
    restates the rule and no future arm can offer the action by copying
    its neighbour. The press LATCHES and is honoured only once
    `hasFirstFrame`, which makes the feature "wait for the FIRST FRAME
    instead of the whole BUDGET" — without that latch a press in the
    Export-size restart gap delivered the PREVIOUS session's canvas at the
    PREVIOUS session's size, i.e. fr-61a2's own bug through the new door.
    Ties go to the BUDGET (the wait loop re-checks readiness before any
    stop check), so a press the finished render beat to the line gets an
    ordinary toast rather than one labelled rough. `cancelled` survives as
    `stop === "cancel"`, so callers predating the action are unmoved;
    Escape stays CANCEL-ONLY; and the button is ABSENT rather than hidden
    when not on offer, so nothing can Tab to it or query it.
  - `regen-scheduler.ts` — rAF coalescer: one generation request per frame.
  - `cloud-worker.ts` / `cloud-worker-core.ts` — point cloud generation worker:
    one-shot request/response, seeded chaos game, colors + 4D transforms
    baked worker-side.
  - `cloud-generator.ts` — main-thread cloud worker client: at most one request
    in flight, latest wins, OR-merges coalesced flags. Synchronous fallback if
    worker crashes. `settle()` for offline export. Pure, tested.
  - `flame-gpu-backend.ts` — drives flame WGSL kernels inside the flame worker
    behind `FlameAccumBackend` seam. Error-scoped resource creation
    (`FlameGpuSizeError`). `destroy()` defers the real `device.destroy()`
    until every in-flight op unwinds (fr-mxkk — `surface-compute.ts`'s
    fr-uec4 idiom one module over, counting OPS rather than frames, with
    the same `destroyed` = teardown REQUESTED / `deviceDestroyed` = device
    GONE split and the same inline teardown whenever nothing is in flight,
    which is what keeps the seam's `void destroy()` and gpu-bench's
    one-device-at-a-time invariant untouched). The hazard is routine here
    rather than exotic: every palette/supersample/symmetry edit reaches
    `startAccumulation`, which destroys the outgoing backend ON PURPOSE
    while a superseded `runChunk` can still be parked on `mapAsync` over a
    submitted copy. The ELEVEN explicit `GPUBuffer.destroy()` calls that
    ran AHEAD of the device are gone rather than reordered — two of them
    are the staging buffers a parked map holds a pending mapping on, an
    independent crash vector, and `device.destroy()` reclaims all eleven
    anyway — so the backend now holds only the buffers it TOUCHES (params,
    hist + staging, display + staging) and the rest live on their bind
    groups. `beginOp` refuses new work once teardown is requested, which
    is what bounds the drain to the ops already started; the only caller
    that can reach that refusal is a stale `runChunk` whose next
    generation check discards the result regardless. Lifecycle pinned by
    `flame-gpu-backend.test.ts` over a fake device (the class is exported
    for it); browser gate `scripts/flame-teardown.verify.mjs`.
  - `flame-worker.ts` / `flame-worker-core.ts` — flame render worker:
    `FlameWorkerSession` driving CPU or WebGPU accumulation; SAB fast path,
    transfer fallback. GPU failure recovery ladder: retry smaller -> fresh
    device -> CPU fallback.
  - `flame-perf.ts` — opt-in flame throughput diagnostics (`?flameperf`).
  - `voxel-worker.ts` / `voxel-worker-core.ts` — solid render worker (transfer only).
  - `surface-grid-worker.ts` / `surface-grid-worker-core.ts` /
    `surface-grid-client.ts` — empty-space-grid build worker (fr-55r5 part 2):
    one-shot `buildSurfaceGrid` request/response (transfer), latest-wins-by-id
    client with `settle()` for the offline exporter. One request per 3D
    surface-session enter (the session freezes its DE), NO sync fallback — a
    lost worker degrades to gridless (correct, slower) marching. Request
    `resolution` is a ceiling (fr-aj4w): the worker times a measured pilot slab
    and downshifts through a 64/48/32 ladder to stay under a 3s budget, floored
    at 32, never skipped; the result's own `resolution`/`halfExtent` are what
    was actually built.
  - `voxel-material.ts` — GLSL3 raymarcher `ShaderMaterial` for voxel volume.
  - `surface-slots.ts` — the two per-slot shading inputs every surface tracer
    takes (per-slot "By Transform" colors, orbit-trap palette coordinates),
    keyed on `baseIndex` into the DOCUMENT's transforms. Honors an authored
    `Transform.colorIndex` (fr-c6yd), else the surface's own even spread —
    pure, shared by `main.ts` and `gpu-bench/` so neither drifts from it.
  - `surface-material.ts` — GLSL3 full-screen-quad sphere tracer mirroring
    `surface-de.ts`'s `estimateDistanceRefined` line for line, the same
    oracle discipline as `flame-gpu.ts`; BASE maps packed into fixed-size
    (24-slot) uniform arrays, with kaleidoscope sectors swept from three
    scalar uniforms rather than expanded into slots (fr-x029), so symmetry
    order no longer counts against the cap. Callers gate eligibility on the
    bare active-map count first, so an over-cap count throws here rather
    than degrading silently. A fold FINAL lens compiles as the
    `SURFACE_FOLD_LENS` variant (fr-g58b): the preprocessor renames the
    descent bodies to `surfaceDECore`, the wrapper owns the public
    `surfaceDE` overloads (mirroring `descendLens`), and the cores' own
    `uFinal*` lens uniforms are packed IDENTITY — the wrapper applies the
    real lens from `uLens*`. The `SURFACE_ESCAPE` variant (fr-kltj)
    replaces the descent bodies wholesale with `escape-de.ts`'s forward
    loop (`setEscapeSystem` packs it; main.ts routes there when the IFS
    gate refuses but `analyzeEscapeSystem` admits — the FALLBACK since
    fr-dlxh, `surface-compute.ts`'s WebGPU renderer preferred whenever an
    adapter exists) — same marcher, tiers, strips, capture; no grid (its
    validity chain is IFS-specific). Since fr-s04t it CYCLES the whole
    formula chain: `uEscM`/`uEscT`/`uEscParams` are declared INSIDE the arm
    (the `SURFACE_BULB` precedent) as one slot per link, `uMapCount` is the
    link count, `uMaxDepth * uMapCount` single-link steps keep `uMaxDepth`
    meaning PASSES, and `uSymOrder`/`uSymPlane` drive `foldQuerySector` —
    the kaleidoscope's dihedral query-space wedge fold, applied once before
    the orbit. The 24-slot cap is the mode's cap (eligibility is one answer
    for both engines, and the compute arm's storage list has none).
    Since fr-j231 a link may be a POWER map, and the arm cost three
    things and no layout change: the fold pair's `kind != 2` / `kind != 1`
    tests are exhaustive by NEGATION over {1, 2, 3}, so kinds 4 and 5 sit
    behind a `kind < 4` GUARD rather than beside them (unguarded, kind 4
    satisfies both and runs both folds — the hazard `surface-de-gpu.ts`'s
    doc cites as why the Mandelbulb became a sixth CORE); `bulbPow8` is
    DUPLICATED from the `SURFACE_BULB` arm character for character,
    because the two arms are alternatives and neither can see a
    definition emitted inside the other (a test diffs the two bodies so
    the copy cannot drift); and `uEscLogForm` — a scalar, not the params
    tail that comment once reserved, because the estimate form is ONE
    number per CHAIN read after the orbit, and making it depend on which
    link happened to terminate would put a step across every boundary
    between the two forms. The hit-info trap gained a second interpolant
    for the same reason it had to: `log(r/R)/log(growth)` models
    constant-factor growth and a PRE-SCALED power link routinely has
    `growth < 1`, so the guard fired and the trap fell back to
    fr-7u8t.8's raw integer confetti; a power-terminated orbit reads
    `log(log r / log R)/log d` instead, off the DEGREE tracked beside
    `growth`. That cost the arm 8.3KB — escape 42.2 -> 50.5KB,
    escape+balloon 48.8 -> 57.1KB — so both still keep their comments.
    The balloon pairing is the one to watch: another paragraph or two puts
    it over the 64KB strip threshold, which is not a hazard (it strips to
    ~15KB, far under the 82.2KB that crashed Mesa) and is not even
    reachable in the app (balloon is IFS-only, fr-5wlv.4), but does mean
    the arm stops reading as source in a driver log. AND A PARAGRAPH DULY
    ARRIVED: fr-8fii's corrected clamp-cost record added ~1.7KB, so the
    measured sizes today are escape 52.3KB and escape+balloon 58.7KB —
    11.7KB and 5.3KB of headroom. Measure before adding the next one
    (`surfaceFragmentFor(escape, lens, balloon, plane, bulb).length`
    against `SURFACE_GLSL_STRIP_BYTES`); the affine/lens/balloon variants
    are unaffected because they strip unconditionally (28.1 / 27.8 /
    29.4KB), and `bulb` sits at 36.3KB. The `SURFACE_BULB` variant (fr-7u8t.9)
    is that arm's SIBLING and `resolveVariantArms`' fifth JS-resolved key,
    nested inside `SURFACE_ESCAPE`'s `#else` (the two are alternatives —
    each replaces the descent bodies wholesale, so `surfaceFragmentFor`
    refuses the pair): `bulb-de.ts`'s forward triplex-power loop, packed by
    `setBulbSystem`, whose `uBulb*` uniforms are declared INSIDE the arm so
    no other variant pays their bytes against the Mesa cliff (resolved
    source ~33KB against the descent variants' ~77KB). Since fr-tdin it
    is the FALLBACK arm for bulb sessions exactly as `SURFACE_ESCAPE` is
    for fold ones (`?surfacegl` / no adapter / device loss); the compute
    `core: "bulb"` kernel is preferred. The `SURFACE_GROUND_PLANE` variant
    (fr-rhn5) is `resolveVariantArms`' fourth JS-resolved key: an infinite
    one-sided floor below the session ball, lit by a `shadeGroundPlane`
    entry mirroring the WGSL arm term for term (penumbra shadow + AO under
    two analytic ball certificates, matte lighting, the shared fog
    formula), called from all three miss exits. It composes with every
    other variant except `SURFACE_BALLOON` (throws — no horizon inside the
    shell); off resolves byte-identical to the pre-plane build. On, it
    would have pushed the shared fold/affine source (~76.5KB shipped) past
    the measured ~80KB Mesa crash cliff (82.2KB observed), so plane
    programs resolve through `stripGlslSource` instead — a whole-source
    comment/indentation strip (the fr-zqu8 probe instance's mechanism,
    extended) emitting the identical token stream at ~30KB raw, the ~79KB
    lens variant included (29.6KB with the floor).
    SINCE fr-s9ll THE STRIP IS A SIZE RULE, not the plane arm's private
    habit: `surfaceFragmentFor` strips any resolved source past
    `SURFACE_GLSL_STRIP_BYTES` (64KB). The fold's authored lengths cost
    this file ~2.2KB — `uFoldRadii[MAX_MAPS]` inside the folds arm,
    `uLensRadii` beside `uLensParams`, `uEscRadii[MAX_MAPS]` inside the
    escape arm, a `foldRadiiOf` helper mirroring `surfaceFoldRadii` field
    for field, and longer expressions at the four inverse-branch sites and
    the escape arm's two forward folds — which took the BALLOON variant
    from 80.9KB to 83.1KB, i.e. past the size that crashed. Measured after:
    affine 74.6->28.0KB, lens 77.6->27.8, balloon 80.9->29.3, with escape
    (39.8) and bulb (34.1) keeping their comments. A size threshold is the
    honest predicate for a size cliff; a hand-kept list of which variants
    strip is what drifts the next time one grows a paragraph. NOTE the 4D
    fragment tracer needed no fold mirror at all — it carries no fold GLSL
    (fr-rsp6 made fold-shaped 4D sessions compute-only), so fr-3pcu's list
    of mirrors was one longer than the code.
    Orbit-trap color blends descent choices TOP-DOWN (depth-0 copy
    dominates, flam3's convention — fr-gt9i); the per-level decay is now the
    Color speed slider (default 0.5 = that original fixed behavior), and the
    rings/sheets orbit-trap color sources ride the same hit-info descent
    (fr-rl4b). The march samples `surface-grid.ts`'s floors (NEAREST 3D
    texture) before paying a descent (fr-55r5 part 2): a floor above the
    pixel epsilon (`uAcceptPixelEps`, fr-7xgi's tier-pinned acceptance eps —
    not the buffer-scaled `uPixelEps`) is both a no-hit proof and a safe
    stride, damped by the same `uStepScale` as analytic steps; gridless
    marching stays the
    always-correct fallback. Skips drain their own whole-ray cap
    (`SURFACE_GRID_SKIP_CAP`), never the analytic march budget, and the
    full-tier budget is 160 — fr-z70m: charging cheap conservative skips
    against 96 march steps starved rays that thread gaps or graze faces,
    dissolving far/threaded geometry into view-dependent dropout speckle
    (measured + healed in `scripts/erosion-repro.harness.ts`). The three
    shading taps (normal/shadow/AO) ride the value form, which fold
    systems route to `surfaceDEProbe` — a width-1 instantiation of the
    SAME fold-descent template (fr-zqu8, fr-p8bc's verdict on the
    fragment path; one text two names, march/hit acceptance stay width
    12). Measured on Iris (cold cache, `scripts/shade-width-ab.mjs`,
    `?surfshadewidth=N` A/B — N=12 disables the probe and reproduces the
    pre-change source byte for byte): the probe CUT the fold program's
    ~25s Mesa link 17.9x to ~1.45s — Mesa inlines the width-12 body per
    call site; with the probe only the march still does — dissolving
    fr-f21s's link-watchdog session-death lottery with it, settles
    boxfold pairs 509-987ms (baseline 695-1296ms) with frames identical
    within session noise, and resolves ~2.3x more mandelboxKifs frame
    per equal window (crease pixels stay march-bound; compute owns fold
    AND fold-lens sessions where an adapter exists, fr-tzdg + fr-55s1).
    The fold-lens variant deliberately carries no probe (its ~79KB source
    sits at the resolveVariantArms cliff; fr-otkf tracks the lens port —
    lower stakes now that SURFACE_FOLD_LENS is the no-adapter/`?surfacegl`
    fallback rather than the lens session's primary tracer).
  - `surface-material-4d.ts` — 4D twin (fr-vxoj): sphere-traces the
    `w = w0` slice of the rotor-posed 4D attractor, mirroring
    `surface-de-4d.ts`'s `estimateDistance4Refined` line for line (refined
    certificates + width-4 beam — the fr-beck-measured ghost eliminator
    plus fr-jkpn's validity slots).
    The slice has a THICKNESS since fr-wa6o: `uSliceHalfW > 0` makes every
    descent query the SEGMENT spanning `|w - uW0| <= h` instead of the point
    `(p, uW0)`, so the mode renders a SLAB's projected shadow rather than a
    cross-section (the oracle's `halfExtent`, mirrored line for line — one
    `vec4` per chain/candidate, `segmentRadius` for every `length`, and the
    visible-ball gate widened to `max(0, |uW0| - h)`). `segment` is a
    dynamically-uniform branch, so `h = 0` — the shipped default — costs
    nothing beyond the extra live registers and renders today's frame value
    for value. Rotor + w-slice are LIVE per-frame view uniforms
    (`setSurfaceView4`),
    unlike flame/solid-4D's frozen snapshot — the slider is normalized
    rotated-w, and `scene.ts`'s `setSurface4View` converts it to the
    tracer's world `uW0` through `wSupport` (fr-33yb), so one slider
    position is one hyperplane across every mode; 24-map cap, matching 3D's —
    the per-map arrays ride a std140 uniform BLOCK (fr-dqlq: 2688 bytes of the
    guaranteed 16KB, where default-block arrays would have taken 192 of the
    guaranteed 224 fragment uniform vectors), and the kaleidoscope SWEEPS
    like 3D's (fr-u91x), so 24 slots means 24 transforms at any order.
    Since fr-dlxh's 4D cut this tracer is the PLAIN-4D fallback arm
    (`?surfacegl` / no adapter / device loss — compute is 1.7x faster
    there) and the kaleidoscope-4D MEASURED HOME: the compute arm never
    settled a 6-minute order-6 observation this arm settled in 10.9s
    (~35x), so order > 1 routes here by verdict, caveat-free. fr-b72d's
    closure attributed that gap: the estimator's own cost is superlinear
    in order for BOTH arms (algorithmic depth growth, CPU-oracle-matched
    — `scripts/aff4-order-cpu.harness.ts`), and the compute arm's
    additional collapse is its march-loop scheduling under that regime
    (fr-fniy), not kernel codegen — the uniform-maps and
    refinedCert-divergence kernel suspects were both refuted with data.
    TWO VARIANT ARMS since fr-qxxw/fr-h0c3 — the balloon inverted-union
    and the ground plane, each mirroring its 3D original term for term —
    and the MECHANISM is the one deviation, forced by measurement: this
    source is 61 751 B with 3 785 B of headroom under the 64KB strip
    threshold, and the arms are ~5.3KB and ~7.7KB, so one monolithic
    `#if` source would be ~74KB and EVERY 4D session would pay it, in the
    band where the 3D fold program takes ~25s to link. So the arms
    resolve JS-side, through `surfaceFragmentFor` ITSELF rather than a
    second preprocessor (`surface4FragmentFor` is a two-line wrapper), and
    the `defines` keys are `SURFACE4_*` while the GLSL directives stay the
    3D names — deliberate, called out at both sites, and renaming them
    would break resolution. Measured: off 61 751 B (byte-identical to the
    pre-lift source), balloon 67 123 -> 16 664 stripped, plane
    69 497 -> 17 705. Three things could not be copied: `balloonInnerDE`'s
    far-field clamp (it exists for 3D's FORWARD cores, whose
    zero-iteration far value is not a distance to anything; this tracer's
    core has a value-exact sphere floor that already is the bound — the
    arm records that a future 4D forward core owes it),
    `shadeGroundPlane`'s normalizer (the FULL 4D radius, not `sliceVisR`,
    which collapses at the slab edges and would make the floor breathe as
    the slider scrubs), and the post-march miss's sphere-exit/exhaustion
    split, which had to be ADDED — 3D splits it because it has a floor to
    classify into, and EXHAUSTED never planes.
  - `surface-compute.ts` — WebGPU compute renderer for fold-shaped 3D
    surface sessions (fr-tzdg): systems with base-map folds OR a fold
    FINAL lens (fr-55s1 — `deHasFolds(de) || foldFinal`; the DE picks
    the kernel core and the lens wrapper, and the two first-sizing
    priors scale by the lens branch count 27/3/81 ÷ 8), — since
    fr-dlxh — escape-time sessions (the non-contracting pure-fold map —
    or, since fr-s04t, the CHAIN of them — that the IFS gate refuses), and — since fr-dlxh's 4D cut — PLAIN 4D
    surface sessions (symmetry order 1): those ALL PREFER it when an
    adapter exists — no fold GLSL ever compiles (the ~25s Mesa link /
    ~5.7s lens link / fr-096u entry hazards never engage), no grid
    request (gridless by decision, measured). FOLD-shaped 4D sessions
    (fr-rsp6: 4D base-map folds or a 4D fold FINAL, any symmetry
    order) are compute-ONLY — the fragment 4D tracer deliberately
    carries no fold GLSL, so the eligibility gate refuses entry when
    compute is unavailable, and a mid-session compute loss exits the
    mode with a toast rather than falling back. KALEIDOSCOPE 4D
    (non-fold, order > 1) stays on
    the fragment tracer by MEASURED verdict (real Iris, 1024x640: plain
    4D compute settles 4.6s vs fragment 8.9s with object-mask IoU
    0.996, but at order 6 the WGSL sector sweep never settled a
    6-minute observation the fragment arm settled in 10.9s — ~35x;
    fr-b72d's closure exonerated the kernel — the DE's cost is
    algorithmically superlinear in order for both arms and the
    uniform-maps/refinedCert kernel suspects were refuted on the
    extended `--surface-aff4-sweep` leg — so the residual is this
    module's march-loop scheduling under an expensive-DE regime,
    fr-fniy). ESCAPE-shaped 4D sessions (fr-vag4 — a non-flat chain the
    4D IFS gate refuses) are compute-ONLY for the fold-4D reason
    unchanged: an escape chain IS fold-shaped, and the fragment 4D tracer
    carries no forward-orbit GLSL either, so entry is refused without
    compute and a mid-session loss exits with the same toast one family
    over. `create()` takes a
    `SurfaceComputeTarget` union
    (`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`) whose
    `kind` picks the kernel core (ifs4 → affine4 or fold4 off
    `deHasFolds4`, the 3D `deHasFolds` split one dimension up; `bulb` →
    fr-tdin's `core:"bulb"`, structurally the escape arm one formula
    over; `escape4` → fr-vag4's `core:"escape4"` — `isForwardTarget`
    names the THREE so a branch cannot serve one and miss another, and
    `isFourDTarget` names the two whose frame spec must carry `view4`,
    `escape4` being in both sets), the
    params packer and the maps
    buffer's layout/existence — the bounded march/shade host loop,
    progressive presents and failure ladder stay shared regardless.
    `isForwardTarget` no longer means "no maps buffer": both ESCAPE kinds
    carry their formula chain on the maps binding, so every maps-shaped
    branch names them ahead of the predicate and `bulb` is the one
    bindingless kind left.
    The BALLOON and the FLOOR ride an ifs4 target since fr-qxxw/fr-h0c3,
    with the 3D arm's precedence (the two never compile together and the
    balloon wins); no FORWARD kind ever balloons, in either dimension.
    Escape and plain-affine ifs4 targets scale no priors (the forward
    loop is phone-cheap and the pessimistic base priors elsewhere only
    err toward smaller first slices); fold/lens-shaped ifs4 scales by
    branch count like 3D. The ifs4 kind's
    rotor/slice view is PER-FRAME SPEC STATE (`spec.view4`, re-read
    from the scene's `setSurface4View` state at every spec assembly and
    repacked per pass — the fragment tracer's live-uniform discipline
    across the WebGPU seam; a missing view4 throws), and
    `surfaceComputeForceFrameKey` includes the pose so a timeline leg's
    rotor/slice glide never re-presents a stale frame. `SURFACE_ESCAPE`
    GLSL and the fragment 4D tracer are the fallback arms (`?surfacegl`
    / no adapter / device loss), exactly like `SURFACE_FOLD_LENS`; the
    fr-tmgf detail vocabulary widened with them (`surfaceWebglDetail`'s
    param is `computeShaped` now — every 4D system is compute-shaped). MEASURED (fr-55s1, Iris Xe real driver, dev
    regime): the fr-g58b lens archetype previews in 0.94s and settles a
    full 1280x720 frame in 9.4s (0 exhausted) where the WebGL A/B of the
    same hash was 43% settled at 30s; the 81-branch mandelbox field
    class settles in ~35-55s (thermally variable) vs a 2min+ WebGL
    grind. Owns the device (bench acquisition
    idioms + flame-backend error taxonomy) and the frame loop: march
    slices sized from a measured per-ray·step EMA + shade batches sized
    in HIT units (fr-p8bc: terminal rays queue by status — misses are
    one background write, hits — and, since fr-rhn5, ground-plane PLANE
    terminals — pay the probe evals and arrive scanline-CLUSTERED;
    batches are predicted from a per-hit cost EMA
    under a pessimistic prior, spike-lifts instantly, decays slowly,
    capped by the slow-trust double/quarter policy — the original
    ray-unit doubling let miss runs inflate capacity a hit band then
    paid, five kernel-confirmed i915 GPU hangs — and FLOORED at one
    WORKGROUP, never one hit: within a workgroup cost is
    depth-dominated, so sub-workgroup batches buy no submission-wall
    safety, and the old 1-hit floor was a one-way trapdoor — one hit
    band past the pass target and every 1-ray batch re-measures the
    full per-submission wall as its per-hit cost, spike-lift latches
    it, ~4 hits/s serialization that reads as a settle parked forever
    at a pose-dependent percent, fr-d6g5's Mesa-25.2.8 "park"; the
    `?surfacetrace` flag + `scripts/fold-settle-park.repro.mjs` are
    that diagnosis' instruments, kept) so NO submission
    outruns the i915 watchdog; shading probes ride the width-1 greedy
    descent (`SURFACE_COMPUTE_SHADE_DE_WIDTH`, the fr-p8bc measured
    verdict: 23.8x cheaper shading, eyeball-identical frames);
    host-compacted active list; progressive presents between
    every bounded piece; colorOut prefill seeded from the last frame
    (nearest-resampled — the strip settle's preview-seeded-target
    discipline; fr-f4bx measured what that buys during MOTION on a slow
    adapter, where every preview is a budget-truncated one: the present
    is the PREVIOUS frame with its newly resolved rays overwritten, so
    the pane never shows backdrop mid-drag — 1280x720 Firefox WebGPU,
    dragging into a mandelbox-lens close-up, mid-drag frames measured
    0.98-0.99x the completed preview's size, i.e. full coverage — and at
    the extreme a preview resolving ZERO rays in its 2.2s budget
    presents the prior image byte for byte. That refutes the bead's own
    premise: there is no worse frame being painted over a better one to
    suppress, and a coverage threshold on the present would have had
    nothing to fix. The pane heals at park through fr-ud7n's completion
    pass); per-frame status counts for field debugging.
    SUPERSAMPLING (fr-vpbq) rides that loop as `opts.samples`: N passes of
    the same frame at N sub-pixel offsets (`subPixelSample` — pass 0 the
    pixel CENTRE exactly, the rest the R2 low-discrepancy sequence),
    averaged in LINEAR light because both tracers end with a
    `pow(lit, 1/2.2)` encode and averaging the bytes is the
    edge-darkening bug. N FRAMES rather than N rays per frame, so the five
    per-ray buffers and every watchdog bound stay exactly as measured and
    fr-biox's device ray ceiling is not met N times sooner — and so the
    result is PROGRESSIVE: pass 0 is the pre-fr-vpbq frame, arriving when
    it always did and presenting its own partials, every later pass only
    refines and presents when it lands, and a superseded job keeps what it
    finished. The speckle it removes is sub-pixel STRUCTURE, measured, not
    march undersampling (`exhausted` 0.00% at 20x the step budget) and not
    reachable by any viewport (the impulse rate is FLAT across a 4x
    resolution range — 16.0-16.1% for the single map, 23.0-23.5% for a
    six-link chain at 128/256/512px — and 39-55% of pixels still move by
    more than 24/255 between the 1-sample and the 16-sample render, against
    a smooth sphere's 0.29% through the same marcher). fr-azjk re-measured
    that sheet on a corrected fitted radius and moved one leg of it: the
    partial-coverage exponents read -0.34 (single map) and -0.73 (six links)
    against the sphere's -0.98, not -0.21..-0.36, because partial coverage
    counts SILHOUETTE pixels and the old inflated marching ball drew these
    objects far smaller than they are. It is the weaker leg either way — a
    frame-filling object keeps its structure in its interior, where a
    silhouette statistic cannot see it, which is why the six-link row's
    coverage fell to the sphere's while its impulse rate rose ABOVE the
    single map's. main.ts spends it on the live SETTLE and on Save-PNG at 8
    samples, never on a preview (cheap by definition) and never on offline
    VIDEO force frames (the cost would multiply by the frame count); the
    progress row discloses the pass as a trailing
    `antialiasing pass k/8`, silent through pass 1. THE WEBGL STRIP ARM
    NOW DOES THE SAME THING (fr-jf9y), and by the same algorithm rather
    than a parallel one — it imports `subPixelSample` from here, averages
    in linear light, and spends 8 on the settle and on Save-PNG, so "8
    samples" has ONE meaning whichever engine a machine has. The in-shader
    loop stayed refused for the reason above (all-or-nothing per-strip
    cost fighting the fr-096u/fr-id9r machinery); instead the settle opens
    a SEQUENCE of N whole-frame strip jobs, each armed exactly the way
    pass 0 is, so pump, planner, fence groups and evidence chain are
    untouched — measured flat per-pass strip counts on real Iris
    (152/258/258/300/258/258/258/258). The accumulator is HOST-SIDE f32,
    not a float render target: ~2.1ms against a ~390ms pass, one sync
    point per pass and outside any job, so strip-planner never sees it —
    and this is the FALLBACK arm, which must not acquire an
    `EXT_color_buffer_float` dependency on the devices that have least.
    Pass 0 is BYTE-IDENTICAL, proved by building twice and diffing: 0 of
    120000 pixels on SwiftShader AND on real Iris, max channel delta 0,
    the PNGs identical to the byte. That second run is not ceremony —
    fr-dlxh's lesson is that a classifier passed SwiftShader clean and
    then real Iris flipped six "stable" rows, so whether Mesa contracts
    `(vUv + 0.0) * 2.0 - 1.0` differently is a question only that driver
    answers. Edge energy falls 0.846x / 0.851x on the two adapters, so
    the win is the object's and not the rasterizer's. `?surfacesamples=N`
    is the escape hatch and the A/B instrument (N=1 restores the exact
    single-pass behaviour). scene.ts
    presents frames as a DataTexture through the shared surface blit (the
    one WebGL canvas — capture/recorder unchanged) and assembles specs
    with the uniform-exact camera/eps/tier quantities (acceptance eps
    stays native-height, fr-7xgi); main.ts routes and choreographs (same
    tier clock + preview governor, latest-wins preview coalescing +
    fr-ud7n's unbudgeted completion pass — the preview frame an
    invalidation must CANCEL rather than wait out, since it is the only
    one with no wall budget to expire — memoized offline force frames,
    one-way fallback: create failure or device loss re-enters through the
    untouched WebGL path; `?surfacegl` forces WebGL).
    A frame's RASTER is bounded by the device, not the caller (fr-biox):
    the five per-ray buffers cost 44 B/ray (the 16 B ray state twice —
    storage + MAP_READ staging — is what a limit bites), so
    `maxFrameRays` = min(maxBufferSize, maxStorageBufferBindingSize)/16
    and a frame past it throws `SurfaceComputeFrameSizeError` up front
    instead of reaching the kernels, because WebGPU refuses SILENTLY
    here — an over-limit `createBuffer` returns an invalid buffer plus a
    validation error, and the first REJECTION is a staging `mapAsync`
    ("Mapping WebGPU buffer failed: Invalid buffer" — the field report,
    from a 4x Save-PNG whose 32.5M rays wanted a 520 MB state buffer
    inside a ~1.4 GB frame; the size that caused it appeared nowhere).
    Both callers size against it: the live pane FITS
    (`fitSurfaceComputeRaster` — one frame IS the image, so a hidpi
    raster past the ceiling traces soft and blits up, the preview tier's
    own mechanism, disclosed once per session) and a capture TILES
    (`surfaceComputeTileRows`, also capped at
    `SURFACE_COMPUTE_MAX_TILE_RAYS` so a device reporting gigabytes
    still exports in ~176 MB pieces). scene.ts's
    `captureSurfaceComputeFrame` traces the export as full-width BANDS —
    every band's spec assembled in ONE synchronous span (a tiled export
    outlives an auto-orbit/drift camera move, the compute answer to the
    WebGL drain's frozen uniforms), each a `camera.setViewOffset`
    sub-frustum, at the FULL image's trace eps, with
    `surfaceComputeBandStops` restricting the backdrop pair to the band's
    own edges (every tracer spreads its stops over its OWN rasterHeight,
    so whole-image stops would repeat the gradient per band) — and the
    frames run `capture: true`, outside the live pane's seed chain. One
    band is the whole image on an ordinary export, byte-identical to the
    untiled path. `?surfacemaxrays=N` pretends a device ceiling;
    `scripts/surface-export-tile.verify.mjs` is the gate (tiled vs
    untiled export of one pinned pose: measured mean 0.002/255, 0.006%
    of pixels off by >8 — the march-start dither's own per-raster hash
    phase, nothing structural). `destroy()` defers the real
    `device.destroy()` until every in-flight frame unwinds (fr-uec4: a
    frame parks on LIVE submitted GPU work — `mapAsync` over a submitted
    `copyBufferToBuffer`, or `onSubmittedWorkDone` over a submitted
    dispatch — and tearing the device down under one of those took the
    WHOLE Firefox process down, not a tab crash or a device-loss toast).
    `destroyed` now means "teardown requested" and `deviceDestroyed` means
    "device gone" — the guard that stops both the idle path (`destroy()`
    itself) and the drain path (`releaseFrame`, when the last in-flight
    frame unwinds) from calling `device.destroy()` twice. The synchronous
    teardown still runs whenever the device IS idle, which is what keeps
    gpu-bench's one-device-alive-at-a-time invariant and
    `RenderSession.terminate()`'s `void` contract untouched. The same
    shape was open one module over and is now closed with the same
    vocabulary — `flame-gpu-backend.ts` (fr-mxkk), counting OPS where this
    counts frames.
  - `render-session.ts` — `enter`/`exit`/`terminate` + first-frame-gate for
    flame/solid/surface controllers. `renderMode` is session-only, never
    persisted. An optional `onFirstFrame` fires on the false→true
    TRANSITION alone (fr-r777 — the flame marks per progress event, so the
    gate absorbs the repeats), which is one wiring per session rather than
    five call sites that could each forget one.
  - `thumbnail-patch.ts` — the pending late thumbnail corrections
    (fr-r777), pure and session-only. A ★ Save to collection or 📍 Add
    keyframe taken during a flame or solid session's STARTUP GAP files an
    entry tagged with that render mode carrying a POINT-CLOUD picture; the
    entry is right (it re-enters the tracer on load), only its picture
    disagrees with its glyph. A thumbnail must be INSTANT — blocking the
    save on a flame convergence would be far worse, and the export modal
    is not available to a save — so the fall-through STAYS and a later
    correction is armed beside it, applied when the session marks its
    first frame. THE INVALIDATION RULE IS THE LOAD-BEARING PART: a saved
    entry froze a DOCUMENT, so a patch applies only while the live
    document still encodes to the string the entry was saved with AND the
    mode is unchanged; otherwise it is dropped, because a stale-but-honest
    picture beats a confident wrong one. The camera pose rides the encoded
    document (fr-1k4), so a manual orbit invalidates too — the
    conservative direction, and free in the headline case since the
    auto-orbit tick sits past the render branches' early returns.
  - `four-d-view.ts` — session-only 4D view state (rotor, tumble, slice).
    `FourDPose` snapshots rotor + slice for persistence. `FourDTween` is the
    directed pose glide (rotor slerp + slice lerp).
  - `rotor4.ts` — SO(4) rotation as renormalizable unit-quaternion pair
    (`RotorPair`); `slerpRotorPair` + `normalizeRotorPair`.
  - `recorder.ts` / `mp4-duration.ts` / `webm-duration.ts` — video capture:
    `MediaRecorder` -> MP4 (preferred) or WebM; binary patchers fix missing
    duration metadata.
  - `offline-export.ts` / `video-encode.ts` / `mp4-mux.ts` — offline
    frame-exact timeline export: steps playback on a VIRTUAL clock (main.ts's
    `nowMs()`), awaits `CloudGenerator.settle()` per frame for determinism.
    `video-encode.ts` = WebCodecs H.264 adapter; `mp4-mux.ts` = dependency-free
    faststart muxer (handles B-frame reordering). Render keyframes PARK the
    clock while the flame/solid/surface render converges (no frames
    captured), then dwell the step's holdMs on the converged still —
    authored clip length.
  - `isolation-handoff.ts` — a session-only, sessionStorage, read-and-clear
    bridge carrying `AppState.renderMode` across the cross-origin-isolation
    reload (fr-su3r; see `register-sw.ts`). The scene document needs no such
    bridge — `persist.ts` already round-trips it through the `#v1=` hash as
    every edit happens — but `renderMode` is deliberately session-only
    (`state.ts`), so it rides nothing across a reload on its own.
    `saveIsolationHandoff` runs from the new `onBeforeIsolationReload` hook;
    `consumeIsolationHandoff` reads it back once, early in the next boot.
  - `register-sw.ts` — service-worker registration + COOP/COEP bootstrap.
    Takes an `onBeforeIsolationReload` hook (fr-su3r), fired the instant
    before the isolation reload — never the update reload — so the app can
    snapshot session state the reload is about to destroy (any throw
    swallowed; isolation matters more). A page bound for that reload now
    registers immediately instead of waiting for `load`, shrinking the
    window in which interaction can be lost; an already-isolated page keeps
    the original `load` timing.
  - `sw/sw.ts` — Workbox precache + COOP/COEP headers (own TS program).

Core algorithm: the chaos game on an IFS — repeatedly apply a randomly chosen
affine map to a moving point and plot where it lands; the cloud converges on the
system's attractor. See `docs/architecture.md`.

**Color management is disabled** (`THREE.ColorManagement.enabled = false` in
`scene.ts`) so authored sRGB colors render verbatim; `color.ts` produces sRGB.

## Testing

Vitest with globals — use `describe`, `it`, `expect` without imports. Tests live
alongside source as `*.test.ts`. DOM tests opt into jsdom with a
`// @vitest-environment jsdom` comment (see `src/app/ui.test.ts`).

- **Test behavior, not implementation.** Assert on outcomes.
- **DAMP over DRY.** Inline setup so each test reads in isolation.
- **One behavior per test.** Each failure should name the exact scenario.
- **Pragmatic coverage.** Don't chase 100%. Every test should pay rent. The pure
  core (`src/fractal/`) and pure app helpers (`orbit`, `state`) carry the tests;
  the Three.js/DOM glue is verified by running the app.

## Issue Tracking

This project uses **beads** (`bd`) for issue tracking instead of markdown files or
TodoWrite.

```bash
bd list               # View all issues
bd ready              # Find available work
bd show <id>          # View issue details
bd create "<title>"   # Create a new issue
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
```

## Branching & Deployment

**ALWAYS create a feature branch before making changes.** Deployment to GitHub
Pages is manual only (`workflow_dispatch`) — not triggered by merges to `main`.

## Session Completion

When ending a work session, work is NOT complete until `git push` succeeds.

1. **Check dimensional parity** — did this touch something with a 4D twin? If
   the 4D half is missing, the work is not done: ship it, or disclose the gap in
   the PR description and the closing summary with the reason and a shaped bead.
   See **Dimensional Parity** at the top of this file.
2. **File issues for remaining work** — capture follow-ups in `bd`.
3. **Run quality gates** (if code changed) — `npm test`, `npm run build`.
4. **Update issue status** — close finished work, update in-progress items.
5. **Push to remote** — push the feature branch and open a PR to `main`.
6. **Verify** — all changes committed AND pushed.

If quality gates fail, fix them before pushing. Never push broken code.
