# `src/app/` — the WebGL Surface path

The WebGL Surface tracer: the interaction tier, the strip pump that bounds every trace, and the GLSL tracers (3D and 4D).

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `render-tier.ts` — surface-mode interaction tier: invalidated
  frames trace a cheap preview into an offscreen target at an adaptive
  (scale, depth) rung picked from measured trace cost
  (`createPreviewGovernor`, EMA + hysteresis + a ≥250ms panic drop; starts
  at the shipped 0.3, climbs to full scale on capable GPUs — 4D
  auto-tumble sessions, which never settle, now sharpen instead of
  staying pinned soft; depth couples to scale via `previewMaxDepth`, the
  contraction-aware clamp, so finer rungs trace deeper and the
  core-ball bug cannot return in adaptive form). March/shadow/AO budgets +
  hit floor per tier — uniform writes only, shader bodies untouched; hit
  ACCEPTANCE is tier-independent (`uAcceptPixelEps`, the settle
  frame's pixel footprint, drives the hit test/grid proof/DE cutoff in
  every tier — a preview coarsens sampling, never acceptance; the
  buffer-scaled eps had rendered fold-DE plateau bands as phantom box
  faces at coarse rungs); after `TIER_SETTLE_MS` of quiet the full-quality
  frame renders as an interruptible strip job (see `strip-planner.ts`).
  The ladder's 0.1/0.07 emergency rungs exist for fold-frontier
  DEs — each buys ~2x fewer rays AND a shallower depth clamp.
  Capture/offline
  `force` frames stay full. Pure, tested, injected clock.
- `strip-planner.ts` — bounds every WebGL trace, previews included (closing
  the i915 preview-hang path); compute bounds its own submissions.
  Seeds unbind destination textures from all samplers: uniform branches
  cannot prevent feedback validation. A lost context ABORTS the job — a
  dead context's draws are silent no-ops and its cleared target reads as
  a false 100% miss (the SwiftShader balloon verdict's actual mechanism).
  Evidence: `docs/surface-strip-pipeline.md`.
  Units are PIXELS, not rows: a strip is a
  row-major pixel interval rendered as 1-3 scissor rects under ONE fence,
  so fold strips shrink below a row's cost. The probe is sized from a
  per-px cost prior — the measured preview cost when one exists, else a
  pessimistic fold-class prior, else the legacy rows fraction for affine
  (the unprimed 3-row probe at full resolution was the
  kernel-confirmed i915 preemption hang) — then strips scale toward a
  per-tier `targetMs` of measured GPU time each, measured by a
  forced-completion 1x1 readback and NOT `gl.finish()`, which some
  command-buffer paths return from before execution. Measurement scaling
  is blind to the fold+grid frames' cheap/expensive bimodality, so every
  strip is ALSO capped at `STRIP_WORST_CASE_CAP_MS` of worst-case
  predicted cost.
  THE EVIDENCE CHAIN: the price starts
  at a class-pessimistic ms/px, RATCHETS up as the job's own measurements
  reveal worse pixels, and chains across job re-arms via scene.ts. A
  COMPLETED job's whole-frame observation REPLACES the floor in BOTH
  directions (x10 tier-gap safety) — down matters, or a measured-cheap
  fold system stays pinned at class-floor micro-strips whose readback
  overhead dissolves its settle — while partial jobs only RAISE.
  Relaxation lives exactly ONE completed-preview->settle handoff (a
  superseded job = the pose moved = stale evidence dies).
  Measurements reach the ratchet through a measurement-time
  `observe(ms, px)` door as well as `next()`'s sizing-time one (a job's
  LAST measurement otherwise never reaches a sizing call at all).
  Capture observations are RAISE-ONLY and may never own the floor,
  with one exception: a COMPLETED capture may SEED an EMPTY
  chain, since offline export is the one caller that never fills it
  otherwise — seed, never replace, and safe in the direction it can be
  wrong, an export-scale trace reading HIGH.
  THE PUMP IS PIPELINED (a measured A/B verdict): every sync point on the
  Iris/ANGLE stack costs the same tax REGARDLESS of the work behind it
  (`SURFACE_STRIP_SYNC_TAX_MS`), so strips go out as individually FLUSHED
  draw groups (the watchdog's preemption boundaries) fenced only per
  ~`SURFACE_STRIP_FENCE_GROUP_MS` of predicted work; batch measurements
  SUBTRACT the tax to price MARGINAL trace work — and a FLAT subtraction
  alone ratchets one-way into a 1px absorbing state (the doc carries the
  measured collapse), which is why the planner carries the COMPUTE arm's
  two-term model (`surface-compute.ts`'s `ShadeHitCost`):
  `interceptMs` + `px * marginalMsPerPx`, each measurement's
  surprise split BY WIDTH so a narrow batch charges the INTERCEPT,
  sizing off the marginal alone, the marginal's RISE rate-limited
  (deliberately the strip-shrinking direction), and a
  sane-unit floor `STRIP_MIN_PX` instead of one pixel. THE CLAMP ORDER
  IS SAFETY-CRITICAL: model, growth cap, floor, then
  `STRIP_WORST_CASE_CAP_MS` LAST — wherever floor and cap disagree the
  CAP WINS, because an unbounded strip draw is the kernel-confirmed
  i915 preemption hang. DO NOT tune the
  tax constant instead — that only moves where the same ratchet engages;
  strips of a row or more row-snap to a single scissor rect (a
  per-DRAW fixed cost tripled under 3-rect strips); and the canvas blit
  rides PRESENT-ON-DRAIN gaps (presents share the strips' GL queue). The
  pipelined refill bounds its in-flight queue at a queue price on
  TYPICAL-cost class floors (the fold PRIOR, not the fold WORST
  constant), raised live by the job's own ratchet and capped at one
  `STRIP_WORST_CASE_CAP_MS` of mispredicted work. No-prior jobs (affine)
  keep the legacy sync-collapse — serial joined strips completing whole
  light jobs in one call, escaping to the pipeline past
  `SURFACE_STRIP_SYNC_ESCAPE_MS`.
  Capture/offline export runs the SAME pump, differing only in
  how it WAITS between calls: the synchronous one (offline export,
  thumbnails) blocks on ONE whole-queue readback per queueful, the
  yielding one (the Save-PNG) hands the main thread back on rAF,
  timer-backstopped at a frame; a bounded macrotask spin when hidden. A capture job never presents (the export-scale target must not
  reach the canvas), ADOPTS the fence backlog like the live jobs, and
  winds its own queue down before returning from an abort (no export
  leftovers outlive the export). THE SYNCHRONOUS DRAIN RETIRES FENCES
  WITHOUT POLLING after its readback; WebGL forbids observing newly
  signaled fences within one task.
  COST CEILINGS ARE THE SYNCHRONOUS DRAIN'S ALONE — offline
  export and thumbnails, the callers that freeze the tab and offer no way
  to stop it. There, measured evidence predicts the frame up front (never
  the class prior, which would refuse every fold export sight unseen) and
  refuses past `SURFACE_CAPTURE_PREDICT_CEILING_MS` (120s); the drain
  itself aborts past `SURFACE_CAPTURE_SPEND_CEILING_MS` (60s) of real
  spend; both throw `SurfaceCaptureCostError` — the offline exporter
  fails the run, the thumbnail path falls back to the explorer render.
  THE INTERACTIVE SAVE-PNG IS REFUSED NOTHING: its modal discloses
  measured coverage, its Cancel works, and the drain yields, so a
  prediction deciding for the user is the patience-guessing the
  truncated-preview regression already reverted one tier over.
  THE STANDING VERDICT IS NO AUTOMATIC GIVE-UP (two reverted truncation
  attempts and the user's own call): the settle always ARMS however
  expensive the frame — bounded strips grind visibly and
  interruptibly — and the preview always runs to COMPLETION, with
  `surfaceRenderProgress()` and the surface progress row disclosing
  honest coverage (naming its engine) so the user decides. The
  unbudgeted completion pass carried the same line across the WebGPU
  seam.
  THE COALESCING RULE: `renderSurface("preview")` ARMS a fresh job, so
  main.ts's tick now COALESCES like the compute loop instead of
  re-arming per invalidation — while a job is in flight an invalidation
  STEPS it, latched in `scene.needsRender` so the next arm takes the
  freshest camera. Pose coherence is free (`armSurfacePreview` snapshots
  the camera into uniforms, so a multi-frame job traces ONE pose).
  Fold surface sessions gate their first frame on `compileAsync` of the
  fold tracer program (long links off the critical path where the driver
  offers `KHR_parallel_shader_compile`); THE COMPILE MESH MUST
  MIRROR FullScreenQuad's position+uv triangle or the draw links a second
  program variant, and the gate defers activate()'s guide/selection
  refresh so no other re-link joins the driver's compile queue behind it.
  Gated by `scripts/capture-export.verify.mjs`,
  `scripts/capture-drain.verify.mjs` and `scripts/surface-tier.verify.mjs`
  (whose mid-drag softness check is that rule's);
  `scripts/fold-settle-park.repro.mjs` and `?surfacetrace` sit one module
  over.
  `tiling-balloon.verify.mjs` and `native-gl-trace.*.mjs` observe this without
  added GL calls. Pure, tested. Evidence and the remaining backend boundary
  are in `docs/surface-strip-pipeline.md`.
- `surface-material.ts` — GLSL3 full-screen-quad sphere tracer mirroring
  `surface-de.ts`'s `estimateDistanceRefined` line for line, the same
  oracle discipline as `flame-gpu.ts`; BASE maps packed into fixed-size
  (24-slot) uniform arrays, with kaleidoscope sectors swept from three
  scalar uniforms, so symmetry
  order no longer counts against the cap. Callers gate eligibility on the
  bare active-map count first, so an over-cap count throws here rather
  than degrading silently — and since the 24/48 split a 25..48-record 3D
  system is compute-only, so only ≤24 records ever reach this arm.
  Live map/escape/lens posts share compile-gated 1600-B `SurfacePosts3`
  (inverse for descent/lens, forward for escape); absence stays byte-exact.
  Browser gate: `scripts/surface-post.verify.mjs --display=:0`.
  VARIANT ARMS, resolved by `surfaceFragmentFor`: `SURFACE_FINISH`
  (per-map authored finishes over `uMapFinishA/B`, composing with EVERY
  variant in both dimensions; the 4D pair rides the `SurfaceMaps4`
  std140 block as UNCONDITIONAL members so the layout never moves on a
  define flip, and every recompose site threads the define);
  `SURFACE_FOLD_LENS`
  (the descent bodies rename to `surfaceDECore`, the wrapper
  owns the public `surfaceDE` overloads mirroring `descendLens`, and the
  cores' own `uFinal*` lens uniforms pack IDENTITY while the wrapper
  applies the real lens from `uLens*`); `SURFACE_ESCAPE`
  (`escape-de.ts`'s forward loop) and `SURFACE_BULB` (`bulb-de.ts`'s
  forward triplex-power loop), which each replace the
  descent bodies WHOLESALE and are therefore ALTERNATIVES —
  `surfaceFragmentFor` REFUSES the pair, and the bulb arm's `uBulb*`
  uniforms are declared INSIDE it so no other variant pays their bytes;
  `SURFACE_GROUND_PLANE` (an infinite one-sided floor below
  the session ball, its `shadeGroundPlane` entry mirroring the WGSL arm
  term for term, called from all three miss exits, composing with every
  variant except the balloon, which throws — no horizon inside the
  shell); and `SURFACE_BALLOON`. Since compute became the preferred
  tracer, the escape, bulb and fold-lens arms are the FALLBACK arms
  (`?surfacegl` / no adapter / device loss).
  The escape arm CYCLES the whole formula chain: one
  `uEscM`/`uEscT`/`uEscParams` slot per link declared INSIDE the arm,
  `uMapCount` the link count, `uMaxDepth * uMapCount` single-link steps
  so `uMaxDepth` keeps meaning PASSES, and `uSymOrder`/`uSymPlane`
  driving `foldQuerySector` once before the orbit. A link may be a POWER
  map, which cost three things and no layout change: the
  fold pair's `kind != 2` / `kind != 1` tests are exhaustive by NEGATION
  over {1, 2, 3}, so kinds 4 and 5 sit behind a `kind < 4` GUARD rather
  than beside them (unguarded, kind 4 satisfies both and runs both
  folds); `bulbPow8` is DUPLICATED from the `SURFACE_BULB`
  arm character for character, because neither alternative can see a
  definition emitted inside the other (a test diffs the two bodies so
  the copy cannot drift); and `uEscLogForm` is a SCALAR, not a params
  tail, because the estimate form is ONE number per CHAIN read after the
  orbit — per-link would put a step across every boundary between the
  two forms.
  THE STRIP IS A SIZE RULE, not the plane arm's private habit:
  `surfaceFragmentFor` strips any resolved source past
  `SURFACE_GLSL_STRIP_BYTES` (64KB) through `stripGlslSource`, a
  whole-source comment/indentation strip emitting the identical token
  stream. The cliff is real — Mesa crashes around 80KB — and a size
  threshold is the honest predicate for a size cliff, where a hand-kept
  list of which variants strip drifts the next time one grows a
  paragraph. MEASURE BEFORE ADDING THE NEXT PARAGRAPH — the strip
  threshold is on the RESOLVED source, the ~80KB cliff on what
  `surfaceFragmentFor` actually EMITS:
  `surfaceFragmentResolvedFor(escape, lens, balloon, plane, bulb).length`
  against `SURFACE_GLSL_STRIP_BYTES`, and `surfaceFragmentFor(...).length`
  against the cliff. The finish arm flips ONE strip status
  (escape+balloon, benign); the 2026-09-27 refinedCert-head restore
  crossed 4D PLAIN too — every arm strips, the benign event the watch
  predicted.
  Orbit-trap color blends descent choices TOP-DOWN (depth-0 copy
  dominates, flam3's convention); the per-level decay is the
  Color speed slider (default 0.5 = that original fixed behavior), and
  the rings/sheets sources ride the same hit-info descent. The
  march samples `surface-grid.ts`'s floors (NEAREST 3D texture) before
  paying a descent: a floor above `uAcceptPixelEps` — the
  tier-pinned acceptance eps, NOT the buffer-scaled
  `uPixelEps` — is both a no-hit proof and a safe stride, damped by the
  same `uStepScale` as analytic steps; gridless marching stays the
  always-correct fallback. Skips drain their own whole-ray cap
  (`SURFACE_GRID_SKIP_CAP`), never the analytic march budget, and the
  full-tier budget is 160 (raised from 96, which starved rays that
  thread gaps or graze faces into dropout speckle — measured + healed
  in `scripts/erosion-repro.harness.ts`). The three shading taps
  (normal/shadow/AO) ride the value form, which fold systems route to
  `surfaceDEProbe` — a width-1 instantiation of the SAME fold-descent
  template (the probe-width verdict on the fragment path; one text
  two names, march/hit acceptance stay width 12). The fold-lens variant
  deliberately carries no probe — the port was left undone when the
  surface-optimization seam closed.
  OUTPUT ALPHA IS THE COVERAGE FLAG AND MUST NEVER REACH THE
  CANVAS: three r163+ creates the canvas `alpha: true`
  unconditionally (the renderer's `alpha` param only picks the clear
  alpha), so a coverage-0 miss reaching the compositor ADDS the page's
  own `--bg` to the pane — the whole of the two 4D arms' measured IoU
  divergence, and an alpha hole in every WebGL surface Save-PNG. The
  present blit (`BLIT_FRAGMENT`) strips alpha to 1 as every surface
  present's last hop; coverage is read off the TRACE targets only.
  Full record — the variant KB sizes and their history, the Mesa link
  cliff, the probe-width A/B and the grid-budget measurement, and the
  coverage-alpha leak — in `docs/surface-glsl-tracers.md`.
- `surface-material-4d.ts` — 4D twin: sphere-traces the
  `w = w0` slice of the rotor-posed 4D attractor, mirroring
  `surface-de-4d.ts`'s `estimateDistance4Refined` line for line (refined
  certificates + width-4 beam — the 4D spike's measured ghost eliminator
  plus the validity slots).
  Its `uInvPostM`/`uInvPostT` arrays append UNCONDITIONALLY to the
  `SurfaceMaps4` std140 block, growing its `UniformsGroup` from six to eight
  arrays so no pre-post offset moves.
  The slice has a THICKNESS: `uSliceHalfW > 0` makes every
  descent query the SEGMENT spanning `|w - uW0| <= h` instead of the
  point `(p, uW0)`, so the mode renders a SLAB's projected shadow rather
  than a cross-section (the oracle's `halfExtent`, mirrored line for line
  — one `vec4` per chain/candidate, `segmentRadius` for every `length`,
  and the visible-ball gate widened to `max(0, |uW0| - h)`). `segment` is
  a dynamically-uniform branch, so `h = 0` — the shipped default — costs
  nothing beyond the extra live registers and renders today's frame value
  for value.
  Rotor + w-slice are LIVE per-frame view uniforms (`setSurfaceView4`),
  unlike Flame/Solid's settled-restart worker contract — the slider is normalized
  rotated-w, and `scene.ts`'s `setSurface4View` converts it to the
  tracer's world `uW0` through `wSupport`, so one slider
  position is one hyperplane across every mode; 24-map cap matching 3D's —
  since the 24/48 lift the FALLBACK's cap alone (compute carries 48),
  the per-map arrays riding a std140 uniform BLOCK, and the
  kaleidoscope SWEEPING like 3D's (order costs no slots). Since the 4D cut
  this tracer is the fallback arm for EVERY 4D system (see
  `surface-compute.ts`'s bullet) — only `?surfacegl`, a missing adapter
  or a device loss.
  TWO VARIANT ARMS — the balloon inverted-union and
  the ground plane, each mirroring its 3D original term for term — and
  the MECHANISM is the one deviation, forced by measurement: one
  monolithic `#if` source would put EVERY 4D session in the band where
  the 3D fold program takes ~25s to link. So the arms resolve JS-side,
  through `surfaceFragmentFor` ITSELF rather than a second preprocessor
  (`surface4FragmentFor` is a two-line wrapper), and THE `defines` KEYS
  ARE `SURFACE4_*` WHILE THE GLSL DIRECTIVES STAY THE 3D NAMES —
  deliberate, called out at both sites, and renaming them would break
  resolution.
  Three things could not be copied: `balloonInnerDE`'s far-field clamp
  (it exists for 3D's FORWARD cores, whose zero-iteration far value is
  not a distance to anything; this tracer's core has a value-exact sphere
  floor that already IS the bound — the arm records that a future 4D
  forward core owes it), `shadeGroundPlane`'s normalizer (the FULL 4D
  radius, not `sliceVisR`, which collapses at the slab edges and would
  make the floor breathe as the slider scrubs), and the post-march miss's
  sphere-exit/exhaustion split, which had to be ADDED — 3D splits it
  because it has a floor to classify into, and EXHAUSTED never planes.
  Full record — the measured source sizes and the strip threshold
  arithmetic — in `docs/surface-glsl-tracers.md`.
