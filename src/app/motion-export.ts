/**
 * The motion-clip export's pure plan: what automatic view motion a live
 * render session has, how many frames an authored clip is, and how one
 * frame's completion is awaited — everything the driver in main.ts needs
 * that can be decided or tested without a browser, the same discipline
 * `offline-export.ts` (the loop) and `export-progress.ts` (the modal
 * policy) follow one layer out.
 *
 * The clip itself is `runOfflineExport` driven with a different motion
 * source: instead of a timeline player's legs, each frame advances the
 * session's ONE automatic motion — the 4D rotor tumble in a non-flat
 * session, the 3D auto-orbit turntable in a flat one — commits the pose to
 * the active renderer, awaits that frame's FULL convergence, paints, and
 * encodes. Not the realtime capture (`recorder.ts`): its timing is whatever
 * the event loop delivered, and a motion clip's whole point is that each
 * frame is fully converged at its own pose.
 */

/** Frame rate of the motion clip — the offline export's own constant, so
 * "30 fps" has one meaning on every machine. */
export const MOTION_EXPORT_FPS = 30;

/**
 * `?motionfps=N` — a page-load override on the clip's frame rate, the
 * `?surfacemaxrays`-style escape hatch a VERIFICATION GATE uses to record a
 * 2-3 frame clip (a 2s authored duration at 1-2 fps) instead of paying
 * sixty-plus full re-renders. Users never see it: anything outside 1..60
 * silently falls back to the shipped rate, and the encoder, the driver's
 * frame clock and the frame budget all read the SAME resolved value, so a
 * gated clip's timing stays exactly authored (2s at 2fps = 4 frames of
 * 500ms each).
 */
export function resolveMotionExportFps(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : MOTION_EXPORT_FPS;
}

/** Authored clip length bounds, in seconds. The default is long enough for
 * the tumble's ~48 s xy revolution to read as motion, short enough that a
 * frame-expensive session (a full flame re-accumulation or surface re-trace
 * per frame) doesn't silently commit to hours; the hard
 * `MAX_RECORDING_SECONDS` cap still applies on top via the frame budget. */
export const MOTION_CLIP_MIN_SECONDS = 2;
export const MOTION_CLIP_MAX_SECONDS = 60;
export const MOTION_CLIP_DEFAULT_SECONDS = 8;

/** The automatic motion a supported session can record. */
export type MotionKind = "tumble" | "orbit";

export type MotionClipPlan =
  { ok: true; kind: MotionKind } | { ok: false; reason: string };

/**
 * Which motion the session in `mode` can record, and which refusal to
 * disclose when none. `nonFlat` is the active session's dimension (the
 * flame session's own `activeFlameNonFlat`, the surface session's 4D-ness).
 *
 * - Points refuses: the realtime recorder already records it honestly — a
 *   points frame converges instantly, so a live capture IS a converged
 *   clip; the frame-exact machinery would buy nothing.
 * - Solid refuses (for now): a 4D pose commit is a full voxel rebuild per
 *   frame — its own cost question — and a flat solid's live orbit is
 *   already honestly recordable by the realtime capture.
 * - Flame and Surface support both kinds: a 4D session records the tumble
 *   (rotor commits — flame re-accumulates at the new rotor, the surface
 *   compute spec re-reads `view4` per frame), a flat one records the
 *   auto-orbit turntable (flame through the `setProjection` camera restart,
 *   surface through the camera living in the force-frame spec).
 */
export function resolveMotionClip(
  mode: "points" | "flame" | "solid" | "surface",
  nonFlat: boolean,
): MotionClipPlan {
  if (mode === "points") {
    return {
      ok: false,
      reason:
        "Motion clips record a Flame or Surface render — enter one of those modes first",
    };
  }
  if (mode === "solid") {
    return {
      ok: false,
      reason: "Solid motion clips aren't supported yet",
    };
  }
  return { ok: true, kind: nonFlat ? "tumble" : "orbit" };
}

/** Frames an authored clip is: duration × fps, capped to the recorder-parity
 * frame budget. A non-finite/underflow-safe plan — the slider's domain
 * already keeps duration inside bounds, this is the driver's arithmetic. */
export function motionClipFrameCount(
  durationS: number,
  fps: number,
  maxFrames: number,
): number {
  const frames = Math.ceil(Math.max(0, durationS) * fps);
  return Math.max(0, Math.min(frames, maxFrames));
}

/**
 * Await one flame frame's completion across a `setFourDView`/`setProjection`
 * accumulation restart — the two-phase signal wait.
 *
 * WHY TWO PHASES: at the moment the driver commits frame i's pose, frame
 * i−1 is always complete (`renderComplete.flame` true) — and the worker's
 * last pre-restart chunk can still be in flight, reporting budget-met for
 * the OLD accumulation AFTER the commit was posted but BEFORE its
 * `restarted` event lands. A single "wait until complete" would consume
 * that stale true. Phase 1 therefore waits for the restart to zero the flag
 * (a `restarted` event is emitted unconditionally by `startAccumulation`,
 * so a commit that changed anything always produces one); phase 2 then
 * waits for the NEW accumulation's budget-met. Frame 0 entering
 * mid-convergence is the safe special case: the flag starts false, phase 1
 * exits immediately, and the discarded pre-commit accumulation cannot reach
 * budget — the first `true` phase 2 sees is this frame's.
 *
 * `isStopped` is checked on every wake so a stop (Cancel, a resize, the
 * session exiting) can't hang on a flag that will never move again; the
 * waiter re-arms per wake exactly like the export-wait/Save-PNG signal
 * pattern it mirrors. Returns false when stopped, true when the frame is
 * complete.
 */
export async function waitForFlameFrame(
  isComplete: () => boolean,
  nextSignal: () => Promise<void>,
  isStopped: () => boolean,
): Promise<boolean> {
  // Phase 1: the restart landed. Skipped entirely when the flag is already
  // false at entry (frame 0's mid-convergence session).
  while (isComplete()) {
    if (isStopped()) return false;
    await nextSignal();
  }
  // Phase 2: the new frame's accumulation met its budget.
  while (!isComplete()) {
    if (isStopped()) return false;
    await nextSignal();
  }
  return true;
}
