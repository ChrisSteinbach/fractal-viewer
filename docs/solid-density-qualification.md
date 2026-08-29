# Sampled Solid production qualification

Status: **PASS** on 2026-08-29. This file defines the release gate and is the
durable operator record for `fr-qxyt.9`. Ignored local evidence is under
`bench-results/fr-qxyt.9/`; the committed summary below records the environment,
commands, thresholds, timings, pixel deltas, and verdicts needed to audit it.

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

| Field                                | Result                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Date/time and timezone               | 2026-08-29 14:01–14:04 CEST (`Europe/Stockholm`)                                                                                   |
| Git revision and branch              | `f9236e0f536ce4bdd8d7cc8d2fa28964a8fa01be`, `codex/fr-qxyt`                                                                        |
| Working tree clean                   | Yes before build and both timed matrices                                                                                           |
| OS/kernel and architecture           | Linux 7.0.0-30-generic, x86_64                                                                                                     |
| CPU and memory                       | Intel Core i7-1165G7, 8 logical CPUs, 15.4 GiB RAM                                                                                 |
| Browser name/version/executable      | Google Chrome 152.0.7977.64, `/usr/bin/google-chrome`; software control: bundled Chromium 151.0.7922.34                            |
| WebGL API                            | WebGL 2.0 / OpenGL ES 3.0 Chromium                                                                                                 |
| `UNMASKED_VENDOR_WEBGL`              | `Google Inc. (Intel)`                                                                                                              |
| `UNMASKED_RENDERER_WEBGL`            | `ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)`                                                        |
| GPU/driver/ANGLE or Mesa versions    | Intel Iris Xe (TGL GT2), direct rendering, Mesa 25.2.8                                                                             |
| Display/headless mode and viewport   | Headed hardware on `DISPLAY=:0`; hermetic headless SwiftShader control; both 820×540 CSS pixels                                    |
| Device-memory/coarse-pointer signals | Unified Intel memory; GLX reported 15,720 MiB. Browser device/coarse-pointer hints were not used to qualify the explicit 192³ run. |

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

| Fixture                                             | Dimension/profile    | Required evidence                                                                                                                                             | Result                                                                |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Supplied two-map linear + swirl document            | 3D nonlinear         | Reusable `nonlinear` browser fixture from `nonlinear-solid.fixture.ts`; converge in Sampled Solid; matched capture/timing and status/capture disclosure.      | PASS: exact shared fixture, 192³ WebGL A/B, 15-sample hardware timing |
| Canonical linear + swirl fixture, seed `0x51d0cafe` | 3D nonlinear         | `nonlinear-solid.fixture.test.ts` routing, bounds, density, occupied voxels, orbit, and texture fingerprint.                                                  | PASS: 4 deterministic tests plus browser matrix                       |
| Canonical linear + swirl lift                       | 4D nonlinear         | `nonlinear4d` browser fixture; same authored blend through `toTransform4`; 4D accumulation/fingerprint; settled rotor and slice rebuild.                      | PASS: deterministic 4D contract and `nonlinear4d` WebGL A/B           |
| Julia final lens                                    | 3D and 4D stochastic | `stochastic` browser fixture plus unit 3D/4D paths; same-seed repeat is byte-identical; adjacent seed differs.                                                | PASS: deterministic tests and `stochastic` WebGL A/B                  |
| Default affine system                               | 3D representative    | `affine` browser fixture; historical defaults, live camera/presentation, matched browser A/B, PNG disclosure.                                                 | PASS: `affine` WebGL A/B and compatibility suite                      |
| Synthetic sparse volume                             | 3D traversal         | Zero mismatches; fetch ratio below 1.0.                                                                                                                       | PASS: 0 mismatches, span-16 ratio 0.066                               |
| Synthetic nonlinear volume                          | 3D traversal         | Zero mismatches; fetch ratio below 1.0.                                                                                                                       | PASS: 0 mismatches, span-16 ratio 0.099                               |
| Synthetic full dense volume                         | 3D traversal         | Zero mismatches; total fetch ratio at most 2.0.                                                                                                               | PASS: 0 mismatches, span-16 ratio 2.000                               |
| Nonlinear 4D plus shipped non-flat interaction      | 4D representative    | Browser `nonlinear4d` A/B plus entry grid, rapid superseding rotor/slice endpoints, latest-revision-only install, fallback, capture wait, stable floor ball.  | PASS: canonical non-flat 4D browser leg plus lifecycle contracts      |
| Default, Mandelbox Classic, Pentatope controls      | Surface routing      | Existing `ifs`, `escape`, and `ifs4` eligibility/backend selection remains unchanged; no sampled route is added.                                              | PASS: renderer regression and eligibility suites                      |
| Presentation matrix                                 | 3D and 4D            | Legacy env=0/floor-off identity; environment opt-in; solid/checker floor; emission; Balloon suppression/restoration; no reaccumulation for look/camera edits. | PASS: shader, scene, control, UI, and persistence suites              |

For every browser row record scene identifier/hash, seed, viewport/DPR, requested
and effective resolution, threshold, iteration budget and final counter, camera
pose, hierarchy status, warm-ups, raw timings, median, capture filename, and
artifact path. A fallback-sized render is evidence only for that effective size;
do not label it as the requested resolution.

## Result record

### Release verdict

**PASS — every predeclared hard gate passed.** The initial five-sample nonlinear
hardware timing ratio was 1.033, close enough to the 1.05 threshold to invoke
the recipe's noise rule. Repeating the unchanged scene with 15 measured samples
produced 1.093. Both sets are retained and reported; the threshold was unchanged.

| Gate                                        | Verdict | Evidence                                                                                            |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| Static/full test/coverage                   | PASS    | 149 files / 6,157 tests; statements 71.54%, branches 70.63%, functions 71.35%, lines 72.12%         |
| Production build and WebGL smoke            | PASS    | Vite production build; SwiftShader WebGL2 smoke screenshot; build identity `f9236e0`                |
| Deterministic hierarchy construction        | PASS    | 64³/128³/192³ sparse+dense repeated fingerprints; 192³ hierarchy exactly 1,048,560 bytes            |
| Deterministic fixed-lattice traversal       | PASS    | 0 mismatches; span-16 sparse/nonlinear/dense total-fetch ratios 0.066/0.099/2.000                   |
| SwiftShader matched capture                 | PASS    | Four 192³ fixtures; 0–5 changed channels of 16,384, maximum delta 1                                 |
| Real-GPU matched capture                    | PASS    | Four 192³ fixtures on Intel Iris Xe; 0–7 changed channels of 16,384, maximum delta 1                |
| Real-GPU timing                             | PASS    | Nonlinear 15-sample repeat: 24.535 ms accelerated, 26.820 ms reference, reference/accelerated 1.093 |
| 3D/nonlinear/stochastic fixtures            | PASS    | Shared exact documents, deterministic fingerprints, SwiftShader and Intel A/B                       |
| 4D settled-generation policy                | PASS    | Revision/capture-wait tests plus 192³ `nonlinear4d` matched browser capture                         |
| Defaults, presentation, status, and capture | PASS    | Compatibility, presentation, a11y, collection/timeline, scene-file, and export-wait tests           |
| Surface routing controls                    | PASS    | Regression/eligibility suite retains `ifs`, `escape`, and `ifs4` routes                             |

### Commands and artifacts

| Purpose                | Exact command/result summary                                                                                                                             | Exit/result         | Artifact                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| Commit/tree identity   | `git rev-parse HEAD && git status --short`                                                                                                               | `f9236e0...`, clean | This document                                         |
| Full quality gates     | `npm run lint`; `npm run build`; coverage command above; both hierarchy harness commands                                                                 | PASS                | Terminal output                                       |
| Software browser A/B   | Verifier above with `--driver=swiftshader --fixtures=affine,nonlinear,stochastic,nonlinear4d --resolution=192 --warmups=2 --captures=5 --timeout=300000` | PASS                | `bench-results/fr-qxyt.9/swiftshader/`                |
| Hardware browser A/B   | Verifier above with `--driver=hardware --fixtures=affine,nonlinear,stochastic,nonlinear4d --resolution=192 --warmups=2 --captures=5 --timeout=300000`    | PASS                | `bench-results/fr-qxyt.9/intel-iris-xe/`              |
| Hardware timing repeat | Same hardware command, `--fixtures=nonlinear --captures=15`                                                                                              | PASS, ratio 1.093   | `bench-results/fr-qxyt.9/intel-iris-xe-nonlinear-15/` |
| Hardware adapter probe | `glxinfo -B`; verifier WebGL renderer query                                                                                                              | Direct Intel/Mesa   | Environment table and local `results.json`            |

### Matched capture and timing data

All rows used two untimed warm-ups. Ratios are reference median divided by
accelerated median; every raw measured sample is included below.

| Fixture/adapter                    | Requested → effective | Done/budget | Accelerated samples ms                                                                                                 | Reference samples ms                                                                                                   | Ratio  | Pixel delta     | Verdict |
| ---------------------------------- | --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ------- |
| affine / SwiftShader               | 192³ → 192³           | 1M / 1M     | 113.655, 124.335, 144.440, 184.185, 173.285                                                                            | 742.730, 734.960, 731.385, 540.080, 1086.805                                                                           | 5.088  | 5/16,384; max 1 | PASS    |
| nonlinear / SwiftShader            | 192³ → 192³           | 1M / 1M     | 133.380, 121.560, 130.665, 169.850, 233.050                                                                            | 1400.540, 1388.075, 1570.130, 1565.740, 1752.230                                                                       | 11.739 | 0/16,384        | PASS    |
| stochastic / SwiftShader           | 192³ → 192³           | 1M / 1M     | 144.125, 142.685, 151.285, 159.175, 169.740                                                                            | 908.445, 1063.565, 1082.420, 1008.125, 858.290                                                                         | 6.664  | 0/16,384        | PASS    |
| nonlinear4d / SwiftShader          | 192³ → 192³           | 1M / 1M     | 127.650, 99.130, 106.480, 112.930, 103.570                                                                             | 697.190, 957.190, 681.220, 714.850, 690.265                                                                            | 6.548  | 0/16,384        | PASS    |
| affine / Intel Iris Xe             | 192³ → 192³           | 1M / 1M     | 37.805, 32.025, 34.790, 32.305, 28.430                                                                                 | 29.390, 25.445, 22.025, 35.450, 31.875                                                                                 | 0.910  | 7/16,384; max 1 | PASS    |
| nonlinear / Intel, initial         | 192³ → 192³           | 1M / 1M     | 26.350, 22.370, 35.780, 31.650, 28.405                                                                                 | 29.355, 25.940, 22.430, 35.295, 31.355                                                                                 | 1.033  | 0/16,384        | REPEAT  |
| stochastic / Intel Iris Xe         | 192³ → 192³           | 1M / 1M     | 35.365, 30.960, 27.485, 23.935, 19.840                                                                                 | 27.915, 23.435, 20.315, 24.255, 21.110                                                                                 | 0.853  | 2/16,384; max 1 | PASS    |
| nonlinear4d / Intel Iris Xe        | 192³ → 192³           | 1M / 1M     | 29.440, 25.855, 21.915, 34.470, 35.480                                                                                 | 33.740, 30.075, 27.750, 24.360, 21.015                                                                                 | 0.943  | 0/16,384        | PASS    |
| nonlinear / Intel, final 15-sample | 192³ → 192³           | 1M / 1M     | 28.365, 24.415, 20.170, 28.080, 23.965, 20.440, 27.645, 24.535, 21.070, 34.890, 31.675, 28.080, 24.150, 20.520, 34.115 | 35.910, 31.940, 28.855, 25.530, 22.375, 35.255, 31.625, 26.820, 22.960, 19.205, 20.425, 33.325, 29.790, 26.640, 23.500 | 1.093  | 0/16,384        | PASS    |

### Visual and interaction review

| Check                                              | Result | Evidence/notes                                                                       |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| No missing first support or hierarchy tunnelling   | PASS   | CPU adversarial/property oracle plus both WebGL matrices                             |
| Refined silhouettes agree with fallback            | PASS   | Every browser row stayed within max delta 1 and the 0.1% changed-channel limit       |
| Progressive grids remain usable while camera moves | PASS   | Render-session, worker lifecycle, interaction, and capture-wait suites               |
| Settled 4D rotor/slice replaces stale generations  | PASS   | Endpoint revision, rapid supersession, stale-event tests, and 4D hardware A/B        |
| Default Solid appearance is unchanged              | PASS   | Literal legacy shader-source contract and affine matched captures                    |
| Environment and floor opt-ins behave in 3D/4D      | PASS   | Presentation shader, scene-sphere, control, persistence, and UI tests                |
| Balloon suppresses/restores floor                  | PASS   | Both Balloon shader families compiled in every browser leg; focused floor tests      |
| Saved PNG/Collection/Timeline disclosure is honest | PASS   | Production PNG capture/status plus collection, timeline, scene-file, and a11y suites |
| Eligible Surface fixtures retain their route       | PASS   | Renderer regression contracts and Surface eligibility tests                          |

### Exceptions and follow-up

No gate was waived. The two local service-worker certificate messages are
retained in browser `consoleMessages` but excluded from `consoleErrors` by the
same narrow predicate used by existing capture qualification scripts; all other
browser errors remain fatal. Hardware capture timing includes app-owned PNG
readback and encoding, so the deterministic fetch-count harness remains the
machine-independent traversal-work authority. The initial five-sample nonlinear
ratio was inconclusive and is preserved alongside the passing unchanged
15-sample repeat.
