# `src/fractal/surface-de-gpu.ts` — the WGSL Surface kernels

The WGSL compute kernels behind the compute Surface path, including the frozen params-wire layout. The full kernel record is `docs/surface-gpu-kernels.md`.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `surface-de-gpu.ts` — WGSL fold-DE compute kernel, the app's compute
  surface path: mirrors `estimateDistance`'s refine=false fold path term
  for term (the estimator the fold GLSL marches) under the `flame-gpu.ts`
  oracle discipline, source-generated per config — the measured config
  stays private frontier, stage 2 OFF. Both map layouts keep the authored
  fold lane and append per-map post tails (`GpuMap` 10 vec4, `GpuMap4`
  14); `fold.w` carries `sigma_min(post)` for branch floors; descent
  stores inverse posts, escape reuses the lanes FORWARD; a live
  fold-final post appends 48/80 B past every params tail, moving no
  offset. Fold radii stay `(mR,fR,wall)` for descent versus squared for
  escape, oracle-packed; `foldRadiiOf` emits only in fold-reading cores.
  The xaos descent's per-component balls ride an optional appended
  `stateBounds` lane (3D one vec4; 4D two — the fit centre is 4D), kernel
  and packer gated together, affine/affine4 only, off byte-identical;
  bench-pinned 0/6912 at 4.5e-7 (union-bound kernel: 4790).
  THE PARAMS WIRE IS FROZEN LAYOUT, and appending to it blind is this
  file's standing hazard — a block appended at 560 lands INSIDE the
  `lens4Fold` quartet and corrupts it (the recorded incident). The
  layout: 3D frozen 0-207, the VARIANT block 208-271 (escape/bulb
  head-link ballast, never with the lens block), the lens fold's lengths
  at 272, and the plane/balloon block SHARED at 288 — escape and bulb
  declare a matching pad so that block keeps ONE offset across every 3D
  core (`SURFACE_GPU_PARAMS_BYTES` 288, balloon 320,
  `SURFACE_GPU_PARAMS_PLANE_BYTES` 336); 4D: the affine4 tail 208..463
  (`SURFACE_GPU_PARAMS4_BYTES` 464), the lens4 block 464..575
  (`SURFACE_GPU_PARAMS4_LENS_BYTES` 576, the `lens4Fold` quartet at 560),
  and the plane/balloon block at frozen 576 for EVERY 4D core (4D
  balloon 608, `SURFACE_GPU_PARAMS4_PLANE_BYTES` 624); the forward
  shape-trap tail frozen at 336/624 ending at
  `SURFACE_GPU_PARAMS_TRAP_BYTES` 400 / `SURFACE_GPU_PARAMS4_TRAP_BYTES`
  688, the plane region declared and zero-filled beneath it.
  FIFTEEN KERNEL CORES — the seven descent/forward cores below plus the
  sphereInv(4), finite(4), menger(4) and sphaira(4) pairs documented in
  their own module-doc sections; recount the module before asserting any
  total.
  `core:"affine"` emits the width-4 A/B + validity-slot REFINED ladder
  (mirrors `estimateDistanceRefined`; width/sharedFrontier/bnbStage2/
  shadeDeWidth inert) beside the fold frontier, picked off `deHasFolds`
  exactly like the CPU.
  `core:"escape"` is not a descent at all — `escape-de.ts`'s
  `estimateEscapeDistance` for exactly the systems `analyzeEscapeSystem`
  admits. It CYCLES the whole formula chain exactly as escape-de.ts
  defines it (`maxDepth * n` single-link steps, one `GpuMap` per link off
  the maps binding), so it DOES declare buffer 1 and `core:"bulb"` is the
  one bindingless core left. A link's `kind` may be a POWER map (4
  triplex, 5 quaternion square), so the fold pair's negative
  `kind != 2u`/`kind != 1u` dispatch sits behind a `kind < 4u` GUARD in
  both bodies (unguarded, a new kind satisfies both and runs both
  folds), with `bulbPow8` HOISTED to one definition emitted for the two
  forward cores, so affine/fold kernels stay byte-identical.
  `escParams.w` at offset 268 is the ONE live word of the head-link
  ballast: `EscapeDE.logEstimate`; its trap is the CONTINUOUS escape
  fraction over the PASS budget (denominator `maxDepth`, NOT the chain's
  step budget), COLOR ONLY.
  `core:"bulb"` is the escape core's SIBLING one formula over
  (`bulb-de.ts`'s `estimateBulbDistance`, for `analyzeBulbSystem`'s
  systems); everything structural is escape's. The one asymmetry: the
  ORBIT bailout and the QUERY-space marching ball are different numbers
  (`bulbParams.y` versus the frozen `boundingRadius`), and the trap is
  the POWER-map form.
  `core:"affine4"` (the 4D cut) is the refined ladder ONE DIMENSION UP —
  `surface-de-4d.ts`'s `estimateDistance4Refined`, the estimator
  `surface-material-4d.ts` marches — with the rotor prologue, the slab
  riding one half-extent register, and the swept kaleidoscope. ITS TAIL
  ALWAYS STORES THE ROW-MAJOR BYTES of the matrix the body applies, the
  packer performing the one real transpose (`setSurfaceView4`'s exact
  dance); maps are `GpuMap4` (224-byte stride). Two frozen slots carry 4D
  semantics: `visibleRadius` packs the SLICE-ADJUSTED sliceVisR so the
  shared march entry's sphere gate stays textually unchanged, while the
  tail's `visRadius4` keeps the FULL radius and the radius source
  normalizes over the `radiusBand` — both slice-invariant, and those two
  shade lines are the one core-conditional interpolation in the shared
  entry text. Fixed width 4; nonzero `footprint` THROWS at pack.
  `core:"fold4"` is the FOLD frontier one dimension up — 4D fold base
  maps (`deHasFolds4`) as the same width-configurable frontier as 3D
  "fold", slab(`ext`)-aware, sharing `GpuMap4` and the affine4 tail; no
  stage-2 B&B by the 3D verdict. A `mapsUniform` codegen option is
  REFUTED for production, kept as the refutation's executable record
  behind the opt-in `--surface-aff4-sweep` leg.
  `core:"escape4"` is the escape core ONE DIMENSION UP
  (`escape-de-4d.ts`'s `estimateEscapeDistance4`) — the first core that
  is BOTH 4D and FORWARD. Three things fall away with the dimension and
  NOTHING is added — no `bulbPow8` (the gate refuses a triplex power), no
  slab (the packer THROWS on a nonzero `sliceHalfW`), and no lens (which
  is what lets its params block reuse lens4's 464..575 region). Its wedge
  fold reads `SYM_PLANE_CODE4` — the index into `SYMMETRY_PLANES` — and
  NOT the descents' `SYM_PLANE_CODE`, which deliberately collapses
  `xw`/`yw`/`zw` onto their w-free twins: sound where the kaleidoscope is
  a swept matrix, wrong where a fold picks its two axes by name.
  `lens`/`balloon` throw, `groundPlane` composes, no fragment mirror.
  Ground plane is an orthogonal `groundPlane` option, not a core of its
  own — it composes with every descent/escape core in both dimensions and
  with the lens wrapper: a fifth ray status, `SURFACE_GPU_RAY_PLANE` (4),
  classified at miss exits only (EXHAUSTED never planes), the params
  block SHARED with the balloon's (both throw at codegen/pack together —
  no horizon inside the shell), `surface-compute.ts` pricing PLANE
  terminals in the hit-priced queue. The lift's no-new-shader-text
  argument and the floor's ball choice are the module doc's.
  All fifteen share the public `surfaceDE(pIn, cutoff, li)` signature, so
  the Modes are textually identical whichever core is picked. And
  `lens:true` wraps EITHER descent core in `descendLens`'s fold-FINAL
  branch sweep — the body token-renames to `surfaceDECore` and the
  wrapper owns the public names; the lens block is zero-filled when
  absent, and footprint+lens is refused at pack time. `lens:true` wraps
  either 4D core in `descendLens4`'s branch sweep the same way (the old
  "4D lens throws" rule is gone).
  Modes: `eval` and `march` (bounded-dispatch, host-compacted active
  list) are the bench baselines; `march` + `rays:"unproject"` for the app
  path, and `shade` runs the GLSL tracer's FULL shading over TERMINAL
  rays — march and shade are SEPARATE entries by measured verdict (the
  v1 megakernel shaded rays inside the march pass that terminated them
  and LOST THE DEVICE on Iris). `shadeDeWidth` routes those probe taps
  (never decide geometry) to a token-renamed narrow descent
  `surfaceDEProbe`; app ships width 1. `statusOut` (march only) is the
  host's side channel at binding 5, indexed by ray SLOT; nothing on the
  device reads it; absent byte-identical.
  RE-VERIFY SURFACE KERNEL CHANGES ON `--display=:0`, NOT SWIFTSHADER
  ALONE — a forward orbit is chaotic and which rounding seeds flip is
  realization-dependent, so the escape legs gate in LAYERS (the ensemble
  classifier's design is the module doc's).
  THE `finish` FLAG parametrizes the SHARED shade entry with per-slot
  authored finishes: shade-mode emission only, shadeMaps stride 1 -> 3
  vec4f, NO params-block change anywhere; absent/false is byte-identical
  source pinned against the PRE-CHANGE module — a compile gate, not a
  defaults claim. Forward cores' slot 0 is their whole wire; the floor
  stays matte.
  Consumed by `src/app/surface-compute.ts` and pinned by `npm run
bench:surface` (`--display=:0` for real-driver rows;
  `--surface-shade-width=N` reruns the probe-width A/B). Full record —
  every core in full, measured verdicts, bench legs and classifier
  design, the trap-normalizer history — in `docs/surface-gpu-kernels.md`.
