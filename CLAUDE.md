# CLAUDE.md

**Fractal Viewer** — an interactive 3D/4D IFS (Iterated Function System) fractal
viewer. A set of affine transforms is rendered with the "chaos game" into a live
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
```

Run a single test file: `npx vitest run src/fractal/chaos-game.test.ts`

Requires **Node.js 18+** (ES2022 target; developed on Node 22).

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
    Three.js conventions so output is identical to the original viewer.
  - `affine4.ts` — the 4D affine group (4×4 + translation), `toTransform4`
    (lift a 3D `Transform` to 4D), and the `systemIsFlat` predicate that decides
    whether a system is 4D at all — derived from the transforms, never stored.
  - `chaos-game.ts` — the IFS iterator: warm-up, escape-reset, bounds tracking.
    Takes an injected RNG so runs are reproducible in tests; an optional
    `IterationRng` (fr-2wfw) moves every iteration-local draw (stochastic
    variations, escape reseeds) onto a per-iteration stream so ε-different
    same-seed runs stay point-for-point correspondent — what keeps a morph
    flowing instead of boiling. `SymmetryParams.blend` (fr-eykn) fades the
    kaleidoscope copies' pick weights continuously (0 ≡ order 1, bit-exact).
  - `chaos-game-4d.ts` — the 4D twin of `chaos-game.ts` (`runChaosGame4`): the
    same warm-up/escape/reseed/bounds loop unrolled to four coordinates
    (including the `IterationRng` parameter). 4D has no kaleidoscope symmetry
    by design.
  - `color.ts` — `Color.setHSL`-faithful HSL→RGB and the five color-mode
    palettes; since fr-3b6 the height/radius ramps can sample a gradient
    palette instead of the built-in HSL formulas (`rampPaletteId`,
    `"legacy"` = the built-ins) — `buildColorModeLUT`/`writePaletteRampColor`
    is the ONE ramp definition the explorer, solid render, and legend share.
    The 4D projection's "By 4D Radius" mode follows the same selection
    (fr-6ue): `buildColors4`, the flame/voxel workers' 4D radius LUT, and the
    4D legend all take the resolved ramp palette. In the panel the 4D look
    controls (4D Color, depth fade) live in the Appearance section beside
    their flat siblings, with the one ramp row statically beneath the
    color-select pair (fr-15g) — the 4D View section keeps only the spatial
    tumble/slice controls.
    The position mode's axis colors are user-pickable too (fr-8k7,
    `PositionAxisColors`): `writePositionColor` — a clipped
    coordinate-weighted blend, absent = the legacy XYZ→RGB identity — is the
    ONE custom-position definition `buildColors` and `accumulateVoxels`
    share; the legend shows the live colors as X/Y/Z swatches.
  - `flame.ts` — the CPU fractal-flame still: accumulate the chaos game into a
    2-D hit/color histogram (`accumulateFlame`) and tone-map it (`tonemapFlame`:
    exposure/gamma/vibrancy over a log-density curve). CPU oracle for
    `flame-gpu.ts`.
  - `flame-4d.ts` — the 4D twin (`accumulateFlame4`), CPU oracle for
    `flame-gpu-4d.ts`; slices with the `0.06` ghost floor like the point cloud
    (unlike the solid render's `0`).
  - `flame-gpu.ts` — the WebGPU flame kernel (WGSL) + pure packing/dispatch-
    planning/histogram-conversion layer; Vitest-tested like the rest of this
    directory, pinned against `flame.ts`'s `accumulateFlame` (its CPU oracle)
    by the agreement harness in `src/app/gpu-bench/`, which CI runs headless
    on SwiftShader (`npm run bench:gpu`, the `gpu-agreement` job; fr-jnu) —
    vitest additionally pins the WGSL variation switch's case numbering to
    `KERNEL_VARIATION_INDEX` statically.
  - `flame-gpu-4d.ts` — the 4D twin of `flame-gpu.ts`: the 4D WGSL kernel
    (4x4+t affines, `variations4`, the rotor+camera projection, the four
    `FourDRenderColor` modes, fixed-point soft-slice weights), pinned against
    `flame-4d.ts`'s `accumulateFlame4` by the same harness's 4D scenarios
    (and the same static variation-switch pin in vitest).
  - `morph.ts` — pure interpolation between two attractor-shaping systems
    (`lerpSystem`, fr-idze) for replace-load tweening instead of a snap:
    endpoint-exact at t=0/1 (the same object reference), rotation lerped
    through the nearest turn, a transform-count mismatch fading surplus
    maps in/out by weight with their geometry pinned bit-exact, flat↔4D
    pairs kept continuous via the derived w-scale, and differing
    kaleidoscopes crossfaded through `SymmetryParams.blend` (fr-eykn) —
    the departing one out over the first half, the arriving one in over
    the second, continuous at the midpoint.
  - `mutate-system.ts` — the mutation grid's perturbation core (fr-3vly):
    `mutateSystem` nudges every numeric field of an existing system by a
    small seeded amount — clamps mirror the editor sliders, optional keys
    stay exactly as present/absent so flat stays flat and maps keep their
    ids — with one `wildcard` option widening the jitter and adding a
    structural kick (a variation-type swap, or a full rotation reroll for a
    purely affine map). Candidates are quality-gated by `random-system.ts`'s
    own exported `scoreSystem` probes — the same "renders as a real shape"
    bar as a fresh roll — returning the best-scoring candidate on
    exhaustion, never failing.
  - `palette.ts` — Inigo-Quilez cosine-gradient palettes (`buildPaletteLUT` →
    256×3 LUT) shared by the flame and solid renders and (fr-3b6) the
    explorer's height/radius ramp recolor; the `"legacy"` sentinel
    falls back to flat per-transform hue. Since fr-55k also the user-authored
    `CustomPalette` (2–8 evenly spaced sRGB stops, sampled piecewise-linearly
    into the same LUT): `PaletteSelection` (preset id | `"custom"`) is the
    UI/state vocabulary, `PaletteSpec` (preset id | payload) the worker/GPU
    wire's, `resolvePalette` the bridge — plus the stop seeding
    (`seedCustomStops`) and strict `#rrggbb` codecs the editor and `persist.ts`
    share.
  - `presets.ts` — default + named systems (Sierpinski, Menger, spiral, pyramid,
    octahedron/icosahedron/dodecahedron flakes) + add-transform.
  - `project4.ts` — the SO(4) rotor→matrix + camera projection the 4D renders
    share, the frozen-view snapshot shape (`FourDView`), `sliceWeight`, and the
    single-source-of-truth `SLICE_GHOST_FLOOR` (`0.06`).
  - `random-system.ts` — the "Surprise Me" generator (`randomSystem`): rolls a
    complete random IFS (2–4 maps, occasional single-axis mirrored scale,
    optional final-transform lens, optional kaleidoscope, 25% chance of a 4D
    `w` extension — itself occasionally w-mirrored via a negative `w.scale`,
    fr-bew) and quality-gates each candidate with short chaos-game
    probes (bounds sanity + grid occupancy), rerolling up to 40× and keeping
    the best rather than ever failing. Takes an injected `Rng`, so rolls are
    reproducible in tests.
  - `rng.ts` — seedable mulberry32 PRNG.
  - `types.ts` — the dependency-free type vocabulary the whole codebase is
    written against: `Transform` / `Transform4`, `Vec3` / `Vec4`, `Bounds` /
    `Bounds4`, and the `WExtension` that makes a system 4D — plus the
    `VARIATION_TYPES` / `COLOR_MODES` / `FOUR_D_COLOR_MODES` / `SYMMETRY_AXES`
    const arrays, each the single source of truth for a derived union type and a
    `persist.ts` validator.
  - `variations.ts` — the dozen nonlinear fractal-flame variations (`spherical`,
    `swirl`, `julia`, …) as pure, total functions; `composeVariations` blends a
    transform's weighted list.
  - `variations4.ts` — the same twelve variations lifted one dimension up,
    reproducing their 3D counterparts bit-for-bit at `w = 0`.
  - `vec.ts` — three tiny generic numeric helpers (`clamp`, `clone3`, `to255`),
    dependency-free so the plain-number app modules can share them; nothing in the
    fractal core itself imports it.
  - `voxel.ts` — the solid render core: accumulate the chaos game into a
    world-space 3-D density grid (`accumulateVoxels`), size it
    (`computeVoxelBounds`), and pack it to an RGBA8 volume (`voxelTextureData`:
    color in RGB, log-density in alpha). `buildColorModeLUT` reuses `color.ts`'s
    modes + gamma so solid colors match the live cloud.
  - `voxel-4d.ts` — the 4D twin (`computeVoxelBounds4` / `accumulateVoxels4`);
    slices with a `0` floor, not the flame's `0.06`.
- **`src/app/`** — Three.js + DOM glue. Vite root (`root: "src/app"`).
  - `scene.ts` — the main Three.js wrapper (scene, camera, renderer, point
    cloud, guide boxes, fog). Three.js is confined to this file,
    `interactions.ts`, and `voxel-material.ts`; everything else works with plain
    numbers. `captureThumbnail` reads the display down to a small JPEG data URL
    for the collection gallery (fr-cai); mode-aware since fr-75sq — a save made
    from a flame/solid render thumbnails the rendered frame, not the cloud.
    `setRightInset` (fr-936q) aims the projection at the region the desktop
    panel overlay leaves uncovered — the camera's `aspect` describes that
    visible region (so every fit frames clear of the panel) while a
    `setViewOffset` extension still renders the full canvas; main.ts eases the
    inset per frame (panel toggle glides, reduced motion snaps, frozen flame
    views excluded), and captures/thumbnails lift it so exports stay centered.
    Save-PNG captures render at the session-only Export-size multiple
    (fr-2urv): `captureFrame(exportScale)` / `captureSolidFrame(exportScale)`
    re-render one frame at `basePixelRatio × scale` — clamped to the device
    texture ceiling and an 8192px long side — and resolve a PNG Blob +
    actual dimensions (`toBlob`; the bitmap snapshot is synchronous, only
    the encode is async); a flame session ACCUMULATES at the export size
    (`flameRenderSize(exportScale)`, additionally clamped to the
    accumulation-memory budget in main.ts, with the iteration budget scaled
    by the area ratio so per-pixel density matches 1×), so
    `captureFlameFrame` just reads the flame canvas at its native size.
    Renders on demand (fr-py7z): every visual mutator marks an internal
    `needsRender` flag — the per-frame setters (`applyCamera`, `setRot4`,
    `setGlowExposure`, `setDrawCount`, `setReplayCursor`) compare against the
    applied value first, so all camera/tumble motion is covered with no
    separate is-animating inventory — the render methods clear it, and
    main.ts's animate loop skips frames where it's clear (video recording
    forces painting: canvas capture streams emit frames only on paint).
  - `orbit.ts` — spherical orbit-camera math (pure, tested).
  - `camera-tween.ts` — the orbit camera's three motions (pure, tested,
    injected clock), mutually exclusive and honoring reduced motion: the
    smoothstep GLIDE that auto-frames a freshly generated attractor (preset
    load / Surprise Me) instead of snapping, (fr-cfoc) the dt-aware
    exponential CHASE that follows a morphing attractor's live bounds —
    retargeted per intermediate arrival, replaced by the terminal fit's
    glide for the settle — both leaving the orbit angles alone, and
    (fr-8v41) the directed POSE GLIDE to a saved `CameraPose`, the one
    motion that moves theta/phi (nearest-turn theta, self-timed by the
    timeline leg's own morph duration); `poseGliding` is how main.ts pauses
    the auto-orbit while a glide owns theta.
  - `framing-bounds.ts` — what those fit motions FRAME (fr-3xfk): per-axis
    trimmed-quantile bounds of the delivered cloud (and the 4D twin, a
    distance-from-center quantile that stays tumble-invariant), computed
    worker-side onto every `CloudResult` (`frameBounds`/`frameRadius`) so a
    nonlinear variation's sparse flung points can't inflate the fit the way
    they do the raw min/max `bounds` — which everything that must cover every
    point (color normalization, culling spheres) still reads. The glow-exposure
    density estimate reads `frameBounds` too (fr-2b82): it wants where the
    mass is, and the raw box's outlier inflation over-brightened the glow.
    Same trim rationale as `voxel.ts`'s `BOUNDS_QUANTILE`, deliberately its
    own constant. Pure, tested.
  - `morph-tween.ts` — the replace-load system morph driver (fr-jx9o):
    per-frame sampler over `../fractal/morph`'s `lerpSystem` with a pinned seed
    so consecutive frames' clouds stay point-for-point correspondent, chained
    restarts resuming from the live sample; polled by main.ts's animate loop,
    which streams each sample as an intermediate generation request — sized
    by `morph-budget.ts` — and sends the real replaced/fit request on the
    terminal sample (fr-a04l) — reduced motion skips straight to that
    terminal request. Since fr-wavo the morph's duration is a `start()`
    parameter (default `MORPH_TWEEN_MS`), so a drift leg can glide slower
    than a click.
  - `morph-budget.ts` — the morph's adaptive intermediate point budget
    (fr-a5gu): an EMA of per-point generation cost — fed by every delivered
    generation's latency (measured by `cloud-generator.ts`) — sizes each
    intermediate request to ~one frame's worth of chaos game on this device,
    clamped to `[MORPH_MIN_POINTS, MORPH_MAX_POINTS]`. The session-only
    Morph Detail select (fr-jonj, `MORPH_DETAILS` in state.ts) trades that
    smoothness back for density — a sparse intermediate cloud video-encodes
    to near-black: `"dense"` scales budget and ceiling ×8, `"full"` runs
    intermediates at the scene's own count. Pure, tested.
  - `mutation-thumbs.ts` — the mutation grid's thumbnail renderer (fr-3vly):
    a pure, canvas-free chaos-game scatter (flat directly, 4D via
    `toTransform4`) into an RGBA pixel buffer — one FIXED oblique view so
    all nine grid cells stay comparable, additive per-transform color so
    density reads as brightness (`captureThumbnail` can't serve here:
    candidates are never in the scene). main.ts owns the candidates and
    builds the 3×3 modal grid one cell per animation frame (the current
    system pinned inert at the center, the last cell `mutate-system.ts`'s
    wildcard, a token guarding every re-seed); a pick is a normal undoable
    replace-load morphing in — the same path as Surprise Me — after which
    the grid re-seeds around the pick, and ui.ts's modal mirrors the
    gallery's chrome (✕/backdrop/Escape). Pure, tested.
  - `drift.ts` — the ambient "Drift" show's timing loop (fr-wavo): a pure
    dwell/advance state machine (injected clock, like `build-replay.ts`)
    polled by main.ts's animate loop; when a dwell elapses it fires one leg —
    a Surprise-Me roll (or, fr-w2ve, the next saved scene) morphing in over
    `DRIFT_MORPH_MS` with a normal "replace" undo checkpoint, then a fresh
    dwell. Since fr-w2ve the deadline can also be HELD (`hold` /
    `resumeAfter(DRIFT_RENDER_LINGER_MS)` / `holding`): active but awaiting
    an external signal instead of the clock. main.ts + `drift-policy.ts`
    own the policy: session-only, STOPS (never pauses) on any undoable
    edit / undo / manual replace-load, unavailable under reduced motion; a
    render-mode switch stops a random show but only holds a collection one
    — the gallery slideshow (`onDriftCollection`) walks
    `SceneCollection.after`'s loop, plays each entry in the mode it was
    SAVED from (fr-75sq, via `pendingRenderMode`; untagged = points), and
    departs a still one `DRIFT_RENDER_LINGER_MS` after its render meets
    the iteration budget (the flame/solid progress events). Between legs
    the poll is one comparison, so a dwelling show does no per-frame work.
  - `drift-policy.ts` — an automated show's stop/advance conductor
    (fr-4otp): the ONE guarded `stop()` every "user reached in" chokepoint
    calls — no-op'd while the show's own leg applies itself (the own-leg
    guard, which is how a leg's replace-load survives the stop-on-edit
    rule) and while idle, so the injected `onStopped` UI sync (and
    fr-ygr1's "stopped" toast) can never fire for a stop that didn't
    happen — and `advance(launchLeg)`, which runs one leg under that guard
    and itself ends the show at a leg boundary under reduced motion or a
    dry leg source (`launchLeg` returning false: an emptied/fully-corrupt
    collection, an undecodable timeline step), the dry stop deferred until
    the guard unwinds — deferring it is the fr-4otp fix; issued from inside
    the leg it was swallowed and the show polled forever. Since fr-8v41 the
    show surface is the structural `ConductableShow` and the leg body is
    `advance`'s parameter, so one instance conducts the drift show and a
    second conducts the timeline player. main.ts's wiring decides what a
    leg does and which stops toast. Pure, injected effects, tested.
  - `build-replay.ts` — the "Watch it build" replay (fr-1zb): a pure
    timing/phase state machine that reveals the displayed cloud in generation
    order (hop → accrete/emerge → spotlight → done, with narration captions)
    — the buffer IS chaos-game order, so the growing prefix faithfully
    replays the drawing. The spotlight tour (fr-01kf) walks the base maps
    one at a time over the finished cloud — main.ts dims every other map's
    points (`color.ts`'s `dimColorsExcept` over the result's
    `transformIndices`, both 3D and 4D) and pins the guide-box emphasis
    (`scene.setGuideHighlight`, which the hop phase also flashes per
    landing) — so each map's landings read as a shrunken copy of the whole
    (A = ⋃ fᵢ(A)); skipped for single-map systems. Polled per frame by
    main.ts's animate loop; `scene.setDrawCount` / `setReplayCursor` do the
    drawing (pure, tested, injected clock).
    Since fr-hpci, main.ts overlays a temporary showcase while it plays: color
    switches to By Transform (`colorMode`/`fourDColor`, skipped if already that
    mode), the guides are forced visible (boxes, grid, axes, 4D scaffold —
    `refreshGuides` pushes the whole `guidesShown()` derivation, not just the
    boxes), and auto-orbit/auto-tumble run — not forced under reduced motion. Display-layer only: AppState and the persisted
    document never see it — main.ts's `recolor()` / `applyFourDColor()` /
    `refreshGuides()` and the `ui.ts` legend fold a session-only `replayShowcase`
    flag instead — and `endReplayDisplay` restores it all on every exit,
    including a panel now opened mid-replay, which cancels the replay too.
  - `exposure.ts` — `glowExposure`: a density-adaptive brightness multiplier for
    the live cloud's `"glow"` render style, derived from screen-space
    points-per-pixel so additive points don't blow out to white (pure, tested).
    Not the flame tone-map's `exposure` — this only scales `glowMaterial.opacity`.
  - `resolution-governor.ts` — the adaptive render-resolution governor
    (fr-4lyt): a pure frame-time ladder (EMA + dead-band hysteresis +
    asymmetric sustains + post-step hold-off) that main.ts feeds the dt
    between consecutively rendered frames; the scale it steps through
    multiplies the base pixel ratio (`scene.setResolutionScale` re-sizes the
    drawing buffer, glow composer, and EDL target together; point sizes
    follow the buffer-height uniforms, so the frame just softens) — weak
    hardware trades pixels for frame rate and earns them back on recovery.
    PNG exports and `flameRenderSize()` stay unscaled; recording and flame
    mode pin full resolution. Opt-out is the session-only
    `adaptiveResolution` checkbox (`persisted: false` — a device preference,
    never a document edit). Pure, tested.
  - `state.ts` — `AppState` + pure reducers (pure, tested).
  - `persist.ts` — encode/decode the scene to a `#v1=<base64url>` URL hash +
    localStorage so systems are shareable and survive reloads. Pure codec with a
    strict, never-throwing decoder; storage/location are injected (tested).
    Since fr-1k4 the saved/shared/collection document also carries the
    orbit-camera pose (`CameraPose`, optional; a malformed pose drops to
    `undefined` instead of rejecting the scene) so a reopened PWA / reloaded
    tab restores its framing — undo-history snapshots stay camera-less on
    purpose (history.ts dedupes by string equality).
  - `history.ts` — session-only undo/redo stacks over the encoded scene
    snapshot (pure, tested).
  - `edit-session.ts` — the burst-coalescing policy over `history.ts`: collapses a
    rapid edit burst (e.g. a slider drag) into one undo checkpoint and one
    debounced save, and drives undo/redo. Every side effect (snapshot, persist,
    restore, UI sync, the timer) is injected; pure, tested.
  - `collection.ts` — the saved-scene collection (fr-cai): a persistent
    multi-slot library of encoded scenes + thumbnails under its own
    localStorage key, layered over the same `encodeScene` codec as the
    single-scene autosave (`persist.ts`) and undo history (`history.ts`).
    `after(id)` (fr-w2ve) is the drift slideshow's loop cursor: the entry
    following an id in gallery order, wrapping, front on a vanished id.
    An entry saved from a flame/solid render carries that mode
    (`SavedSceneMode`, fr-75sq) — on the ENTRY, never inside `encoded`, so
    the document/share-link stays render-mode-less per fr-39y; a garbage
    mode from storage drops to undefined without losing the entry. Pure,
    injected storage/clock, tested. `importScenes` (fr-de9t) is the backup
    merge: dedupe by `encoded`, createdAt-sorted insertion (like `restore`),
    fresh collision-free ids, cap eviction — returning only the count that
    survived.
  - `timeline.ts` — the animation timeline's persistent document (fr-8v41):
    an authored, ORDERED sequence of keyframe steps — each a frozen copy of
    an encoded scene (camera pose included) + thumbnail + its own
    `morphMs`/`holdMs` — under its own localStorage key, the collection's
    opaque-encoded-string stance throughout. Deliberately not references
    into the collection: deleting a keeper can never break a timeline.
    `add` REFUSES at the 20-step cap (and `persist` never evict-retries) —
    an authored sequence must not be silently shortened; `restore(step, at)`
    is the delete-toast's undo (fr-ifts pattern, index-addressed). A
    persisted `seed` + `legSeed(seed, i)` give playback its deterministic
    per-leg morph seeds — the reproducible half of "deterministic video
    export". Pure, injected storage/clock, tested.
  - `timeline-player.ts` — the timeline's playback clock (fr-8v41): the
    drift show's directed, FINITE sibling, polled per frame like its
    siblings. Unlike `DriftShow`'s reschedule-from-now, the schedule is
    ABSOLUTE against start (`due[i]` accumulates each step's morph+hold), so
    a recorded clip keeps its authored length; catch-up fires only the
    LATEST due leg (never a burst), at most one event per poll, and the last
    leg always precedes `done` — a recording stop can never beat the final
    keyframe's launch. main.ts's `launchTimelineLeg` does what a leg IS: the
    same replace-load morph as a drift leg, seed pinned via `legSeed`, the
    camera gliding to the step's saved pose over the leg's own duration
    (`CameraTween.glideToPose`) — poseless steps fall back to drift's
    fit+chase. A second `DriftPolicy` instance conducts it (stop-on-edit,
    own-leg guard); `stopShows` in main.ts routes every "user reached in"
    chokepoint to both shows. Export = the same run with the canvas
    recorder rolling: whatever ends the run stops the recorder, so the clip
    downloads. Playback is points-only by design (a converging flame/solid
    render has no deterministic duration). Pure, injected clock, tested.
  - `scene-file.ts` — the JSON file import/export codec (fr-de9t): a
    single-scene file and a whole-collection backup file (encoded scenes +
    mode tags + thumbnails; ids omitted — the merge mints fresh ones)
    sharing one `{app, kind, version}` envelope. `decodeImportFile` is the
    never-throwing trust boundary for picked/dropped files: every `encoded`
    it returns has already passed `decodeScene` (a returned scene is
    genuinely loadable), thumbnails must be bounded `data:image/` URLs, and
    entries keep their ORIGINAL encoded strings — never re-canonicalized —
    so a newer build's fields survive an import/re-export round trip through
    this build. main.ts wires the panel buttons, the hidden picker input,
    and the window drag-drop (a scene file loads via the undoable
    gallery-load path; a backup merges and opens the gallery). Pure, tested.
  - `flame-file.ts` — the flam3/Apophysis `.flame` XML codec (fr-8uy5; see
    `docs/flame-interop.md` for the mapping + verified conventions). Import
    QR-decomposes each xform's 2D coefs EXACTLY onto our rotation/scale/
    shear `Transform` (orbit pinned to the `z = 0` plane, where the 3D
    variation lifts equal flam3's planar formulas — our twelve variation
    names ARE flam3's attribute names), folds pure-linear blends and posts
    on affine maps, and degrades the rest (xaos, posts on nonlinear maps,
    unknown variations, opacity) into deduplicated human-readable warnings;
    a flame palette becomes an 8-stop `CustomPalette`. Same trust-boundary
    contract as `scene-file.ts`: never throws, every returned scene is
    verified `decodeScene`-loadable, `null` strictly means "not a flame
    file". Export writes the system's XY shadow (exact for z-flat systems —
    imports round-trip) with kaleidoscope copies baked into explicit xforms
    (composed coefs for affine maps, `post` for nonlinear ones), the
    resolved palette as the 256-entry block, and probe-framed center/scale.
    DOMParser-tied, hence `src/app/` (tests run under jsdom). main.ts routes
    the shared import sink (picker + drop): one flame loads as the current
    scene hinting the flame render, a multi-flame file merges into the
    collection tagged mode `"flame"`; "⬇ Export .flame" sits beside the
    JSON scene export.
  - `ui.ts` — control panel + transform list, built with `createElement`. The
    panel's categories are an exclusive-open accordion of native
    `<details name="panel-section">` sections (fr-zoi) — the browser owns
    which one is open; `Ui` re-anchors the tapped summary after the
    exclusivity reflow — only while the panel is on screen (fr-dd4b: the
    restore below also opens sections with the panel parked off-screen, and
    scrollIntoView toward it pans a phone's viewport clean off the app) —
    and remembers the open section per render mode (fr-99o: Points ↔ Flame
    ↔ Solid each restore their own on switch; session-only, like
    `renderMode` itself). Mode content that is NOT a section — Points'
    Undo/Redo row, the flame/solid hint + progress blocks — sits above the
    whole accordion, right under the mode switch (fr-374p): wedged between
    two collapsed headers it would read as the upper section's open content.
  - `control-spec.ts` — declarative spec table for the panel's simple scalar
    controls (slider/select/checkbox ↔ one state field): `Ui` derives lookup,
    listeners, and label sync from it; `main.ts` derives the one generic
    handler. Adding a scalar setting = one spec entry + one index.html row
    (pure, tested).
  - `constants.ts` — shared UI/interaction magic numbers (`MOBILE_BREAKPOINT`, the
    guide-box scale clamps) kept out of `src/fractal/` on purpose.
  - `interactions.ts` — pointer / touch / wheel handling (uses Three.js
    raycasting for transform drags).
  - `slider-scroll-guard.ts` — undoes the tap-jump a panel slider commits on
    `pointerdown` when the touch turns out to be a panel scroll (fr-zoi):
    Blink jumps the thumb before `touch-action: pan-y` can classify the
    gesture, then fires `pointercancel` once it claims the pan — the guard
    snapshots the value pre-jump and restores it on that signal (plus a
    pure-vertical `pointerup`/`touchend` fallback for engines without the
    cancel). Delegated on `#panel`, so the dynamic editor sliders are covered
    (tested).
  - `main.ts` — entry point; wires state ↔ scene ↔ ui ↔ interactions.
  - `regen-scheduler.ts` — the rAF coalescer (fr-acc) in front of
    `regenerate()`: collapses a drag/slider burst into one generation request
    per animation frame instead of one per input event. Now bounds
    request-building/postMessage traffic to the cloud worker (fr-5kx); in the
    generator's synchronous fallback mode it's again all that stops a drag
    from running a full generation per input event.
  - `cloud-worker.ts` / `cloud-worker-core.ts` — the live point cloud's
    generation worker (fr-5kx): a one-shot request → response, not a session
    state machine like flame/voxel have. Seeded chaos game (`generateCloud`);
    the 3D path bakes its color buffer (`buildColors`) worker-side and the 4D
    path lifts transforms through `toTransform4` worker-side too, so a
    regeneration costs the main thread only a transferable-buffer upload.
  - `cloud-generator.ts` — the main-thread client for the cloud worker
    (fr-5kx): at most one request in flight, latest wins, OR-merging a
    coalesced request's `replaced`/`fit` flags so a superseded preset load's
    fresh-visit reset and camera fit still land. Times every generation and
    reports the latency to `onResult` (fr-a5gu — `morph-budget.ts`'s feed).
    Falls back to running the same `generateCloud` synchronously if the
    worker never loads or crashes — the live cloud IS the app, unlike the
    optional flame/solid overlays — and `generateSync` takes that path
    deliberately at boot. Pure, injected deps, tested.
  - `flame-gpu-backend.ts` — drives `flame-gpu.ts`'s and `flame-gpu-4d.ts`'s
    kernels from inside the flame worker (one shared driver, two packing
    factories), behind `flame-worker-core.ts`'s pluggable `FlameAccumBackend`
    seam (WebGPU when available, CPU otherwise). All resource creation is
    error-scoped, so allocation refusals fail at create time as a classified
    `FlameGpuSizeError` — reported device limits overstate real, dynamic
    allocator ceilings (fr-2w5; see
    `docs/investigation-fr-2w5-gpu-selection.md`).
  - `flame-worker.ts` / `flame-worker-core.ts` — the flame render worker: thin
    `postMessage` glue around a plain-testable session (`FlameWorkerSession`)
    driving CPU (`accumulateFlame` / `accumulateFlame4`) or WebGPU accumulation
    behind the `FlameAccumBackend` seam; SharedArrayBuffer fast path,
    postMessage-transfer fallback. A `fourD` field on `start` flips it to 4D;
    `iterationsBudgetScale` (fr-2urv) scales the budget — and every live
    `setIterationsBudget` — for a hi-res export session, so per-output-pixel
    density matches a 1× render.
    GPU failures run a recovery ladder (`handleGpuFailure`, fr-2w5): retry ON
    the GPU at a smaller supersample, one fresh-device retry (refusing a
    software adapter after real hardware), and only then the permanent CPU
    fallback — whose `gpuUnavailable` reason annotates the UI's CPU backend
    note (CPU is the one fallback, on every browser).
  - `flame-perf.ts` — `FlamePerfMeter`, opt-in flame-throughput diagnostics
    (behind the `?flameperf` URL param): windows the worker's per-chunk timing
    samples into a throughput summary. Pure, tested; deliberately changes no
    render behavior.
  - `voxel-worker.ts` / `voxel-worker-core.ts` — the solid render worker, same
    shape as the flame worker but postMessage-transfer only (the solid render
    has no live tone-map to fast-path).
  - `voxel-material.ts` — the Three.js GLSL3 raymarcher `ShaderMaterial` that
    displays the voxel volume (isosurface march + gradient-normal shading; live
    threshold/light/ambient uniforms `scene.ts` pushes with no worker round-trip).
  - `render-session.ts` — the `enter` / `exit` / `terminate` + first-frame-gate
    choreography shared by the flame and solid render controllers
    (`RenderSession`); which renderer is showing is the session-only
    `renderMode` (`"points" | "flame" | "solid"`, fr-39y) in `AppState`,
    switched by the panel's segmented control and never persisted. A preset
    can hint the mode it showcases (`PRESET_RENDER_HINTS` in `presets.ts`).
  - `four-d-view.ts` — the session-only 4D view state (the `RotorPair`,
    auto-tumble, soft w-slice); `main.ts` freezes it into a render's `fourD`
    snapshot when the system is 4D.
  - `rotor4.ts` — SO(4) rotation as a renormalizable unit-quaternion pair
    (`RotorPair`), composed cheaply over a long session.
  - `recorder.ts` / `mp4-duration.ts` / `webm-duration.ts` — the video-capture
    feature: `createCanvasRecorder` streams the shared WebGL canvas through
    `MediaRecorder` to a downloadable clip (MP4 preferred for upload
    compatibility, WebM fallback); the two dependency-free binary patchers rewrite
    the duration metadata the browser's `MediaRecorder` leaves unset so uploads
    are accepted. Pure helpers are tested; the `MediaRecorder` glue is verified
    in-browser.
  - `register-sw.ts` — service-worker registration + the reload-once
    cross-origin-isolation bootstrap (gives the flame worker its
    SharedArrayBuffer fast path; postMessage transfer is the fallback).
  - `sw/sw.ts` — hand-written service worker (vite-plugin-pwa
    `injectManifest`): Workbox precache composed with COOP/COEP header
    injection in ONE fetch handler. Lives in its own TS program
    (`sw/tsconfig.json`) because the WebWorker lib conflicts with the app's
    DOM lib; `npm run lint` type-checks both programs.

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
