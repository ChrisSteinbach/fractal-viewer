# `src/app/` — the WebGPU compute Surface path and Surface routing

The WebGPU compute Surface renderer and its routing, per-slot shading inputs, eligibility, the force-frame memo key, the grid worker, and the software-renderer detector.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `surface-grid-worker.ts` / `surface-grid-worker-core.ts` /
  `surface-grid-client.ts` — empty-space-grid build worker:
  one-shot `buildSurfaceGrid` request/response (transfer), latest-wins-by-id
  client with `settle()` for the offline exporter. One request per 3D
  surface-session enter (the session freezes its DE), NO sync fallback — a
  lost worker degrades to gridless (correct, slower) marching. Request
  `resolution` is a ceiling: the worker times a measured pilot slab
  and downshifts through a 64/48/32 ladder to stay under a 3s budget, floored
  at 32, never skipped; the result's own `resolution`/`halfExtent` are what
  was actually built.
- `surface-slots.ts` — the three per-slot shading inputs every surface tracer
  takes (per-slot "By Transform" colors, orbit-trap palette coordinates,
  and RESOLVED finishes), keyed on `baseIndex` into the DOCUMENT's
  transforms. Honors an authored `Transform.colorIndex`, else the
  surface's own even spread — pure, shared by `main.ts` and `gpu-bench/`
  so neither drifts from it. `surfaceSlotsAuthorFinish` is the finish
  COMPILE GATE's predicate — keyed on the SLOT list, so a weight-0
  transform's authored finish cannot force the parametric program;
  main.ts derives the gated list ONCE per surface enter (forward
  sessions pass ONE slot, the head transform's, matching firstChoice 0,
  and EVERY routing arm must assign it — the 4D chain's shipped
  unassigned for one review round, so the declaration now carries no
  initializer and tsc's definite-assignment analysis refuses the next
  one).
- `surface-compute.ts` — WebGPU compute renderer; the ROUTING is the part
  to get right. PREFERRED whenever an adapter exists: fold-shaped 3D
  sessions (`deHasFolds(de) || foldFinal`), escape-time sessions (the
  non-contracting fold map/CHAIN the IFS gate refuses), bulb sessions,
  and EVERY 4D session (no order split) — none compiles fold GLSL, none requests a grid (gridless by
  decision).
  COMPUTE-ONLY, entry REFUSED without compute and a mid-session loss
  exiting with a toast: fold-shaped 4D at any symmetry order and
  escape-shaped 4D (no fold or forward-orbit GLSL exists). The 4D kernels' cost is superlinear in ORDER
  regardless of routing. `?surfacecompute`/`?surfacegl` keep this
  re-measurable (`?surfacegl` wins if both given). `create()`'s opts
  also carry the session's gated finishes (null = classic kernels,
  non-null compiles `finish: true` at create time;
  the spec discloses the list so the force-frame memo re-traces a
  finish-only leg).
  `create()` takes a `SurfaceComputeTarget` union
  (`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`) picking the kernel
  core (ifs4 → affine4/fold4 off `deHasFolds4`), the params packer and the maps buffer's
  layout; the march/shade host loop, presents and failure ladder stay
  shared. `isForwardTarget` names the THREE forward kinds, `isFourDTarget`
  the two needing `view4`.
  BALLOON and FLOOR ride `ifs`/`ifs4` targets with the same precedence
  (never compile together, balloon wins); NO FORWARD KIND EVER BALLOONS,
  either dimension. `ifs4`'s rotor/slice view is PER-FRAME SPEC STATE
  (`spec.view4`, re-read per spec assembly and repacked per pass; a
  missing view4 THROWS), and
  `surfaceComputeForceFrameKey` includes the pose.
  Owns the device and frame loop. Shade batches are sized in HIT units,
  never ray units — misses drain the FREE queue WHOLE per sweep, and hits (plus
  ground-plane PLANE terminals) are FLOORED AT ONE WORKGROUP, NEVER ONE
  HIT. The sizer carries a two-term model,
  `cost(n) = intercept + n·marginal` (`ShadeHitCost`): sizing
  reads the MARGINAL alone, its FALL is rate-limited to a halving
  (`SURFACE_COMPUTE_SHADE_MARGINAL_DECAY`), ONE sizer is shared across a
  supersampling job's passes, and a partial hit batch is HELD for the
  next sweep. NO SIZING RULE HERE MAY BE WRITTEN IN TERMS OF `intercept`
  ALONE — the model only ever
  fixes the RATIO of its two terms — so `K`
  (`SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST`) is a WIDTH, not a ratio.
  `SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS` sits outside the range
  real scenes measure in; that PLACEMENT is the measurement. THE HIT CAP
  IS BAND-CLAMPED, NOT FLAT: `SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` is
  65536 and `shadeBandHitCap` clamps the width's ceiling by the frame's
  own worst measured per-eval march rate, so an unmeasured expensive
  band's width×marginal stays under the shade ceiling at any width; the
  4096 floor keeps every recorded scene's width — the immersed regime
  (a pane whose every ray hits) was submission-bound at 4096,
  ~507 dispatches × ~1.2 ms each against 0.3 ms of GPU work, the
  sphaira owner report's mechanism and the finite control's alike
  (A/B + byte-identity rows in docs/surface-compute-renderer.md).
  THE LIT QUEUE IS SIZED THE SAME WAY (`nextLightingRayCap`): an
  inert cost lane is a pinned width, not a safe default. AND NO SIZING MODEL OR LADDER MAY READ A
  RAW DISPATCH TIME: the session calibrates its own fence round-trip once
  (five probes) and every model, ladder and EMA reads the
  GPU-side pass-duration instrument wherever the session's own fence is
  cheap enough for its after-fence resolve to be free
  (`SURFACE_COMPUTE_TS_FENCE_COST_MS`), wall MINUS that fence otherwise;
  the tally alone always reads wall. The resolve rides its own submission
  after the fence — same-submission is measured-broken on Chrome/Dawn.
  THE FENCE IS PAID PER GROUP, NOT PER DISPATCH: a dispatch is still its
  own SUBMISSION (the preemption boundary) but several queue behind ONE
  `onSubmittedWorkDone`, closing at `SURFACE_COMPUTE_FENCE_GROUP_MS`
  against TWICE the lane's worst MEASURED per-dispatch work this frame,
  `SURFACE_COMPUTE_FENCE_GROUP_MAX` dispatches, or the next
  present/budget deadline — whichever first — each lane's first group
  PILOTED at one. NEVER SIZE A GROUP OFF A MODEL PREDICTION (a
  dispatch's predicted cost IS the target by construction).
  `SURFACE_COMPUTE_FENCE_GROUP_MAX` IS A MEASURED CEILING, NOT A DIAL
  (8 — the repro settled staged VOLUME behind a fence, not a count;
  groups also close at
  `SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES`); a killed device never
  returns, so the loss latch is
  one-way by measurement (`scripts/webgpu-staging-ceiling.repro.mjs`).
  THE WATCHDOG'S UNIT IS THE SUBMISSION: submissions ARE separate driver
  JOBS (a backlog is not one — REFUTED), ONE job is cut at ~2.0 s on the
  AMD box (not its nominal 10 s), and K command buffers in ONE
  `submit()` ARE one job. NO SUBMISSION MAY OUTRUN A WATCHDOG, and an
  instrument read at the FENCE cannot see the dispatch that killed the
  device (`scripts/webgpu-job-watchdog.repro.mjs`). A GROUP MEASURES ONCE
  FOR N PIECES, so its attribution is FIXED per lane and no reader may
  invent another. `?surfacefencegroup=1` is that old loop.
  Gate: `scripts/surface-fence-cost.verify.mjs`. Presents are
  progressive; shading probes ride
  `SURFACE_COMPUTE_SHADE_DE_WIDTH`; unresolved rays keep that seed.
  SUPERSAMPLING rides the loop as `opts.samples`: N FRAMES at N sub-pixel
  offsets (`subPixelSample`), averaged in LINEAR light (averaging bytes
  is the edge-darkening bug) — N frames not N rays, so every per-ray
  buffer/watchdog bound stays as measured. PROGRESSIVE; main.ts spends the persisted
  `surface.antialiasSamples` choice (1/2/4/8/16, default 8) on the live
  SETTLE and Save-PNG, never a preview or offline VIDEO frame; the
  progress row discloses a trailing `antialiasing pass k/N`, silent
  through pass 1. `?surfacesamples=N` (1–64) is a page-load override
  supplied to BOTH engines — the WebGL strip arm imports
  `subPixelSample` from here, so "N samples" has ONE meaning on every
  machine.
  A FRAME'S RASTER IS BOUNDED BY THE DEVICE, NOT THE CALLER:
  `maxFrameRays = min(maxBufferSize, maxStorageBufferBindingSize)/16`,
  and a frame past it THROWS `SurfaceComputeFrameSizeError` UP FRONT
  rather than reaching the kernels, because WEBGPU REFUSES SILENTLY
  HERE. The live pane FITS (`fitSurfaceComputeRaster`); a capture TILES
  (`surfaceComputeTileRows`, capped at `SURFACE_COMPUTE_MAX_TILE_RAYS`).
  `?surfacemaxrays=N` pretends a device ceiling;
  `scripts/surface-export-tile.verify.mjs` is the gate.
  `destroy()` defers the real `device.destroy()` until every in-flight
  frame unwinds — the fence calibration included. `destroyed`
  means teardown REQUESTED, `deviceDestroyed` means device GONE — NEVER
  call `device.destroy()` twice. Same shape as `flame-gpu-backend.ts`
  (OPS there, frames here); pinned by `surface-compute.test.ts` over a
  fake device and by `scripts/surface-teardown.verify.mjs` on real
  Firefox.
  scene.ts presents frames as a DataTexture through the shared surface
  blit; main.ts routes and choreographs. Where a fragment arm exists,
  fallback is one-way — create failure or device loss re-enters the
  untouched WebGL path (`?surfacegl` forces it); compute-only routes exit
  with the disclosed toast instead. Full record in
  `docs/surface-compute-renderer.md`.
- `surface-eligibility.ts` — the Surface gate as a pure derivation:
  document in, `{status, note, kind}` out — the routing across
  the five analyzers TESTABLE instead of an untestable closure inside
  `main()`; `refreshSurfaceEligibility` is one call into this plus the ui
  write, every decision leaf pinned over the shipped presets. `kind`
  exists so `surfaceSession.start`'s own re-derivation can one day consume
  the one shared answer; it does not yet.
- `surface-force-frame-key.ts` — the offline-export force-frame memo key
  (`ensureSurfaceComputeForceFrame` re-PRESENTS instead of re-tracing when
  it is unchanged), pulled out of main.ts's closure so it tests at all —
  `capture-cost.ts`'s pattern, and the extraction is what let the
  stale-frame bug get a regression test. It must key EVERY spec field that
  repaints a HIT, and missing one fails SILENTLY: fog, envLight and the
  backdrop SHAPE triple all landed after the key and none were
  added, so an atmosphere-only timeline leg under a parked camera exported
  the PREVIOUS leg's frame for its whole dwell. EACH ABSENT FIELD MUST
  DEFAULT TO WHAT `packSurfaceGpuShade` DEFAULTS TO — a key that defaults
  differently re-creates the bug from the other side, keying two specs the
  same that pack differently. The string is a plain `join("|")`, so every
  optional block is tagged and fixed-length when present; the module doc
  carries the collision argument.
- `render-backend.ts` — the "which engine, and is it software?"
  vocabulary: ONE `SOFTWARE_RENDERER_RE`, adapter-status derivation,
  unmasked-renderer read and warning-string pair, so every site deciding
  whether the app is silently on a CPU rasterizer agrees on the answer
  AND the wording (`gpuprobe.html`'s inline copy is deliberately
  byte-identical — it runs before the bundle can be trusted). Tested.
