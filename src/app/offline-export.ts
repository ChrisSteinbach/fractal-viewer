/**
 * The offline frame-exact timeline export's driver loop (fr-92t9): step a
 * VIRTUAL clock through the timeline playback one exported frame at a time —
 * `startMs + i * frameMs`, never `performance.now()` — settling each frame's
 * generation before it is rendered and encoded.
 *
 * ## Why not the realtime capture (fr-8v41's recorder)?
 *
 * The MediaRecorder export records the live canvas: the CONTENT is already
 * seed-deterministic (timeline.ts's `legSeed` pins every leg's generation
 * stream), but the TIMING is whatever this run of the event loop delivered —
 * a GC hitch drops frames, device speed sizes the morph intermediates
 * (`morph-budget.ts` adapts point counts to measured latency), and the cloud
 * generator's latest-wins slot silently skips samples that outran the
 * worker. This driver removes every one of those: the clock is arithmetic,
 * each frame's generation is awaited (`stepFrame` resolves only once the
 * sample is on the scene), and the encoder receives exactly one frame per
 * timestep. Same device + same timeline + hands off the controls =>
 * the same clip, frame for frame — slower or faster than realtime,
 * whichever the machine dictates, and correct either way.
 *
 * ## The per-frame contract
 *
 * For frame `i` at virtual time `t = startMs + i * frameMs`:
 *
 * 1. `await stepFrame(t)` — main.ts sets the shared virtual clock and runs
 *    the animate loop's LOGIC phase (timeline player poll — which may launch
 *    a leg or finish the run — morph sample, camera/4D tween advance), then
 *    awaits the cloud generator's `settle()` so the request that logic just
 *    issued has been delivered to the scene.
 * 2. `running()` — checked immediately after, because the step itself is
 *    what learns the run ended (the player's `done` event, or a user stop
 *    that landed between frames). A frame stepped after the end is never
 *    rendered or encoded: the run's last captured frame is the last one the
 *    playback actually owned.
 * 3. `renderFrame(t)` — the RENDER phase, forced: render-on-demand would
 *    skip a visually-identical dwell frame, but the encoder needs a painted
 *    canvas for every timestamp (and the paint and the encode must share
 *    one task — the WebGL drawing buffer is only guaranteed until the
 *    browser composites).
 * 4. `await encodeFrame(i)` — hands the canvas to the encoder and honors
 *    its backpressure before the clock is allowed to advance.
 *
 * Between frames the loop yields (`yieldToUi`) so input stays live — a
 * click can still reach the stop button mid-export. The injected yield is
 * expected to be MessageChannel-based rather than `setTimeout`: timers are
 * throttled in background tabs, and outliving a backgrounded tab is one of
 * this export's advantages over the rAF-driven realtime capture (which
 * stops on `visibilitychange` because its captureStream stalls).
 *
 * ## Ending
 *
 * The loop ends when the playback reports itself over (`running()` false —
 * the player's natural `done`, or any "user reached in" stop chokepoint) or
 * at `maxFrames` (the recorder's MAX_RECORDING_SECONDS cap, kept for
 * parity), whichever comes first; `capped` distinguishes the cut. The
 * caller owns everything after the loop — flushing the encoder, muxing,
 * downloading, and unwinding the virtual clock.
 *
 * ## What this module is not
 *
 * No DOM, no WebCodecs, no Three.js, no clock of its own — every effect is
 * injected, so the loop's ordering rules (settle before render, encode
 * before advance, never capture a frame the run doesn't own) are unit-tested
 * without a browser, the same discipline as `drift.ts` / `timeline-player.ts`
 * one shape over: those are per-rAF-poll state machines, this is an async
 * loop that OWNS its frames, because frame-exactness is the point.
 */

/** Frame rate of the offline export. 30 halves the per-clip generation work
 * of 60 while staying a standard smooth video rate — and unlike the realtime
 * capture the rate is exact: every frame is authored, none are dropped. */
export const OFFLINE_EXPORT_FPS = 30;

export interface OfflineExportDeps {
  /** Virtual clock reading of frame 0 — `performance.now()` at export
   * start, so tweens already in flight continue seamlessly onto the
   * virtual clock. */
  startMs: number;
  /** Milliseconds between exported frames (1000 / fps). */
  frameMs: number;
  /** Hard cap on captured frames (MAX_RECORDING_SECONDS × fps — recorder
   * parity). The loop never steps past it. */
  maxFrames: number;
  /** Progress denominator: the authored timeline's expected frame count,
   * already capped to `maxFrames` by the caller. Rounding at the schedule's
   * end can run `framesDone` one past this — display code clamps. */
  totalFrames: number;
  /** Run one virtual frame's app logic at `nowMs` and resolve once the
   * generation it issued has landed on the scene (see the module header's
   * per-frame contract, step 1). */
  stepFrame(nowMs: number): Promise<void>;
  /** Whether the playback run still owns the stage — false once the player
   * reported done or a stop reached it. */
  running(): boolean;
  /** Paint the settled frame at `nowMs` to the canvas, forced past
   * render-on-demand. Must stay synchronous with the encode that follows. */
  renderFrame(nowMs: number): void;
  /** Encode the just-painted canvas as frame `index`; resolves once the
   * encoder accepted it (backpressure honored). A rejection aborts the
   * export — the caller catches. */
  encodeFrame(index: number): Promise<void>;
  /** After each captured frame: `framesDone` of `totalFrames`. */
  onProgress(framesDone: number, totalFrames: number): void;
  /** Yield to the event loop between frames so input/UI stay live. */
  yieldToUi(): Promise<void>;
}

export interface OfflineExportRun {
  /** Frames actually captured (0 when the run was over before frame 0). */
  frames: number;
  /** True when the loop hit `maxFrames` with the playback still running —
   * the clip was cut at the cap rather than ending naturally. */
  capped: boolean;
}

/**
 * Drive one offline export to its end (natural finish, external stop, or
 * the frame cap) and resolve with what happened. Never calls the encoder's
 * finalization — the caller flushes/muxes/downloads after this resolves,
 * and decides what a rejection (an `encodeFrame` failure) discards.
 */
export async function runOfflineExport(
  deps: OfflineExportDeps,
): Promise<OfflineExportRun> {
  let frames = 0;
  while (frames < deps.maxFrames && deps.running()) {
    const nowMs = deps.startMs + frames * deps.frameMs;
    await deps.stepFrame(nowMs);
    // The step is what learns the run ended (player `done`, a stop that
    // landed since the last frame) — a frame stepped after the end is
    // never captured.
    if (!deps.running()) break;
    deps.renderFrame(nowMs);
    await deps.encodeFrame(frames);
    frames++;
    deps.onProgress(frames, deps.totalFrames);
    await deps.yieldToUi();
  }
  return { frames, capped: frames >= deps.maxFrames && deps.running() };
}
