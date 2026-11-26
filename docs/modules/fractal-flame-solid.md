# `src/fractal/` — Flame and Solid render cores

The CPU fractal-flame accumulator and its WebGPU kernels (3D and 4D), and the Solid render's voxel accumulators.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `flame.ts` — CPU fractal-flame: `accumulateFlame` (2D histogram) +
  `tonemapFlame` (exposure/gamma/vibrancy). CPU oracle for `flame-gpu.ts`.
  The tone-map anchor is the MEAN deposited density (`hitMass`/buckets,
  `log1p(h/mean)/log1p(32)`), never the hottest bucket — a ratio, so
  exposure is invariant under budget, pooling and deposit weights;
  `maxHits` is an instrument. `flame-differential.harness.ts` is the
  fidelity sheet; the finished adaptive pass is the banded
  `createAdaptiveDownsampleJob` (plan fixes the total; bands yield through
  the scheduler, `estimateProgress` drives the determinate bar, quick
  passes emit none), gather clipped to the occupied footprint —
  bit-identical, 4-55x measured imports, +4% dense
  (`flame-density-estimate.harness.ts`).
  Its optional balloon echo deposits one full-weight, tint-only splat into
  that SAME histogram — no separate compositing, conformal magnification
  or radial fade (`scripts/flame-balloon.harness.ts`).
- `flame-4d.ts` — 4D twin (`accumulateFlame4`), CPU oracle for
  `flame-gpu-4d.ts`; slices with `0.06` ghost floor (not solid's `0`). Its
  balloon path reduces through the worker's current settled rotor first,
  inverts the visible
  3D point, then applies the camera — never a 4D inversion.
- `flame-gpu.ts` — WebGPU kernels, CPU-oracle pinned by `npm run bench:gpu`.
  CI fails closed over the 3D/4D import graph; full runs nightly and at
  dispatch/deploy, REUSED per already-swept TREE. Each scenario owns its
  CI deadline. Browser exits are
  not timeouts; partials never pass a gate. Policy:
  `docs/gpu-agreement-ci.md`.
  XAOS VERDICT: one draw through chi or fallback, oracle-built cumulative
  rows transferred, chain stride held at 32 via a spare aux lane.
  EMITTER VERDICT: bounded device samplers reproduce the CPU MEASURE rather
  than its rejection-loop draw sequence; one primary draw keeps selection
  aligned, and emitters never force CPU.
  THE SLOT WIRE IS APPEND-ONLY: the original 20 variation lanes and every
  old offset stay frozen; entries 20–24 ride appended `varWeightsExtra`/
  `varTypesExtra` arrays. The existing three `varParams` lanes keep
  julian/juliascope/curl and spend spare words on bipolar shift + PDJ a–d
  (one word remains spare); fold radii stay the type-indexed
  `(mR²,fR²,wall)` block. `SLOT_STRIDE_BYTES` is 1232.
- `flame-gpu-4d.ts` — 4D WGSL kernel (4x4+t affines, `variations4`,
  rotor+camera projection, four `FourDRenderColor` modes). Same agreement
  harness, with the 3D Slot's fold/parameter/extra lanes verbatim and all
  old offsets frozen. `SLOT4_STRIDE_BYTES` is 1296: its existing
  `postTrans` remains at 1216 and the two extra arrays append at 1232.
- `voxel.ts` — solid render: `accumulateVoxels` → 3D density grid →
  `voxelTextureData` (RGBA8 volume). `buildColorModeLUT` reuses `color.ts`.
- `voxel-4d.ts` — 4D twin; slices with `0` floor (not flame's `0.06`).
