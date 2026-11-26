# `src/app/` — scene, motion, workers, sessions and export

The Three.js scene, camera and morph motion, shows, the generation/render workers and their clients, render sessions, 4D view, and image/video export.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `scene.ts` — Three.js wrapper (scene, camera, renderer, point cloud, guide
  boxes, fog). Three.js confined to this file, `interactions.ts`,
  `voxel-material.ts`, `surface-material.ts`, and `surface-material-4d.ts`.
  `setRightInset` aims
  projection clear of the desktop panel. Captures:
  `captureFrame`/`captureSolidFrame`/`captureSurfaceFrame` render at export
  scale (clamped to device limits + 8192px); flame accumulates at export size so
  `captureFlameFrame` reads native. Renders on demand via `needsRender` flag.
- `orbit.ts` — spherical orbit-camera math (pure, tested).
- `camera-tween.ts` — three mutually exclusive camera motions (pure, tested,
  injected clock): smoothstep GLIDE (auto-frame on load), exponential CHASE
  (follow morphing bounds), directed POSE GLIDE to a saved `CameraPose`
  (moves theta/phi, nearest-turn). All honor reduced motion.
- `framing-bounds.ts` — trimmed-quantile bounds (`frameBounds`/`frameRadius`)
  computed worker-side so nonlinear outliers don't inflate fits. Raw `bounds`
  still used where every point matters (color normalization, culling). Pure, tested.
- `morph-tween.ts` — replace-load morph driver: per-frame `lerpSystem`
  sampler with pinned seed; main.ts streams intermediates sized by
  `morph-budget.ts`, sends real request on terminal sample. Configurable
  duration. Pure, tested.
- `morph-budget.ts` — adaptive intermediate point budget: EMA of per-point
  cost sizes each intermediate to ~one frame's chaos game, clamped
  `[MIN, MAX]`. The session-owned Performance → Morph Detail select trades
  smoothness for density. Pure, tested.
- `mutation-thumbs.ts` — mutation grid thumbnail renderer: canvas-free
  chaos-game scatter into RGBA buffer, fixed oblique view, additive
  per-transform color. main.ts owns the 3x3 modal grid. Pure, tested.
- `drift.ts` — ambient "Drift" show: dwell/advance state machine (injected
  clock), fires Surprise-Me rolls or saved-scene legs. Can HOLD awaiting an
  external signal (render convergence). Session-only, stops on user edits.
- `drift-policy.ts` — show stop/advance conductor: guarded `stop()` (no-op
  during own leg or while idle) + `advance(launchLeg)` with own-leg guard.
  `ConductableShow` surface shared by drift and timeline player. Pure, tested.
- `build-replay.ts` — "Watch it build" replay: timing/phase state machine
  (hop -> accrete -> spotlight -> done) revealing the cloud in generation
  order. Spotlight tours base maps one at a time. main.ts overlays a
  temporary showcase (By Transform color, guides visible, auto-orbit).
  Pure, tested, injected clock.
- `exposure.ts` — `glowExposure`: density-adaptive brightness for the
  `"glow"` render style (not the flame tone-map). Pure, tested.
- `resolution-governor.ts` — adaptive resolution: frame-time ladder (EMA +
  hysteresis) trades pixels for frame rate; a parked still restores to full
  after ~2s quiet (render-on-demand starves the sample stream).
  Exports/flame stay unscaled. Session-only `adaptiveResolution` opt-out.
  Bypassed in surface mode (render-tier.ts owns that cost). Pure, tested.
- `capture-cost.ts` — a capture's cost memory out of `scene.ts`
  (`solidCaptureMsPerPx`, `predictCaptureMs`), tested without WebGL. It
  decides only whether the solid Save-PNG skips the modal's grace period;
  a missing reading flashes the modal while an under-prediction costs one
  grace period, so the reading survives everything but the voxel grid and
  solid params (never the pose). The measured flash: its module doc; the
  invalidation rule: `scene.ts`'s `solidCapturePxCostMs`.
- `export-progress.ts` — the Save-PNG progress modal's DOM-free policy:
  a run earns a blocking modal only past a slow `predictedMs`
  or `EXPORT_MODAL_GRACE_MS` (never-flash, `render-tier.ts`'s
  discipline), and its two stops stay apart on `ExportRun.stop` —
  `"cancel"` means DISCARD, the optional `"deliver"` means stop and
  keep. Cancellation is a REQUEST, never an instant stop. Pure, tested.
- `main.ts` — entry point; wires state <-> scene <-> ui <-> interactions.
  `?surfacestate` publishes `window.__surfaceState()`, the
  read-only settle latch `scripts/surface-repro.verify.mjs` — and any
  future visual-regression script — waits on: the surface renderer is
  bit-reproducible run to run once truly settled, PROVIDED the scene
  document pins its camera (a pose-less scene deterministically auto-fits,
  but does not reproduce the reporter's inspection framing).
  SAVE-PNG'S ARM IS THE RENDER MODE'S, FULL STOP: a render that has not
  produced its picture yet is WAITED for behind the export
  modal (`planPngExport`'s `awaitReady`, disclosed and cancellable), never
  swapped for the explorer's — `scene.captureFrame` is reached by being in
  points mode and by nothing else, through one shared `planRenderWait` all
  three arms spread so no arm can restate (or misstate) the rule.
  Flame's wait is not merely a startup gap — it waits for
  `renderComplete.flame`, the accumulation MEETING ITS BUDGET (the
  flame canvas IS the export, so a mid-accumulation PNG is a
  categorically coarser picture, not an early one). Solid and Surface
  wait only for their first frame — both produce the export at capture
  time by re-tracing.
  `notifyRenderSignal` (was `notifyOfflinePark`) is the shared wake:
  progress, a session's deactivate, a playback stop, an export's Cancel.
  THE FLAME WAIT HAS A SECOND EXIT: "Save now (rough)" beside Cancel,
  offered only where the wait is longest (the budget scales with
  export AREA, so 4x multiplies it by sixteen). FLAME ONLY — solid's
  wait is the voxel grid with no partial
  to deliver. The press LATCHES and is honoured only once
  `hasFirstFrame`, which makes the feature "wait for the FIRST FRAME
  instead of the whole BUDGET".
  Ties go to the BUDGET (the wait loop re-checks readiness before any
  stop check), so a press the finished render beat to the line gets an
  ordinary toast rather than one labelled rough. `cancelled` survives as
  `stop === "cancel"`, so callers predating the action are unmoved;
  Escape stays CANCEL-ONLY; and the button is ABSENT rather than hidden
  when not on offer, so nothing can Tab to it or query it.
  The fall-through bug this replaced, and why the Export-size restart
  gap could re-open it through the rough-save latch, are recorded in
  `docs/architecture.md`.
- `regen-scheduler.ts` — rAF coalescer: one generation request per frame.
- `cloud-worker.ts` / `cloud-worker-core.ts` — point cloud generation worker:
  one-shot request/response, seeded chaos game, colors + 4D transforms
  baked worker-side.
- `cloud-generator.ts` — main-thread cloud worker client: at most one request
  in flight, latest wins, OR-merges coalesced flags. Synchronous fallback if
  worker crashes. `settle()` for offline export. Pure, tested.
- `flame-backdrop-generator.ts` — optional backdrop worker controller over
  the existing flame protocol: one persistent CPU/transfer worker, fixed
  256px-class/1M-iteration blurred policy, 300ms trailing debounce, at most
  one request in flight plus one latest pending snapshot, and no synchronous
  fallback. Morphs `suspend()` it and keep the currently displayed source;
  the terminal cloud `resume()`s one fresh request. It screen-composites the
  worker image over dark off-thread output, publishes immutable opaque RGBA
  plus its mean fog color, and exposes `settle()` to frame-exact export.
  Its snapshot carries the schedule/tiling/balloon-legality inputs the
  frozen plot order needs (tiling.ts's bullet). Pure controller, tested.
- `flame-gpu-backend.ts` — drives flame WGSL kernels inside the flame worker
  behind `FlameAccumBackend` seam. Error-scoped resource creation
  (`FlameGpuSizeError`). `destroy()` defers the real `device.destroy()`
  until every in-flight op unwinds (`surface-compute.ts`'s
  deferred-teardown idiom one module over, counting OPS rather than
  frames, with the same `destroyed` = teardown REQUESTED /
  `deviceDestroyed` = device GONE split and the same inline teardown
  whenever nothing is in flight, which is what keeps the seam's
  `void destroy()` and gpu-bench's one-device-at-a-time invariant
  untouched).
  The hazard is routine here rather than exotic: every
  palette/supersample/symmetry edit reaches `startAccumulation`, which
  destroys the outgoing backend ON PURPOSE while a superseded `runChunk`
  can still be parked on `mapAsync` over a submitted copy. The ELEVEN
  explicit `GPUBuffer.destroy()` calls that ran AHEAD of the device are
  gone rather than reordered — two of them are the staging buffers a
  parked map holds a pending mapping on, an independent crash vector,
  and `device.destroy()` reclaims all eleven anyway — so the backend now
  holds only the buffers it TOUCHES (params, hist + staging, display +
  staging) and the rest live on their bind groups. `beginOp` refuses new
  work once teardown is requested, which is what bounds the drain to the
  ops already started; the only caller that can reach that refusal is a
  stale `runChunk` whose next generation check discards the result
  regardless. Lifecycle pinned by `flame-gpu-backend.test.ts` over a
  fake device (the class is exported for it); browser gate
  `scripts/flame-teardown.verify.mjs`.
- `flame-worker.ts` / `flame-worker-core.ts` — flame render worker:
  `FlameWorkerSession` driving CPU or WebGPU accumulation; SAB fast path,
  transfer fallback. A non-flat session retains entry geometry/support but
  accepts a settled `setFourDView` rotor/slice endpoint and restarts its
  accumulation. GPU failure recovery ladder: retry smaller -> fresh device ->
  CPU fallback.
- `flame-perf.ts` — opt-in flame throughput diagnostics (`?flameperf`).
- `voxel-worker.ts` / `voxel-worker-core.ts` — solid render worker (transfer
  only). Its non-flat session shares Flame's retained-geometry,
  restart-on-settled-`setFourDView` contract.
- `voxel-material.ts` — GLSL3 raymarcher `ShaderMaterial` for voxel volume.
- `render-session.ts` — `enter`/`exit`/`terminate` + first-frame-gate for
  flame/solid/surface controllers. `renderMode` is session-only, never
  persisted. An optional `onFirstFrame` fires on the false→true
  TRANSITION alone (the flame marks per progress event, so the
  gate absorbs the repeats), which is one wiring per session rather than
  five call sites that could each forget one.
- `thumbnail-patch.ts` — the pending late thumbnail corrections, pure
  and session-only. A ★ Save to collection or 📍 Add
  keyframe taken during a flame or solid session's STARTUP GAP files an
  entry tagged with that render mode carrying a POINT-CLOUD picture; the
  entry is right (it re-enters the tracer on load), only its picture
  disagrees with its glyph. A thumbnail must be INSTANT — blocking the
  save on a flame convergence would be far worse, and the export modal
  is not available to a save — so the fall-through STAYS and a later
  correction is armed beside it, applied when the session marks its
  first frame. THE INVALIDATION RULE IS THE LOAD-BEARING PART: a saved
  entry froze a DOCUMENT, so a patch applies only while the live
  document still encodes to the string the entry was saved with AND the
  mode is unchanged; otherwise it is dropped, because a stale-but-honest
  picture beats a confident wrong one. Camera + non-flat FourDPose framing
  ride the encoded document, so a manual orbit or rotor/slice change
  invalidates too — the conservative direction. Flat Solid's live
  auto-orbit can invalidate such a correction exactly like a manual camera
  turn; frozen Flame and parked Surface do not advance it.
- `four-d-view.ts` — the session-owned live 4D view container. `FourDPose`
  snapshots rotor + slice as Saved-view framing; auto-motion on/off is a
  browser preference and speed is session-only. During non-flat Flame/Solid,
  manual endpoints are sent to the active worker once on release or after the
  interaction quiet period; automatic tumble stays parked. `FourDTween` is
  the directed pose glide (rotor slerp + slice lerp).
- `rotor4.ts` — SO(4) rotation as renormalizable unit-quaternion pair
  (`RotorPair`); `slerpRotorPair` + `normalizeRotorPair`.
- `recorder.ts` / `mp4-duration.ts` / `webm-duration.ts` — video capture:
  `MediaRecorder` -> MP4 (preferred) or WebM; binary patchers fix missing
  duration metadata.
- `offline-export.ts` / `video-encode.ts` / `mp4-mux.ts` — offline
  frame-exact timeline export: steps playback on a VIRTUAL clock (main.ts's
  `nowMs()`), awaits `CloudGenerator.settle()` per frame for determinism.
  `video-encode.ts` = WebCodecs H.264 adapter; `mp4-mux.ts` = dependency-free
  faststart muxer (handles B-frame reordering). Render keyframes PARK the
  clock while the render converges, then dwell the step's hold on the
  converged still — authored clip length.
- `motion-export.ts` — the motion-clip export's pure plan: the session's
  automatic motion recorded frame-exactly (4D → tumble, flat → orbit;
  Points refuses; Solid rides BOTH — flat orbit one paint (world-space
  camera), tumble commit the settled-edit path and ONE FULL VOXEL REBUILD
  per frame, the flame clip's cost class, waited off
  `renderComplete.solid`'s revisions). The flame/solid frame waits TWO
  PHASES (`restarted` zeroes `renderComplete`, then budget met). Flame 3D
  rides a `setProjection` worker command; `FourDView.step` is the
  tumble's UNconditional composition; pose edits/mode switches/gestures/
  exports/resize stop it; offline frames freeze the solid turntable's
  ambient advance. Length/rate are session sliders; Capture size rides
  `scene.beginExportFrames`; `?motionfps=N` (gate-only) WINS over the
  rate slider. The WebGL arm's clip frames are synchronous drains the
  tier clock never sees; the unwind re-invalidates or the settled latch
  sticks false. Gate: `scripts/motion-export.verify.mjs` (surface legs
  need `--mode=x11::0`; `--surfacegl` = that arm alone).
- `isolation-handoff.ts` — the session-only sessionStorage bridge
  carrying `renderMode` across the cross-origin-isolation reload
  (`register-sw.ts`'s `onBeforeIsolationReload`).
- `register-sw.ts` — service-worker registration + COOP/COEP bootstrap.
  Takes an `onBeforeIsolationReload` hook, fired the instant
  before the isolation reload — never the update reload — so the app can
  snapshot session state the reload is about to destroy (any throw
  swallowed; isolation matters more). A page bound for that reload
  registers immediately instead of waiting for `load`.
- `sw/sw.ts` — Workbox precache + COOP/COEP headers (own TS program).
