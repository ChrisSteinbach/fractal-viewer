# CLAUDE.md

**Fractal Explorer** — an interactive 3D/4D IFS (Iterated Function System) fractal
explorer. A set of affine transforms is rendered with the "chaos game" into a live
Three.js point cloud. Built with TypeScript + Vite, packaged as a PWA, deployed to
GitHub Pages. Reference docs in `docs/`.

## What belongs in this file — rules here, evidence in `docs/`

**This file is the RULES**: invariants, refusals, frozen wire constants,
which gate verifies what, and the one-line VERDICT of every settled
question. **The EVIDENCE lives in `docs/`** — measured numbers, per-bead
measurement narratives, refuted hypotheses, the history of a correction —
one file per subsystem, linked from the bullet it belongs to.

The reason is mechanical rather than editorial: this file is loaded into
every session's context, and it reached 167.8k characters against a 150k
limit, at which point it stops being loaded at all. A rule nobody can
afford to read is not written where it is read, which is the whole point of
putting it here. So when a session measures something new, **the numbers go
in the `docs/` file and the verdict comes back here as one line**. A bullet
that has grown a table, or a paragraph opening "MEASURED", is a bullet due
for a split.

Nothing was dropped in the split — every figure, refuted claim and bead id
is in `docs/`. The subsystem records:

- `docs/architecture.md` — how the whole thing works (narrative).
- `docs/surface-gpu-kernels.md` — `surface-de-gpu.ts`: the seven WGSL
  cores, the params wire, bench legs and classifiers.
- `docs/surface-compute-renderer.md` — `surface-compute.ts`: routing, the
  frame loop, supersampling, raster limits, teardown.
- `docs/surface-strip-pipeline.md` — `strip-planner.ts`: the WebGL strip
  pump, the cost evidence chain, the capture drains.
- `docs/surface-glsl-tracers.md` — `surface-material.ts` / `-4d.ts`:
  variant arms, the Mesa link cliff, the probe-width verdict.
- `docs/escape-time-family.md` — `escape-de.ts`: the formula chain,
  cycling vs chaining, the estimate form, the emptiness instruments.
- `docs/gpu-bench-surface.md` — `npm run bench:surface`: what it pins, the
  known SwiftShader false failure, the fixture rows.
- `docs/harness-sheets.md` — the `scripts/*.harness.ts` catalogue and each
  sheet's verdict.
- `docs/fold-de-performance-brief.md`, `docs/quaternion-julia-brief.md`,
  `docs/julia-sets.md`, `docs/4d-exploration.md`, `docs/flame-interop.md`,
  `docs/controls.md` — standing briefs.

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

fr-5666 closed the balloon's remaining Points half with the same
dimensional-reduction-first rule: the explorer PROJECTS THEN INVERTS the exact
3D point it displays, using the full rotation-invariant 4D ball so the shell
does not pulse as the view tumbles. Its echo shares the source point's rotor,
w-ramp and soft-slice treatment; projection-of-a-4D-inversion would echo a
different object.

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
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (all seven cores; eval/march baselines + fr-tzdg's march-unproject/shade app path) to its CPU oracles; add --display=:0 for real-driver timing. Run it on a QUIET machine, never beside the test suite: a contended software device corrupts mid-run readbacks, which the fr-76pp canary reports as verdict=device-unreliable (exit 2, rerun). JUDGE THE ESCAPE ROWS ON --display=:0 — escChainKaleido carries a known SwiftShader-only false failure (fr-jtd4) and the flip cap must NOT be raised to make it green. Fixtures, caps and measured rows: docs/gpu-bench-surface.md
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

The 4D explorer balloon gate (fr-5666) is self-contained:
`node scripts/explorer-balloon-4d.verify.mjs`. It drives Pentatope through
Points, parks the tumble, enables the echo, reloads the app's own copied link,
then compares real SwiftShader canvas frames with the restored echo on/off.
That one path gates the non-flat controls, boot-time ball-uniform sync and the
project-then-invert shader compile/render together. MEASURED at the lift:
10.255% of pixels changed (mean absolute RGB difference 3.285, max 234).

**Harness sheets** (`scripts/*.harness.ts`, run with
`npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>`)
are this project's executable measurement records — the argument for a
decision, kept runnable rather than summarized. Two shared instruments
carry the rules. `scripts/de-preview.ts` is the SHARED renderer eight of
them import (`renderPreview`, `writeContactSheet`, `encodePng`, and the
`DistanceEstimator`/`PanelStats` vocabulary): a CPU sphere-marcher with
AO/shadow switches, a settable step budget and an always-counted
`exhausted`, so a new sheet writes its estimator and its panel list, NEVER
a ninth marcher. `scripts/set-extent.ts` is the other (fr-azjk): the ONE
definition of "how much of a ball does this set fill, and how far out does
it reach", against a MEMBERSHIP oracle the caller supplies and never a
threshold on a distance, volume-uniform for fill and a shell walk from the
outside in for reach. It exists because five sheets had each grown their
own copy and all five were wrong the same two ways — a grid aliases
against a fold's walls, and `de(p) < eps` is not membership in either
direction — which corrected figures in four module docs and cost two
standing claims. Output lands under `scripts/out/`, which is gitignored —
regenerate rather than commit megabytes of PNG.

The catalogue of sheets and what each one's verdict was is in
`docs/harness-sheets.md`.

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
    THE 4D LIFTS are semantic decisions and ball choices, no new algebra.
    The surface arm (fr-qxxw) inverts in the SLICED 3D space and hands the
    estimator `(q, w0)` on both terms — SLICE THEN INVERT, so the echo is the
    inversion of exactly what is drawn, where inverting in 4D and slicing the
    result would draw the echo of a DIFFERENT slice (`I₄({w = w0})` is a
    3-sphere; the two agree exactly at `w0 = 0` for this origin-anchored
    ball). The Points arm (fr-5666) applies the same reduction-first rule as
    PROJECT THEN INVERT: rotate/project the stored 4D point, preserve its
    w-ramp and soft-slice weight, then invert that visible 3D point through
    the full rotation-invariant 4D enclosing ball. Projection of a 4D
    inversion would not be the echo of the cloud on screen. The 3D bound then
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
    fr-kidj stage-2 B&B on/off (WGSL has no Mesa link cliff). Measured
    verdicts: private frontier, stage 2 OFF — the config stays
    stage-1-only.
    THE FOLD'S AUTHORED LENGTHS (fr-s9ll) ride a dedicated `fold` lane in
    both map layouts — `GpuMap` 6 -> 7 vec4, `GpuMap4` 8 -> 9 — carrying
    `resolveFoldRadii`'s own output `(mR, fR, wall)`, from which a
    generated `foldRadiiOf` re-derives the branch algebra
    (`surfaceFoldRadii` field for field). The ESCAPE core's lane says
    something different — `(mR², fR², wall)`, the form `EscapeLink` keeps
    and the form `fR²/clamp(r², mR², fR²)` wants — exactly as its `p0`
    already differs; each packer transfers its OWN oracle's numbers
    rather than recomputing them. `foldRadiiOf` is emitted only where a
    fold branch reads it — the fold cores, or ANY core under the lens
    wrapper — so affine kernels stay byte-identical.
    THE PARAMS WIRE IS FROZEN LAYOUT, and appending to it blind is this
    file's standing hazard. 3D: 0-207 frozen, 208-271 the VARIANT block
    (escape/bulb head-link ballast, mutually exclusive with the lens
    block by construction), the lens fold's lengths at 272, and the
    plane/balloon block SHARED at 288 — the escape and bulb cores declare
    a matching pad so that block keeps ONE offset across every 3D core
    (`SURFACE_GPU_PARAMS_BYTES` 288, balloon 320,
    `SURFACE_GPU_PARAMS_PLANE_BYTES` 336). 4D: the affine4 tail 208..463
    (`SURFACE_GPU_PARAMS4_BYTES` 464), the lens4 block 464..575
    (`SURFACE_GPU_PARAMS4_LENS_BYTES` 576, fr-s9ll's `lens4Fold` quartet
    at 560), and the plane/balloon block at the frozen 576 for EVERY 4D
    core — which the lens4 block being declared unconditionally under
    either is what buys, the 3D `lens || balloon || groundPlane` rule one
    dimension up, zero-filled by the packer when there is no lens (4D
    balloon 608, `SURFACE_GPU_PARAMS4_PLANE_BYTES` 624). fr-h0c3's bead
    had recorded exactly the hazard this avoids: a block appended at 560
    lands INSIDE the `lens4Fold` quartet and corrupts it.
    SEVEN KERNEL CORES (fr-55s1 added the second, fr-dlxh the third and —
    its 4D cut — the fourth, fr-rsp6 phase 2A the fifth, fr-7u8t.9 the
    sixth, fr-vag4 the seventh):
    `core:"affine"` emits the width-4 A/B + fr-jkpn-validity-slot REFINED
    ladder (mirrors `estimateDistanceRefined`, the affine GLSL's
    estimator; width/sharedFrontier/bnbStage2/shadeDeWidth inert) beside
    the fold frontier, picked off `deHasFolds` exactly like the CPU.
    `core:"escape"` (fr-dlxh) is not a descent at all — it emits
    `escape-de.ts`'s `estimateEscapeDistance`, the FORWARD fold orbit
    with the Buddhi/Rrrola scalar derivative, in the `SURFACE_ESCAPE`
    GLSL arm's f32 formulation, for exactly the systems
    `analyzeEscapeSystem` admits; marching quantities ride the params
    uniform via `packEscapeGpuParams` (bailout ball packed as both
    bounding AND visible sphere, `ESCAPE_STEP_SCALE`, `maxDepth` as the
    orbit budget in PASSES through the same preview door the descents
    use, `mapCount` the LINK COUNT, `symOrder`/`symPlane` the query-space
    wedge fold). Since fr-s04t it CYCLES the whole formula chain — link
    `i mod n`, `+ p` and the bailout test after EACH link, `maxDepth * n`
    single-link steps — reading one `GpuMap` per link off the maps
    storage binding (`packEscapeGpuMaps`), so it DOES declare buffer 1
    and `core:"bulb"` is the one bindingless core left. Since fr-j231 a
    link's `kind` may be a POWER map (4 triplex, 5 quaternion square), so
    the fold pair's negative `kind != 2u`/`kind != 1u` dispatch sits
    behind a `kind < 4u` GUARD in both bodies — unguarded, a new kind
    satisfies both and runs both folds, which is why the Mandelbulb
    became a sixth core rather than a fourth kind — with `bulbPow8`
    HOISTED to one definition emitted for the two forward cores (declared
    in the body block so both the value body and the entry's hit-info see
    it, and affine/fold kernels stay byte-identical). `escParams.w` at
    offset 268 is the ONE live word of the head-link ballast:
    `EscapeDE.logEstimate`, the chain-level choice between `r/dr` and the
    Böttcher `0.5·r·ln r/dr`; the hit-info carries the matching second
    interpolant off the DEGREE of the link that produced the terminal
    radius (a pre-scaled power link has `growth < 1`, which failed the
    old guard). Its trap is the CONTINUOUS escape fraction over the PASS
    budget (fr-7u8t.8; denominator is `maxDepth`, NOT the chain's
    `maxDepth * n` step budget — fr-byxb) and drives COLOR ONLY, the
    descent cores' convention.
    `core:"bulb"` (fr-7u8t.9) is the escape core's SIBLING one formula
    over: `bulb-de.ts`'s `estimateBulbDistance`, the forward
    triplex-power orbit with the Böttcher log estimate, for the systems
    `analyzeBulbSystem` admits, in the `SURFACE_BULB` GLSL arm's f32
    formulation. Everything structural is escape's (208..271 variant
    block via `packBulbGpuParams`, no maps binding, every frontier knob
    inert, `maxDepth` as the orbit budget, lens/balloon throw); the one
    asymmetry is that the ORBIT bailout and the QUERY-space marching ball
    are different numbers, so `bulbParams.y` carries the bailout and the
    frozen `boundingRadius` stays the marching ball. Its trap is the
    POWER-map form `log(log r / log R)/log n`, not the fold arm's
    constant-factor form.
    `core:"affine4"` (fr-dlxh's 4D cut) is the refined ladder ONE
    DIMENSION UP — `surface-de-4d.ts`'s `estimateDistance4Refined` behind
    the app's view lift, the estimator `surface-material-4d.ts` marches:
    the prologue does `rotorInv · vec4f(p, w0)`, the fr-wa6o slab rides
    one vec4f half-extent register beside every point (linear parts
    alone, gated on the dynamically uniform `sliceHalfW > 0`), and the
    fr-u91x kaleidoscope sweeps ONE backward-step 4×4 where 3D swept a
    (cos, sin) pair. Its tail holds rotor/stepBack/4D-lens rows as
    row-vec4 quartets — the buffer always stores the ROW-MAJOR bytes of
    the matrix the body applies, the packer performing the one real
    transpose (`setSurfaceView4`'s exact dance) — plus
    w0/sliceHalfW/`visRadius4` and the fr-skhv radius-ramp band; maps are
    `GpuMap4` (`packSurfaceGpuMaps4`, 128-byte stride). Two frozen slots
    carry 4D semantics: `visibleRadius` packs the SLICE-ADJUSTED sliceVisR
    so the shared march entry's sphere gate is the 4D GLSL's textually
    unchanged, while the tail's `visRadius4` keeps the FULL radius for the
    height color source and the radius source normalizes over the band —
    both slice-invariant, and those two shade lines are the one
    core-conditional interpolation in the shared entry text. Fixed width
    4; nonzero `footprint` THROWS at pack (the 4D oracle has no cone cap).
    `core:"fold4"` (fr-rsp6 phase 2A) is the FOLD frontier one dimension
    up — 4D fold base maps (`deHasFolds4`) marched as the same
    width-configurable frontier as 3D "fold", slab(`ext`)-aware, sharing
    `GpuMap4` and the affine4 tail; no stage-2 B&B emission by the 3D
    verdict. A `mapsUniform` codegen option (fr-b72d probe) moves the 4D
    cores' maps binding to a fixed 24-slot uniform array — REFUTED for
    production, kept as the refutation's executable record behind the
    opt-in `--surface-aff4-sweep` leg.
    `core:"escape4"` (fr-vag4) is the escape core ONE DIMENSION UP —
    `escape-de-4d.ts`'s `estimateEscapeDistance4` — and the first core
    that is BOTH 4D and FORWARD, which is the whole of its novelty: it
    takes the rotor prologue and the `GpuMap4` maps layout from the
    descent cores and the orbit, params scalars and colors-only hit-info
    from `core:"escape"`. Three things fall away with the dimension and
    NOTHING is added — no `bulbPow8` (the gate refuses a triplex power),
    no slab (a forward orbit cannot thread a segment, so the packer
    THROWS on a nonzero `sliceHalfW`), and no lens (an escape chain has
    no final transform, which is what lets its params block reuse lens4's
    464..575 region). Its wedge fold reads `SYM_PLANE_CODE4` — the index
    into `SYMMETRY_PLANES` — and NOT the descents' `SYM_PLANE_CODE`,
    which deliberately collapses `xw`/`yw`/`zw` onto their w-free twins:
    sound where the kaleidoscope is a swept matrix, wrong where a fold
    picks its two axes by name. `lens`/`balloon` throw, `groundPlane`
    composes, and there is no fragment mirror at all.
    Ground plane (fr-rhn5) is an orthogonal `groundPlane` option, not a
    core of its own — it composes with every descent/escape core, in both
    dimensions since fr-h0c3, and with the lens wrapper. It adds a fifth
    ray status, `SURFACE_GPU_RAY_PLANE` (4), that march classifies a
    sphere-gate/sphere-exit MISS into when a downward ray crosses the
    floor inside its fade band (EXHAUSTED never planes); the shade entry
    lights the crossing with the hit path's penumbra/AO probe-width
    discipline under two analytic ball certificates. Its params block is
    SHARED with the balloon's — the two throw at codegen/pack together
    (no horizon inside the balloon's shell). THE 4D LIFT NEEDED NO NEW
    SHADER TEXT: the march classifier and the shade entry are already
    shared across every core, so it is the params block, the struct
    splice and deleting the throw. The floor is a world-space plane in
    the SLICED 3D space, so every 3D certificate holds verbatim once a
    ball is chosen; the app chooses the origin and the FULL 4D visible
    radius, so the floor does not slide as the slice scrubs (an
    off-centre slice shows a smaller object floating above it, which is
    honest — it IS a smaller slice). `surface-compute.ts` prices PLANE
    terminals in the hit-priced queue, not the miss path.
    All seven share the public `surfaceDE(pIn, cutoff, li)` signature, so
    the Modes are textually identical whichever core is picked. And
    `lens:true` wraps EITHER descent core in `descendLens`'s fold-FINAL
    branch sweep — the body token-renames to `surfaceDECore` (hit-info to
    `surfaceDEHitInfoCore` behind the argmin sweep, probe to
    `surfaceDEProbeCore` under the same sweep text renamed) and the
    wrapper owns the public names, entries untouched; the lens block is
    zero-filled when absent, and footprint+lens is refused at pack time
    (descendLens's per-branch innerFootprint would need a core signature
    change; the app passes 0). `lens:true` wraps either 4D core in
    `descendLens4`'s branch sweep the same way (fr-rsp6 phase 2B — the
    old "4D lens throws" rule is gone).
    Modes: `eval` (per-query distances) and `march` (bounded-dispatch ray
    march, host-compacted active list) are the fr-q1f8 bench baselines,
    byte-identical since the spike; `march` + `rays:"unproject"` swaps the
    ray derivation to the GLSL tracer's uInvProjView unproject (+
    flag-gated start dither) for the app path, and `shade` runs the GLSL
    tracer's FULL shading (greedy width-1 hit-info descent, tetra normal,
    penumbra shadow, AO, linear-space lighting, fog, LUT color sources)
    over host-compacted batches of TERMINAL rays. March and shade are
    separate entries by measured verdict, not taste: the v1 megakernel
    shaded rays inside the march pass that terminated them and LOST THE
    DEVICE on Iris. `shadeDeWidth` (fr-p8bc) routes exactly those probe
    taps (normal/shadow/AO — they LIGHT a hit the full-width march
    already certified, never decide geometry) to a second narrow descent
    `surfaceDEProbe`, derived from the same body template by token rename
    so the two cannot drift; app ships width 1. `statusOut` (fr-si66,
    march mode only, THROWS elsewhere) adds the host's one question as a
    side channel — `u32(st.y)` at binding 5, indexed by the ray's SLOT in
    the active list, written at EVERY exit but the out-of-range guard —
    so a sweep's rebuild costs 4 B per ACTIVE ray instead of the frame's
    whole ray state. Nothing on the device reads it, and absent/false is
    byte-identical source, which is what leaves the bench's own march
    legs the kernels they were.
    RE-VERIFY SURFACE KERNEL CHANGES ON `--display=:0`, NOT SWIFTSHADER
    ALONE — fr-dlxh re-proved it: a classifier passed SwiftShader clean,
    then real Iris flipped six "stable" rows. A forward orbit is chaotic
    and which rounding seeds flip is realization-dependent, so the escape
    legs gate in LAYERS (a pre-hoc ensemble classifier
    `escapeQueryStable` with exclusions disclosed per row, and a post-hoc
    `escapeShadowFlipVerified` absolution capped at 7 flips).
    Consumed by `src/app/surface-compute.ts` (the fold- and, since
    fr-dlxh, escape-shaped surface sessions' preferred tracer) and pinned
    by `src/app/gpu-bench/`'s surface section (`npm run bench:surface`;
    real-driver timing via `--display=:0`; `--surface-shade-width=N`
    reruns the fr-p8bc probe-width A/B).
    Full record — measured verdicts, bench legs and classifier design,
    the trap-normalizer measurement history and its corrections — in
    `docs/surface-gpu-kernels.md`.
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
    the IFS gate refuses (one or more flat maps of which at least one
    does NOT contract, no final transform, no kaleidoscope that rotates
    out of 3D — `analyzeEscapeSystem` is the deliberate COMPLEMENT of
    `analyzeSurfaceSystem` on that shape, which admits exactly when EVERY
    map contracts).
    THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`):
    orbit step `i` applies link `i mod n`, `+ p` and the bailout test
    after EACH link, and a PASS is one full cycle — so
    `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the GPU's
    `maxDepth` keep meaning "how many times is each link applied". The
    rejected alternative, CHAINING (all n links inside one pass, i.e. the
    per-PASS offset), was measured fattening toward a solid ball as links
    were added — the fr-7u8t.8 defect returning — and lives on as an
    executable local in `scripts/escape-chain.harness.ts`, the sheet the
    SHIPPED estimator draws (`scripts/hybrid-chain.harness.ts` is the
    prototype that asked the question first).
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
    anything but 1: there is no textbook object here to deform away from,
    and `dr` accounts for `w` exactly). The orbit stays in `v` space with
    the literal `+ 1` — the power modules work in `y` space and seed `dr`
    at `sigma_max(M)`; the two are the same recurrence in different
    coordinates, but that factoring needs ONE `M` and a chain has n, so
    staying in `v` is how a chain avoids choosing.
    THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW
    (`EscapeDE.logEstimate`, ONE flag per chain resolved at build and
    carried on both wires rather than re-decided in six mirrors): folds
    escape exponentially and read the linear `r/dr`; a power link makes
    the chain super-exponential and it reads the Böttcher `0.5·r·ln r/dr`,
    `bulb-de.ts`'s and `qjulia-de.ts`'s own form. That does NOT reopen
    fr-282c, which refused the log form for the FOLD family — its
    dimensional argument (the folds are uniform-rescale equivariant)
    cannot reach a map with `V(λy) = λ^d V(y)`, and its decisive
    empirical control was re-run here rather than waved past.
    THE PREDICTED STIFFNESS HAZARD DOES NOT REPRODUCE, and it is
    fr-j231's most useful result: the bead's blank-frame figures are the
    PROTOTYPE's CHAINING arm's, and the shipped orbit CYCLES — `+ p`
    re-enters after every link, so a power link is applied to a point the
    query has just tethered and its output is tested before any fold can
    compound it. SO NO AUTO-SCALE AND NO NEW SIGNAL — a hint computed
    from the closed-form bound (`escapeLinkStiffnessLimit`, kept
    executable as the refuted prediction's own record) was written and
    then DELETED, because it fires on every row of that table and every
    one of them renders, which is fr-17qu's second-cut lesson verbatim.
    TWO INSTRUMENT RULES, both of which a first draft of this record got
    wrong. Ball fill is a seeded uniform sample against
    `escapeSetContains`, NEVER A GRID: a fold's structure sits on its own
    walls — the integers, at the classic `boxLimit` — so a grid whose
    planes land there over-samples them, and THIN sets only, which is why
    it is easy to miss (it bites exactly the rows a blank-frame question
    is about). AND A DISTANCE THRESHOLD IS NOT A MEMBERSHIP ORACLE IN
    EITHER DIRECTION — a small estimate means "near a boundary" for an
    ESCAPER too — which is what manufactured the record's phantom
    collapse. fr-azjk carries both findings back to the sheets that
    predate them.
    `estimateEscapeDistance` iterates the maps FORWARD with ONE shared
    scalar running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's
    standard heuristic, not a certified bound), mirrored by
    `surface-material.ts`'s `SURFACE_ESCAPE` variant and, since fr-dlxh,
    `surface-de-gpu.ts`'s `core:"escape"` kernel. `ESCAPE_STEP_SCALE` is
    the one marcher-damping definition both the GLSL variant and the WGSL
    packer import, and it STAYS 0.35 AT EVERY CHAIN LENGTH, MEASURED
    rather than assumed (fr-za0n predicted chains would need heavier
    damping; both harnesses refute it) — cycling floors `dr` after every
    link, so no two folds compound between floors and the slack per step
    is the single map's. BAILOUT STAYS 4 for the same measured reason it
    always was: raising it at a fixed budget inflates the set rather than
    revealing it. Phone-cheap by construction (~30 branchless folds per
    link per eval, at or BELOW the single map on every measured row,
    because the n-times budget is a ceiling only a non-escaping orbit
    pays and every extra link is another chance to escape). f32 is safe
    on the GPU mirrors: the bailout test bounds `|v|` entering every link
    and the per-link `+ 1` floors `dr`.
    EMPTY CHAINS ARE REACHABLE inside the gate — a big enough pre-scale
    escapes everywhere on the first pass and the mode renders a blank
    frame — so `escapeSetContains` (membership, from the same orbit the
    estimate reads) and `probeEscapeFill` (a seeded sample of the bailout
    ball) exist to say so. `probeEscapeFill` MEASURES VOLUME AND MUST NOT
    BE READ AS "WILL IT RENDER": an escape-time set is often a thin
    fractal, the shipped `mandelboxRings` reads 0.0000% fill while
    rendering ~38k surface hits, and fr-wuuu's stronger case is a slice
    with LITERALLY ZERO members in 524288 samples that still draws 20.9%
    of its rays as a coherent shaded object — a slice through a set of
    shells is a set of surfaces, and no volume statistic can see one.
    fr-17qu's first cut toasted "looks empty" over one of the app's own
    presets on exactly that confusion. The signal fires off the FIRST
    completed settle's own hit count instead (main.ts's
    `surfaceBlankNotice`, and since fr-7k0o off BOTH engines'): a frame
    that drew essentially nothing at the entry pose IS blank by the
    renderer's own arithmetic, so it cannot disagree with what the user
    sees. The bar is `SURFACE_BLANK_HIT_FRACTION` (0.001) and NOT zero,
    because the marcher accepts at `uAcceptPixelEps` and a few rays catch
    even a degenerate system. It reports, never refuses. Neither probe is
    wired into `analyzeEscapeSystem` or `buildEscapeDE`, which stay cheap.
    KALEIDOSCOPE is a query-space wedge fold (`foldQueryIntoSector`), not
    an orbit operation: `g` is 1-Lipschitz and an isometry per sector,
    the orbit is seeded AND offset by `g(p)`, so the set is exactly
    `g^-1(M)` — dihedral rather than the chaos game's cyclic (a cyclic
    fold is discontinuous and would certify empty balls across the seam),
    free per orbit step, and `SymmetryParams.blend` is deliberately
    unread exactly as in `surface-de.ts`.
    EACH LINK CARRIES ITS OWN FOLD LENGTHS since fr-s9ll (`EscapeLink`'s
    `boxLimit`/`minRadius2`/`fixedRadius2`, resolved once at build), so a
    chain may hold a different sphere/box apparatus per link, and
    `foldLipschitz` tests the real magnification `fR²/mR²` rather than the
    frozen 4 — which is what keeps this gate the exact COMPLEMENT of the
    IFS one as the knob moves. Pinned against an INDEPENDENT oracle:
    `scripts/spherefold-radius-sweep.harness.ts`'s own parameterized copy
    of `runEscapeOrbit`, written for fr-qi9c's sheet before any of this
    existed, agrees bit-exactly over 12k queries including a two-link
    chain whose links carry DIFFERENT radii.
    ONE-LINK, UNSYMMETRISED SYSTEMS ARE BIT-IDENTICAL to fr-kltj's loop
    (pinned in `escape-de.test.ts` against a frozen copy of it), and
    fr-s04t carried the cycle into the two shader mirrors, so a CHAIN now
    renders what this module estimates on every path: GLSL as one
    `uEscM`/`uEscT`/`uEscParams` slot per link (24-slot cap, the
    descent's own — and the mode's, since eligibility is one answer for
    both engines), WGSL as one `GpuMap` per link on the maps storage
    binding. `EscapeDE extends EscapeLink` survives as the head link's
    flat wire, now frozen layout ballast nothing reads to render.
    The rendered set is the MANDELBROT-form set — the per-iteration
    offset is the QUERY POINT (fr-7u8t.8), which is what makes it the
    object published Mandelbox renders show. fr-kltj had shipped the
    Julia form (offset = the document's `t`) and it rendered a
    near-SPHERE. `t` survives as the PRE-fold offset — a live deformation
    knob, classic Mandelbox at `t = 0` — so the mode still adds NO
    document state and stays a render MODE over the existing vocabulary
    (morphs/mutations/persistence untouched). The Julia form was
    measured, not merely argued away, and lives on as a local in
    `scripts/escape-form-sweep.harness.ts`; it does not earn the
    permanent document flag it would cost.
    Full record — the cycling/chaining tables, the refuted stiffness
    prediction, the instrument corrections, and the cost, bailout and
    step-scale figures — in `docs/escape-time-family.md`.
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
    previews included (fr-sjff; fr-du81 removed the preview tier's one
    unbounded draw — the i915-preemption GPU-hang path that killed fold
    sessions outright). Units are PIXELS, not rows (fr-096u): a strip is a
    row-major pixel interval rendered as 1-3 scissor rects under ONE fence,
    so fold strips shrink below a row's cost. The probe is sized from a
    per-px cost prior — the measured preview cost when one exists, else a
    pessimistic fold-class prior, else the legacy rows fraction for affine
    (the unprimed 3-row probe at full resolution was fr-096u's
    kernel-confirmed i915 preemption hang) — then strips scale toward a
    per-tier `targetMs` of measured GPU time each, measured by a
    forced-completion 1x1 readback and NOT `gl.finish()`, which some
    command-buffer paths return from before execution. Measurement scaling
    is blind to the fold+grid frames' 100-1000x cheap/expensive band
    bimodality, so every strip is ALSO capped at `STRIP_WORST_CASE_CAP_MS`
    of worst-case predicted cost.
    THE EVIDENCE CHAIN has semantics worth stating exactly: the price starts
    at a class-pessimistic ms/px, RATCHETS up as the job's own measurements
    reveal worse pixels, and chains across job re-arms via scene.ts. A
    COMPLETED job's whole-frame observation REPLACES the floor in BOTH
    directions (x10 tier-gap safety) — down matters, or a measured-cheap
    fold system stays pinned at class-floor micro-strips whose readback
    overhead dissolves its settle and poisons the cost gate — while partial
    jobs only RAISE. Relaxation lives exactly ONE completed-preview->settle
    handoff (a superseded job = the pose moved on = stale evidence dies).
    Measurements reach the ratchet through a measurement-time
    `observe(ms, px)` door as well as `next()`'s sizing-time one (fr-id9r:
    a job's LAST measurement never reaches a sizing call, and capture
    frames' final strips are the bottom rows, fold monsters' favorite
    home). Capture observations are RAISE-ONLY and may never own the floor,
    with one exception (fr-y1m7): a COMPLETED capture may SEED an EMPTY
    chain, because offline export is the one caller that never fills it
    otherwise — seed, never replace, and safe in the direction it can be
    wrong, since an export-scale trace resolves finer pixels than the live
    tier and so reads HIGH.
    THE PUMP IS PIPELINED (fr-096u's A/B verdict): every sync point on the
    Iris/ANGLE stack costs ~66-90ms REGARDLESS of the work behind it
    (`SURFACE_STRIP_SYNC_TAX_MS`), so strips go out as individually FLUSHED
    draw groups (the watchdog's preemption boundaries) fenced only per
    ~`SURFACE_STRIP_FENCE_GROUP_MS` of predicted work; batch measurements
    SUBTRACT the tax to price MARGINAL trace work (leaving it in
    re-inflated the evidence, tightened the caps, made more strips and paid
    more tax — a vicious cycle); strips of a row or more row-snap to a
    single scissor rect (a ~20-30ms per-DRAW fixed cost tripled under
    3-rect strips); and the canvas blit rides PRESENT-ON-DRAIN gaps
    (presents share the strips' GL queue). The pipelined refill bounds its
    in-flight queue at a queue price on TYPICAL-cost class floors (the fold
    PRIOR, not the fold WORST constant), raised live by the job's own
    ratchet and capped at one `STRIP_WORST_CASE_CAP_MS` of mispredicted
    work. No-prior jobs (affine) keep the legacy sync-collapse — serial
    joined strips completing whole light jobs in one call, escaping to the
    pipeline past `SURFACE_STRIP_SYNC_ESCAPE_MS`.
    Capture/offline export runs the SAME pump (fr-y6m0), looping it and
    differing only in how it WAITS between calls: the synchronous one
    (offline export, thumbnails) blocks on ONE whole-queue readback per
    queueful, the yielding one (fr-7mfx's Save-PNG) hands the main thread
    back on rAF — timer-backstopped at a frame, because a page whose frame
    clock runs slow starves the queue, and a bounded macrotask spin when
    the page is hidden. A capture job never presents (the export-scale
    target must not reach the canvas), ADOPTS the fence backlog like the
    live jobs, and winds its own queue down before returning from an abort
    so no export leftovers outlive the export. THE SYNCHRONOUS DRAIN
    RETIRES ITS FENCES WITHOUT POLLING THEM, straight after its readback:
    that readback is the stronger barrier, and a sync object's signaled
    state is only refreshed on the page's message loop, so a loop that
    never yields reads TIMEOUT_EXPIRED forever and spins on a queue the GPU
    finished long ago.
    COST CEILINGS ARE THE SYNCHRONOUS DRAIN'S ALONE since fr-avf6 — offline
    export and thumbnails, the callers that freeze the tab for a frame's
    whole duration and offer no way to stop it. There, measured evidence
    predicts the frame up front (never the class prior, which would refuse
    every fold export sight unseen) and refuses past
    `SURFACE_CAPTURE_PREDICT_CEILING_MS` (120s); the drain itself aborts
    past `SURFACE_CAPTURE_SPEND_CEILING_MS` (60s) of real spend; both throw
    `SurfaceCaptureCostError` — the offline exporter fails the run, the
    thumbnail path falls back to the explorer render. THE INTERACTIVE
    SAVE-PNG IS REFUSED NOTHING: its modal discloses measured coverage, its
    Cancel works, and the drain yields, so a prediction deciding for the
    user is the patience-guessing fr-zx34 already reverted one tier over.
    THE STANDING VERDICT IS NO AUTOMATIC GIVE-UP (fr-24to, fr-zx34, the
    user's own call): the settle always ARMS however expensive the frame —
    bounded strips grind visibly and interruptibly, and an early cut that
    gated it on predicted cost silently blanked legitimate lens settles
    into permanent preview blur, which reads as a broken render — and the
    preview always runs to COMPLETION, with `surfaceRenderProgress()` and
    the surface progress row disclosing honest coverage (naming its engine
    since fr-tmgf) so the user decides. Two rounds of budget/prediction
    truncation shipped and were REVERTED; fr-ud7n carried the same line
    across the WebGPU seam.
    fr-nl32's COALESCING RULE: `renderSurface("preview")` ARMS a fresh job,
    so re-arming per invalidation discarded the in-flight partial and any
    renderer where a preview spans frames painted essentially nothing for a
    whole drag. main.ts's tick now coalesces like the compute loop — while
    a job is in flight an invalidation STEPS it instead of re-arming, and
    stays latched in `scene.needsRender` so the next arm takes the freshest
    camera. Pose coherence is free (`armSurfacePreview` snapshots the
    camera into uniforms, so a multi-frame job traces ONE pose).
    Fold surface sessions gate their first frame on `compileAsync` of the
    fold tracer program (~25s links happen off the critical path where the
    driver offers `KHR_parallel_shader_compile`); THE COMPILE MESH MUST
    MIRROR FullScreenQuad's position+uv triangle or the draw links a second
    program variant, and the gate defers activate()'s guide/selection
    refresh so no other re-link joins the driver's compile queue behind it.
    Gated by `scripts/capture-export.verify.mjs`,
    `scripts/capture-drain.verify.mjs` and `scripts/surface-tier.verify.mjs`
    (whose mid-drag softness check is fr-nl32's); `scripts/fold-settle-park.repro.mjs`
    and `?surfacetrace` sit one module over. Pure, tested.
    Full record — the A/B measurements, the reverted truncation attempts,
    the sync-tax arithmetic and the cost-ceiling history — in
    `docs/surface-strip-pipeline.md`.
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
    than degrading silently.
    VARIANT ARMS, resolved by `surfaceFragmentFor`: `SURFACE_FOLD_LENS`
    (fr-g58b — the preprocessor renames the descent bodies to
    `surfaceDECore`, the wrapper owns the public `surfaceDE` overloads
    mirroring `descendLens`, and the cores' own `uFinal*` lens uniforms are
    packed IDENTITY while the wrapper applies the real lens from `uLens*`);
    `SURFACE_ESCAPE` (fr-kltj — replaces the descent bodies wholesale with
    `escape-de.ts`'s forward loop, packed by `setEscapeSystem`);
    `SURFACE_BULB` (fr-7u8t.9 — `bulb-de.ts`'s forward triplex-power loop,
    packed by `setBulbSystem`, nested inside `SURFACE_ESCAPE`'s `#else`
    because the two are ALTERNATIVES, each replacing the descent bodies
    wholesale, so `surfaceFragmentFor` refuses the pair; its `uBulb*`
    uniforms are declared INSIDE the arm so no other variant pays their
    bytes); `SURFACE_GROUND_PLANE` (fr-rhn5 — an infinite one-sided floor
    below the session ball, lit by a `shadeGroundPlane` entry mirroring the
    WGSL arm term for term, called from all three miss exits, composing
    with every other variant except the balloon, which throws — no horizon
    inside the shell); and `SURFACE_BALLOON`. Since compute became the
    preferred tracer, the escape, bulb and fold-lens arms are the FALLBACK
    arms (`?surfacegl` / no adapter / device loss).
    The escape arm CYCLES the whole formula chain since fr-s04t:
    `uEscM`/`uEscT`/`uEscParams` are declared INSIDE the arm as one slot
    per link, `uMapCount` is the link count, `uMaxDepth * uMapCount`
    single-link steps keep `uMaxDepth` meaning PASSES, and
    `uSymOrder`/`uSymPlane` drive `foldQuerySector` once before the orbit.
    Since fr-j231 a link may be a POWER map, which cost three things and no
    layout change: the fold pair's `kind != 2` / `kind != 1` tests are
    exhaustive by NEGATION over {1, 2, 3}, so kinds 4 and 5 sit behind a
    `kind < 4` GUARD rather than beside them (unguarded, kind 4 satisfies
    both and runs both folds — the hazard `surface-de-gpu.ts`'s doc cites
    as why the Mandelbulb became a sixth CORE); `bulbPow8` is DUPLICATED
    from the `SURFACE_BULB` arm character for character, because the two
    arms are alternatives and neither can see a definition emitted inside
    the other (a test diffs the two bodies so the copy cannot drift); and
    `uEscLogForm` is a SCALAR, not a params tail, because the estimate form
    is ONE number per CHAIN read after the orbit, and making it depend on
    which link happened to terminate would put a step across every boundary
    between the two forms.
    THE STRIP IS A SIZE RULE, not the plane arm's private habit (fr-s9ll):
    `surfaceFragmentFor` strips any resolved source past
    `SURFACE_GLSL_STRIP_BYTES` (64KB) through `stripGlslSource`, a
    whole-source comment/indentation strip emitting the identical token
    stream. The cliff is real — Mesa crashes at ~80KB (82.2KB observed) —
    and a size threshold is the honest predicate for a size cliff, where a
    hand-kept list of which variants strip is what drifts the next time one
    grows a paragraph. MEASURE BEFORE ADDING THE NEXT PARAGRAPH:
    `surfaceFragmentFor(escape, lens, balloon, plane, bulb).length` against
    `SURFACE_GLSL_STRIP_BYTES`. The escape and bulb arms are the ones with
    headroom left to spend and the escape+balloon pairing is the one to
    watch.
    Orbit-trap color blends descent choices TOP-DOWN (depth-0 copy
    dominates, flam3's convention — fr-gt9i); the per-level decay is the
    Color speed slider (default 0.5 = that original fixed behavior), and
    the rings/sheets orbit-trap color sources ride the same hit-info
    descent (fr-rl4b). The march samples `surface-grid.ts`'s floors
    (NEAREST 3D texture) before paying a descent (fr-55r5 part 2): a floor
    above `uAcceptPixelEps` — fr-7xgi's tier-pinned acceptance eps, NOT the
    buffer-scaled `uPixelEps` — is both a no-hit proof and a safe stride,
    damped by the same `uStepScale` as analytic steps; gridless marching
    stays the always-correct fallback. Skips drain their own whole-ray cap
    (`SURFACE_GRID_SKIP_CAP`), never the analytic march budget, and the
    full-tier budget is 160 — fr-z70m: charging cheap conservative skips
    against 96 march steps starved rays that thread gaps or graze faces,
    dissolving far/threaded geometry into view-dependent dropout speckle
    (measured + healed in `scripts/erosion-repro.harness.ts`). The three
    shading taps (normal/shadow/AO) ride the value form, which fold systems
    route to `surfaceDEProbe` — a width-1 instantiation of the SAME
    fold-descent template (fr-zqu8, fr-p8bc's verdict on the fragment path;
    one text two names, march/hit acceptance stay width 12). The fold-lens
    variant deliberately carries no probe (fr-otkf tracks the port — lower
    stakes now that it is the fallback rather than the primary tracer).
    Full record — the variant KB sizes and their history, the Mesa link
    cliff, the probe-width A/B and the grid-budget measurement — in
    `docs/surface-glsl-tracers.md`.
  - `surface-material-4d.ts` — 4D twin (fr-vxoj): sphere-traces the
    `w = w0` slice of the rotor-posed 4D attractor, mirroring
    `surface-de-4d.ts`'s `estimateDistance4Refined` line for line (refined
    certificates + width-4 beam — the fr-beck-measured ghost eliminator
    plus fr-jkpn's validity slots).
    The slice has a THICKNESS since fr-wa6o: `uSliceHalfW > 0` makes every
    descent query the SEGMENT spanning `|w - uW0| <= h` instead of the
    point `(p, uW0)`, so the mode renders a SLAB's projected shadow rather
    than a cross-section (the oracle's `halfExtent`, mirrored line for line
    — one `vec4` per chain/candidate, `segmentRadius` for every `length`,
    and the visible-ball gate widened to `max(0, |uW0| - h)`). `segment` is
    a dynamically-uniform branch, so `h = 0` — the shipped default — costs
    nothing beyond the extra live registers and renders today's frame value
    for value.
    Rotor + w-slice are LIVE per-frame view uniforms (`setSurfaceView4`),
    unlike flame/solid-4D's frozen snapshot — the slider is normalized
    rotated-w, and `scene.ts`'s `setSurface4View` converts it to the
    tracer's world `uW0` through `wSupport` (fr-33yb), so one slider
    position is one hyperplane across every mode; 24-map cap matching 3D's,
    the per-map arrays riding a std140 uniform BLOCK (fr-dqlq), and the
    kaleidoscope SWEEPS like 3D's (fr-u91x), so 24 slots means 24
    transforms at any order. Since fr-dlxh's 4D cut this tracer is the
    PLAIN-4D fallback arm and the kaleidoscope-4D MEASURED HOME: order > 1
    routes here by verdict, caveat-free (fr-b72d attributed the gap to the
    compute arm's march-loop scheduling, not kernel codegen).
    TWO VARIANT ARMS since fr-qxxw/fr-h0c3 — the balloon inverted-union and
    the ground plane, each mirroring its 3D original term for term — and
    the MECHANISM is the one deviation, forced by measurement: one
    monolithic `#if` source would put EVERY 4D session in the band where
    the 3D fold program takes ~25s to link. So the arms resolve JS-side,
    through `surfaceFragmentFor` ITSELF rather than a second preprocessor
    (`surface4FragmentFor` is a two-line wrapper), and THE `defines` KEYS
    ARE `SURFACE4_*` WHILE THE GLSL DIRECTIVES STAY THE 3D NAMES —
    deliberate, called out at both sites, and renaming them would break
    resolution.
    Three things could not be copied: `balloonInnerDE`'s far-field clamp
    (it exists for 3D's FORWARD cores, whose zero-iteration far value is
    not a distance to anything; this tracer's core has a value-exact sphere
    floor that already IS the bound — the arm records that a future 4D
    forward core owes it), `shadeGroundPlane`'s normalizer (the FULL 4D
    radius, not `sliceVisR`, which collapses at the slab edges and would
    make the floor breathe as the slider scrubs), and the post-march miss's
    sphere-exit/exhaustion split, which had to be ADDED — 3D splits it
    because it has a floor to classify into, and EXHAUSTED never planes.
    Full record — the measured source sizes and the strip threshold
    arithmetic — in `docs/surface-glsl-tracers.md`.
  - `surface-compute.ts` — WebGPU compute renderer, and the ROUTING is the
    part to get right. PREFERRED whenever an adapter exists: fold-shaped 3D
    sessions (fr-tzdg — base-map folds OR a fold FINAL lens, i.e.
    `deHasFolds(de) || foldFinal`, fr-55s1), escape-time sessions (fr-dlxh — the
    non-contracting pure-fold map, or since fr-s04t the CHAIN of them, that
    the IFS gate refuses), bulb sessions (fr-tdin), and PLAIN 4D sessions
    at symmetry order 1 (fr-dlxh's 4D cut). For all of those no fold GLSL
    ever compiles (the ~25s Mesa link, the ~5.7s lens link and the fr-096u
    entry hazards never engage) and no grid is requested (gridless by
    measured decision). COMPUTE-ONLY, entry REFUSED without compute and a
    mid-session loss exiting the mode with a toast: fold-shaped 4D sessions
    at any symmetry order (fr-rsp6) and escape-shaped 4D sessions (fr-vag4)
    — the fragment 4D tracer deliberately carries no fold GLSL and no
    forward-orbit GLSL either. STAYS ON THE FRAGMENT TRACER by measured
    verdict: kaleidoscope 4D (non-fold, order > 1), where the compute arm
    never settled an observation the fragment arm settled in seconds;
    fr-b72d's closure exonerated the kernel — the DE's cost is
    algorithmically superlinear in order for BOTH arms and the
    uniform-maps/refinedCert suspects were refuted on the extended
    `--surface-aff4-sweep` leg — so the residual is this module's
    march-loop scheduling under an expensive-DE regime (fr-fniy).
    `create()` takes a `SurfaceComputeTarget` union
    (`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`) whose `kind` picks
    the kernel core (ifs4 → affine4 or fold4 off `deHasFolds4`, the 3D
    `deHasFolds` split one dimension up; `bulb` → `core:"bulb"`; `escape4`
    → `core:"escape4"`), the params packer and the maps buffer's
    layout/existence — the bounded march/shade host loop, progressive
    presents and failure ladder stay shared regardless. Two predicates keep
    branches honest: `isForwardTarget` names the THREE forward kinds so a
    branch cannot serve one and miss another, and `isFourDTarget` names the
    two whose frame spec must carry `view4` — `escape4` being in both sets.
    `isForwardTarget` no longer means "no maps buffer": BOTH escape kinds
    carry their formula chain on the maps binding, so every maps-shaped
    branch names them ahead of the predicate and `bulb` is the one
    bindingless kind left. The BALLOON and the FLOOR ride an ifs4 target
    since fr-qxxw/fr-h0c3, with the 3D arm's precedence (the two never
    compile together and the balloon wins); NO FORWARD KIND EVER BALLOONS,
    in either dimension. Escape and plain-affine ifs4 targets scale no
    priors; fold/lens-shaped ifs4 scales by branch count like 3D. The ifs4
    kind's rotor/slice view is PER-FRAME SPEC STATE (`spec.view4`, re-read
    from the scene's `setSurface4View` state at every spec assembly and
    repacked per pass — the fragment tracer's live-uniform discipline
    across the WebGPU seam; a missing view4 throws), and
    `surfaceComputeForceFrameKey` includes the pose so a timeline leg's
    rotor/slice glide never re-presents a stale frame.
    Owns the device (bench acquisition idioms + flame-backend error
    taxonomy) and the frame loop: march slices sized from a measured
    per-ray·step EMA, THE SWEEP'S ACTIVE-LIST REBUILD READING 4 B PER
    ACTIVE RAY off the march's own status side-channel and not the whole
    16 B/ray states buffer (fr-si66: the states never leave the device,
    the terminal tally is kept as rays LEAVE the list, and the bench pins
    it with no bench edit — leg B's hit-rate gate reads exactly that
    tally. MEASURED 12.3x less transferred and 7.2x less host time
    blocked per settle, `scripts/march-readback-ab.mjs`; the settle WALL
    did not move, because it is shade-dominated, and the settled PNGs are
    byte-identical across the change), and shade batches sized in HIT
    units (fr-p8bc:
    terminal rays queue by status — misses are one background write, hits
    and, since fr-rhn5, ground-plane PLANE terminals pay the probe evals
    and arrive scanline-CLUSTERED; the original ray-unit
    doubling let miss runs inflate capacity a hit band then paid, five
    kernel-confirmed i915 GPU hangs) and FLOORED AT ONE WORKGROUP, NEVER
    ONE HIT: within a workgroup cost is depth-dominated, so sub-workgroup
    batches buy no submission-wall safety, and the old 1-hit floor was a
    one-way trapdoor — one hit band past the pass target and every 1-ray
    batch re-measures the full per-submission wall as its per-hit cost,
    the estimate latches it, and the settle reads as parked forever at a
    pose-dependent percent (fr-d6g5's Mesa-25.2.8 "park"; `?surfacetrace`
    and `scripts/fold-settle-park.repro.mjs` are that diagnosis'
    instruments, kept). THE FREE (miss/exhausted) QUEUE HAS NO CAP AT ALL
    since fr-257o — one background write per ray is not a cost model, so
    it drains WHOLE in one dispatch per sweep, bounded by the device's
    dispatch ceiling alone, which BOTH sizing paths now clamp at
    (`surfaceComputeMaxDispatchRays`; the frame ceiling deliberately does
    NOT meet it — memory question, not submission shape). MEASURED 2492
    free dispatches -> 58 and a 35.0 s settle -> 25.0 s, settled PNGs
    byte-identical. AND THE HIT HALF IS NOT REAL WORK EITHER, which
    fr-si66's record had concluded, fr-257o's own instrument refuted and
    fr-2ojg fixed: a hit dispatch's wall is FLAT in its width to at least
    eight workgroups (its hits come from one scanline band, so the cost is
    the deepest ray's and the lanes run in parallel), so dividing a
    submission's WHOLE time by its ray count charged LATENCY to every hit
    and the sizer walked itself down to the floor — fr-d6g5's trapdoor at
    every width below the occupancy knee. The sizer now carries a two-term
    model, `cost(n) = intercept + n*marginal` (`ShadeHitCost`), splitting
    each measurement's surprise between the terms by WIDTH (`n/(n+512)` to
    the marginal — 512 is where the cost curve measured flat), sizing off
    the MARGINAL alone, allowing `max(pass target - intercept, intercept)`
    of hits per dispatch (a latency-bound dispatch cannot be made cheaper
    by narrowing it, so refusing to widen it buys nothing), growing the
    capacity ladder against THAT budget rather than a fixed
    `PASS_TARGET/2`, rate-limiting the marginal's FALL to a halving
    (`SURFACE_COMPUTE_SHADE_MARGINAL_DECAY` — clamped at zero it reads
    "hits are free" and one cheap dispatch buys the whole capacity, which
    is fr-p8bc's inflated-capacity hole re-opened in the cost model),
    sharing ONE sizer across a supersampling job's passes (same pose, same
    raster — across FRAMES the ladder's first-encounter bound is the
    point), and HOLDING a partial hit batch for the next sweep rather than
    paying the intercept for a sliver (bounded by the march having rays
    left AND by one present interval). No per-hit PRIOR survives — it
    could only ask for less than the one-workgroup starting cap already
    gives, and its decay held ~7 dispatches at the floor.
    `SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS` IS 2000 AND ITS PLACEMENT
    IS THE MEASUREMENT, not a round number: a ceiling on the predicted
    TOTAL must squeeze the allowance to nothing as the intercept
    approaches it, so it has to sit outside the range real scenes measure
    in — at 1000 it bit mandelboxKifs (whose intercept reaches 960 ms)
    directly, and moving it to 2000 bought 3.5x the hits/s there at an
    UNCHANGED worst dispatch. MEASURED, real Iris: boxfoldPair settle
    25.0 s -> 10.1 s (3.5x from the pre-fr-257o 35.0 s), hit shade
    14807 -> 2650 ms, 139 -> 20 dispatches; mandelboxKifs 6.1x the
    hits/s; lens3 -14.3%; the 4D `affine4` arm -39% on the same gate (the
    sizer is host-loop state, shared by every core in both dimensions, so
    there is no 4D twin owed); all ten settled PNGs byte-identical. AND THE
    WORST SINGLE DISPATCH DID NOT GROW, which is the watchdog answer a
    mean cannot give: 181.2 -> 188.3 ms on boxfoldPair while the batch
    that produced it went 369 -> 2197 hits, and on mandelboxKifs
    1714.8 -> 1731.3 ms — the fold monster's worst submission is its
    deepest ray, not the sizer's width, and it hit that number at
    `len=64` before this and at `len=512` after.
    NO submission outruns the i915 watchdog;
    progressive presents between every bounded piece; host-compacted active
    list; shading probes ride `SURFACE_COMPUTE_SHADE_DE_WIDTH` (the fr-p8bc
    verdict); colorOut prefill seeded from the last frame
    (nearest-resampled), so during motion the present is the PREVIOUS frame
    with its newly resolved rays overwritten and the pane never shows
    backdrop mid-drag (fr-f4bx — which refuted its own bead's premise:
    there is no worse frame being painted over a better one to suppress);
    per-frame status counts for field debugging.
    SUPERSAMPLING (fr-vpbq) rides that loop as `opts.samples`: N FRAMES of
    the same image at N sub-pixel offsets (`subPixelSample` — pass 0 the
    pixel CENTRE exactly, the rest the R2 low-discrepancy sequence),
    averaged in LINEAR light because both tracers end with a
    `pow(lit, 1/2.2)` encode and averaging the bytes is the edge-darkening
    bug. N frames rather than N rays per frame, so the five per-ray buffers
    and every watchdog bound stay exactly as measured and fr-biox's device
    ray ceiling is not met N times sooner — and so the result is
    PROGRESSIVE: pass 0 is the pre-fr-vpbq frame, arriving when it always
    did and presenting its own partials, every later pass only refines, and
    a superseded job keeps what it finished. main.ts spends it on the live
    SETTLE and on Save-PNG at 8 samples, never on a preview (cheap by
    definition) and never on offline VIDEO force frames (the cost would
    multiply by the frame count); the progress row discloses the pass as a
    trailing `antialiasing pass k/8`, silent through pass 1.
    `?surfacesamples=N` is the escape hatch and the A/B instrument. THE
    WEBGL STRIP ARM DOES THE SAME THING BY THE SAME ALGORITHM (fr-jf9y) —
    it imports `subPixelSample` from here — so "8 samples" has ONE meaning
    whichever engine a machine has.
    A FRAME'S RASTER IS BOUNDED BY THE DEVICE, NOT THE CALLER (fr-biox):
    the six per-ray buffers cost 36 B/ray (44 across five before fr-si66
    dropped the ray state's MAP_READ twin), and it is the 16 B ray state
    as a bound STORAGE buffer that a limit bites, so `maxFrameRays`
    = min(maxBufferSize, maxStorageBufferBindingSize)/16 and a frame past
    it throws `SurfaceComputeFrameSizeError` UP FRONT instead of reaching
    the kernels, because WEBGPU REFUSES SILENTLY HERE — an over-limit
    `createBuffer` returns an invalid buffer plus a validation error, and
    the first REJECTION is a staging `mapAsync` whose message names nothing
    about size. Both callers size against it: the live pane FITS
    (`fitSurfaceComputeRaster` — one frame IS the image, so a hidpi raster
    past the ceiling traces soft and blits up, the preview tier's own
    mechanism, disclosed once per session) and a capture TILES
    (`surfaceComputeTileRows`, also capped at
    `SURFACE_COMPUTE_MAX_TILE_RAYS`). `captureSurfaceComputeFrame` traces
    the export as full-width BANDS — every band's spec assembled in ONE
    synchronous span (a tiled export outlives an auto-orbit/drift camera
    move, the compute answer to the WebGL drain's frozen uniforms), each a
    `camera.setViewOffset` sub-frustum, at the FULL image's trace eps, with
    `surfaceComputeBandStops` restricting the backdrop pair to the band's
    own edges (every tracer spreads its stops over its OWN rasterHeight, so
    whole-image stops would repeat the gradient per band). One band is the
    whole image on an ordinary export, byte-identical to the untiled path.
    `?surfacemaxrays=N` pretends a device ceiling;
    `scripts/surface-export-tile.verify.mjs` is the gate.
    `destroy()` defers the real `device.destroy()` until every in-flight
    frame unwinds (fr-uec4: a frame parks on LIVE submitted GPU work —
    `mapAsync` over a submitted `copyBufferToBuffer`, or
    `onSubmittedWorkDone` over a submitted dispatch — and tearing the
    device down under one of those took the WHOLE Firefox process down,
    not a tab crash or a device-loss toast). `destroyed` means "teardown
    REQUESTED" and `deviceDestroyed` means "device GONE" — the guard that
    stops both the idle path and the drain path (`releaseFrame`) from
    calling `device.destroy()` twice. The synchronous teardown still runs
    whenever the device IS idle, which is what keeps gpu-bench's
    one-device-alive-at-a-time invariant and `RenderSession.terminate()`'s
    `void` contract untouched. Same shape as `flame-gpu-backend.ts`
    (fr-mxkk), counting OPS where this counts frames.
    scene.ts presents frames as a DataTexture through the shared surface
    blit (the one WebGL canvas — capture/recorder unchanged) and assembles
    specs with the uniform-exact camera/eps/tier quantities (acceptance eps
    stays native-height, fr-7xgi); main.ts routes and choreographs (same
    tier clock + preview governor, latest-wins preview coalescing +
    fr-ud7n's unbudgeted completion pass — the preview frame an
    invalidation must CANCEL rather than wait out, since it is the only one
    with no wall budget to expire — memoized offline force frames, one-way
    fallback: create failure or device loss re-enters through the untouched
    WebGL path; `?surfacegl` forces WebGL).
    Full record — the routing measurements, the fr-d6g5 park diagnosis, the
    supersampling evidence and the fr-biox field report — in
    `docs/surface-compute-renderer.md`.
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

**MERGE BY REBASE, NEVER BY SQUASH.** `gh pr merge <n> --rebase`, not
`--squash`. Merge commits are disabled on the repo, so the two buttons GitHub
offers are rebase and squash and the wrong one is one word away.

This is not a taste preference, and the reason is this project's own
discipline. A commit here is a DECISION RECORD — what was measured, what was
refuted, what a number cost — and the per-item commits a session writes are
the unit a later reader bisects, blames and quotes. Squashing collapses them
into one blob whose body is a wall of concatenated essays: the messages
survive, the ADDRESSABILITY does not, and `git log --oneline` stops being a
readable index of why the code is the way it is. The multi-item rule one
section up ("commit per item so history stays readable") is pointless if the
merge throws that away.

DO NOT infer the method from what recent PRs did. As of this writing every
merged PR on `main` landed as a single squashed commit — that is the mistake
this note exists to stop, not the convention to copy.

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
