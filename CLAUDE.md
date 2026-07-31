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
npm run bench:surface # WebGPU fold-DE kernel agreement/timing — pins surface-de-gpu.ts (eval/march baselines + fr-tzdg's march-unproject/shade app path) to the CPU estimator; add --display=:0 for real-driver timing
```

Run a single test file: `npx vitest run src/fractal/chaos-game.test.ts`

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
    3D→4D), `systemIsFlat` predicate (derived from transforms, never stored).
  - `chaos-game.ts` — IFS iterator: warm-up, escape-reset, bounds tracking.
    Injected RNG for reproducibility; optional `IterationRng` keeps morphs
    point-for-point correspondent. `SymmetryParams.blend` fades kaleidoscope
    weights continuously.
  - `chaos-game-4d.ts` — 4D twin (`runChaosGame4`), same loop unrolled to four
    coords. No kaleidoscope symmetry by design.
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
    weight, flat↔4D continuous via derived w-scale, kaleidoscope crossfade.
  - `mutate-system.ts` — mutation grid perturbation (`mutateSystem`): seeded
    nudge of every field, clamps mirror sliders, optional keys preserved
    exactly; `wildcard` option adds structural kicks. Quality-gated by
    `scoreSystem`.
  - `palette.ts` — Iq cosine-gradient palettes (`buildPaletteLUT` → 256×3 LUT)
    - user-authored `CustomPalette` (2–8 stops). `PaletteSelection` = UI/state,
      `PaletteSpec` = worker/GPU wire, `resolvePalette` = bridge.
  - `presets.ts` — default + named systems + add-transform.
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
    `buildSurfaceDE4` (final-transform lens included), beam
    `estimateDistance4` + ghost-free `estimateDistance4Refined` — the 4D
    surface render's CPU oracle, mirrored by `surface-material-4d.ts`.
    Measured verdict + numbers in the module doc.
  - `surface-de-gpu.ts` — WGSL fold-DE compute kernel (fr-q1f8 spike, gated
    in by fr-ck0w's occupancy verdict; app integration fr-tzdg): mirrors
    `estimateDistance`'s refine=false fold path term for term (the
    estimator the fold GLSL marches) under the `flame-gpu.ts` oracle
    discipline, source-generated per config — frontier width,
    workgroup-SHARED (banked, transposed) vs private frontier storage,
    fr-kidj stage-2 B&B on/off (WGSL has no Mesa link cliff). TWO descent
    cores since fr-55s1: `core:"affine"` emits the width-4 A/B +
    fr-jkpn-validity-slot REFINED ladder (mirrors
    `estimateDistanceRefined`, the affine GLSL's estimator; width/
    sharedFrontier/bnbStage2/shadeDeWidth inert) beside the fold
    frontier, picked off `deHasFolds` exactly like the CPU; and
    `lens:true` wraps EITHER core in `descendLens`'s fold-FINAL branch
    sweep — the body token-renames to `surfaceDECore` (hit-info to
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
    kernel changes on `--display=:0`, not SwiftShader alone.
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
    Consumed by `src/app/surface-compute.ts` (the fold surface session's
    preferred tracer) and pinned by `src/app/gpu-bench/`'s surface section
    (`npm run bench:surface`; real-driver timing via `--display=:0`;
    `--surface-shade-width=N` reruns the fr-p8bc probe-width A/B).
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
  - `escape-de.ts` — escape-time fold render's CPU oracle (fr-kltj): the
    canonical Mandelbox/Juliabox object for exactly the systems the IFS
    gate refuses (single non-contracting pure-fold map, flat, no
    final/kaleidoscope — `analyzeEscapeSystem` is the deliberate
    COMPLEMENT of `analyzeSurfaceSystem` on that shape).
    `estimateEscapeDistance` iterates the map FORWARD with a scalar
    running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's
    standard heuristic, not a certified bound; the marcher damps steps),
    mirrored by `surface-material.ts`'s `SURFACE_ESCAPE` variant.
    Phone-cheap by construction (~30 branchless folds per eval). The
    rendered set is the JULIA-form set of the authored transform (`t` is
    the document's fixed offset), so the mode stays a render MODE over
    the existing transform vocabulary — morphs/mutations/persistence
    untouched.
  - `types.ts` — type vocabulary: `Transform`/`Transform4`, `Vec3`/`Vec4`,
    `Bounds`/`Bounds4`, `WExtension`; `VARIATION_TYPES`/`COLOR_MODES`/
    `FOUR_D_COLOR_MODES`/`SYMMETRY_AXES` const arrays (single source of truth).
  - `variations.ts` — fifteen nonlinear flame variations as pure functions: a
    dozen classics plus the Mandelbox fold family (`boxfold`/`spherefold`/
    `mandelbox`, fr-p7nu); `composeVariations` blends a transform's weighted
    list.
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
  - `exposure.ts` — `glowExposure`: density-adaptive brightness for the
    `"glow"` render style (not the flame tone-map). Pure, tested.
  - `resolution-governor.ts` — adaptive resolution: frame-time ladder (EMA +
    hysteresis) trades pixels for frame rate. Exports/flame stay unscaled.
    Session-only `adaptiveResolution` opt-out. Bypassed in surface mode
    (render-tier.ts owns that cost). Pure, tested.
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
    Capture/offline export still drains serially with forced-completion joins,
    now under cost ceilings (fr-id9r): measured evidence predicts the frame up
    front — never the class prior, which would refuse every fold export
    sight unseen — and refuses past `SURFACE_CAPTURE_PREDICT_CEILING_MS`
    (120s); the drain itself aborts past `SURFACE_CAPTURE_SPEND_CEILING_MS`
    (60s) of real spend; both throw `SurfaceCaptureCostError` — save-PNG
    toasts it, the offline exporter fails the run, the thumbnail path falls
    back to the explorer render. Capture observations raise-only into the
    evidence chain without killing it — the pose hasn't moved, so live
    settle/preview evidence stays valid, and the drain's export-scale,
    join-tax-inflated observation may only tighten that floor, never own it (a
    micro-strip capture priced at pure readback overhead would otherwise pin
    the next settle to dissolved micro-strips). fr-24to asked for a
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
    refusals gained the "Render anyway" opt-in (300s consented
    backstop). Measured A/B (Iris, real driver, `?surfacegl`): lens-system
    settle 2.5s vs main's 3.2s (total-to-settled 6.8s vs 7.4s), boxfold-pair
    settle 0.2s, escape 45ms — at full safety caps, kernel-silent through
    every monster run. The settle always ARMS, however expensive the frame —
    bounded strips grind visibly and interruptibly (an early fr-096u cut
    gated it on predicted cost and silently blanked legitimate lens
    settles into permanent preview blur: a silent refusal reads as a
    broken render); the same never-refuse discipline now covers the
    preview too — it always runs to completion, with progress
    disclosed rather than bounded. Fold surface sessions also
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
    gate refuses but `analyzeEscapeSystem` admits) — same marcher, tiers,
    strips, capture; no grid (its validity chain is IFS-specific).
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
    Rotor + w-slice are LIVE per-frame view uniforms (`setSurfaceView4`),
    unlike flame/solid-4D's frozen snapshot — the slider is normalized
    rotated-w, and `scene.ts`'s `setSurface4View` converts it to the
    tracer's world `uW0` through `wSupport` (fr-33yb), so one slider
    position is one hyperplane across every mode; 24-map cap, matching 3D's —
    the per-map arrays ride a std140 uniform BLOCK (fr-dqlq: 2688 bytes of the
    guaranteed 16KB, where default-block arrays would have taken 192 of the
    guaranteed 224 fragment uniform vectors), and there is no kaleidoscope to
    expand, so 24 slots means 24 transforms.
  - `surface-compute.ts` — WebGPU compute renderer for FOLD 3D surface
    sessions (fr-tzdg): systems with base-map folds OR a fold FINAL lens
    (fr-55s1 — `deHasFolds(de) || foldFinal`; the DE picks the kernel
    core and the lens wrapper, and the two first-sizing priors scale by
    the lens branch count 27/3/81 ÷ 8) PREFER it when an adapter exists
    — no fold GLSL ever compiles (the ~25s Mesa link / ~5.7s lens link /
    fr-096u entry hazards never engage), no grid request (gridless by
    decision, measured). MEASURED (fr-55s1, Iris Xe real driver, dev
    regime): the fr-g58b lens archetype previews in 0.94s and settles a
    full 1280x720 frame in 9.4s (0 exhausted) where the WebGL A/B of the
    same hash was 43% settled at 30s; the 81-branch mandelbox field
    class settles in ~35-55s (thermally variable) vs a 2min+ WebGL
    grind. Owns the device (bench acquisition
    idioms + flame-backend error taxonomy) and the frame loop: march
    slices sized from a measured per-ray·step EMA + shade batches sized
    in HIT units (fr-p8bc: terminal rays queue by status — misses are
    one background write, hits pay the probe evals and arrive
    scanline-CLUSTERED; batches are predicted from a per-hit cost EMA
    under a pessimistic prior, spike-lifts instantly, decays slowly,
    capped by the slow-trust double/quarter policy — the original
    ray-unit doubling let miss runs inflate capacity a hit band then
    paid, five kernel-confirmed i915 GPU hangs) so NO submission
    outruns the i915 watchdog; shading probes ride the width-1 greedy
    descent (`SURFACE_COMPUTE_SHADE_DE_WIDTH`, the fr-p8bc measured
    verdict: 23.8x cheaper shading, eyeball-identical frames);
    host-compacted active list; progressive presents between
    every bounded piece; colorOut prefill seeded from the last frame
    (nearest-resampled — the strip settle's preview-seeded-target
    discipline); per-frame status counts for field debugging. scene.ts
    presents frames as a DataTexture through the shared surface blit (the
    one WebGL canvas — capture/recorder unchanged) and assembles specs
    with the uniform-exact camera/eps/tier quantities (acceptance eps
    stays native-height, fr-7xgi); main.ts routes and choreographs (same
    tier clock + preview governor, latest-wins preview coalescing,
    memoized offline force frames, one-way fallback: create failure or
    device loss re-enters through the untouched WebGL path; `?surfacegl`
    forces WebGL).
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
