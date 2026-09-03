# Contributing

`AGENTS.md` is the project's rules file — read it before changing `src/`.
It carries the invariants this file does not repeat (dimensional parity,
frozen shader wire layouts, byte-identity contracts).

## Setup and checks

- Node.js 22 (`.nvmrc` pins it), then `npm ci`.
- `npm test` — Vitest only.
- `npm run lint` — type-check, ESLint, Stylelint, Prettier.
- `npm run build` — production build to `dist/app/`.

Tests live beside the source they test, as `*.test.ts` (Vitest, globals on).
Test behavior, not implementation; the dependency-free core in
`src/fractal/` carries most of the suite.

## GPU benches need a real display

`npm run bench:gpu` and `npm run bench:surface` pin the WebGPU kernels to
their CPU oracles. They must run on a real GPU driver: without a display
(`--display=:0` plus the Xwayland `XAUTHORITY` cookie on Linux) the harness
silently falls back to SwiftShader, a CPU rasterizer, and the rows measure
software without failing. Confirm with `glxinfo -B | grep "OpenGL renderer"`
that the renderer is your actual GPU before believing a row.

## Pull requests

- Branch from `main`; PRs target `main`.
- Merge by rebase, never squash: per-item commits are this project's
  decision records, and squashing collapses them into one blob.
