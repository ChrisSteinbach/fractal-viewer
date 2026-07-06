# Spike fr-53k: GPU accumulation for the flame render — go/no-go

**Verdict: GO** — for WebGPU compute-shader flame accumulation as an optional
fast path behind capability detection, with the existing CPU worker kept
unchanged as the universal fallback and ground truth. The measured win is too
large to leave on the table (**22–68× on a modest integrated laptop GPU**),
the visual-agreement risk the issue flagged turned out to be quantifiable and
small (statistically indistinguishable output), and every "the current design
resists it" cost has a concrete, bounded mitigation. The voxel path (payoff
#2) was not benchmarked; see [Voxel path](#voxel-path) for why this result
mostly transfers.

Spike artifacts live on the throwaway branch `spike/fr-53k-gpu-flame-accum`
(benchmark page `src/app/gpu-spike/`, runner `scripts/gpu-flame-bench.mjs`).
No production code was changed.

## What was built

- **WGSL compute kernel** (`src/app/gpu-spike/kernel.ts`): a parity port of
  `accumulateFlame`'s hand-inlined chaos-game loop — uniform and weighted
  transform selection (same lower-bound binary search), **all 12 variations**
  (~70 lines of WGSL; every one is plain trig/sqrt that ports directly,
  including `julia`'s stochastic bit), symmetry post-rotations, the
  final-transform lens with its adopt-only-if-finite guard, escape-reseed at
  the same limit (written NaN-robustly for f32), the flam3 color-coordinate
  walk, and identical NDC→pixel bucketing. 65,536 independent chains, each
  with its own PCG32 stream seeded from `mulberry32(seed)`; one warm-up
  dispatch (PLOT=false pipeline specialization) mirrors the CPU's unrecorded
  warm-up.
- **Histogram**: `width × height × 4` u32s (hits, r, g, b) accumulated with
  `atomicAdd` — WGSL has no float atomics, so color channels are fixed-point
  (×256, quantization ≤ 1/512 per channel per hit). 16 bytes/bucket vs the
  CPU's 32 (Float64 hits + sumRGB).
- **Benchmark harness**: a dev-only page (`/gpu-spike/index.html`) that runs,
  per scenario, a timed CPU run (the real `accumulateFlame`, same chunking
  discipline as the worker), a timed GPU run, and an **equal-N comparison**:
  both sides accumulate exactly 50,331,648 iterations from the same
  seed-class, go through the _same_ downstream pipeline
  (`downsampleFlame(0.4)` → `tonemapFlame` at app-default params), and are
  diffed per-pixel. A `playwright-core` runner drives it headlessly
  (SwiftShader) or headful (real GPU) and dumps JSON + per-canvas PNGs.

## Results

Intel Iris Xe (TigerLake gen-12lp, ~15 W laptop iGPU), Chrome 148/Vulkan,
1920×1080 accumulation (960×540 display, 2× supersample), 4 s timed runs.
CPU is the production-equivalent single worker thread on the same machine.

| Scenario   | System character                                        | CPU iter/s | GPU iter/s | Speedup   |
| ---------- | ------------------------------------------------------- | ---------- | ---------- | --------- |
| sierpinski | 4 affine maps, uniform, legacy palette                  | 16.2 M     | 352.6 M    | **21.8×** |
| fern       | weighted (85/7/7/1), LUT palette, hot-bucket contention | 15.9 M     | 413.4 M    | **26.0×** |
| swirl      | nonlinear variations (swirl+linear), LUT                | 6.8 M      | 460.4 M    | **67.7×** |
| kaleido    | order-5 symmetry (20 slots), LUT                        | 8.4 M      | 320.2 M    | **38.3×** |

Equal-N visual agreement (50.3 M iterations each, identical tonemap):

| Scenario   | MAE (RGB, /255) | Mean signed bias (/255) | Max pixel Δ | maxHits CPU/GPU |
| ---------- | --------------- | ----------------------- | ----------- | --------------- |
| sierpinski | 0.084           | ≤ 0.052                 | 13          | 2,492 / 2,497   |
| fern       | 0.014           | ≤ 0.0006                | 7           | 52,678 / 52,216 |
| swirl      | 0.306           | ≤ 0.011                 | 77          | 14,636 / 14,554 |
| kaleido    | 0.578           | ≤ 0.065                 | 86          | 405 / 422       |

Reading the numbers:

- **Throughput.** Even the worst case (many-slot kaleido) is >20× a CPU core;
  the atomic-contention stress case (fern funnels ~85% of mass through one
  map's hot buckets) _gained_ ground (26×). Variation-heavy systems benefit
  most — the CPU pays per-iteration closure dispatch and tuple allocation for
  variations (16 M → 6.8 M iter/s), while the GPU inlines them and slightly
  _speeds up_ as extra ALU work hides memory latency. A multi-worker CPU
  design (the obvious alternative) tops out around cores × single-thread ≈
  8 × 16 M ≈ 130 M iter/s on this machine — still under the iGPU — and costs
  either per-worker histograms (n× the dominant memory cost) or a merge/
  contention scheme. Discrete desktop GPUs are 5–20× an Iris Xe, so the
  classic "GPU flames run at billions of iter/s" claim from the issue is
  consistent with these numbers.
- **Quality.** Differences are Monte-Carlo shot noise, not structure: the
  amplified diff images show uniform speckle tracking the sparse regions
  (where log-density tonemapping amplifies single-hit deltas), no geometric
  displacement, no banding. Systematic bias — the thing fixed-point
  quantization and f32 would cause — is ≤ 0.065/255 everywhere. Peak densities
  agree within ±4% (sampling noise; the two sides intentionally use different
  RNG streams of the same seed-class). MAE scales with per-pixel convergence
  (kaleido spreads 50 M iterations over 20 slots, hence the noisiest), i.e.
  two CPU runs with different seeds would show the same order of difference.
- **In user terms**: the default 20 M-iteration render
  (`DEFAULT_FLAME_ITERATIONS`) drops from ~1.3 s of worker crunch to ~60 ms;
  a deep 1-billion-iteration convergence drops from ~60 s to ~3 s — on this
  laptop, at wall power ~nothing.

## The issue's cost list, answered

- **"src/fractal/ is dependency-free, Vitest-testable, bit-reproducible."**
  True and unchanged — the CPU path stays the oracle. The kernel itself can't
  run under Vitest, but agreement is _testable_ where it matters: the spike's
  equal-N MAE harness ran fine on **SwiftShader headlessly** (Chrome's
  conformant CPU implementation of WebGPU), so a statistical-agreement check
  (MAE/bias thresholds vs the CPU oracle) can run in CI with no GPU hardware.
  Per-device: a GPU render at a fixed iteration count is deterministic given
  (seed, chain count, iters/invocation) — integer atomics commute — but NOT
  bit-identical across devices/drivers (f32 transcendentals vary). So:
  bit-reproducibility remains a CPU-path guarantee; the GPU path gets
  "seed-class + statistical agreement", which the numbers above show is
  visually equivalent.
- **"Two implementations kept in visual agreement."** The real recurring
  cost. Mitigations that fell out of the spike: (1) the kernel is a
  line-for-line parity port with the CPU loop as its named reference, and the
  porting surface is small — the 12 variations were ~70 lines total; (2) the
  agreement harness exists now and pins the two together the same way
  `flame.test.ts`'s oracle test pins `accumulateFlame` to `stepOrbit`.
  New variations/features land CPU-first, then WGSL, then the agreement run.
- **"Float64 histograms vs fp32/fixed-point."** Measured: no visible cost at
  spike convergence. Two real limits to engineer around in production:
  (1) fixed-point color capacity is 2³²/256 ≈ 16.7 M hits/bucket — reachable
  in minutes at GPU speeds on hot buckets (the spike page watches `maxHits`
  and warns at 12 M). Fix: periodic flush of the u32 tiles into a wider
  accumulation (or u64-emulated adds); straightforward, bounded work.
  (2) f32 orbit precision at extreme camera zooms is untested — bound it
  before shipping deep-zoom workflows.
- **"RAM budgets need a VRAM counterpart."** Yes, and it's _cheaper_: GPU
  buckets are 16 B vs 32 B, so the same budget arithmetic
  (`flameAccumBudgetBuckets`-style) covers twice the resolution. The
  learned-ceiling ratchet ports as: request adapter limits explicitly (the
  spike engine already must — WebGPU silently caps devices at 128 MiB
  bindings otherwise), treat `device.lost` as the allocation-failure signal,
  ratchet down and retry — same shape as the worker's OOM ratchet, different
  trigger.
- **"WebGPU not universal → CPU fallback stays."** Confirmed as designed: the
  spike page detects and skips cleanly (no adapter, no `navigator.gpu`,
  software adapter flagged). The fallback isn't hypothetical maintenance —
  it's today's shipped worker, unmodified.
- **"Escape-reset + per-transform selection port fine."** Confirmed
  empirically — weighted fern, order-5 symmetry, LUT color walk, and the
  final-lens guard all render in agreement.

## What the spike did NOT cover

- **Progressive display**: the spike reads the full histogram back once at
  the end (~33 MB). Production wants either throttled readbacks (fine at the
  worker's 150 ms cadence on desktop) or — better, and the issue's "cheap
  wins" item — GPU-side downsample + tonemap so the histogram never leaves
  the GPU except as pixels. Not risky, just work.
- **Adaptive density estimation** (`adaptiveDownsampleFlame`) stays CPU-side
  initially (it runs once, on the finished frame, on a display-resolution
  derivative) — port later if profiling says so.
- **Phones.** WebGPU ships broadly on Android Chrome and iOS 26 Safari, but
  no phone numbers were taken. Expect the CPU-vs-GPU gap to be smaller but
  material; the capability check + fallback make this shippable-then-measure.
- <a name="voxel-path"></a>**Voxel path.** Not benchmarked. The flame result
  transfers structurally: same chaos-game loop, same atomics, scatter into a
  `size³` storage buffer instead of 2D — and the entire O(size³)
  pack/transfer/`texSubImage3D` pipeline (including fr-8x7's pack-duty
  throttle) disappears because the volume can stay resident on-GPU next to
  the raymarcher that displays it. Recommend folding voxels into
  productization _after_ the flame path lands, not as a second spike.

## Recommended next step

Productize as: `GpuFlameAccumulator` (spike engine + kernel as the starting
point) behind `navigator.gpu` capability detection inside the existing flame
worker session (the protocol/UI don't change; the session picks its
accumulation backend), with (1) color-overflow handling, (2) VRAM budget +
device-lost ratchet, (3) GPU downsample/tonemap or throttled readback for
progressive frames, (4) the equal-N agreement harness kept as a scripted
check (SwiftShader in CI, real GPU locally). CPU worker remains the default
wherever WebGPU is absent and the reference everywhere.

## Reproducing

```bash
node scripts/gpu-flame-bench.mjs --duration=4 --headed   # real GPU (window opens)
node scripts/gpu-flame-bench.mjs --duration=4            # headless → SwiftShader
```

Writes `bench-results/results.json` + per-scenario `cpu/gpu/diff` PNGs.
Headful is required for a hardware adapter on this dev box (headless Chrome
148 + Linux/Vulkan falls back to SwiftShader). The page is also usable
interactively at `https://<dev-server>/gpu-spike/index.html` — including from
a phone on the LAN, which is how phone numbers should eventually be taken.

Benchmarked 2026-07-06: Chrome 148, Linux, Intel Iris Xe (gen-12lp), spike
branch `spike/fr-53k-gpu-flame-accum`.
