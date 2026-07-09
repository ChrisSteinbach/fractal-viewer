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
    Takes an injected RNG so runs are reproducible in tests.
  - `chaos-game-4d.ts` — the 4D twin of `chaos-game.ts` (`runChaosGame4`): the
    same warm-up/escape/reseed/bounds loop unrolled to four coordinates. 4D has
    no kaleidoscope symmetry by design.
  - `color.ts` — `Color.setHSL`-faithful HSL→RGB and the five color-mode palettes.
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
    by the agreement harness in `src/app/gpu-bench/`.
  - `flame-gpu-4d.ts` — the 4D twin of `flame-gpu.ts`: the 4D WGSL kernel
    (4x4+t affines, `variations4`, the rotor+camera projection, the four
    `FourDRenderColor` modes, fixed-point soft-slice weights), pinned against
    `flame-4d.ts`'s `accumulateFlame4` by the same harness's 4D scenarios.
  - `palette.ts` — Inigo-Quilez cosine-gradient palettes (`buildPaletteLUT` →
    256×3 LUT) shared by the flame and solid renders; the `"legacy"` sentinel
    falls back to flat per-transform hue.
  - `presets.ts` — default + named systems (Sierpinski, Menger, spiral, pyramid,
    octahedron/icosahedron/dodecahedron flakes) + add-transform.
  - `project4.ts` — the SO(4) rotor→matrix + camera projection the 4D renders
    share, the frozen-view snapshot shape (`FourDView`), `sliceWeight`, and the
    single-source-of-truth `SLICE_GHOST_FLOOR` (`0.06`).
  - `rng.ts` — seedable mulberry32 PRNG.
  - `variations.ts` — the dozen nonlinear fractal-flame variations (`spherical`,
    `swirl`, `julia`, …) as pure, total functions; `composeVariations` blends a
    transform's weighted list.
  - `variations4.ts` — the same twelve variations lifted one dimension up,
    reproducing their 3D counterparts bit-for-bit at `w = 0`.
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
    numbers.
  - `orbit.ts` — spherical orbit-camera math (pure, tested).
  - `state.ts` — `AppState` + pure reducers (pure, tested).
  - `persist.ts` — encode/decode the scene to a `#v1=<base64url>` URL hash +
    localStorage so systems are shareable and survive reloads. Pure codec with a
    strict, never-throwing decoder; storage/location are injected (tested).
  - `history.ts` — session-only undo/redo stacks over the encoded scene
    snapshot (pure, tested).
  - `ui.ts` — control panel + transform list, built with `createElement`.
  - `control-spec.ts` — declarative spec table for the panel's simple scalar
    controls (slider/select/checkbox ↔ one state field): `Ui` derives lookup,
    listeners, and label sync from it; `main.ts` derives the one generic
    handler. Adding a scalar setting = one spec entry + one index.html row
    (pure, tested).
  - `interactions.ts` — pointer / touch / wheel handling (uses Three.js
    raycasting for transform drags).
  - `main.ts` — entry point; wires state ↔ scene ↔ ui ↔ interactions.
  - `flame-gpu-backend.ts` — drives `flame-gpu.ts`'s and `flame-gpu-4d.ts`'s
    kernels from inside the flame worker (one shared driver, two packing
    factories), behind `flame-worker-core.ts`'s pluggable `FlameAccumBackend`
    seam (WebGPU when available, CPU otherwise).
  - `flame-worker.ts` / `flame-worker-core.ts` — the flame render worker: thin
    `postMessage` glue around a plain-testable session (`FlameWorkerSession`)
    driving CPU (`accumulateFlame` / `accumulateFlame4`) or WebGPU accumulation
    behind the `FlameAccumBackend` seam; SharedArrayBuffer fast path,
    postMessage-transfer fallback. A `fourD` field on `start` flips it to 4D.
  - `voxel-worker.ts` / `voxel-worker-core.ts` — the solid render worker, same
    shape as the flame worker but postMessage-transfer only (the solid render
    has no live tone-map to fast-path).
  - `voxel-material.ts` — the Three.js GLSL3 raymarcher `ShaderMaterial` that
    displays the voxel volume (isosurface march + gradient-normal shading; live
    threshold/light/ambient uniforms `scene.ts` pushes with no worker round-trip).
  - `render-session.ts` — the `enter` / `exit` / `terminate` + first-frame-gate
    choreography shared by the flame and solid render controllers
    (`RenderSession`); the two render modes are session-only `flameActive` /
    `solidActive` state, never persisted.
  - `flame-session-host.ts` — hosts a flame session on the main thread instead
    of a worker where a worker can't reach WebGPU (Firefox exposes
    `navigator.gpu` only on the main thread).
  - `four-d-view.ts` — the session-only 4D view state (the `RotorPair`,
    auto-tumble, soft w-slice); `main.ts` freezes it into a render's `fourD`
    snapshot when the system is 4D.
  - `rotor4.ts` — SO(4) rotation as a renormalizable unit-quaternion pair
    (`RotorPair`), composed cheaply over a long session.
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
