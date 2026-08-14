# CLAUDE.md

**Fractal Explorer** — an interactive 3D/4D IFS (Iterated Function System) fractal
explorer. A set of affine transforms is rendered with the "chaos game" into a live
Three.js point cloud. Built with TypeScript + Vite, packaged as a PWA, deployed to
GitHub Pages. Reference docs in `docs/`.

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
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (eval/march baselines + fr-tzdg's march-unproject/shade app path) to the CPU estimator; add --display=:0 for real-driver timing; run it on a QUIET machine, never concurrently with the test suite or other heavy CPU load — a contended software device corrupts mid-run readbacks, which the fr-76pp canary reports as verdict=device-unreliable (exit 2, rerun) instead of plausible numeric fails
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

**Harness sheets** (`scripts/*.harness.ts`, run with
`npx vitest run --config scripts/vitest.harness.config.ts scripts/<name>`)
are this project's executable measurement records — the argument for a
decision, kept runnable rather than summarized. `scripts/de-preview.ts` is
the SHARED renderer eight of them import (`renderPreview`,
`writeContactSheet`, `encodePng`, and the `DistanceEstimator`/`PanelStats`
vocabulary): a CPU sphere-marcher with AO/shadow switches, a settable step
budget and an always-counted `exhausted`, so a new sheet writes its
estimator and its panel list, never a ninth marcher. Output lands under
`scripts/out/`, which is gitignored — regenerate rather than commit
megabytes of PNG. The escape-time family's sheets:
`escape-form-sweep` (fr-7u8t.8's retired Julia form, still executable),
`escape-chain` (fr-za0n's shipped cycling estimator, and the rejected
per-pass CHAINING arm beside it), `hybrid-chain` (the cross-family
prototype fr-j231 is filed from — links this gate still refuses),
`chain-speckle` (fr-vpbq's and fr-byxb's evidence: the speckle is
sub-pixel, the ramp is bottom-heavy), `bulb-preview` (fr-7u8t.7's step-scale
sweep), `escape-family-preview` (the three estimators side by side),
`qjulia-preview` and `qjulia-beauty` (fr-7u8t.4's proof, and the twenty
panels that demoted fr-7u8t.5/.6), `julia-flame` (the compositions three
flame presets were picked from).

Requires **Node.js 18+** (ES2022 target; developed on Node 22).

Reproduce the COOP/COEP first-visit reload locally:
`node scripts/isolation-reload.verify.mjs` (fr-su3r, not an npm script) —
serves the production build over a plain static server with no COOP/COEP
and a deliberately delayed `sw.js`, widening the reload window on demand;
`npm run preview` can trigger the same dance, but only at real,
easy-to-miss localhost timing.

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
  - `flame-gpu-4d.ts` — 4D WGSL kernel (4x4+t affines, `variations4`,
    rotor+camera projection, four `FourDRenderColor` modes). Same agreement harness.
  - `morph.ts` — pure interpolation (`lerpSystem`): endpoint-exact at t=0/1,
    rotation lerped nearest-turn, transform-count mismatches fade surplus by
    weight, flat↔4D continuous via derived w-scale, kaleidoscope crossfade
    (identity tuple = order/plane/twist; twist never interpolates).
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
    none). Oracle for
    `surface-material.ts`, the `flame.ts` <-> `flame-gpu.ts` discipline one
    render mode over.
  - `surface-de-4d.ts` — `surface-de.ts` one dimension up (born as the
    fr-beck spike): Jacobi `singularValues4`, `analyzeSurfaceSystem4`,
    `buildSurfaceDE4` (final-transform lens included; also derives
    `radiusBand` — the visible set's probe-seeded 4D center + [minD,
    maxD] distance band, fr-skhv: the radius color source's normalizer,
    matching `buildColors4`'s radius convention so the full ramp is in
    play, slice/rotor-invariant), beam
    `estimateDistance4` + ghost-free `estimateDistance4Refined` — the 4D
    surface render's CPU oracle, mirrored by `surface-material-4d.ts`.
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
    fr-kidj stage-2 B&B on/off (WGSL has no Mesa link cliff). SIX
    KERNEL CORES (fr-55s1 added the second, fr-dlxh the third and — its
    4D cut — the fourth, fr-rsp6 phase 2A the fifth, fr-7u8t.9 the
    sixth):
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
    core left; width/sharedFrontier/
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
    chain-invariance. Cost is the clamp: 1.9-8.6% of really-hit pixels at
    six links, up to 15.8% over the whole surface. The convention
    `core:"bulb"` always used)
    with rings/sheets over the orbit's
    closest approaches — the descent cores' colors-only convention.
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
    lens4 params block at 464..559, `SURFACE_GPU_PARAMS4_LENS_BYTES`
    560, packed exactly when the DE carries a `foldFinal`; the old
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
    row, capped at 7). Measured on real Iris: fail=0 across all four
    escape systems, worst row excluded=74/700 with flips=2, gated
    maxAbs 2.1e-6. A `computeFrameEscape` leg
    runs one production frame through `SurfaceComputeRenderer` with a
    `{kind:"escape"}` target and checks it against a strided CPU sanity
    march as HIT RATES rather than the per-pixel fr-7tl3
    status-exclusion tiers — the march entry text is shared across every
    core (test-pinned) and the escape DE is eval-pinned, so a rate band
    absorbs the same chaotic-orbit flips without duplicating that
    machinery for a second DE type (measured on real Iris: 256x144 in
    136ms wall, 33 passes, 0 exhausted, GPU hit rate 0.153 vs CPU 0.158 —
    the rates roughly halved at fr-7u8t.8, which is the Mandelbrot form
    replacing a blob that filled 94% of its own ball with an object that
    fills 10%; the gate is the GAP between the two rates, so it moved with
    them).
    Ground plane (fr-rhn5) is an orthogonal `groundPlane` option, not a
    sixth core — it composes with every descent/escape core and the lens
    wrapper. It adds a fifth ray status, `SURFACE_GPU_RAY_PLANE` (4), that
    march classifies a sphere-gate/sphere-exit MISS into when a downward
    ray crosses the floor inside its fade band (EXHAUSTED never planes);
    the shade entry lights the crossing with the hit path's penumbra/AO
    probe-width discipline under two analytic ball certificates. Params
    append a 320-byte block (`SURFACE_GPU_PARAMS_PLANE_BYTES`) at the
    frozen offset 272, SHARED with the balloon block — the two throw at
    codegen/pack together (no horizon inside the balloon's shell), and so
    do the 4D cores (3D scope). `surface-compute.ts` prices PLANE
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
    the IFS gate refuses (one or more pure-fold flat maps of which at
    least one does NOT contract, no final transform, no kaleidoscope
    that rotates out of 3D — `analyzeEscapeSystem` is the deliberate
    COMPLEMENT of `analyzeSurfaceSystem` on that shape, which admits
    exactly when EVERY map contracts).
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
    2.9% → 57.7% → 65.6% at 4/8/16). Phone-cheap by
    construction (~30 branchless folds per link per eval; measured 0.25
    us/eval at one link and 0.27-1.10 across eight chains, the six-link one
    at 0.60 — the n-times budget is a ceiling only a non-escaping orbit
    pays, and every extra link is another chance to escape).
    THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`):
    orbit step `i` applies link `i mod n`, `+ p` and the bailout test
    after EACH link, and a PASS is one full cycle — so
    `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the GPU's
    `maxDepth` keep meaning "how many times is each link applied". The
    rejected alternative, CHAINING (all n links inside one pass, i.e. the
    per-PASS offset — the same fork under the prototype's other name),
    was measured into a near-solid ball as links were added — 72.8% of the
    bailout ball at six links, the fr-7u8t.8 defect returning — and
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
    that confusion. The signal fires off the FIRST completed settle's own
    hit count instead (main.ts's `surfaceBlankNotice`): a frame that drew
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
    a near-SPHERE: 94% of the bounding ball non-escaping at the bench
    fixture's own constant. `t` survives as the PRE-fold offset — a live
    deformation knob, classic Mandelbox at `t = 0` — so the mode still
    adds NO document state and stays a render MODE over the existing
    vocabulary (morphs/mutations/persistence untouched). The Julia form
    was measured, not merely argued away, and lives on as a local in
    `scripts/escape-form-sweep.harness.ts`: it only thins past |t| ~ 2.5
    and is a pitted ball even at its best, so it does not earn the
    permanent document flag it would cost.
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
    fr-j231 cites it by name as where the quaternion square's EXACT
    `2|q|` derivative lives — as a chain LINK the map rides the escape
    core and needs neither its own kernel nor its own 4D lift, so the
    object that is dull alone may still earn its place composed with a
    fold.
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
    presets reach it from the Escape-time menu group.
  - `types.ts` — type vocabulary: `Transform`/`Transform4`, `Vec3`/`Vec4`,
    `Bounds`/`Bounds4`, `WExtension`; `VARIATION_TYPES`/`COLOR_MODES`/
    `FOUR_D_COLOR_MODES`/`SYMMETRY_PLANES` const arrays (single source of truth).
  - `variations.ts` — seventeen nonlinear flame variations as pure functions:
    a dozen classics, the Mandelbox fold family (`boxfold`/`spherefold`/
    `mandelbox`, fr-p7nu), and the two escape-time maps that exist so their
    renderers can gate on a document shape — `qsquare` (fr-7u8t.3, the
    quaternion square) and `bulb` (fr-7u8t.7, the White/Nylander triplex
    8th power, `triplexPow8`: a TRIG-FREE closed form via the Chebyshev
    `T8`/`U7` polynomials plus de Moivre, an exact rewrite of the
    `acos`/`atan2`/`sin`/`cos`/`pow` one at 6e-14 and ~11x cheaper. The
    power is baked in because triplex multiplication is not associative —
    `p^8` is NOT `((p^2)^2)^2`, which disagrees on 48.8% of queries — so
    every power would need its own closed form). `composeVariations` blends
    a transform's weighted list.
  - `variations4.ts` — same variations lifted to 4D, bit-exact at `w = 0`.
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
    string equality).
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
    merges backups with dedup + fresh ids. Pure, tested.
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
  - `control-spec.ts` — declarative spec for panel scalar controls. Adding a
    setting = one spec entry + one index.html row (pure, tested).
  - `constants.ts` — shared UI/interaction magic numbers.
  - `interactions.ts` — pointer/touch/wheel handling (Three.js raycasting).
  - `slider-scroll-guard.ts` — undoes tap-jump on panel sliders when touch
    becomes a scroll (tested).
  - `main.ts` — entry point; wires state <-> scene <-> ui <-> interactions.
    `?surfacestate` publishes `window.__surfaceState()` (fr-opgk), the
    read-only settle latch `scripts/surface-repro.verify.mjs` — and any
    future visual-regression script — waits on: the surface renderer is
    bit-reproducible run to run once truly settled, PROVIDED the scene
    document pins its camera (a pose-less scene auto-frames from a
    `Math.random()`-seeded cloud and drifts ~0.3%/load, lighting up 1-9%
    of pixels).
  - `regen-scheduler.ts` — rAF coalescer: one generation request per frame.
  - `cloud-worker.ts` / `cloud-worker-core.ts` — point cloud generation worker:
    one-shot request/response, seeded chaos game, colors + 4D transforms
    baked worker-side.
  - `cloud-generator.ts` — main-thread cloud worker client: at most one request
    in flight, latest wins, OR-merges coalesced flags. Synchronous fallback if
    worker crashes. `settle()` for offline export. Pure, tested.
  - `flame-gpu-backend.ts` — drives flame WGSL kernels inside the flame worker
    behind `FlameAccumBackend` seam. Error-scoped resource creation
    (`FlameGpuSizeError`).
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
    for both engines, and the compute arm's storage list has none). The `SURFACE_BULB` variant (fr-7u8t.9)
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
    fr-fniy). `create()` takes a
    `SurfaceComputeTarget` union
    (`{kind:"ifs"|"escape"|"bulb"|"ifs4"}`) whose
    `kind` picks the kernel core (ifs4 → affine4 or fold4 off
    `deHasFolds4`, the 3D `deHasFolds` split one dimension up; `bulb` →
    fr-tdin's `core:"bulb"`, structurally the escape arm one formula
    over — `isForwardTarget` names the pair so a branch cannot serve one
    and miss the other), the
    params packer and the maps
    buffer's layout/existence — the bounded march/shade host loop,
    progressive presents and failure ladder stay shared regardless.
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
    reachable by any viewport (partial-coverage exponent -0.21..-0.36
    against output resolution where a sphere's perimeter law measures
    -0.98). main.ts spends it on the live SETTLE and on Save-PNG at 8
    samples, never on a preview (cheap by definition) and never on offline
    VIDEO force frames (the cost would multiply by the frame count); the
    progress row discloses the pass as a trailing
    `antialiasing pass k/8`, silent through pass 1. The WebGL strip arm
    is untouched — it needs accumulation passes through the strip pump
    rather than an in-shader loop, whose all-or-nothing per-strip cost
    would fight the fr-096u/fr-id9r bounded-strip machinery. scene.ts
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
    phase, nothing structural).
  - `render-session.ts` — `enter`/`exit`/`terminate` + first-frame-gate for
    flame/solid/surface controllers. `renderMode` is session-only, never
    persisted.
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

1. **File issues for remaining work** — capture follow-ups in `bd`.
2. **Run quality gates** (if code changed) — `npm test`, `npm run build`.
3. **Update issue status** — close finished work, update in-progress items.
4. **Push to remote** — push the feature branch and open a PR to `main`.
5. **Verify** — all changes committed AND pushed.

If quality gates fail, fix them before pushing. Never push broken code.
