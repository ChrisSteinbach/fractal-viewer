# Fractal Viewer

An interactive 3D **Iterated Function System (IFS)** fractal viewer. Design a set
of affine transforms and watch the [chaos game](docs/architecture.md) render their
attractor as a live point cloud — rotate the camera, drag transforms around, swap
between presets, and recolor the cloud in real time. Built with TypeScript,
Three.js, and Vite, and packaged as an installable, offline-capable PWA.

> Started life as a single standalone HTML file; this repo restructures it into a
> tested, linted, deployable project. The pure fractal math lives in `src/fractal/`
> and is fully unit-tested; Three.js and the DOM are confined to `src/app/`.

## Features

- **Real-time chaos game** rendering of an IFS attractor (up to 500k points).
- **Editable transforms** — add/remove maps and drag, rotate, and scale them in
  the 3D view with mouse or touch.
- **Presets** — Sierpinski tetrahedron, Menger sponge, and a spiral.
- **Six color modes** — by transform, height, radius, position, iteration age, or
  a uniform cyan.
- **Orbit camera** with rotate / pan / zoom, and depth fog that tracks the cloud.
- **PWA** — installable and works offline once loaded.

## Getting started

Requires **Node.js 18+** (the repo is developed and tested on Node 22; see
`.nvmrc`).

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
│   ├── color.ts         # HSL→RGB and the six color modes
│   ├── presets.ts       # default / Sierpinski / Menger / spiral systems
│   └── rng.ts           # seedable PRNG for reproducible output
└── app/       # Three.js rendering + DOM glue
    ├── scene.ts         # Three.js scene wrapper (the only file importing three)
    ├── orbit.ts         # spherical orbit-camera math (pure, tested)
    ├── state.ts         # app state + reducers (pure, tested)
    ├── ui.ts            # control panel + transform list (createElement)
    ├── interactions.ts  # pointer / touch / wheel handling
    └── main.ts          # entry point — wires everything together
```

See [docs/architecture.md](docs/architecture.md) for the algorithm and data flow.

## Testing & quality

```bash
npm test               # lint + run all tests
npm run test:watch     # tests in watch mode
npm run test:coverage  # tests with a coverage report
npm run lint           # type-check + ESLint + Stylelint + Prettier
npm run lint:fix       # auto-fix what can be fixed
```

Tests are [Vitest](https://vitest.dev/) specs alongside the source as `*.test.ts`.
Husky runs `lint-staged` on commit. CI runs lint, type-check, build, and tests on
every push and pull request.

## Deployment

Deployment to GitHub Pages is **manual** (`workflow_dispatch`) via the "Deploy to
GitHub Pages" workflow — nothing publishes automatically on merge. The build uses a
relative base path, so it works at any Pages URL or custom domain.

## Issue tracking

This project uses [**beads**](https://github.com/steveyegge/beads) (`bd`) for issue
tracking — see [AGENTS.md](AGENTS.md). Run `bd ready` to see available work.

## License

ISC
