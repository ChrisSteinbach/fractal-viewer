# Fractal Explorer

An interactive 3D/4D **Iterated Function System (IFS)** fractal explorer. Design a set
of affine transforms and watch the [chaos game](docs/architecture.md) render their
attractor as a live point cloud — rotate the camera, drag transforms around, swap
between presets, and recolor the cloud in real time. Built with TypeScript,
Three.js, and Vite, and packaged as an installable, offline-capable PWA.

> Started life as a single standalone HTML file; this repo restructures it into a
> tested, linted, deployable project. The pure fractal math lives in `src/fractal/`
> and is fully unit-tested; Three.js and the DOM are confined to `src/app/`.

## Features

- **Real-time chaos game** rendering of an IFS attractor (up to 5M points).
- **Built-in explainer** — an in-app "What is this?" dialog covers the IFS /
  chaos-game basics, and **▶ Watch it build** replays the cloud's own
  generation point by point, from the first random hops to the full attractor.
- **Editable transforms** — add/remove maps and drag, rotate, and scale them in
  the 3D view with mouse or touch, with per-axis sliders (shear and
  flame-style variations included) for everything the gestures can't reach,
  plus an optional final-transform lens that warps the whole cloud at once.
- **Goes 4D** — every map (and the lens) can extend into a fourth dimension;
  a non-flat system renders as a slowly tumbling projection with its own
  color modes, Shift-drag control of the hidden rotation planes, and a
  sweepable **W slice** cross-section. All four render modes follow it.
- **Kaleidoscope symmetry** — replicate the whole attractor up to 12-fold in
  any coordinate plane, the 4D ones included (with an optional
  double-rotation **Twist**); every render mode draws the same kaleidoscope.
- **Four render modes** — the live point cloud, plus **✺ Flame** (a classic
  fractal-flame exposure), **◆ Solid** (a lit, shadowed voxel surface), and
  **◈ Surface** — the attractor sphere-traced as a true implicit surface,
  with an optional shadow-catching **Floor** underneath and a **Balloon**
  mode that encloses the scene in its own sphere-inverted echo, the
  fractal's shadows falling on the cave wall around it.
- **Presets** — two dozen systems, from the Sierpinski tetrahedron and Menger
  sponge to icosahedron and dodecahedron flakes, fractal-flame classics, the
  Mandelbox, and a 4D group of tumbling polytope fractals.
- **Surprise Me, 🧬 Mutate, ▶ Drift** — quality-gated random systems, a 3×3
  grid of small mutations around the current system to walk outward through,
  and an ambient, ever-evolving show for leaving on a second screen.
- **Five color modes** — by transform, height, radius, position, or a uniform
  cyan — plus gradient palettes and a custom-gradient editor.
- **Orbit camera** with rotate / pan / zoom, and an adjustable atmosphere:
  depth fog with its own density and tint, tracking the cloud and backdrop.
- **Collection & Timeline** — a persistent gallery of saved scenes, and an
  authored keyframe timeline played back as a chain of morphs — exportable
  as a frame-exact 30 fps MP4 clip (WebCodecs) or a live recording.
- **Share everything** — scenes travel as copyable `#v1=` links, as small
  JSON scene files, or as flam3/Apophysis `.flame` files (import and
  export); collections and timelines back up to JSON and merge back in.
- **Capture** — Save PNG at up to 4× screen resolution (a true re-render,
  not an upscale) and record MP4/WebM video straight off the canvas.
- **PWA** — installable and works offline once loaded.

## Getting started

Requires **Node.js 22+** (see `.nvmrc`).

```bash
npm install      # install dependencies (also installs the git hooks)
npm run dev      # start the Vite dev server (binds 0.0.0.0 for phone testing)
npm run build    # production build → dist/app/
npm run preview  # preview the production build
```

The dev server runs over HTTPS (via `@vitejs/plugin-basic-ssl`) so the PWA and
touch gestures can be tested on a real device on your LAN.

## Controls

| Mode          | Gesture                 | Action             |
| ------------- | ----------------------- | ------------------ |
| **Camera**    | drag / one finger       | orbit              |
|               | right-drag / two finger | pan                |
|               | wheel / pinch           | zoom               |
| **Transform** | drag / one finger       | move on view plane |
|               | right-drag              | rotate             |
|               | wheel / pinch           | scale              |
|               | twist (two finger)      | rotate             |

Pick **Camera View** or a transform in the panel's "Select to Edit" list to switch
modes. See [docs/controls.md](docs/controls.md) for details.

## Project structure

```
src/
├── fractal/   # Pure IFS core — no Three.js, no DOM, fully unit-tested
│   ├── affine.ts        # Euler-XYZ rotation + TRS matrix compose/apply
│   ├── chaos-game.ts    # the IFS iterator (the "chaos game")
│   ├── color.ts         # HSL→RGB and the five color modes
│   ├── presets.ts       # default + named systems (Sierpinski, Menger, flakes…)
│   ├── rng.ts           # seedable PRNG for reproducible output
│   └── …                # flame/voxel/surface render math, 4D twins, morphs
└── app/       # Three.js rendering + DOM glue
    ├── scene.ts         # Three.js scene wrapper (point cloud, guides, fog)
    ├── orbit.ts         # spherical orbit-camera math (pure, tested)
    ├── state.ts         # app state + reducers (pure, tested)
    ├── ui.ts            # control panel + transform list (createElement)
    ├── interactions.ts  # pointer / touch / wheel handling
    ├── main.ts          # entry point — wires everything together
    └── …                # render workers, persistence, collection/timeline
```

The tree above is the load-bearing sample, not the full listing — see
[docs/architecture.md](docs/architecture.md) for the algorithm and data flow,
and [CLAUDE.md](CLAUDE.md) for the complete module map.

## Testing & quality

```bash
npm test               # lint + run all tests
npm run test:watch     # tests in watch mode
npm run test:coverage  # tests with a coverage report
npm run lint           # type-check + ESLint + Stylelint + Prettier
npm run lint:fix       # auto-fix what can be fixed
```

Tests are [Vitest](https://vitest.dev/) specs alongside the source as `*.test.ts`.
Husky runs `lint-staged` on commit. CI runs lint (type-check + ESLint + Stylelint +
Prettier), a production build, the test suite, and a headless WebGL smoke test on
every push and pull request.

## Deployment

Deployment to GitHub Pages is **manual** (`workflow_dispatch`) via the "Deploy to
GitHub Pages" workflow — nothing publishes automatically on merge. The build uses a
relative base path, so it works at any Pages URL or custom domain.

The `github-pages` environment only accepts deploys from `main`, so this workflow
cannot deploy any other ref. **Rollback = revert the bad commit(s) on `main` and
dispatch a fresh run** — never use "Re-run failed jobs" to try to get old content
redeployed; a re-run rebuilds and redeploys the same commit its run originally
dispatched, so it can retry a transient failure but never substitute an older,
known-good state.

## Issue tracking

This project uses [**beads**](https://github.com/steveyegge/beads) (`bd`) for issue
tracking — see [AGENTS.md](AGENTS.md). Run `bd ready` to see available work.

## License

[ISC](LICENSE). Production builds bundle third-party packages (Three.js, Workbox)
whose MIT notices ship alongside the app as `THIRD-PARTY-LICENSES.txt`, generated
at build time by `scripts/collect-third-party-licenses.mjs`.
