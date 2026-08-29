# Sampled Solid production qualification

Status: **PENDING**. This file defines the release gate and is the durable
operator record for `fr-qxyt.9`. The documentation pass did not run the GPU
matrix, so every result section below remains explicitly pending.

## Contract under qualification

The product has one sampled-density renderer: **Sampled Solid**. The existing
voxel worker progressively accumulates one camera-independent density plus
running-RGB grid, publishes an RGBA8 texture and an optional conservative
max-alpha hierarchy as one generation, and the existing Solid material marches
that texture. The hierarchy changes traversal work only. It does not define a
second density field, a second sampled mode, or a Surface backend.

Surface remains the analytic/distance-estimator route selected by
`surface-eligibility.ts`. Nonlinear or stochastic systems that do not have an
analytic Surface route still enter Solid without rewriting their document.
The reference geometry is the unaccelerated, fixed-lattice march over the
hardware-equivalent trilinear reconstruction of packed alpha, with a strict
`density > threshold` hit and five bisections of the same outside/inside
bracket.

The detailed proof, byte layout, prior deterministic measurements, and
allocation fallback are in `solid-density-acceleration.md`. The decision not to
widen the authored voxel payload is in `solid-voxel-payload-decision.md`.

## Release thresholds

These thresholds are fixed before the hardware run. A result may not be made to
pass by widening them after inspecting an image or timing.

| Area                       | Acceptance threshold                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality gates              | `lint`, production `build`, full coverage run, focused Solid regressions, both deterministic hierarchy harnesses, and WebGL smoke all exit 0.                                                                                                                                                                                                                 |
| Conservative construction  | Root/source maximum, deterministic bytes, boundary halos, isolated corners, thin diagonals, threshold equality, and randomized trilinear support tests all pass with zero violations.                                                                                                                                                                         |
| CPU traversal agreement    | Accelerated and reference oracles have zero hit/miss, first-inside, last-outside, refinement-count, refined-position, and density mismatches in the adversarial/property suite.                                                                                                                                                                               |
| Browser image agreement    | Matched accelerated/fallback captures have no browser errors; maximum channel delta is at most 1 byte and changed channels are at most `ceil(totalChannels × 0.001)`. Both plain and Balloon shader families compile.                                                                                                                                         |
| Deterministic work         | Sparse and nonlinear profiles have zero first-hit mismatches and total fetch ratio below 1.0. The intentionally full dense profile may cost at most 2.0× total fetches: one hierarchy lookup plus the same first primary read.                                                                                                                                |
| Hardware timing            | Use at least 2 untimed warm-ups and 5 timed captures per arm. Report every sample and compare medians. A representative sparse/nonlinear production fixture must show `fallbackMedian / acceleratedMedian >= 1.05`; a dense control is acceptable up to `acceleratedMedian / fallbackMedian <= 2.0`. No timing from SwiftShader satisfies this hardware gate. |
| Generation ownership       | Every installed grid carries its matching hierarchy and active 4D endpoint revision. Rapid superseding endpoints install only the latest revision; explicit hierarchy absence clears prior acceleration.                                                                                                                                                      |
| Resolution and convergence | The record contains requested and effective N³ resolution plus exact done/budget counters. A reduced grid is acceptable only when disclosed. Only `done >= budget` is called converged; stopped, failed, and saved-active states remain incomplete.                                                                                                           |
| Defaults and routing       | Environment strength 0 and floor off select the historical Solid shader sources. Existing Solid defaults and eligible Surface route/backend selections remain unchanged.                                                                                                                                                                                      |
| 4D policy                  | Rotor/slice changes rebuild only after the settled endpoint; exact repeats no-op; dormant relative-color-only edits do not invalidate a valid frame; camera and presentation-only edits do not rebuild.                                                                                                                                                       |
| Presentation and capture   | Environment/floor edits do not reaccumulate. Floor is miss-only, Balloon suppresses and later restores it, and the 4D floor ball is stable across rotor/slice edits. Capture waits through startup or a generation invalidation and its name/status disclose Sampled Solid, effective/requested resolution, and convergence.                                  |

If timing is noisy enough to cross one of the hardware ratios in both
directions, increase the sample count without changing scene, camera, browser,
or thresholds and report both sample sets. Do not substitute a software
rasterizer result for the hardware row.

## Environment record

Use a quiet working tree and do not edit source while gathering timings. Record
the following before running the matrix; renderer strings must come from the
same browser context that renders the captures.

| Field                                | Result  |
| ------------------------------------ | ------- |
| Date/time and timezone               | PENDING |
| Git revision and branch              | PENDING |
| Working tree clean                   | PENDING |
| OS/kernel and architecture           | PENDING |
| CPU and memory                       | PENDING |
| Browser name/version/executable      | PENDING |
| WebGL API                            | PENDING |
| `UNMASKED_VENDOR_WEBGL`              | PENDING |
| `UNMASKED_RENDERER_WEBGL`            | PENDING |
| GPU/driver/ANGLE or Mesa versions    | PENDING |
| Display/headless mode and viewport   | PENDING |
| Device-memory/coarse-pointer signals | PENDING |

A renderer containing `SwiftShader`, `llvmpipe`, or another software adapter is
valid for the software smoke row only. The real-GPU row must name the physical
adapter and driver. Use a headed system Chrome/Chromium session where that is
required to reach the native adapter, keep the page in front, disable background
timer/renderer throttling, and do not pass any flag that forces SwiftShader.
Record the exact launch and verification commands in the result section rather
than relying on a remembered browser configuration.

## Reproducible gate sequence

Install dependencies before this sequence if the checkout does not already have
them. Run the commands from the repository root.

### Static, unit, integration, and production gates

```bash
git status --short
npm run lint
npm run build
NODE_OPTIONS=--max-old-space-size=6144 npm run test:coverage -- --maxWorkers=1
```

The focused command makes failures in the Solid contract easier to attribute,
even though the coverage run includes the same tests:

```bash
npx vitest run \
  src/fractal/nonlinear-solid.fixture.test.ts \
  src/app/renderer-regression-contracts.test.ts \
  src/fractal/voxel.test.ts \
  src/fractal/voxel-4d.test.ts \
  src/fractal/voxel-max-hierarchy.test.ts \
  src/fractal/voxel-raymarch.test.ts \
  src/fractal/voxel-raymarch-accelerated.test.ts \
  src/app/voxel-material.test.ts \
  src/app/voxel-worker-core.test.ts \
  src/app/render-session.test.ts \
  src/app/export-wait.test.ts \
  src/app/solid-render-status.test.ts \
  src/fractal/presentation-floor.test.ts \
  src/app/persist.test.ts \
  src/app/collection.test.ts \
  src/app/timeline.test.ts \
  src/app/scene-file.test.ts \
  src/app/control-spec.test.ts \
  src/app/interactions.test.ts \
  src/app/ui.test.ts
```

Run the deterministic construction and traversal records separately so their
tables remain visible in the evidence:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/voxel-max-hierarchy.harness.ts
npx vitest run --config scripts/vitest.harness.config.ts scripts/voxel-hierarchy-traversal.harness.ts
```

### Production browser comparison

Serve the production build in one terminal:

```bash
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Vite's self-signed certificate produces two known service-worker registration
errors under Playwright. The verifier retains those messages in the evidence
but excludes only those exact certificate errors from its renderer failure
list; every other console or page error remains fatal.

Against that preview, run the generic WebGL boot gate and retain its screenshot
under the ignored local evidence directory. Supplying `--url` matters: without
it the smoke script starts a development server rather than testing `dist/`.

```bash
npm run smoke -- \
  --url=https://127.0.0.1:4173 \
  --screenshot=bench-results/fr-qxyt.9/webgl-smoke.png
```

Run the same production fixture matrix through the verifier's explicit
SwiftShader arm first. Its latency is descriptive and does not fill the
real-GPU timing row:

```bash
DISPLAY=:0 node scripts/solid-hierarchy.verify.mjs \
  --url=https://127.0.0.1:4173 \
  --driver=swiftshader \
  --fixtures=affine,nonlinear,stochastic,nonlinear4d \
  --resolution=192 \
  --warmups=2 \
  --captures=5 \
  --outdir=bench-results/fr-qxyt.9/swiftshader
```

Run the mandatory physical-GPU arm with the same inputs. The hardware driver
rejects a software renderer string rather than accidentally publishing it as
GPU evidence. Adjust `--display` and `--chrome` to the qualifying host, and
record the actual values:

```bash
node scripts/solid-hierarchy.verify.mjs \
  --url=https://127.0.0.1:4173 \
  --driver=hardware \
  --display=:0 \
  --chrome=/usr/bin/google-chrome \
  --fixtures=affine,nonlinear,stochastic,nonlinear4d \
  --resolution=192 \
  --warmups=2 \
  --captures=5 \
  --outdir=bench-results/fr-qxyt.9/intel-iris-xe
```

The built-in fixture ids are `default`, `affine`, `nonlinear`, `stochastic`,
and `nonlinear4d`; `--fixture=<id>` may be repeated when isolating a failure.
Each output directory contains `results.json` and matched
`<fixture>-accelerated.png`, `<fixture>-reference.png`, and
`<fixture>-diff.png` images. Each fixture renders the same built assets twice,
changing only the hierarchy payload from `present` to explicit `absent`; seed,
document, camera, threshold, requested resolution, accumulation budget, texture
bytes, viewport, DPR, and capture path remain matched.

## Fixture matrix

Use deterministic seeds and retain the encoded scene or fixture fingerprint.
Requested resolution is 192³. The browser verifier deliberately uses Solid's
minimum 1M detent so the complete shader matrix can converge; the product
default remains 20M and is pinned separately by compatibility tests. Record the
exact budget on every row. The effective resolution reported by the worker is
the value used for comparisons.

| Fixture                                             | Dimension/profile    | Required evidence                                                                                                                                             | Result  |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Supplied two-map linear + swirl document            | 3D nonlinear         | Reusable `nonlinear` browser fixture from `nonlinear-solid.fixture.ts`; converge in Sampled Solid; matched capture/timing and status/capture disclosure.      | PENDING |
| Canonical linear + swirl fixture, seed `0x51d0cafe` | 3D nonlinear         | `nonlinear-solid.fixture.test.ts` routing, bounds, density, occupied voxels, orbit, and texture fingerprint.                                                  | PENDING |
| Canonical linear + swirl lift                       | 4D nonlinear         | `nonlinear4d` browser fixture; same authored blend through `toTransform4`; 4D accumulation/fingerprint; settled rotor and slice rebuild.                      | PENDING |
| Julia final lens                                    | 3D and 4D stochastic | `stochastic` browser fixture plus unit 3D/4D paths; same-seed repeat is byte-identical; adjacent seed differs.                                                | PENDING |
| Default affine system                               | 3D representative    | `affine` browser fixture; historical defaults, live camera/presentation, matched browser A/B, PNG disclosure.                                                 | PENDING |
| Synthetic sparse volume                             | 3D traversal         | Zero mismatches; fetch ratio below 1.0.                                                                                                                       | PENDING |
| Synthetic nonlinear volume                          | 3D traversal         | Zero mismatches; fetch ratio below 1.0.                                                                                                                       | PENDING |
| Synthetic full dense volume                         | 3D traversal         | Zero mismatches; total fetch ratio at most 2.0.                                                                                                               | PENDING |
| Nonlinear 4D plus shipped non-flat interaction      | 4D representative    | Browser `nonlinear4d` A/B plus entry grid, rapid superseding rotor/slice endpoints, latest-revision-only install, fallback, capture wait, stable floor ball.  | PENDING |
| Default, Mandelbox Classic, Pentatope controls      | Surface routing      | Existing `ifs`, `escape`, and `ifs4` eligibility/backend selection remains unchanged; no sampled route is added.                                              | PENDING |
| Presentation matrix                                 | 3D and 4D            | Legacy env=0/floor-off identity; environment opt-in; solid/checker floor; emission; Balloon suppression/restoration; no reaccumulation for look/camera edits. | PENDING |

For every browser row record scene identifier/hash, seed, viewport/DPR, requested
and effective resolution, threshold, iteration budget and final counter, camera
pose, hierarchy status, warm-ups, raw timings, median, capture filename, and
artifact path. A fallback-sized render is evidence only for that effective size;
do not label it as the requested resolution.

## Result record

### Release verdict

**PENDING — real-GPU qualification has not been run.**

| Gate                                        | Verdict | Evidence |
| ------------------------------------------- | ------- | -------- |
| Static/full test/coverage                   | PENDING | PENDING  |
| Production build and WebGL smoke            | PENDING | PENDING  |
| Deterministic hierarchy construction        | PENDING | PENDING  |
| Deterministic fixed-lattice traversal       | PENDING | PENDING  |
| SwiftShader matched capture                 | PENDING | PENDING  |
| Real-GPU matched capture                    | PENDING | PENDING  |
| Real-GPU timing                             | PENDING | PENDING  |
| 3D/nonlinear/stochastic fixtures            | PENDING | PENDING  |
| 4D settled-generation policy                | PENDING | PENDING  |
| Defaults, presentation, status, and capture | PENDING | PENDING  |
| Surface routing controls                    | PENDING | PENDING  |

### Commands and artifacts

| Purpose                | Exact command | Exit/result | Artifact |
| ---------------------- | ------------- | ----------- | -------- |
| Commit/tree identity   | PENDING       | PENDING     | PENDING  |
| Full quality gates     | PENDING       | PENDING     | PENDING  |
| Software browser A/B   | PENDING       | PENDING     | PENDING  |
| Hardware browser A/B   | PENDING       | PENDING     | PENDING  |
| Hardware adapter probe | PENDING       | PENDING     | PENDING  |

### Matched capture and timing data

| Fixture/adapter | Requested → effective | Done/budget | Accelerated samples ms | Fallback samples ms | Median ratio | Pixel delta | Verdict |
| --------------- | --------------------- | ----------- | ---------------------- | ------------------- | ------------ | ----------- | ------- |
| PENDING         | PENDING               | PENDING     | PENDING                | PENDING             | PENDING      | PENDING     | PENDING |

### Visual and interaction review

| Check                                              | Result  | Evidence/notes |
| -------------------------------------------------- | ------- | -------------- |
| No missing first support or hierarchy tunnelling   | PENDING | PENDING        |
| Refined silhouettes agree with fallback            | PENDING | PENDING        |
| Progressive grids remain usable while camera moves | PENDING | PENDING        |
| Settled 4D rotor/slice replaces stale generations  | PENDING | PENDING        |
| Default Solid appearance is unchanged              | PENDING | PENDING        |
| Environment and floor opt-ins behave in 3D/4D      | PENDING | PENDING        |
| Balloon suppresses/restores floor                  | PENDING | PENDING        |
| Saved PNG/Collection/Timeline disclosure is honest | PENDING | PENDING        |
| Eligible Surface fixtures retain their route       | PENDING | PENDING        |

### Exceptions and follow-up

PENDING. Record every waived row, inconclusive measurement, driver limitation,
or follow-up bead here. A pending or inconclusive real-GPU row keeps the release
verdict pending; it is not a pass by absence of evidence.
