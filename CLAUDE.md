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

Nothing was dropped in the split — every figure and every refuted claim is
in `docs/`. The subsystem records:

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
- `docs/panel-ia.md` — the accepted control-family, applicability and edit-
  behavior contract for placing panel controls.

## Dimensional Parity — the 4D half is not a follow-up

**The site is fractal-4d.com. A capability that exists only in 3D is not
finished, and a session that leaves it that way is not done.**

The standing failure mode is shipping the 3D half, filing a "4D lift" bead and
closing the epic. The ground plane and the balloon both did exactly that; the
escape-time CHAIN was worse than either — `analyzeEscapeSystem` refused every
non-flat map outright (`map N extends into 4D`), no 4D oracle, kernel core or
GLSL arm stood behind that refusal, and until the 4D chain landed nothing
tracked the lift at all, in the family whose own `qjulia-de.ts` describes its
object as "the one the site is named after: a genuinely 4D set, of which a 3D
render is a SLICE".

ONE SESSION CLOSED ALL THREE — the chain's, the ground plane's and the
balloon's 4D halves — and what it measured is the argument for the rule rather
than an anecdote beside it. The three lifts cost ONE structural decision
between them — where the 4D params tail's appended blocks land — and once that
was made (576, the 3D cores' frozen 288 one dimension up), the ground plane
needed NO new shader text at all (the march classifier and shade entry were
already shared across cores), the balloon needed NO new wrapper text (every
core shares `surfaceDE(pIn: vec3f, …)` over a MARCHED point, so wrapping a 4D
core inverts in the sliced space for free), and the escape chain's oracle
duplicated only the five maps' arithmetic while IMPORTING every constant and
link code from its 3D twin. The expensive part was none of the algebra; it was
that the ground plane's lift had to warn a future session away from offset 560,
where a block appended without reading the lens4Fold quartet would have landed
INSIDE it. So:

The balloon's remaining Points half closed with the same
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
  shape the ground plane's and the balloon's lifts both had, and the reason
  both were cheap to close when someone finally did. "3D first, 4D later" is
  not a reason. `surface-grid.ts` is the model REFUSAL (a live rotor/slice
  invalidates a grid per frame — stated, not implied), `bulb-de.ts` its
  sibling one family over (triplex numbers are R³ with a spherical-coordinate
  product and no fourth component to give meaning to, so `variations4.ts`'s
  `bulb` carries `w` through untouched — honest for the chaos game, useless to
  an estimator), and the quaternion Julia set's refused 4D lift the model
  WON'T-DO (closed on twenty measured panels, not on a hunch about cost).
- **The lift costs more later, and the cost is structural.** The 3D half
  freezes wire layout the 4D half must then append past — the ground plane's
  lift records a plane block appended at 4D offset 560 landing INSIDE lens4 and
  corrupting it — and a lift written months later re-derives shared algebra
  instead of importing it, which is how two renderers start drawing different
  objects from one document. `variations4.ts` importing `resolveFoldRadii`
  rather than restating it is the standing counter-example, and
  `escape-de-4d.ts` importing every constant, link code and estimate form from
  `escape-de.ts` is the second: what a chain IS has one definition across both
  dimensions, and only the maps' arithmetic is duplicated under the twin-file
  convention. `inversion.ts` (`inversionBallScale`) SHIPPED as the helper the
  4D slab work and the balloon lift agreed to share, before its second caller
  exists rather than after — the balloon lift did NOT need it
  (slice-then-invert keeps the inversion 3D and the slab rides both terms
  untouched), and the spherefold slab port that would consume it stays REFUSED
  on the slab work's own measurements (`slabExact4`), so what is still owed is
  that port, not the identity.
- **An unlifted gap is disclosed, not quietly filed.** A session that ends
  3D-only says so in the PR description and in its closing summary, as
  unfinished work. The bead is the tracking; it is not the disclosure.

## Panel information architecture — classify before placing

**Every panel control has one conceptual home — Scene / Look, Renderer,
View / Device, or Workflow — chosen independently of its consumers, lifetime
and edit behavior.** Keep the native exclusive-open top-level accordion;
sections own applicability, shared open sections survive renderer changes,
dependent details hide, dormant authored capabilities disable with an adjacent
reason, document status never lives only under a mode gate, and every visible
edit discloses whether it is live, restarts, applies on next entry, or is
refused. Active editing precedes output/library controls. The placement record,
ordering and examples are in `docs/panel-ia.md`.

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
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (all seven cores; eval/march baselines + the app path's march-unproject/shade) to its CPU oracles; add --display=:0 for real-driver timing. Run it on a QUIET machine, never beside the test suite: a contended software device corrupts mid-run readbacks, which the contended-device canary reports as verdict=device-unreliable (exit 2, rerun). JUDGE THE ESCAPE ROWS ON --display=:0 — escChainKaleido carries a known SwiftShader-only false failure and the flip cap must NOT be raised to make it green. Fixtures, caps and measured rows: docs/gpu-bench-surface.md
```

**`--display=:0` NEEDS AN X COOKIE, and without it every gate that offers it
falls back to SwiftShader SILENTLY.** This machine has the real Iris — the
driver this file keeps calling the authority — but an agent/SSH shell arrives
with a forwarded `DISPLAY` (`localhost:10.0`) and no authorization for `:0`, so
`--display=:0` gets "Authorization required" and the run quietly measures a CPU
rasterizer instead. Nothing fails; the numbers are just not the ones you asked
for. The credential is Xwayland's, and its suffix changes every login, so glob
it rather than pasting a path:

```bash
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
export DISPLAY=:0
glxinfo -B | grep "OpenGL renderer"   # MUST say Mesa Intel(R) Iris(R) Xe, not SwiftShader
```

CHECK THAT LINE BEFORE BELIEVING A REAL-DRIVER ROW. A SwiftShader run that was
meant to be an Iris run is the failure mode this note exists to stop — one
session shipped its whole measurement set on software before noticing, and the
gates it could not complete at all (`bench:surface`) were the ones the
software adapter is too slow for rather than the ones that were broken.

Run a single test file: `npx vitest run src/fractal/chaos-game.test.ts`

The escape-time family's in-app gate (not an npm script — it drives a
real build in a real browser): `npm run build && npm run preview &` then
`node scripts/escape-family.verify.mjs --mode=x11::0`. It loads every preset in
the Escape-time menu group FROM THE MENU, enters Surface, waits on the
`?surfacestate` settle latch and checks four things no unit test reaches: that
each preset enters unaided; that the members of each trio render DIFFERENT
objects (a knob that never reaches the DE renders the same picture three
times); that `PRESET_FINALS` installs and clears in both directions, read out
of the `#v1=` document hash rather than the panel (the transform list hides
outside explorer mode, so a DOM probe passes vacuously); and WHICH ENGINE each
session takes — measured compute for all nine, which is what keeps the
`core:"bulb"` WGSL kernel from being dead code. It also gates the empty-set
toast and the `antialiasing pass k/8` disclosure. `--mode=sw` runs everything
but the engine question without a display.

The 4D lifts' gate (chain, ground plane and balloon, same prerequisites):
`node scripts/surface-4d-lift.verify.mjs --display=:0`. Eight scenes as
`#v1=` hashes rather than presets — so it needs no preset table and
survives one changing under it — each driven into Surface FROM THE UI
and asked the four questions no unit test reaches: does the session
ENTER, does it reach a COMPLETED settle (the settle latch), does it
DRAW (non-backdrop share of a real screenshot; a canvas READBACK reads
empty for a WebGL context outside its own rAF and measures 0% for a
frame that is plainly there), and WHICH ENGINE took it — which is what
keeps `core:"escape4"` and the 4D plane/balloon blocks from being dead
code. MEASURED real Iris, 1024x640, 11/11 (the first run with
`page.bringToFront()` — see below): the 4D chain 44.6%, under an xw
kaleidoscope 44.5%, with the floor 87.8%; a 4D IFS attractor with the
floor 87.7% and with the balloon 40.9%; kaleidoscope-4D 86.6% / 40.1%
(COMPUTE since the shade-sizer width fix — the 67.4% / 32.3% pair was
the earlier FRAGMENT record, and a later sweep caught the script still
expecting webgl); the 3D Mandelbox-with-floor control 88.2%; and the
three shipped 4D presets 89.5% / 89.4% / 83.1%, which no earlier run
reached. THE FLOOR-BEARING ROWS ALL FELL ~1.0-1.5 POINTS against the
previous record while the two FLOORLESS rows reproduced to the digit,
which is that run's own prediction that a gate parking mid-settle may
have been measuring a partially-drawn frame; one run, so it is a re-read rather
than a second independent pin. Its kaleidoscope fixture is
deliberately LIGHT (2 maps at order 3) and that is a measurement too — a
four-map order-5 4D system settles neither with the floor NOR without it
inside 200s on this hardware, which is the DE's own superlinear order cost
and not anything a lift did. Without `--display` the engine column is
reported rather than gated.

The 4D explorer balloon gate is self-contained:
`node scripts/explorer-balloon-4d.verify.mjs`. It drives Pentatope through
Points, parks the tumble, enables the echo, reloads the app's own copied link,
then compares real SwiftShader canvas frames with the restored echo on/off.
That one path gates the non-flat controls, boot-time ball-uniform sync and the
project-then-invert shader compile/render together. IT COMPARES THE SCENE
REGION, NOT THE FRAME, at a radius the DOCUMENT carries and where the echo is
demonstrably on screen — the original row diffed the full frame at the
document's own 1.60x, where the echo is off screen entirely, so all 10.255% of
it was `#panel` growing a row and a shader drawing NOTHING would have passed
(same two frames, scene only: 0.000%, max 0). MEASURED re-pinned: 19.9% of
scene pixels changed, meanAbs 0.944, against a 2% floor. The radius is driven
BEFORE the share link is copied, because `setBalloonEchoRadius` syncs the
uniforms and a post-reload drive would repair the very desync the gate exists
to catch. It still does NOT separate project-then-invert from
invert-then-project — both draw something; that needs a rotor pose where they
visibly disagree.

**Harness sheets** (`scripts/*.harness.ts`, run with
`npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>`)
are this project's executable measurement records — the argument for a
decision, kept runnable rather than summarized. Two shared instruments
carry the rules. `scripts/de-preview.ts` is the SHARED renderer eight of
them import (`renderPreview`, `writeContactSheet`, `encodePng`, and the
`DistanceEstimator`/`PanelStats` vocabulary): a CPU sphere-marcher with
AO/shadow switches, a settable step budget and an always-counted
`exhausted`, so a new sheet writes its estimator and its panel list, NEVER
a ninth marcher. `scripts/set-extent.ts` is the other: the ONE
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

Requires **Node.js 22+** (.nvmrc pins 22; the compile target is ES2022).

Reproduce the COOP/COEP first-visit reload locally:
`node scripts/isolation-reload.verify.mjs` (not an npm script) —
serves the production build over a plain static server with no COOP/COEP
and a deliberately delayed `sw.js`, widening the reload window on demand;
`npm run preview` can trigger the same dance, but only at real,
easy-to-miss localhost timing.

The post-deploy live-site gate (not an npm script):
`node scripts/live-site.verify.mjs [url]` boots the REAL deployed origin
(default https://fractal-4d.com) in headless SwiftShader Chromium and
asserts what only the live host can prove: HTTP OK, app boot
(`#pointCount` > 0, `#error` empty), the SW's COOP/COEP compensation
completing (`crossOriginIsolated` true through the one isolation reload),
a controlling service worker, and no console errors. Exit 2 means the
CHECKING side failed (browser/network) — rerun, it is not a site verdict.
Run it after every `gh workflow run deploy.yml`.

The WebGPU compute-surface teardown gate (not an npm script — it
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

Its flame sibling (same prerequisites, same dev server):
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
INFORMATIONAL, not a gate on the deferred teardown: leaving flame mode never
calls `destroy()` at all, since main.ts kills the worker with
`worker.terminate()`, orphaning a live map a different way. MEASURED: the
crash does not reproduce on this stack in either direction (pre-fix module
12/12 clean, fixed module 12/12 clean), so this is a regression gate
rather than a reproduction — the script's header carries the full
numbers.

The flame Save-PNG gate (not an npm script — it asserts what a
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
`src/` `.ts` files (a staged `scripts/*.ts` gets Prettier only — its lint waits
for `npm test`) and Stylelint + Prettier on staged `.css` files. Hooks are installed by
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
  - `background-shape.ts` — the backdrop gradient's SHAPE: "given
    a pixel, what is the mix parameter between the two stops", as against
    `background.ts`'s "given a mode, what are the two stops". The ONE
    definition six mirrors used to hold independently — a canvas 2D
    gradient, three byte-identical GLSL `mix(uBgBottom, uBgTop,
clamp(vUv.y, 0, 1))` lines, the WGSL row form, its obliged-byte-exact
    TS prefill mirror, and `surfaceComputeBandStops`, the shape's AFFINE
    INVERSE. Emits `backgroundShapeT` from ONE body TEMPLATE in two shader
    dialects (dialect-parameterized — see below — but still
    ONE shared math text), and mirrors it in TS for the prefill and for
    `backgroundMeanColor` (the shape INTEGRATED AWAY — THREE.Fog carries
    one scalar colour). THE COORDINATE CONTRACT IS THE LOAD-BEARING PART:
    every mirror evaluates at FULL-IMAGE coordinates
    `(pixel + 0.5 + bgOffset) / bgExtent`, a DIVISION by the full extent
    and never a multiply by a precomputed reciprocal, so a capture BAND
    reports where it sits instead of remapping its stops — which is what
    retired `surfaceComputeBandStops` (a linear ramp restricted to a
    sub-rectangle is still a two-stop ramp; nothing else is) and what lets
    a non-linear shape exist at all. `"radial"` is the second
    entry in `BACKGROUND_SHAPES`: a smoothstep vignette reading a
    host-computed `center`/`scale` (`backgroundRadialScale`, per-axis so
    the shape stays circular in real pixels rather than elliptical in
    normalized UV) through the SAME dialect `field` accessor
    (`uBgCenter`/`shade.bgCenter`) both shader mirrors and the WGSL
    `ShadeParams` tail (`surface-de-gpu.ts`, `bgCenter`/`bgScale`/`bgShape`
    appended at 176/184/192, struct 208 B then, 224 since
    the balloon tint pair) now carry — a SHAPE
    orthogonal to `background.ts`'s GRADIENT modes, so every gradient mode can
    be linear or radial and `BackgroundGradient` stays the two-stop pair it
    always was. The per-pixel `"flame"` mode keeps the authored shape dormant
    until a gradient mode is selected again.
    Full measurement record (byte sizes, the two-token dialect divergence,
    the viewport-vs-canvas scale distinction) in
    `docs/surface-glsl-tracers.md`.
  - `balloon-de.ts` — the balloon inverted-union DE: the scene as
    the UNION of the attractor and its sphere-inverted echo
    `I(p) = c + R²(p−c)/|p−c|²`, bounded by
    `min(DE(p), (|p−c|/rho)·DE(I(p)))` over the UNTOUCHED public
    estimators — the `descendLens` idiom one wrapper further out,
    conservative at every R (the measured verdict; module doc carries the
    certification argument against the DE's own probe-fit ball, margined
    by `BALLOON_RHO_MARGIN`). The march-epsilon cutoff contract survives
    through the inverse-scaled inner cutoff; `BALLOON_FAR_CAP_RHO` is the
    march-entry far cap every arm shares (capped rays fall to background;
    the grid stays off in balloon mode).
    CPU oracle for the `SURFACE_BALLOON` GLSL variant
    (`surface-material.ts`) and the `balloon: true` WGSL kernels
    (`surface-de-gpu.ts`, bench-pinned by `balloonEval`/`balloonMarch`
    legs); the explorer echo (`scene.ts`'s shared-geometry echo Points)
    reuses only the inversion + the far-cap vocabulary. IFS systems only:
    both FORWARD-ORBIT modes render plain — a filled solid's interior
    reaches the ball center, so its echo swallows the camera (the measured
    verdict for the escape folds; the Mandelbulb's own routing re-measured
    it rather than inheriting it — DE(0) = 0 with 100% of a 0.1R
    neighbourhood of the centre interior, union DE exactly 0 at the
    session's own opening eye for R = 0.35 and 0.9 raw-ball radii, and a
    flat featureless frame at every R) — and the estimator composed under
    the union must be far-field SOUND (a true lower bound outside the
    ball; the escape heuristic's `|q|` is not).
    Balloon on/`R` persist in the scene document; `R` is authored NORMALIZED
    (multiples of the raw ball radius, `buildBalloon`'s `rMult`), one
    continuous parameter across the explorer echo and the surface balloon.
    THE 4D LIFTS are semantic decisions and ball choices, no new algebra.
    The surface arm inverts in the SLICED 3D space and hands the
    estimator `(q, w0)` on both terms — SLICE THEN INVERT, so the echo is the
    inversion of exactly what is drawn, where inverting in 4D and slicing the
    result would draw the echo of a DIFFERENT slice (`I₄({w = w0})` is a
    3-sphere; the two agree exactly at `w0 = 0` for this origin-anchored
    ball). The Points arm applies the same reduction-first rule as
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
    Möbius-ball helper this lift and the 4D slab work agreed to share was
    NOT needed here; it shipped anyway (`inversion.ts`), against a
    spherefold slab port that stays refused. The WGSL 4D wrapper is the 3D
    text UNCHANGED, which is the same decision seen from the kernel side.
    THE ECHO'S COLOUR IS AUTHORED, as ONE pair across both
    arms: `balloonTint`/`balloonTintStrength` mix the SHELL's base albedo
    toward an authored colour BEFORE lighting (`mix(base, tint, strength)`),
    so the shell still shades as geometry and the specular stays untinted.
    Strength 0 — the default and the absent-field value — is `mix(x, y, 0)`
    = x exactly, so every document predating it renders byte for byte. The
    surface arms gate it on the oracle's OWN `BalloonDistance.shell`
    attribution, which all three shader mirrors had been dropping: the WGSL
    hit-info now carries it as a balloon-only `shell` member beside
    `colorPos`, both GLSL arms as an out-param, ties to the fractal term in
    every mirror. The pair rides `ShadeParams` (208/220, struct 224) and NOT
    the frozen balloon DE params block — it LIGHTS a hit, it does not move
    geometry — and `surface-de-gpu.ts`'s shade entry being SHARED across all
    seven cores is what made the 4D half one emission rather than a lift.
    THE INDEPENDENT BALLOON PALETTE is likewise one authored LUT consumed by
    Points, Flame, Solid and Surface in both dimensions. Solid samples it only
    for a strict echo-attributed inverted-volume query, before balloon tint;
    changing it is a live material-texture update and never restarts the voxel
    worker or rebuilds its density volume.
    NO SECOND BRIGHTNESS KNOB, and `BALLOON_ECHO_DIM` stays a module
    constant: the default tint is BLACK, so the strength slider alone reads
    as a dimmer (`mix(base, black, s)` = `base·(1−s)`), where one shared dim
    field would have had to carry two different "today" values — 0.5 in the
    additive-points echo, 1.0 in the lit-surface shell — and so could not be
    byte-identical in both arms.
  - `chaos-game.ts` — IFS iterator: warm-up, escape-reset, bounds tracking.
    Injected RNG for reproducibility; optional `IterationRng` keeps morphs
    point-for-point correspondent. `SymmetryParams.blend` fades kaleidoscope
    weights continuously. TWO MULTI-SYSTEM LAYERS ride it, both
    absent-means-classic byte-identically and both refused by every
    surface/escape/bulb gate until their descent lifts ship.
    `Transform.chaos` (flam3's xaos, graph-directed selection): row = FROM
    map, entry j scales the pick of base j next, `systemHasChaos`/
    `chaosRowIsNonTrivial`/`resolveChaosEntry` the ONE definitions; picks
    stay one draw on every path; chi runs re-fuse each
    `CHAOS_SUB_ORBIT_POINTS` (a block-diagonal orbit never leaves its
    block); both Flame WGSL kernels transfer the oracle's row-major rows
    and keep `prevBase` across dispatches, so xaos never forces CPU; the
    fern|sponge preset pair is the reachability proof. `Transform.emitter`
    ignores its input and spends exactly one primary draw to seed the shape
    sampler; every point-consumer mirror carries it, while Surface refuses
    until its condensation term lands. `HybridSchedule` (the
    scheduled-hybrid post-word): scene-level `{transforms, depth}`, B
    AFFINE-ONLY and stripped at every producer, applied at PLOT time —
    post-word THEN lens, `depth` primary-stream draws exactly when live,
    never fed back — in all four inlined mirrors AND both flame WGSL
    kernels (bench-pinned agreement scenarios); morphs never interpolate
    it (target's block pops at the leg's first push); `spongeOfFerns` +
    `PRESET_SCHEDULES` side table are its reachability. The four
    hand-inlined stepper mirrors (flame, flame-4d, voxel, voxel-4d) and
    both voxel bounds pilots carry BOTH layers, forced by oracle tests.
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
    Its optional balloon echo deposits one full-weight, tint-only second
    splat into that SAME histogram; there is deliberately no separate
    compositing, conformal magnification, or radial fade. The executable
    weight decision is `scripts/flame-balloon.harness.ts`.
  - `flame-4d.ts` — 4D twin (`accumulateFlame4`), CPU oracle for
    `flame-gpu-4d.ts`; slices with `0.06` ghost floor (not solid's `0`). Its
    balloon path reduces through the frozen rotor first, inverts the visible
    3D point, then applies the camera — never a 4D inversion.
  - `flame-gpu.ts` — WebGPU flame kernel (WGSL) + packing/dispatch/histogram
    layer. Pinned against CPU oracle by `src/app/gpu-bench/` (`npm run bench:gpu`).
    The bare local runner re-arms its 20-minute flame stall deadline per
    completed scenario; `--shard` keeps 20 minutes as a whole-run CI cap.
    XAOS VERDICT: one draw through chi or fallback, oracle-built cumulative
    rows transferred, chain stride held at 32 via a spare aux lane.
    EMITTER VERDICT: bounded device samplers reproduce the CPU MEASURE rather
    than its rejection-loop draw sequence; one primary draw keeps selection
    aligned, and emitters never force CPU.
    The fold family's AUTHORED lengths ride a per-TYPE Slot lane —
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
  - `inversion.ts` — sphere inversion's ONE shared identity:
    `inversionBallScale`, the Möbius factor `R²/(|c|² − r²)` that takes a
    ball to a ball exactly, returning 0 — "no information", so a caller's
    bound degrades conservatively — when the region swallows the centre.
  - `morph.ts` — pure interpolation (`lerpSystem`): endpoint-exact at t=0/1,
    rotation lerped nearest-turn, transform-count mismatches fade surplus by
    weight, flat↔4D continuous via derived w-scale, kaleidoscope crossfade
    (identity tuple = order/plane/twist; twist never interpolates). The
    fold's three lengths ride the file's existing `lerpOptional`
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
  - `presets.ts` — default + named systems (`fourFinishes` is the FINISH
    showcase: four corner maps under a boxfold lens, three finishes and
    one deliberately UNAUTHORED control, since a showcase that authors
    every map cannot show what absence renders) + add-transform, plus
    seven
    `Partial<Record<Preset, …>>` SIDE TABLES main.ts's preset handler
    consumes: `PRESET_SCAFFOLDS` (4D wireframes), `PRESET_RENDER_HINTS`
    (the renderer a preset was authored for), and `PRESET_FINALS`
    (the plot-time lens a composition is built around;
    ABSENT MEANS CLEAR, so no lens survives a preset load into a system
    whose gate refuses one) and `PRESET_PALETTES` (the flame palette a
    composition was chosen with — built-in ids only, flame-hinted presets
    only); and `PRESET_SYMMETRIES` (the kaleidoscope a
    composition IS — today only `foldChainFlower`, whose subject is the
    five-fold query fold — on `PRESET_FINALS`'s ABSENT-MEANS-OFF rule,
    load-bearing in both directions since `analyzeBulbSystem` refuses any
    order above 1 and `analyzeEscapeSystem` refuses one that rotates into
    4D; main.ts also clears the twist, and no entry may carry one),
    `PRESET_TRAPS` (absent means CLEAR), and `PRESET_SURFACE_PALETTES`
    (set-never-clear). Side tables rather than a wider `PRESETS` signature
    keep every preset from declaring what it does not carry.
  - `project4.ts` — SO(4) rotor→matrix + camera projection, `FourDView`,
    `sliceWeight`, `SLICE_GHOST_FLOOR` (`0.06`).
  - `random-system.ts` — "Surprise Me" generator: rolls random IFS (2–4 maps,
    optional kaleidoscope, 25% 4D), quality-gated by chaos-game probes,
    rerolls up to 40×. Injected `Rng`.
  - `rng.ts` — seedable mulberry32 PRNG.
  - `shapes.ts` — the multi-system epic's shape library: ONE document-facing
    `ShapeSpec` vocabulary (flat posed-part list, max 8 parts — no
    recursion, GPU packers need fixed blocks; Tier-1 primitives + the
    parametric gear) with TWO evaluators so every consumer renders the same
    object: `shapeSdf` (exact f64 SDF oracle, conservative under the
    min/max fold) and `prepareShapeSampler` (uniform-by-volume, min-index
    overlap acceptance; intersect parts are SDF-only, it throws).
    `shapeSdfSource` emits per-spec baked-constant code from ONE scalar
    template in glsl/wgsl/js dialects — the js dialect EXECUTES the shared
    template in tests against the oracle; the GPU-side executable pin lands
    with the first shader consumer. `SHAPE_MARCH_SAFETY` (0.9) is the one
    marching factor every consumer shares; the gear sector fold's domain
    (tooth must fit its sector, or the field overestimates) is disclosed in
    the module doc. Measured worst Lipschitz 1.000000 on both reference
    shapes; `scripts/shapes.harness.ts` is the visual + extent proof. The
    vocabulary is deliberately 3D — each consumer decides its embedding
    (stated in the module doc under the parity rule). Consumers own their
    persistence, while `app/bundled-shapes.ts` is the ONE registry for the
    shipped authoring choices (canonical spec, stable UI kind, label/icon,
    and emitter/trap eligibility); imported non-catalog specs remain Authored.
    Catalog meshes are prepared lazily and their exact nearest/sign queries
    use a deterministic identity-cached BVH; Surface atlases contain only the
    active scene's canonical id set, preserving stable catalog dispatch while
    analytic scenes allocate and upload nothing. Proof and cold-bake budget:
    `docs/mesh-sdf-delivery.md`.
  - `surface-de.ts` — surface render's CPU oracle: `analyzeSurfaceSystem`
    (eligibility gate: eligible/degraded/ineligible + reasons),
    `buildSurfaceDE` (BASE inverse maps + the kaleidoscope the descent
    SWEEPS around them — the sector sweep replaced the old symmetry
    expansion, so slots are base maps at any order; the module doc carries
    the validity argument and why a single wedge FOLD is unsound here — +
    seeded bounding-radius probe), `estimateDistance` (width-4 beam
    inverse-map descent + sibling certificates: the paired A/B chains —
    width 1 = the old greedy descent, measured overshooting, kept for
    tests — plus two validity slots, rank-3/4 chains live only while
    in-sphere, closing the 3+-simultaneous-branch drops; tables in
    `scripts/surface-beam.harness.ts`) + production
    `estimateDistanceRefined` (the 4D spike's extra Hutchinson level on
    folded sibling certificates, ported down from 4D — kills the balloon
    ghosts plain certificates rendered across voids; lazily guarded,
    measured void-false-hits 0 on every preset; the march-epsilon
    cutoff + the value-exact sphere-floor pin exit the descent
    early, both mirrored in the GLSL bodies; branch-and-bounding
    the fold branch enumeration adds dual bit-identical no-op skips —
    floor prune moved ahead of the child transform, then sigma-form +
    directional child-radius lower bounds — measured 75x fewer
    transforms/call on mandelboxKifs; the descent takes a probe-fit
    centered bounding ball where it beats the origin ball, axis-projected
    under kaleidoscope; an optional cone-footprint parameter caps descent
    depth per query, previewMaxDepth's argument per-step). A pure-fold
    FINAL transform is eligible via `descendLens`: the pure-fold branch
    vocabulary lifted one level — each lens branch seeds a root descent
    through the UNTOUCHED cores (`final` stays null when `foldFinal` is
    set), with region floors, value-exact sphere/floor prunes and the
    visible-sphere pin; no contraction gate (an un-iterated lens needs
    none).
    THE FOLD'S RADII ARE AUTHORED, NOT BAKED IN: the branch algebra's
    constants became expressions of the map's own lengths (inner inverse
    `×0.25 -> ×mR²/fR²` and its sigma `4 -> fR²/mR²`, inner output region
    `r <= 2 -> r <= fR²/mR`, mid shell `[1,2] -> [fR, fR²/mR]` with
    inversion `u/|u|² -> fR²u/|u|²` and certified factor `|u| -> |u|/fR`,
    box preimages `±2 − u -> ±2·wall − u` and in-box region
    `[-1,1] -> [-wall, wall]`), derived ONCE per map into
    `SurfaceFoldRadii` (these sit inside a per-candidate, per-branch loop)
    and carried on `SurfaceDEMap.foldRadii` and the lens.
    `SPHEREFOLD_LIPSCHITZ` survives only as the CLASSIC value the docs and
    tests quote — the live bound is `variations.ts`'s
    `sphereFoldLipschitz`, which the contraction gate and the depth cap
    read, so the knob moves the Surface/escape-time seam (exactly one
    shipped system, `mandelboxKifs`, is close enough to cross it).
    `SPHEREFOLD_MID_MIN_R` SCALES WITH `fR`, NOT `fR²` — it guards the mid
    inversion's image `fR²/|u|`, so holding that to `1e3·fR` makes the
    threshold `1e-3·fR`; `fR²` would be a length² where a length belongs
    and would break the uniform-rescale equivariance the fold family has
    (the two are indistinguishable at the classic `fR = 1`, which is why
    the first sketch of the change proposed the wrong one).
    Byte-identity at the defaults is by CONSTRUCTION — at the classic
    lengths every expression reduces to the literal that shipped. Oracle
    for `surface-material.ts`, the `flame.ts` <-> `flame-gpu.ts`
    discipline one render mode over — and EVERY GPU MIRROR NOW READS THE
    AUTHORED LENGTHS, so the CPU/GPU divergence is closed and the feature
    is reachable: `ui.ts` gives each fold variation the lengths that fold
    actually reads. The wire is the three AUTHORED lengths everywhere, not
    this struct's eight derived fields — three numbers a reader can check
    against the document beat eight combinations, which would be eight
    chances to disagree — and each kernel re-derives the branch algebra
    from them (`foldRadiiOf`, this file's `surfaceFoldRadii` field for
    field). Two producers still leave the fields alone, now by CHOICE
    rather than as that divergence's mitigation: `random-system.ts` does
    not roll them (no evidence they improve the generator, and rolling
    `minRadius` would move systems across the eligibility seam behind the
    user's back), and `mutate-system.ts` perturbs a present one but never
    materializes an absent one (so a mutation grid stays a grid of the
    system you brought it).
  - `surface-de-4d.ts` — `surface-de.ts` one dimension up (born as the 4D
    surface DE spike): Jacobi `singularValues4`, `analyzeSurfaceSystem4`,
    `buildSurfaceDE4` (final-transform lens included; also derives
    `radiusBand` — the visible set's probe-seeded 4D center + [minD,
    maxD] distance band: the radius color source's normalizer,
    matching `buildColors4`'s radius convention so the full ramp is in
    play, slice/rotor-invariant), beam
    `estimateDistance4` + ghost-free `estimateDistance4Refined` — the 4D
    surface render's CPU oracle, mirrored by `surface-material-4d.ts`.
    Reads the fold's authored radii at all three of its own branch sites
    SHARING `SurfaceFoldRadii`/`surfaceFoldRadii` with 3D
    rather than redefining them (the resolved lengths are dimension-free,
    and two copies of "what does an absent field mean" is how a 3D system
    and its 4D lift start rendering different objects); the one genuinely
    new part is the FOURTH box axis, whose `pw0/pw1/pw2` and `dwUp/dwDn`
    take the same treatment as x/y/z and whose visible-radius bound's `+ 4`
    — the axis COUNT — becomes `4·wall²`.
    Measured verdict + numbers in the module doc — the off-centre slice
    measurements included: the SLICE CAVEAT costs ~10% and is FLAT in `w0`,
    so slice-aware certificates are a measured won't-do
    (`scripts/slice-cost.harness.ts`), and the 20-40x off-centre cost cliff
    they were for does not reproduce on either engine
    (`scripts/slice-cliff.probe.mjs`, the app-level pose-cost instrument).
    Both estimators take an
    optional `halfExtent`: the query becomes the SEGMENT
    `p ± halfExtent`, which turns the marched hyperplane into a SLAB of
    half-thickness `h` — same contract (conservative bound, exact zero set),
    just looser, because affine maps take segments to segments. One extra
    4-vector per chain/candidate (moved by each inverse map's LINEAR part),
    `segmentRadius` in place of every `|q|`, and `chainScale · |e| <= h`
    caps what the bound can lose at every level. `null`/zero — the default
    and the shipped slider position — is the point query value for value.
  - `surface-de-gpu.ts` — WGSL fold-DE compute kernel (a spike, gated in by
    the beam-width occupancy verdict; integrated as the app's compute
    surface path): mirrors `estimateDistance`'s refine=false fold path term
    for term (the estimator the fold GLSL marches) under the `flame-gpu.ts`
    oracle discipline, source-generated per config — frontier width,
    workgroup-SHARED (banked, transposed) vs private frontier storage,
    stage-2 B&B on/off (WGSL has no Mesa link cliff). Measured
    verdicts: private frontier, stage 2 OFF — the config stays
    stage-1-only.
    THE FOLD'S AUTHORED LENGTHS ride a dedicated `fold` lane in
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
    (escape/bulb head-link ballast, mutually exclusive with the lens block
    by construction), the lens fold's lengths at 272, and the
    plane/balloon block SHARED at 288 — the escape and bulb cores declare
    a matching pad so that block keeps ONE offset across every 3D core
    (`SURFACE_GPU_PARAMS_BYTES` 288, balloon 320,
    `SURFACE_GPU_PARAMS_PLANE_BYTES` 336). 4D: the affine4 tail 208..463
    (`SURFACE_GPU_PARAMS4_BYTES` 464), the lens4 block 464..575
    (`SURFACE_GPU_PARAMS4_LENS_BYTES` 576, the authored fold lengths'
    `lens4Fold` quartet at 560), and the plane/balloon block at the frozen
    576 for EVERY 4D core — which the lens4 block being declared
    unconditionally under either is what buys, the 3D
    `lens || balloon || groundPlane` rule one dimension up, zero-filled by
    the packer when there is no lens (4D balloon 608,
    `SURFACE_GPU_PARAMS4_PLANE_BYTES` 624). The forward shape-trap tail is
    frozen at 336/624 and ends at `SURFACE_GPU_PARAMS_TRAP_BYTES` 400 /
    `SURFACE_GPU_PARAMS4_TRAP_BYTES` 688; the plane region stays declared
    and zero-filled beneath it. That hazard is on record: a
    block appended at 560 lands INSIDE the `lens4Fold` quartet and
    corrupts it.
    SEVEN KERNEL CORES, each described in full in the module doc; what a
    session must not get wrong is here.
    `core:"affine"` emits the width-4 A/B + validity-slot REFINED
    ladder (mirrors `estimateDistanceRefined`, the affine GLSL's
    estimator; width/sharedFrontier/bnbStage2/shadeDeWidth inert) beside
    the fold frontier, picked off `deHasFolds` exactly like the CPU.
    `core:"escape"` is not a descent at all — it emits
    `escape-de.ts`'s `estimateEscapeDistance` in the `SURFACE_ESCAPE`
    GLSL arm's f32 formulation, for exactly the systems
    `analyzeEscapeSystem` admits, its marching quantities packed by
    `packEscapeGpuParams` (bailout ball as BOTH bounding and visible
    sphere, `ESCAPE_STEP_SCALE`, `maxDepth` the orbit budget in PASSES
    through the descents' own preview door, `mapCount` the LINK COUNT). It
    CYCLES the whole formula chain — link `i mod n`, `+ p` and the bailout test
    after EACH link, `maxDepth * n` single-link steps — reading one
    `GpuMap` per link off the maps storage binding (`packEscapeGpuMaps`),
    so it DOES declare buffer 1 and `core:"bulb"` is the one bindingless
    core left. A link's `kind` may be a POWER map (4
    triplex, 5 quaternion square), so the fold pair's negative
    `kind != 2u`/`kind != 1u` dispatch sits behind a `kind < 4u` GUARD in
    both bodies (unguarded, a new kind satisfies both and runs both
    folds), with `bulbPow8` HOISTED to one definition emitted for
    the two forward cores, so affine/fold kernels stay byte-identical.
    `escParams.w` at offset 268 is the ONE live word of the head-link
    ballast: `EscapeDE.logEstimate`, the chain-level choice between
    `r/dr` and the Böttcher `0.5·r·ln r/dr`, with the hit-info's matching
    second interpolant read off the DEGREE of the link that produced the
    terminal radius. Its trap is the CONTINUOUS
    escape fraction over the PASS budget (denominator is `maxDepth`, NOT
    the chain's `maxDepth * n` step budget) and drives COLOR ONLY, the
    descent cores' convention.
    `core:"bulb"` is the escape core's SIBLING one formula over:
    `bulb-de.ts`'s `estimateBulbDistance`, for the systems
    `analyzeBulbSystem` admits, in the `SURFACE_BULB` GLSL arm's f32
    formulation. Everything structural is escape's (208..271 variant
    block via `packBulbGpuParams`, no maps binding, every frontier knob
    inert, `maxDepth` as the orbit budget, lens/balloon throw); the one
    asymmetry is that the ORBIT bailout and the QUERY-space marching ball
    are different numbers, so `bulbParams.y` carries the bailout and the
    frozen `boundingRadius` stays the marching ball. Its trap is the
    POWER-map form `log(log r / log R)/log n`, not the fold arm's
    constant-factor form.
    `core:"affine4"` (the 4D cut) is the refined ladder ONE
    DIMENSION UP — `surface-de-4d.ts`'s `estimateDistance4Refined` behind
    the app's view lift, the estimator `surface-material-4d.ts` marches,
    with the rotor prologue, the slab riding one half-extent register
    (gated on the dynamically uniform `sliceHalfW > 0`) and the swept
    kaleidoscope. ITS TAIL ALWAYS STORES THE ROW-MAJOR
    BYTES of the matrix the body applies, the packer performing the one
    real transpose (`setSurfaceView4`'s exact dance); maps are `GpuMap4`
    (`packSurfaceGpuMaps4`, 128-byte stride). Two frozen slots carry 4D
    semantics: `visibleRadius` packs the SLICE-ADJUSTED sliceVisR so the
    shared march entry's sphere gate is the 4D GLSL's textually
    unchanged, while the tail's `visRadius4` keeps the FULL radius for
    the height color source and the radius source normalizes over the
    `radiusBand` — both slice-invariant, and those two shade lines are
    the one core-conditional interpolation in the shared entry text.
    Fixed width 4; nonzero `footprint` THROWS at pack (the 4D oracle has
    no cone cap).
    `core:"fold4"` is the FOLD frontier one dimension up — 4D fold base
    maps (`deHasFolds4`) marched as the same width-configurable frontier
    as 3D "fold", slab(`ext`)-aware, sharing `GpuMap4` and the affine4
    tail; no stage-2 B&B emission by the 3D verdict. A `mapsUniform`
    codegen option (a 4D kernel-cost probe) moves the 4D cores' maps
    binding to a fixed 24-slot uniform array — REFUTED for production,
    kept as the refutation's executable record behind the opt-in
    `--surface-aff4-sweep` leg.
    `core:"escape4"` is the escape core ONE DIMENSION UP —
    `escape-de-4d.ts`'s `estimateEscapeDistance4` — the first core that is
    BOTH 4D and FORWARD. Three
    things fall away with the dimension and NOTHING is added — no
    `bulbPow8` (the gate refuses a triplex power), no slab (a forward
    orbit cannot thread a segment, so the packer THROWS on a nonzero
    `sliceHalfW`), and no lens (an escape chain has no final transform,
    which is what lets its params block reuse lens4's 464..575 region).
    Its wedge fold reads `SYM_PLANE_CODE4` — the index into
    `SYMMETRY_PLANES` — and NOT the descents' `SYM_PLANE_CODE`, which
    deliberately collapses `xw`/`yw`/`zw` onto their w-free twins: sound
    where the kaleidoscope is a swept matrix, wrong where a fold picks
    its two axes by name. `lens`/`balloon` throw, `groundPlane` composes,
    and there is no fragment mirror at all.
    Ground plane is an orthogonal `groundPlane` option, not a core of its
    own — it composes with every descent/escape core, in both dimensions,
    and with the lens wrapper. It adds a fifth ray status,
    `SURFACE_GPU_RAY_PLANE` (4), that march classifies a
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
    radius, so the floor does not slide as the slice scrubs.
    `surface-compute.ts` prices PLANE
    terminals in the hit-priced queue, not the miss path.
    All seven share the public `surfaceDE(pIn, cutoff, li)` signature, so
    the Modes are textually identical whichever core is picked. And
    `lens:true` wraps EITHER descent core in `descendLens`'s fold-FINAL
    branch sweep — the body token-renames to `surfaceDECore` (hit-info to
    `surfaceDEHitInfoCore`, probe to `surfaceDEProbeCore`) and the
    wrapper owns the public names, entries untouched; the lens block is
    zero-filled when absent, and footprint+lens is refused at pack time
    (descendLens's per-branch innerFootprint would need a core signature
    change; the app passes 0). `lens:true` wraps either 4D core in
    `descendLens4`'s branch sweep the same way (the old "4D lens throws"
    rule is gone).
    Modes: `eval` (per-query distances) and `march` (bounded-dispatch ray
    march, host-compacted active list) are the bench baselines,
    byte-identical since the spike; `march` + `rays:"unproject"` swaps the
    ray derivation to the GLSL tracer's uInvProjView unproject (+
    flag-gated start dither) for the app path, and `shade` runs the GLSL
    tracer's FULL shading over host-compacted batches of TERMINAL rays.
    March and shade are separate entries by measured verdict, not taste:
    the v1 megakernel shaded rays inside the march pass that terminated
    them and LOST THE DEVICE on Iris. `shadeDeWidth` routes
    exactly those probe taps (normal/shadow/AO — never decide geometry) to a
    second narrow descent `surfaceDEProbe`, derived from the same body
    template by token rename so the two cannot drift; app ships width 1.
    `statusOut` (march mode only, THROWS elsewhere) adds the
    host's one question as a side channel — `u32(st.y)` at binding 5,
    indexed by the ray's SLOT in the active list, written at EVERY exit
    but the out-of-range guard — so a sweep's rebuild costs 4 B per
    ACTIVE ray instead of the frame's whole ray state. Nothing on the
    device reads it, and absent/false is byte-identical source.
    RE-VERIFY SURFACE KERNEL CHANGES ON `--display=:0`, NOT SWIFTSHADER
    ALONE. A forward orbit is
    chaotic and which rounding seeds flip is realization-dependent, so
    the escape legs gate in LAYERS (a pre-hoc ensemble classifier
    `forwardQueryStable` with exclusions disclosed per row, and a post-hoc
    `forwardShadowFlipVerified` absolution capped at 7 flips).
    THE `finish` FLAG parametrizes the SHARED shade entry with per-slot
    authored finishes (`surface-finish.ts`'s lanes): shade-mode emission
    only, shadeMaps stride 1 -> 3 vec4f, and NO ShadeParams/params-block
    change anywhere. Absent/false is byte-identical source, pinned
    against the PRE-CHANGE module rather than against itself — a compile
    gate, not a defaults claim, since `pow(x, 32.0)` literal -> per-slot
    value is no exact identity. Forward cores' slot 0 is their whole
    wire; the floor stays matte.
    Consumed by `src/app/surface-compute.ts` (the fold- and
    escape-shaped surface sessions' preferred tracer) and pinned
    by `src/app/gpu-bench/`'s surface section (`npm run bench:surface`;
    real-driver timing via `--display=:0`; `--surface-shade-width=N`
    reruns the probe-width A/B).
    Full record — every core in full, measured verdicts, bench legs and
    classifier design, the trap-normalizer measurement history and its
    corrections — in `docs/surface-gpu-kernels.md`.
  - `surface-grid.ts` — empty-space skip grid for the 3D surface march:
    conservative distance floors (cell centers, cutoff `cellRadius` — at/above
    the cutoff the return is the exact full-descent value, below it 0 is the
    only safe store — f32-FLOORED so quantization never rounds a bound up),
    priced per-system by `surfaceGridEstimator` (`"plain"` for fold
    systems — the estimator the fold GLSL actually marches, measured ~1.5x
    cheaper with near-identical floors — `"refined"` for affine). The 3D march
    samples it before paying a descent; `pickSurfaceGridResolution` sizes the
    build itself from a measured pilot slab, downshifting a 64/48/32 ladder to
    fit a 3s budget (floored at 32, never skipped). Module doc carries the
    validity chain and the 3D-only refusal.
  - `surface-finish.ts` — the per-transform surface FINISH's meaning:
    `resolveSurfaceFinish` is the ONE absent-means-classic definition +
    domain (classic = the fixed formula's 0.4/32/0/0/0; shininess FLOORS
    at 0.01, pow's domain, rather than falling back),
    `isClassicSurfaceFinish` the compile gate's predicate,
    `surfaceFinishLanes` the one wire-lane order both engines pack, and
    `surfaceFinishShadeSource` emits the ONE finish BRDF body in both
    shader dialects (`background-shape.ts`'s discipline applied to
    lighting) with `finishShadeTs` as its TS mirror — EXACT at the classic
    params against the fixed formula (324-case pin): the value-true half
    of the byte-identity story, the compile gates being the byte-true
    half. `Transform.finish` persists/morphs/mutates on the fold lengths'
    exact treatment (random-system deliberately never rolls one).
    `surfaceFinishPatternAlbedo` is PRODUCTION-DEAD, kept as a
    measurement's record (`qjulia-de.ts`'s stance):
    `scripts/finish-pattern.harness.ts` refused Tier-2 wood off `rings`
    (at 1x it is speckle, not grain — `rings` varies at the fractal's own
    detail frequency) while CONFIRMING the zoom premise that motivated it
    (native coarsens into bands where world-space noise goes flat). The
    survivor — banding off `sheets` — is filed, not wired.
  - `escape-de.ts` — escape-time fold render's CPU oracle, and now a HYBRID
    FORMULA CHAIN: the canonical Mandelbox/Juliabox object and its
    hybrids, for exactly the systems the IFS gate refuses (one or more
    flat maps of which at least one does NOT contract, no final transform,
    no kaleidoscope that rotates out of 3D — `analyzeEscapeSystem` is the
    deliberate COMPLEMENT of `analyzeSurfaceSystem`, which admits exactly
    when EVERY map contracts).
    THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`):
    orbit step `i` applies link `i mod n`, `+ p` and the bailout test
    after EACH link, and a PASS is one full cycle — so
    `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the GPU's
    `maxDepth` keep meaning "how many times is each link applied". The
    rejected alternative, CHAINING (all n links inside one pass), was
    measured fattening toward a solid ball as links were added — the
    near-sphere defect returning — and survives only as an executable local
    in `scripts/escape-chain.harness.ts`, the sheet the SHIPPED estimator
    draws.
    A LINK NEED NOT BE A FOLD: the chain admits the two
    POWER maps beside its three folds — the triplex 8th power (`bulb`)
    and the quaternion square (`qsquare`) — so one document can hold a
    Mandelbox and a Mandelbulb in ONE chain. A link contributes its
    forward map and its LOCAL Lipschitz factor (`8·|y|⁷` from
    `bulb-de.ts`, a heuristic; `2·|y|` from `qjulia-de.ts`, EXACT because
    quaternion norms multiply), inheriting each map's shipped status
    rather than adding a new one. A LONE power map is
    REFUSED — `bulb-de.ts`'s estimator is the better one for that shape —
    which keeps this gate DISJOINT from `analyzeBulbSystem` rather than
    merely ordered before it, and costs no range because two power links
    ARE a chain. A power link's WEIGHT is free (`dr` accounts for `w`
    exactly), unlike `analyzeBulbSystem`'s lone map. THE ORBIT STAYS IN
    `v` SPACE with the literal `+ 1`: the power modules work in `y` space
    and seed `dr` at `sigma_max(M)`, the same recurrence in different
    coordinates, but that factoring needs ONE `M` and a chain has n.
    THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW
    (`EscapeDE.logEstimate`, ONE flag per chain resolved at build and
    carried on both wires rather than re-decided in six mirrors): folds
    escape exponentially and read the linear `r/dr`; a power link makes
    the chain super-exponential and it reads the Böttcher
    `0.5·r·ln r/dr`. That does NOT reopen the sweep that refused the log
    form for the FOLD family — its dimensional argument (the folds are
    uniform-rescale equivariant) cannot reach a map with
    `V(λy) = λ^d V(y)`.
    THE PREDICTED STIFFNESS HAZARD DOES NOT REPRODUCE (the power-link
    work's most useful result: the prediction's blank-frame figures are
    the PROTOTYPE's CHAINING arm's, and cycling re-tethers the query after
    every link).
    SO NO AUTO-SCALE AND NO NEW SIGNAL — a hint computed from the
    closed-form bound (`escapeLinkStiffnessLimit`, kept executable as the
    refuted prediction's record) was written and then DELETED, because it
    fires on every row of that table and every one of them renders.
    TWO INSTRUMENT RULES. Ball fill is a seeded uniform sample against
    `escapeSetContains`, NEVER A GRID (a fold's structure sits on its own
    walls — the integers, at the classic `boxLimit` — so a grid's planes
    land there and over-sample them), and it bites THIN sets, which is
    why it is easy to miss. AND A DISTANCE THRESHOLD IS NOT A MEMBERSHIP
    ORACLE IN EITHER DIRECTION — a small estimate means "near a boundary"
    for an ESCAPER too.
    `estimateEscapeDistance` iterates the maps FORWARD with ONE shared
    scalar running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's
    standard heuristic, not a certified bound), mirrored by
    `surface-material.ts`'s `SURFACE_ESCAPE` variant and
    `surface-de-gpu.ts`'s `core:"escape"` kernel. `ESCAPE_STEP_SCALE` is
    the one marcher-damping definition both mirrors import, and it STAYS
    0.35 AT EVERY CHAIN LENGTH, MEASURED rather than assumed (refuting a
    prediction that chains would need heavier damping) — cycling floors
    `dr` after every link, so no two folds compound
    between floors and the slack per step is the single map's. BAILOUT
    STAYS 4 for the same measured reason it always was: raising it at a
    fixed budget inflates the set rather than revealing it. Phone-cheap
    by construction (the n-times budget is a ceiling only a non-escaping
    orbit pays, and every extra link is another chance to escape). f32 is
    safe on the GPU mirrors: the bailout test bounds `|v|` entering every
    link and the per-link `+ 1` floors `dr`.
    EMPTY CHAINS ARE REACHABLE inside the gate — a big enough pre-scale
    escapes everywhere on the first pass and the mode renders a blank
    frame — so `escapeSetContains` (membership, from the same orbit the
    estimate reads) and `probeEscapeFill` (a seeded sample of the bailout
    ball) exist to say so. `probeEscapeFill` MEASURES VOLUME AND MUST NOT
    BE READ AS "WILL IT RENDER": these sets are often thin fractals — a
    slice can have LITERALLY ZERO members and still draw a coherent
    shaded object, since a slice through a set of shells is itself a set
    of surfaces no volume statistic can see. The signal fires off the
    FIRST completed settle's own hit
    count instead (main.ts's `surfaceBlankNotice`, off BOTH engines'): a
    frame that drew essentially nothing at the entry pose IS blank by the
    renderer's own arithmetic, so it cannot disagree with what the user
    sees. The bar is `SURFACE_BLANK_HIT_FRACTION` (0.001) and NOT zero,
    because the marcher accepts at `uAcceptPixelEps`. It reports, never
    refuses, and neither probe is wired into `analyzeEscapeSystem` or
    `buildEscapeDE`, which stay cheap.
    KALEIDOSCOPE is a query-space wedge fold (`foldQueryIntoSector`), not
    an orbit operation: `g` is 1-Lipschitz and an isometry per sector,
    the orbit is seeded AND offset by `g(p)`, so the set is exactly
    `g^-1(M)` — dihedral rather than the chaos game's cyclic (a cyclic
    fold is discontinuous and would certify empty balls across the seam),
    free per orbit step, and `SymmetryParams.blend` is deliberately
    unread exactly as in `surface-de.ts`.
    EACH LINK CARRIES ITS OWN FOLD LENGTHS (`EscapeLink`'s
    `boxLimit`/`minRadius2`/`fixedRadius2`, resolved once at build), so a
    chain may hold a different sphere/box apparatus per link, and
    `foldLipschitz` tests the real magnification `fR²/mR²` rather than the
    frozen 4 — which keeps this gate the exact COMPLEMENT of the IFS one
    as the knob moves. Pinned against an INDEPENDENT oracle:
    `scripts/spherefold-radius-sweep.harness.ts`'s own parameterized copy
    of `runEscapeOrbit` agrees bit-exactly including a two-link chain
    whose links carry DIFFERENT radii.
    ONE-LINK, UNSYMMETRISED SYSTEMS ARE BIT-IDENTICAL to the original
    single-fold loop (pinned in `escape-de.test.ts` against a frozen copy
    of it), and the cycle carried into both shader mirrors: GLSL as one
    `uEscM`/`uEscT`/`uEscParams` slot per link (24-slot cap, the
    descent's own — and the mode's, since eligibility is one answer for
    both engines), WGSL as one `GpuMap` per link on the maps storage
    binding. `EscapeDE extends EscapeLink` survives as the head link's
    flat wire, now frozen layout ballast nothing reads to render.
    The rendered set is the MANDELBROT-form set — the per-iteration
    offset is the QUERY POINT, which is what makes it the
    object published Mandelbox renders show; the original Julia form (offset
    = the document's `t`) rendered a near-SPHERE and lives on as a local
    in `scripts/escape-form-sweep.harness.ts`, not as the permanent
    document flag it would cost. `t` survives as the PRE-fold offset — a
    live deformation knob, classic Mandelbox at `t = 0` — so the mode
    adds NO document state and stays a render MODE over the existing
    vocabulary (morphs/mutations/persistence untouched).
    SHAPE-TRAP VERDICT: color only, one accumulator in the shared orbit
    runners, mirrored by both 3D GLSL arms and all three forward WGSL cores.
    Full record — including its agreement evidence — in
    `docs/escape-time-family.md`.
  - `escape-de-4d.ts` — the escape-time chain's 4D half, for the
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
    mirror, so an escape-shaped 4D session is compute-only exactly as the
    4D fold-branch port made fold-shaped ones. THREE PRESETS reach it,
    from the 4D menu group rather than the Escape-time one:
    `mandelboxBrick` and `mandelboxColumn` are the same map
    (`mandelboxCube`'s) turned in `xw` and in `yw` — a PAIR whose subject
    is that the rotation plane picks the long axis — the one place the
    rotor slider reads as geometry rather than as a tumble — and
    `hybridChainShells` is
    `hybridChainQuaternion` with the rotation on its POWER link, the link
    position that costs the least.
    Full record — the per-axis extent figures and the rotation-cost
    comparison across link positions — in `docs/escape-time-family.md`.
  - `qjulia-de.ts` — the quaternion Julia set's CPU oracle:
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
    nothing there to resolve, which is why its WGSL/GLSL cores and its
    4D lift (the only cut that is NOT a solid of revolution — tested
    among those panels, and smooth too) are CLOSED
    won't-do along with their epic. The module stays for two reasons: it
    is the executable record of the measurement that refused them, and
    it is where the quaternion square's EXACT `2|q|` derivative lives —
    which the power-link work CASHED IN: the map is now a chain LINK on
    the escape core, needing neither its own kernel nor its own 4D lift,
    and the `hybridChainQuaternion` preset renders it. So this module's own
    prediction came true — the object that is dull alone earns its place
    composed with a fold — while the module stays production-dead in the
    literal sense that no renderer calls `estimateQJuliaDistance`: the
    chain reads the map in `v` space with the linear-or-Böttcher form
    `escape-de.ts` picks, not this file's `y`-space estimator. Its
    step-scale and bailout numbers are still ITS object's, not a
    hybrid's.
  - `bulb-de.ts` — the Mandelbulb's CPU oracle, third object in
    the escape-time family beside the folds and `qjulia-de.ts`: the triplex
    8th power (`variations.ts`'s `bulb`) iterated in the MANDELBROT form
    the escape family settled on — `v <- V(Mv + t) + p`, `t` the pre-power
    offset and a live deformation knob, no document state. `dr` seeds at
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
    3.5x CHEAPER than the fold mode that already ships, refuting the
    prediction going in. `scripts/bulb-preview.harness.ts` is its sheet;
    mirrored by the `SURFACE_BULB` GLSL variant
    (`surface-material.ts`) and the `core: "bulb"` WGSL kernel
    (`surface-de-gpu.ts`), bench-pinned by the `bulb-forward` eval leg.
    ROUTED: `analyzeBulbSystem` is the third arm of main.ts's flat surface
    path (beside `analyzeSurfaceSystem` and `analyzeEscapeSystem`), the
    compute renderer's `{kind:"bulb"}` target and the `SURFACE_BULB` GLSL
    fallback carry it, and the `mandelbulbClassic`/`Offset`/`Rotated`
    presets reach it from the Escape-time menu group. The same map ALSO
    rides the escape CHAIN as a link (`ESCAPE_LINK_BULB`),
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
    truth). `Variation` is `{type, weight}` plus the fold's three
    optional lengths `minRadius`/`fixedRadius`/`boxLimit`, the FIRST
    per-variation parameters in a document every other producer treats as a
    type -> weight MAP; they deliberately break that model rather than
    pretending to fit it (each belongs to two of the seventeen types and the
    rest ignore all three), and ABSENT MEANS THE CLASSIC MANDELBOX VALUES
    (0.5, 1, 1) BYTE-IDENTICALLY — the `weight`/`colorIndex` convention, and
    what keeps every existing document, preset, morph and `.flame` import
    unmoved. There is no fourth SIZE field on purpose: only two dimensionless
    ratios of the three lengths are new shape, because a uniform
    rescale is equivariant through both folds and is therefore already what
    the transform's own affine part does.
  - `variations.ts` — seventeen nonlinear flame variations as pure functions:
    a dozen classics, the Mandelbox fold family (`boxfold`/`spherefold`/
    `mandelbox`), and the two escape-time POWER maps — `qsquare` (the
    quaternion square) and `bulb` (the White/Nylander triplex power).
    Those two exist so their renderers can gate on a document shape, and
    they are also CHAIN LINKS: `escape-de.ts` admits either beside a
    fold, which is what makes the seventeen-variation vocabulary compose
    instead of merely coexist.
    `bulb` is the triplex
    8th power, `triplexPow8`: a TRIG-FREE closed form via the Chebyshev
    `T8`/`U7` polynomials plus de Moivre, an exact rewrite of the
    `acos`/`atan2`/`sin`/`cos`/`pow` one at 6e-14 and ~11x cheaper. The
    power is baked in because triplex multiplication is not associative —
    `p^8` is NOT `((p^2)^2)^2`, which disagrees on 48.8% of queries — so
    every power would need its own closed form. `composeVariations` blends
    a transform's weighted list.
    THE FOLD'S THREE LENGTHS ARE AUTHORABLE, and this module
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
  - `background.ts` — the scene backdrop: `BACKGROUND_MODES` vocabulary
    (dark/haze/auto/flame/custom, extensible for curated presets);
    `resolveBackground` is the ONE mode→(top, bottom) definition every
    renderer/capture/compute-spec path shares. `"auto"` is
    the palette-linked backdrop: `autoBackground` darkens two
    `buildPaletteLUT` samples into disjoint luminance bands
    (`AUTO_BACKGROUND_TUNING` pins the curve; legacy/no-gradient palettes
    keep dark), `state.ts`'s `activeScenePalette`/`resolveSceneBackground`
    pick the tracked palette per render mode (coarse on purpose), and
    main.ts's `trackAutoBackground` re-derives on palette edits and
    render-mode landings — persisted as the MODE alone, never baked colors.
    `"flame"` selects a transient, low-budget 2D echo generated from the
    current system; only that mode id persists, never its bitmap, seed, blur,
    or budget. `lerpBackground` + `BackgroundTween` are the gradient-only
    replace-load crossfade, a fourth motion beside the system morph/camera/4D rotor
    glides — the SHAPE below is deliberately not part of it (no meaningful
    midpoint between linear and radial; it pops to the target's at the
    leg's first push). Persists via `persist.ts`, whose decoder doubles as
    the legacy migration (absent field + aerial style → haze). Pure,
    tested. `BackgroundParams.shape` is ORTHOGONAL to the gradient modes —
    the gradient SHAPE (`fractal/background-shape.ts`'s vocabulary) their
    two stops paint through, absent means `"linear"` byte-identical
    to every document predating it. `scene.ts`'s Shape select
    (`setBackgroundShape`) and `pushBackground` read it the same way the
    Background select reads `mode`.
  - `exposure.ts` — `glowExposure`: density-adaptive brightness for the
    `"glow"` render style (not the flame tone-map). Pure, tested.
  - `resolution-governor.ts` — adaptive resolution: frame-time ladder (EMA +
    hysteresis) trades pixels for frame rate; a parked still restores to full
    after ~2s quiet (render-on-demand starves the sample stream).
    Exports/flame stay unscaled. Session-only `adaptiveResolution` opt-out.
    Bypassed in surface mode (render-tier.ts owns that cost). Pure, tested.
  - `render-tier.ts` — surface-mode interaction tier: invalidated
    frames trace a cheap preview into an offscreen target at an adaptive
    (scale, depth) rung picked from measured trace cost
    (`createPreviewGovernor`, EMA + hysteresis + a ≥250ms panic drop; starts
    at the shipped 0.3, climbs to full scale on capable GPUs — 4D
    auto-tumble sessions, which never settle, now sharpen instead of
    staying pinned soft; depth couples to scale via `previewMaxDepth`, the
    contraction-aware clamp, so finer rungs trace deeper and the
    core-ball bug cannot return in adaptive form). March/shadow/AO budgets +
    hit floor per tier — uniform writes only, shader bodies untouched; hit
    ACCEPTANCE is tier-independent (`uAcceptPixelEps`, the settle
    frame's pixel footprint, drives the hit test/grid proof/DE cutoff in
    every tier — a preview coarsens sampling, never acceptance; the
    buffer-scaled eps had rendered fold-DE plateau bands as phantom box
    faces at coarse rungs); after `TIER_SETTLE_MS` of quiet the full-quality
    frame renders as an interruptible strip job (see `strip-planner.ts`).
    The ladder's 0.1/0.07 emergency rungs exist for fold-frontier
    DEs — each buys ~2x fewer rays AND a shallower depth clamp.
    Capture/offline
    `force` frames stay full. Pure, tested, injected clock.
  - `strip-planner.ts` — adaptive scissor-strip sizing for EVERY WebGL surface
    trace (the compute path bounds its own submissions instead),
    previews included (bounding them removed the preview tier's one
    unbounded draw — the i915-preemption GPU-hang path that killed fold
    sessions outright). Units are PIXELS, not rows: a strip is a
    row-major pixel interval rendered as 1-3 scissor rects under ONE fence,
    so fold strips shrink below a row's cost. The probe is sized from a
    per-px cost prior — the measured preview cost when one exists, else a
    pessimistic fold-class prior, else the legacy rows fraction for affine
    (the unprimed 3-row probe at full resolution was the
    kernel-confirmed i915 preemption hang) — then strips scale toward a
    per-tier `targetMs` of measured GPU time each, measured by a
    forced-completion 1x1 readback and NOT `gl.finish()`, which some
    command-buffer paths return from before execution. Measurement scaling
    is blind to the fold+grid frames' cheap/expensive bimodality, so every
    strip is ALSO capped at `STRIP_WORST_CASE_CAP_MS` of worst-case
    predicted cost.
    THE EVIDENCE CHAIN: the price starts
    at a class-pessimistic ms/px, RATCHETS up as the job's own measurements
    reveal worse pixels, and chains across job re-arms via scene.ts. A
    COMPLETED job's whole-frame observation REPLACES the floor in BOTH
    directions (x10 tier-gap safety) — down matters, or a measured-cheap
    fold system stays pinned at class-floor micro-strips whose readback
    overhead dissolves its settle — while partial jobs only RAISE.
    Relaxation lives exactly ONE completed-preview->settle handoff (a
    superseded job = the pose moved on = stale evidence dies).
    Measurements reach the ratchet through a measurement-time
    `observe(ms, px)` door as well as `next()`'s sizing-time one (a job's
    LAST measurement otherwise never reaches a sizing call at all).
    Capture observations are RAISE-ONLY and may never own the floor,
    with one exception: a COMPLETED capture may SEED an EMPTY
    chain, since offline export is the one caller that never fills it
    otherwise — seed, never replace, and safe in the direction it can be
    wrong, an export-scale trace reading HIGH.
    THE PUMP IS PIPELINED (a measured A/B verdict): every sync point on the
    Iris/ANGLE stack costs the same tax REGARDLESS of the work behind it
    (`SURFACE_STRIP_SYNC_TAX_MS`), so strips go out as individually FLUSHED
    draw groups (the watchdog's preemption boundaries) fenced only per
    ~`SURFACE_STRIP_FENCE_GROUP_MS` of predicted work; batch measurements
    SUBTRACT the tax to price MARGINAL trace work. A FLAT subtraction was
    NOT enough on its own: a single ms/px number absorbs whatever fixed
    cost the constant under-states, which is a ONE-WAY RATCHET into a 1px
    absorbing state. The planner now
    carries the COMPUTE arm's two-term model instead
    (`surface-compute.ts`'s `ShadeHitCost`, whose own one-workgroup-floor
    comment describes this bug as its own pre-fix design):
    `interceptMs` + `px * marginalMsPerPx`, each measurement's
    surprise split BY WIDTH so a narrow batch charges the INTERCEPT,
    sizing off the marginal alone, the marginal's RISE rate-limited (the
    direction that shrinks strips — compute limits its FALL, for the
    opposite reason, so the direction is reasoned and not copied), and a
    sane-unit floor `STRIP_MIN_PX` instead of one pixel. THE CLAMP ORDER
    IS SAFETY-CRITICAL: model, growth cap, floor, then
    `STRIP_WORST_CASE_CAP_MS` LAST — wherever floor and cap disagree the
    CAP WINS, because an unbounded strip draw is the kernel-confirmed
    i915 preemption hang. The set of sizes a strip may
    take is unchanged; only the choice within it moved. DO NOT tune the
    tax constant instead — that only moves where the same ratchet engages;
    strips of a row or more row-snap to a single scissor rect (a
    per-DRAW fixed cost tripled under 3-rect strips); and the canvas blit
    rides PRESENT-ON-DRAIN gaps (presents share the strips' GL queue). The
    pipelined refill bounds its in-flight queue at a queue price on
    TYPICAL-cost class floors (the fold PRIOR, not the fold WORST
    constant), raised live by the job's own ratchet and capped at one
    `STRIP_WORST_CASE_CAP_MS` of mispredicted work. No-prior jobs (affine)
    keep the legacy sync-collapse — serial joined strips completing whole
    light jobs in one call, escaping to the pipeline past
    `SURFACE_STRIP_SYNC_ESCAPE_MS`.
    Capture/offline export runs the SAME pump, differing only in
    how it WAITS between calls: the synchronous one (offline export,
    thumbnails) blocks on ONE whole-queue readback per queueful, the
    yielding one (the Save-PNG) hands the main thread back on rAF —
    timer-backstopped at a frame (a slow frame clock would otherwise
    starve the queue) — and a bounded macrotask spin when the page is
    hidden. A capture job never presents (the export-scale target must not
    reach the canvas), ADOPTS the fence backlog like the live jobs, and
    winds its own queue down before returning from an abort so no export
    leftovers outlive the export. THE SYNCHRONOUS DRAIN RETIRES ITS FENCES
    WITHOUT POLLING THEM, straight after its readback (the stronger
    barrier) — polling would read TIMEOUT_EXPIRED forever on a page that
    never yields, spinning on a queue the GPU finished long ago.
    COST CEILINGS ARE THE SYNCHRONOUS DRAIN'S ALONE — offline
    export and thumbnails, the callers that freeze the tab and offer no way
    to stop it. There, measured evidence predicts the frame up front (never
    the class prior, which would refuse every fold export sight unseen) and
    refuses past `SURFACE_CAPTURE_PREDICT_CEILING_MS` (120s); the drain
    itself aborts past `SURFACE_CAPTURE_SPEND_CEILING_MS` (60s) of real
    spend; both throw `SurfaceCaptureCostError` — the offline exporter
    fails the run, the thumbnail path falls back to the explorer render.
    THE INTERACTIVE SAVE-PNG IS REFUSED NOTHING: its modal discloses
    measured coverage, its Cancel works, and the drain yields, so a
    prediction deciding for the user is the patience-guessing the
    truncated-preview regression already reverted one tier over.
    THE STANDING VERDICT IS NO AUTOMATIC GIVE-UP (two reverted truncation
    attempts and the user's own call): the settle always ARMS however
    expensive the frame — bounded strips grind visibly and
    interruptibly — and the preview always runs to COMPLETION, with
    `surfaceRenderProgress()` and the surface progress row disclosing
    honest coverage (naming its engine) so the user decides. The
    unbudgeted completion pass carried the same line across the WebGPU
    seam.
    THE COALESCING RULE: `renderSurface("preview")` ARMS a fresh job, so
    main.ts's tick now COALESCES like the compute loop instead of
    re-arming per invalidation — while a job is in flight an invalidation
    STEPS it, latched in `scene.needsRender` so the next arm takes the
    freshest camera. Pose coherence is free (`armSurfacePreview` snapshots
    the camera into uniforms, so a multi-frame job traces ONE pose).
    Fold surface sessions gate their first frame on `compileAsync` of the
    fold tracer program (the long links happen off the critical path where
    the driver offers `KHR_parallel_shader_compile`); THE COMPILE MESH MUST
    MIRROR FullScreenQuad's position+uv triangle or the draw links a second
    program variant, and the gate defers activate()'s guide/selection
    refresh so no other re-link joins the driver's compile queue behind it.
    Gated by `scripts/capture-export.verify.mjs`,
    `scripts/capture-drain.verify.mjs` and `scripts/surface-tier.verify.mjs`
    (whose mid-drag softness check is that rule's);
    `scripts/fold-settle-park.repro.mjs` and `?surfacetrace` sit one module
    over. Pure, tested. Full record — the A/B measurements, the reverted
    truncation attempts, the sync-tax arithmetic and the cost-ceiling
    history — in `docs/surface-strip-pipeline.md`.
  - `state.ts` — `AppState` + pure reducers (pure, tested). Xaos blocks are
    derived from mutual-1 chi connectivity; the isolated-block gesture writes
    structure, leak dials summarize uniform cross-weights, and the matrix is
    the fine editor rather than the construction path.
  - `persist.ts` — encode/decode scene to `#v1=<base64url>` hash + localStorage.
    Strict never-throwing decoder. Document carries optional `CameraPose` and
    optional `FourDPose` (rotor pair + w-slice; malformed quietly drops to
    `undefined`). Undo snapshots stay camera/pose-less (history.ts dedupes by
    string equality). A variation's three optional fold lengths encode
    only when present and finite — an unparameterized document is
    byte-identical to one predating them — and decode with two deliberate
    deviations from this file's other optional numbers, both documented at
    the function: NO `Number()` coercion (a numeric string or boolean drops
    rather than becoming a radius) and NO clamp, since the domain belongs to
    `variations.ts`'s `resolveFoldRadii` and persist's job at this leaf is
    fidelity.
  - `viewer-prefs.ts` — per-browser preferences under their own
    `fractal-viewer:prefs` localStorage key, deliberately OUTSIDE the scene
    document: a pref belongs to the person at this browser, so it
    must never ride the `#v1=` hash a shared link carries. localStorage only,
    never the URL/hash/`history`. Never-throwing load with strict validation
    (`false` is a real choice and survives); writes go through
    `updateViewerPrefs` (merge over stored — a bare save of one field would
    drop the others). Two prefs: `autoMotion` — one visible Automatic motion
    checkbox and shared 3D auto-orbit / 4D auto-tumble choice, `undefined` =
    never chosen, so boot follows
    prefers-reduced-motion — and `surfacePreview` — the surface
    quick-preview tier on/off; `false` freezes the pane during motion and
    settles straight to full detail on park (both engines), the
    no-patience-guessing line applied to the preview tier,
    with the progress row's one-shot Skip button as the in-the-moment
    escape (both engines). Pure, tested.
  - `history.ts` — session-only undo/redo stacks (pure, tested).
  - `edit-session.ts` — burst-coalescing over `history.ts`: one undo checkpoint
    per slider drag + debounced save. All effects injected; pure, tested.
  - `collection.ts` — persistent multi-slot scene library (localStorage).
    `after(id)` is the drift slideshow's loop cursor. Entries carry optional
    `SavedSceneMode` (on the ENTRY, never inside `encoded`). `importScenes`
    merges backups with dedup + fresh ids. `setThumbnail(id, …)` (and its
    `timeline.ts` twin) replaces ONLY the picture — not `add`,
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
    shadow with kaleidoscope baked into explicit xforms. Xaos rows parse and
    export in raw xform order, reindex around dropped maps, and omit at unity.
    DOMParser-tied (jsdom tests). Pure, tested.
  - `ui.ts` — control panel + transform list (`createElement`). Accordion of
    `<details name="panel-section">` sections, remembers open section per
    render mode. Mode content above the accordion (undo row, render progress).
    A FOLD variation's weight row carries the lengths that fold actually
    reads nested under it (box limit for a box fold, the sphere pair for a
    sphere fold, all three for a mandelbox — a box fold's `mR`/`fR`
    measured inert). Two rules keep `types.ts`'s "absent means classic
    BYTE-IDENTICALLY" true through an editing session:
    a length is written only once its own slider moves, and
    dragging one back to its classic value REMOVES it. The min-radius
    slider's ceiling IS the fixed radius and moves with it — the fold's
    domain `0 < mR <= fR` enforced in the row, so the readout is never a
    length `resolveFoldRadii` would silently clamp.
    A transform's FINISH group carries the same two rules one level up
    (to within half a slider step — a value round-trips through the
    slider's string and persist's rounding), plus a bundle select that is
    UI VOCABULARY ONLY: it SETS the sliders through that same per-field
    write, so Classic clears a finish outright and no bundle stores a
    classic-valued field (detection reads RESOLVED values, so
    `{specular: 0}` alone reads "Matte"). The forward-orbit disclosure
    reads the DOCUMENT's routing kind (`deriveSurfaceEligibility`'s
    `kind`) — NOT the session kind, unobservable here because the editor
    hides for the whole of a surface session. AND METALS READ AS THEIR
    SURROUNDINGS: metalness damps the diffuse away and the only
    reflection source is the backdrop, so Metal/Chrome render nearly
    BLACK against the dark stops (measured on `fourFinishes`' own
    system). Physically right — a mirror in an unlit room — so the hint
    and `docs/controls.md` DISCLOSE it rather than the BRDF fudging it.
  - `control-spec.ts` — declarative spec for panel scalar controls. Adding a
    setting = one spec entry + one index.html row (pure, tested).
  - `legend-spec.ts` — the color legend as DATA: `deriveLegend`
    returns a plain `LegendSpec` (hidden / gradient bar + three labels /
    swatch strip of labels and color chips) and `ui.ts`'s `paintLegend` only
    paints it. Every family choice — the showcase override, the render-mode
    branches ahead of the document's 4D-ness, the palette-driven renders,
    the colorMode key — lives here, so it is tested without jsdom the way
    `control-spec.ts` is. The one thing it cannot derive is a palette's
    DISPLAY name (index.html's `<option>` labels are the app's single source
    of those), so the caller injects a `paletteName` lookup keyed by which
    `<select>` picked it.
  - `constants.ts` — shared UI/interaction magic numbers.
  - `interactions.ts` — pointer/touch/wheel handling (Three.js raycasting).
  - `slider-scroll-guard.ts` — PREVENTS the panel sliders' tap-jump on
    touch, where an earlier pass repaired it after the fact (tested).
    The repair let the jump commit mid-gesture and fired `input` TWICE —
    two trips through burst coalescing, a possible history checkpoint and
    a cloud regeneration request, for a gesture meant as a scroll. The
    obvious prevention does NOT work and that pass's own doc said it would:
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
    change plus the trailing `change` the commit-on-release sliders
    hang off (`numPointsSlider` defers its whole regeneration to it, and a
    programmatic `value` assignment fires nothing). TAP-TO-SET IS GONE ON
    TOUCH by design — on a panel of full-width sliders a tap that lands on
    one is a scroll that has not moved yet far more often than it is an
    edit — and desktop click-to-jump is untouched (mouse pointers return
    early). Verified on real Chromium via
    `scripts/panel-touch-scroll.verify.mjs`: `#fogSlider` HAZARD -> SAFE
    from both start positions, pan still -132px. Not verified on WebKit or
    Firefox Android.
  - `capture-cost.ts` — the arithmetic behind a capture's cost memory,
    out of `scene.ts` so it tests without a WebGL context:
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
  - `export-progress.ts` — the Save-PNG progress modal's DOM-free policy:
    a run earns a blocking modal only past a slow `predictedMs`
    or `EXPORT_MODAL_GRACE_MS` (never-flash, `render-tier.ts`'s
    discipline), and its two stops stay apart on `ExportRun.stop` —
    `"cancel"` means DISCARD, the optional `"deliver"` means stop and
    keep. Cancellation is a REQUEST, never an instant stop. Pure, tested.
  - `main.ts` — entry point; wires state <-> scene <-> ui <-> interactions.
    `?surfacestate` publishes `window.__surfaceState()`, the
    read-only settle latch `scripts/surface-repro.verify.mjs` — and any
    future visual-regression script — waits on: the surface renderer is
    bit-reproducible run to run once truly settled, PROVIDED the scene
    document pins its camera (a pose-less scene deterministically auto-fits,
    but does not reproduce the reporter's inspection framing).
    SAVE-PNG'S ARM IS THE RENDER MODE'S, FULL STOP: a render that has not
    produced its picture yet is WAITED for behind the export
    modal (`planPngExport`'s `awaitReady`, disclosed and cancellable), never
    swapped for the explorer's — `scene.captureFrame` is reached by being in
    points mode and by nothing else, through one shared `planRenderWait` all
    three arms spread so no arm can restate (or misstate) the rule.
    Flame's wait is not merely a startup gap — it waits for
    `renderComplete.flame`, the accumulation MEETING ITS BUDGET (the
    flame canvas IS the export, so a mid-accumulation PNG is a
    categorically coarser picture, not an early one). Solid and Surface
    wait only for their first frame — both produce the export at capture
    time by re-tracing.
    `notifyRenderSignal` (was `notifyOfflinePark`) is the shared wake:
    progress, a session's deactivate, a playback stop, an export's Cancel.
    THE FLAME WAIT HAS A SECOND EXIT: "Save now (rough)" beside Cancel,
    offered only where the wait is longest (the budget scales with
    export AREA, so 4x multiplies it by sixteen). FLAME ONLY — solid's
    wait is the voxel grid with no partial
    to deliver. The press LATCHES and is honoured only once
    `hasFirstFrame`, which makes the feature "wait for the FIRST FRAME
    instead of the whole BUDGET" — without that latch a press in the
    Export-size restart gap delivered the PREVIOUS session's canvas at the
    PREVIOUS session's size, i.e. that same bug through a new door.
    Ties go to the BUDGET (the wait loop re-checks readiness before any
    stop check), so a press the finished render beat to the line gets an
    ordinary toast rather than one labelled rough. `cancelled` survives as
    `stop === "cancel"`, so callers predating the action are unmoved;
    Escape stays CANCEL-ONLY; and the button is ABSENT rather than hidden
    when not on offer, so nothing can Tab to it or query it.
    The fall-through bug this replaced, and why the Export-size restart
    gap could re-open it through the rough-save latch, are recorded in
    `docs/architecture.md`.
  - `regen-scheduler.ts` — rAF coalescer: one generation request per frame.
  - `cloud-worker.ts` / `cloud-worker-core.ts` — point cloud generation worker:
    one-shot request/response, seeded chaos game, colors + 4D transforms
    baked worker-side.
  - `cloud-generator.ts` — main-thread cloud worker client: at most one request
    in flight, latest wins, OR-merges coalesced flags. Synchronous fallback if
    worker crashes. `settle()` for offline export. Pure, tested.
  - `flame-backdrop-generator.ts` — optional backdrop worker controller over
    the existing flame protocol: one persistent CPU/transfer worker, fixed
    256px-class/1M-iteration blurred policy, 300ms trailing debounce, at most
    one request in flight plus one latest pending snapshot, and no synchronous
    fallback. Morphs `suspend()` it and keep the currently displayed source;
    the terminal cloud `resume()`s one fresh request. It screen-composites the
    worker image over dark off-thread output, publishes immutable opaque RGBA
    plus its mean fog color, and exposes `settle()` to frame-exact export.
    Pure controller, tested.
  - `flame-gpu-backend.ts` — drives flame WGSL kernels inside the flame worker
    behind `FlameAccumBackend` seam. Error-scoped resource creation
    (`FlameGpuSizeError`). `destroy()` defers the real `device.destroy()`
    until every in-flight op unwinds (`surface-compute.ts`'s
    deferred-teardown idiom one module over, counting OPS rather than
    frames, with the same `destroyed` = teardown REQUESTED /
    `deviceDestroyed` = device GONE split and the same inline teardown
    whenever nothing is in flight, which is what keeps the seam's
    `void destroy()` and gpu-bench's one-device-at-a-time invariant
    untouched).
    The hazard is routine here rather than exotic: every
    palette/supersample/symmetry edit reaches `startAccumulation`, which
    destroys the outgoing backend ON PURPOSE while a superseded `runChunk`
    can still be parked on `mapAsync` over a submitted copy. The ELEVEN
    explicit `GPUBuffer.destroy()` calls that ran AHEAD of the device are
    gone rather than reordered — two of them are the staging buffers a
    parked map holds a pending mapping on, an independent crash vector,
    and `device.destroy()` reclaims all eleven anyway — so the backend now
    holds only the buffers it TOUCHES (params, hist + staging, display +
    staging) and the rest live on their bind groups. `beginOp` refuses new
    work once teardown is requested, which is what bounds the drain to the
    ops already started; the only caller that can reach that refusal is a
    stale `runChunk` whose next generation check discards the result
    regardless. Lifecycle pinned by `flame-gpu-backend.test.ts` over a
    fake device (the class is exported for it); browser gate
    `scripts/flame-teardown.verify.mjs`.
  - `flame-worker.ts` / `flame-worker-core.ts` — flame render worker:
    `FlameWorkerSession` driving CPU or WebGPU accumulation; SAB fast path,
    transfer fallback. GPU failure recovery ladder: retry smaller -> fresh
    device -> CPU fallback.
  - `flame-perf.ts` — opt-in flame throughput diagnostics (`?flameperf`).
  - `voxel-worker.ts` / `voxel-worker-core.ts` — solid render worker (transfer only).
  - `surface-grid-worker.ts` / `surface-grid-worker-core.ts` /
    `surface-grid-client.ts` — empty-space-grid build worker:
    one-shot `buildSurfaceGrid` request/response (transfer), latest-wins-by-id
    client with `settle()` for the offline exporter. One request per 3D
    surface-session enter (the session freezes its DE), NO sync fallback — a
    lost worker degrades to gridless (correct, slower) marching. Request
    `resolution` is a ceiling: the worker times a measured pilot slab
    and downshifts through a 64/48/32 ladder to stay under a 3s budget, floored
    at 32, never skipped; the result's own `resolution`/`halfExtent` are what
    was actually built.
  - `voxel-material.ts` — GLSL3 raymarcher `ShaderMaterial` for voxel volume.
  - `surface-slots.ts` — the three per-slot shading inputs every surface tracer
    takes (per-slot "By Transform" colors, orbit-trap palette coordinates,
    and RESOLVED finishes), keyed on `baseIndex` into the DOCUMENT's
    transforms. Honors an authored `Transform.colorIndex`, else the
    surface's own even spread — pure, shared by `main.ts` and `gpu-bench/`
    so neither drifts from it. `surfaceSlotsAuthorFinish` is the finish
    COMPILE GATE's predicate — keyed on the SLOT list, so a weight-0
    transform's authored finish cannot force the parametric program;
    main.ts derives the gated list ONCE per surface enter (forward
    sessions pass ONE slot, the head transform's, matching firstChoice 0,
    and EVERY routing arm must assign it — the 4D chain's shipped
    unassigned for one review round, so the declaration now carries no
    initializer and tsc's definite-assignment analysis refuses the next
    one).
  - `surface-material.ts` — GLSL3 full-screen-quad sphere tracer mirroring
    `surface-de.ts`'s `estimateDistanceRefined` line for line, the same
    oracle discipline as `flame-gpu.ts`; BASE maps packed into fixed-size
    (24-slot) uniform arrays, with kaleidoscope sectors swept from three
    scalar uniforms rather than expanded into slots, so symmetry
    order no longer counts against the cap. Callers gate eligibility on the
    bare active-map count first, so an over-cap count throws here rather
    than degrading silently.
    VARIANT ARMS, resolved by `surfaceFragmentFor`: `SURFACE_FINISH`
    (per-map authored finishes over `uMapFinishA/B`, composing with EVERY
    variant in both dimensions; the 4D pair rides the `SurfaceMaps4`
    std140 block as UNCONDITIONAL members so the layout never moves on a
    define flip, and every recompose site threads the define);
    `SURFACE_FOLD_LENS`
    (the descent bodies rename to `surfaceDECore`, the wrapper
    owns the public `surfaceDE` overloads mirroring `descendLens`, and the
    cores' own `uFinal*` lens uniforms pack IDENTITY while the wrapper
    applies the real lens from `uLens*`); `SURFACE_ESCAPE`
    (`escape-de.ts`'s forward loop) and `SURFACE_BULB` (`bulb-de.ts`'s
    forward triplex-power loop), which each replace the
    descent bodies WHOLESALE and are therefore ALTERNATIVES —
    `surfaceFragmentFor` REFUSES the pair, and the bulb arm's `uBulb*`
    uniforms are declared INSIDE it so no other variant pays their bytes;
    `SURFACE_GROUND_PLANE` (an infinite one-sided floor below
    the session ball, its `shadeGroundPlane` entry mirroring the WGSL arm
    term for term, called from all three miss exits, composing with every
    variant except the balloon, which throws — no horizon inside the
    shell); and `SURFACE_BALLOON`. Since compute became the preferred
    tracer, the escape, bulb and fold-lens arms are the FALLBACK arms
    (`?surfacegl` / no adapter / device loss).
    The escape arm CYCLES the whole formula chain: one
    `uEscM`/`uEscT`/`uEscParams` slot per link declared INSIDE the arm,
    `uMapCount` the link count, `uMaxDepth * uMapCount` single-link steps
    so `uMaxDepth` keeps meaning PASSES, and `uSymOrder`/`uSymPlane`
    driving `foldQuerySector` once before the orbit. A link may be a POWER
    map, which cost three things and no layout change: the
    fold pair's `kind != 2` / `kind != 1` tests are exhaustive by NEGATION
    over {1, 2, 3}, so kinds 4 and 5 sit behind a `kind < 4` GUARD rather
    than beside them (unguarded, kind 4 satisfies both and runs both
    folds); `bulbPow8` is DUPLICATED from the `SURFACE_BULB`
    arm character for character, because neither alternative can see a
    definition emitted inside the other (a test diffs the two bodies so
    the copy cannot drift); and `uEscLogForm` is a SCALAR, not a params
    tail, because the estimate form is ONE number per CHAIN read after the
    orbit — per-link would put a step across every boundary between the
    two forms.
    THE STRIP IS A SIZE RULE, not the plane arm's private habit:
    `surfaceFragmentFor` strips any resolved source past
    `SURFACE_GLSL_STRIP_BYTES` (64KB) through `stripGlslSource`, a
    whole-source comment/indentation strip emitting the identical token
    stream. The cliff is real — Mesa crashes around 80KB — and a size
    threshold is the honest predicate for a size cliff, where a hand-kept
    list of which variants strip drifts the next time one grows a
    paragraph. MEASURE BEFORE ADDING THE NEXT PARAGRAPH — the strip
    threshold is on the RESOLVED source, the ~80KB cliff on what
    `surfaceFragmentFor` actually EMITS:
    `surfaceFragmentResolvedFor(escape, lens, balloon, plane, bulb).length`
    against `SURFACE_GLSL_STRIP_BYTES`, and `surfaceFragmentFor(...).length`
    against the cliff. The finish arm flips ONE strip status
    (escape+balloon, benign) and moves the pairing to watch to 4D PLAIN +
    FINISH — the first crossing that would cost a SHIPPED 4D session its
    commentary.
    Orbit-trap color blends descent choices TOP-DOWN (depth-0 copy
    dominates, flam3's convention); the per-level decay is the
    Color speed slider (default 0.5 = that original fixed behavior), and
    the rings/sheets sources ride the same hit-info descent. The
    march samples `surface-grid.ts`'s floors (NEAREST 3D texture) before
    paying a descent: a floor above `uAcceptPixelEps` — the
    tier-pinned acceptance eps, NOT the buffer-scaled
    `uPixelEps` — is both a no-hit proof and a safe stride, damped by the
    same `uStepScale` as analytic steps; gridless marching stays the
    always-correct fallback. Skips drain their own whole-ray cap
    (`SURFACE_GRID_SKIP_CAP`), never the analytic march budget, and the
    full-tier budget is 160 (raised from 96, which starved rays that
    thread gaps or graze faces into dropout speckle — measured + healed
    in `scripts/erosion-repro.harness.ts`). The three shading taps
    (normal/shadow/AO) ride the value form, which fold systems route to
    `surfaceDEProbe` — a width-1 instantiation of the SAME fold-descent
    template (the probe-width verdict on the fragment path; one text
    two names, march/hit acceptance stay width 12). The fold-lens variant
    deliberately carries no probe — the port was left undone when the
    surface-optimization seam closed.
    OUTPUT ALPHA IS THE COVERAGE FLAG AND MUST NEVER REACH THE
    CANVAS: three r163+ creates the canvas `alpha: true`
    unconditionally (the renderer's `alpha` param only picks the clear
    alpha), so a coverage-0 miss reaching the compositor ADDS the page's
    own `--bg` to the pane — the whole of the two 4D arms' measured IoU
    divergence, and an alpha hole in every WebGL surface Save-PNG. The
    present blit (`BLIT_FRAGMENT`) strips alpha to 1 as every surface
    present's last hop; coverage is read off the TRACE targets only.
    Full record — the variant KB sizes and their history, the Mesa link
    cliff, the probe-width A/B and the grid-budget measurement, and the
    coverage-alpha leak — in `docs/surface-glsl-tracers.md`.
  - `surface-material-4d.ts` — 4D twin: sphere-traces the
    `w = w0` slice of the rotor-posed 4D attractor, mirroring
    `surface-de-4d.ts`'s `estimateDistance4Refined` line for line (refined
    certificates + width-4 beam — the 4D spike's measured ghost eliminator
    plus the validity slots).
    The slice has a THICKNESS: `uSliceHalfW > 0` makes every
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
    tracer's world `uW0` through `wSupport`, so one slider
    position is one hyperplane across every mode; 24-map cap matching 3D's,
    the per-map arrays riding a std140 uniform BLOCK, and the
    kaleidoscope SWEEPS like 3D's, so 24 slots means 24
    transforms at any order. Since the 4D cut this tracer is the PLAIN-4D
    fallback arm, and since the shade-sizer width fix the fallback for EVERY 4D
    system, nothing routes here by preference any more (see
    `surface-compute.ts`'s bullet) — only `?surfacegl`, a missing adapter
    or a device loss.
    TWO VARIANT ARMS — the balloon inverted-union and
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
    sessions (base-map folds OR a fold FINAL lens, i.e.
    `deHasFolds(de) || foldFinal`), escape-time sessions (the
    non-contracting pure-fold map, or the CHAIN of them, that the IFS gate
    refuses), bulb sessions, and EVERY 4D session (THERE IS NO ORDER
    SPLIT LEFT, since the shade-sizer width fix) — for all
    of which no fold GLSL ever compiles (the Mesa link, the lens link and
    the i915 preemption entry hazards never engage) and no grid is
    requested (gridless by measured decision); the fragment 4D tracer is
    now purely its FALLBACK arm. COMPUTE-ONLY, entry REFUSED without
    compute and a mid-session loss exiting the mode with a toast:
    fold-shaped 4D sessions at any symmetry order and escape-shaped 4D
    sessions — the fragment 4D tracer carries no fold GLSL and no
    forward-orbit GLSL either. The 4D kernels' cost is algorithmically
    superlinear in ORDER, which no routing choice touches, so the scene is
    still tens of seconds on either arm. `?surfacecompute`/`?surfacegl`
    keep this re-measurable (main.ts; `?surfacegl` wins if both are
    given).
    `create()`'s opts carry the session's gated finishes (null = classic
    = literally today's kernels; non-null compiles `finish: true` and
    packs the stride-3 shadeMaps — create-time like the colors, and the
    frame spec DISCLOSES the list so the force-frame memo re-traces a
    finish-only leg).
    `create()` takes a `SurfaceComputeTarget` union
    (`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`) whose `kind` picks
    the kernel core (ifs4 → affine4 or fold4 off `deHasFolds4`, the 3D
    split one dimension up; `bulb` → `core:"bulb"`; `escape4` →
    `core:"escape4"`), the params packer and the maps buffer's
    layout/existence; the bounded march/shade host loop, progressive
    presents and failure ladder stay shared. `isForwardTarget` names the
    THREE forward kinds, `isFourDTarget` the two needing `view4`
    (`escape4` in both) — BOTH escape kinds carry their formula chain on
    the maps binding, so `bulb` is the one bindingless kind left. The
    BALLOON and the FLOOR ride an ifs4 target, with the 3D
    arm's precedence (the two never compile together and the balloon
    wins); NO FORWARD KIND EVER BALLOONS, in either dimension. The ifs4
    kind's rotor/slice view is PER-FRAME SPEC STATE (`spec.view4`, re-read
    from `setSurface4View` at every spec assembly and repacked per pass; a
    missing view4 THROWS), and `surfaceComputeForceFrameKey` includes the
    pose so a timeline leg's glide never re-presents a stale frame.
    Owns the device and the frame loop. March slices are sized from a measured
    per-ray·step EMA; the sweep's active-list rebuild reads 4 B PER ACTIVE
    RAY off the march's own status side-channel rather than the whole
    16 B/ray states buffer (the states never leave the device). Shade
    batches are sized in HIT units, never ray units — terminal rays queue
    by status, misses drain the FREE queue WHOLE in one dispatch per sweep
    with no cap of its own, and hits (plus ground-plane PLANE terminals)
    are FLOORED AT ONE WORKGROUP, NEVER ONE HIT: within a workgroup cost
    is depth-dominated, so a sub-workgroup batch buys no submission-wall
    safety — the old 1-hit floor was a one-way trapdoor that latched a
    settle as parked forever at a pose-dependent percent (the Mesa settle
    park; `?surfacetrace` and `scripts/fold-settle-park.repro.mjs` are
    that diagnosis' kept instruments). A hit dispatch's wall is FLAT in
    width to at least eight workgroups — latency-bound, not per-hit work —
    so the sizer carries a two-term model, `cost(n) = intercept +
n·marginal` (`ShadeHitCost`): each measurement's surprise splits
    between the terms BY WIDTH, sizing reads the MARGINAL alone, the
    capacity ladder grows against that budget, the marginal's FALL is
    rate-limited to a halving (`SURFACE_COMPUTE_SHADE_MARGINAL_DECAY`),
    ONE sizer is shared across a supersampling job's passes, and a partial
    hit batch is HELD for the next sweep rather than paying the intercept
    for a sliver. NO SIZING RULE HERE MAY BE WRITTEN IN TERMS OF
    `intercept` ALONE — the model never identifies its two terms
    individually, only their ratio — so `K`
    (`SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST`) is a WIDTH, not a ratio
    the scene has any say in: K = 7 (3584 hits), forced off the model
    since the sizer only ever visits one width.
    `SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS` IS 2000 AND ITS PLACEMENT
    IS THE MEASUREMENT, not a round number: a ceiling on the predicted
    TOTAL squeezes the allowance to nothing as the intercept approaches
    it, so it must sit outside the range real scenes measure in — at 1000
    it bit mandelboxKifs directly.
    NO submission outruns the i915 watchdog; progressive presents between
    every bounded piece; host-compacted active list; shading probes ride
    `SURFACE_COMPUTE_SHADE_DE_WIDTH` (the probe-width verdict); colorOut
    prefill seeds from the last frame (nearest-resampled), so during
    motion the present is the PREVIOUS frame with its newly resolved rays
    overwritten and the pane never shows backdrop mid-drag; per-frame
    status counts ride along for field debugging.
    SUPERSAMPLING rides that loop as `opts.samples`: N FRAMES of the same
    image at N sub-pixel offsets (`subPixelSample` — pass 0 the pixel
    CENTRE exactly, the rest the R2 low-discrepancy sequence), averaged in
    LINEAR light because both tracers end with a `pow(lit, 1/2.2)` encode
    and averaging the bytes is the edge-darkening bug — N frames rather
    than N rays per frame, so every per-ray buffer and watchdog bound
    stays as measured. The result is PROGRESSIVE and a superseded job
    keeps what it finished; main.ts spends it on the live SETTLE and on
    Save-PNG at 8 samples, never on a preview (cheap by definition) and
    never on offline VIDEO force frames (the cost would multiply by the
    frame count); the progress row discloses the pass as a trailing
    `antialiasing pass k/8`, silent through pass 1. `?surfacesamples=N` is
    the escape hatch and the A/B instrument. THE WEBGL STRIP ARM DOES THE
    SAME THING BY THE SAME ALGORITHM — it imports `subPixelSample` from
    here — so "8 samples" has ONE meaning whichever engine a machine has.
    A FRAME'S RASTER IS BOUNDED BY THE DEVICE, NOT THE CALLER: the six
    per-ray buffers cost 36 B/ray, and it is the 16 B ray state as a bound
    STORAGE buffer that a limit bites, so `maxFrameRays =
min(maxBufferSize, maxStorageBufferBindingSize)/16` and a frame past
    it THROWS `SurfaceComputeFrameSizeError` UP FRONT instead of reaching
    the kernels, because WEBGPU REFUSES SILENTLY HERE. Both callers size
    against it: the live pane FITS (`fitSurfaceComputeRaster` — a hidpi
    raster past the ceiling traces soft and blits up, disclosed once per
    session) and a capture TILES (`surfaceComputeTileRows`, capped at
    `SURFACE_COMPUTE_MAX_TILE_RAYS`). `captureSurfaceComputeFrame` traces
    the export as full-width BANDS, every band's spec assembled in ONE
    synchronous span (a tiled export outlives an auto-orbit/drift camera
    move), each a `camera.setViewOffset` sub-frustum at the FULL image's
    trace eps, with a `bgOffset`/`bgExtent` pair carrying the band's own
    place in the image per `background-shape.ts`'s shared FULL-IMAGE
    coordinate contract. One band is the whole image on an ordinary
    export, byte-identical to the untiled path.
    `?surfacemaxrays=N` pretends a device ceiling;
    `scripts/surface-export-tile.verify.mjs` is the gate.
    `destroy()` defers the real `device.destroy()` until every in-flight
    frame unwinds (tearing it down under a parked frame took the WHOLE
    Firefox process down, not a tab crash or a device-loss toast).
    `destroyed` means "teardown REQUESTED", `deviceDestroyed` means
    "device GONE" — NEVER call `device.destroy()` twice. Same shape as
    `flame-gpu-backend.ts`, counting OPS where this counts frames; pinned
    by `surface-compute.test.ts` over a fake device, and the real-Firefox
    `scripts/surface-teardown.verify.mjs` stays the authority on drivers.
    scene.ts presents frames as a DataTexture through the shared surface
    blit; main.ts routes and choreographs (same tier clock + preview
    governor, latest-wins preview coalescing + the unbudgeted completion
    pass; memoized offline force frames); fallback is one-way: create
    failure or device loss re-enters through the untouched WebGL path
    (`?surfacegl` forces WebGL).
    Full record — the routing measurements, the settle-park diagnosis,
    the two-term shade-cost model's derivation, the supersampling
    evidence and the raster-ceiling field report — in
    `docs/surface-compute-renderer.md`.
  - `surface-eligibility.ts` — the Surface gate as a pure derivation:
    document in, `{status, note, kind}` out — the routing across
    the five analyzers TESTABLE instead of an untestable closure inside
    `main()`; `refreshSurfaceEligibility` is one call into this plus the ui
    write, every decision leaf pinned over the shipped presets. `kind`
    exists so `surfaceSession.start`'s own re-derivation can one day consume
    the one shared answer; it does not yet.
  - `surface-force-frame-key.ts` — the offline-export force-frame memo key
    (`ensureSurfaceComputeForceFrame` re-PRESENTS instead of re-tracing when
    it is unchanged), pulled out of main.ts's closure so it tests at all —
    `capture-cost.ts`'s pattern, and the extraction is what let the
    stale-frame bug get a regression test. It must key EVERY spec field that
    repaints a HIT, and missing one fails SILENTLY: fog, envLight and the
    backdrop SHAPE triple all landed after the key and none were
    added, so an atmosphere-only timeline leg under a parked camera exported
    the PREVIOUS leg's frame for its whole dwell. EACH ABSENT FIELD MUST
    DEFAULT TO WHAT `packSurfaceGpuShade` DEFAULTS TO — a key that defaults
    differently re-creates the bug from the other side, keying two specs the
    same that pack differently. The string is a plain `join("|")`, so every
    optional block is tagged and fixed-length when present; the module doc
    carries the collision argument.
  - `render-backend.ts` — the "which engine, and is it software?"
    vocabulary: ONE `SOFTWARE_RENDERER_RE`, adapter-status derivation,
    unmasked-renderer read and warning-string pair, so every site deciding
    whether the app is silently on a CPU rasterizer agrees on the answer
    AND the wording (`gpuprobe.html`'s inline copy is deliberately
    byte-identical — it runs before the bundle can be trusted). Tested.
  - `render-session.ts` — `enter`/`exit`/`terminate` + first-frame-gate for
    flame/solid/surface controllers. `renderMode` is session-only, never
    persisted. An optional `onFirstFrame` fires on the false→true
    TRANSITION alone (the flame marks per progress event, so the
    gate absorbs the repeats), which is one wiring per session rather than
    five call sites that could each forget one.
  - `thumbnail-patch.ts` — the pending late thumbnail corrections, pure
    and session-only. A ★ Save to collection or 📍 Add
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
    picture beats a confident wrong one. Camera + non-flat FourDPose framing
    ride the encoded document, so a manual orbit or rotor/slice change
    invalidates too — the conservative direction. Flat Solid's live
    auto-orbit can invalidate such a correction exactly like a manual camera
    turn; frozen Flame and parked Surface do not advance it.
  - `four-d-view.ts` — the session-owned live 4D view container. `FourDPose`
    snapshots rotor + slice as Saved-view framing; auto-motion on/off is a
    browser preference and speed is session-only. `FourDTween` is the directed
    pose glide (rotor slerp + slice lerp).
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
    reload (see `register-sw.ts`). The scene document needs no such
    bridge — `persist.ts` already round-trips it through the `#v1=` hash as
    every edit happens — but `renderMode` is deliberately session-only
    (`state.ts`), so it rides nothing across a reload on its own.
    `saveIsolationHandoff` runs from the new `onBeforeIsolationReload` hook;
    `consumeIsolationHandoff` reads it back once, early in the next boot.
  - `register-sw.ts` — service-worker registration + COOP/COEP bootstrap.
    Takes an `onBeforeIsolationReload` hook, fired the instant
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

**THE CODEBASE MUST NOT CITE THE TRACKER.** A bead id is not a stable
foreign key: this tracker has been corrupted before and may be replaced
outright, and either event turns every `see fr-xxxx` into a pointer at
nothing. So ids are never written into `src/`, `docs/`, `scripts/`, the
build and workflow files, or this one — and neither is the tracker itself
as the CARRIER of a claim ("the bead expected", "per the bead's ask", "the
epic's figures"), which dangles exactly as badly while looking innocent.
What a decision, a measurement or a refutation WAS is written out in full
where it lives — rules here, evidence in `docs/`, per the split at the top
— and named in the project's own words ("the march-epsilon cutoff
contract", "the kernel-confirmed i915 preemption hang"). Writing ABOUT the
practice is fine — "filing a 4D-lift bead and closing the epic" names the
standing failure mode two sections up — but citing an item's contents as
your source is not. The ONE exception is work still OPEN: a comment may
name the id of an unfinished item it waits on, and deleting that reference
is part of closing the item. Commit messages are out of scope and may cite
freely — git history is immutable and is not loaded into a session's
context. One sweep removed ~7,500 ids and ~130 such citations, so
`grep -rE 'fr-[a-z0-9]{3,6}' src docs scripts CLAUDE.md` finding anything
but open work is a regression, not a style preference.

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

**Merge, then WAIT for main's CI before dispatching a deploy.** A rebase merge
mints NEW SHAs on main, so the PR's green checks do not transfer to the merged
commits: deploy.yml's gate reads the dispatched commit's own check runs, and a
dispatch fired straight after `gh pr merge --rebase` is refused (measured: at
merge+14s). The refusal is the gate working, not a bug — watch main's
CI finish on the new tip (`gh run watch`), then dispatch.

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
