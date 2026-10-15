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
 *
 * Per-frame convergence cost is the renderer's own, and the three supported
 * modes span it: Surface re-traces a force frame, Flame re-accumulates, and
 * a non-flat Solid pays the heaviest commit in the app — one FULL VOXEL
 * REBUILD per frame (bounds re-pilot, grid reallocation, the whole iteration
 * budget, pack + hierarchy), because the pose is baked into the density
 * volume itself and no cheaper reuse exists: a 4D rotation's 3D projection
 * is a deformation, not a rigid motion of the previous volume. That is the
 * same per-frame re-render class the Flame tumble clip already ships, made
 * legible by the progress row and button, and cancellable at every frame.
 * A FLAT Solid's orbit clip is the opposite extreme: the volume is
 * world-space and the camera is a raymarcher uniform, so a frame is one
 * paint with no worker commit at all.
 */

/** Frame rate of the motion clip — the offline export's own constant, so
 * "30 fps" has one meaning on every machine. Also the rate slider's
 * session default (below). */
export const MOTION_EXPORT_FPS = 30;

/** The rate slider's domain — `resolveMotionExportFps`'s validation band,
 * so a slider-driven clip and a `?motionfps` override obey ONE bound. */
export const MOTION_CLIP_MIN_FPS = 1;
export const MOTION_CLIP_MAX_FPS = 60;

/**
 * `?motionfps=N` — a page-load override on the clip's frame rate, the
 * `?surfacemaxrays`-style escape hatch a VERIFICATION GATE uses to record a
 * 2-3 frame clip (a 2s authored duration at 1-2 fps) instead of paying
 * sixty-plus full re-renders. Anything outside 1..60 silently falls back —
 * to `fallback` (main.ts passes the session rate slider's value there, so
 * an absent or garbage override defers to the user's choice; the gate's
 * no-arg call keeps the shipped rate) — and the encoder, the driver's
 * frame clock and the frame budget all read the SAME resolved value, so a
 * gated clip's timing stays exactly authored (2s at 2fps = 4 frames of
 * 500ms each). The override WINS over the slider: a gate must not depend
 * on session state it cannot see.
 */
export function resolveMotionExportFps(
  raw: string | null,
  fallback: number = MOTION_EXPORT_FPS,
): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : fallback;
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
 * flame session's own `activeFlameNonFlat`, the solid session's
 * `activeSolidNonFlat`, the surface session's 4D-ness).
 *
 * - Points refuses: the realtime recorder already records it honestly — a
 *   points frame converges instantly, so a live capture IS a converged
 *   clip; the frame-exact machinery would buy nothing.
 * - Flame, Solid and Surface support both kinds: a 4D session records the
 *   tumble (rotor commits — flame re-accumulates at the new rotor, the
 *   solid worker rebuilds its whole volume, the surface compute spec
 *   re-reads `view4` per frame), a flat one records the auto-orbit
 *   turntable (flame through the `setProjection` camera restart, surface
 *   and solid through the camera being live at paint time — the solid
 *   volume is world-space, so its frame needs no commit at all).
 */
export function resolveMotionClip(
  mode: "points" | "flame" | "solid" | "surface",
  nonFlat: boolean,
): MotionClipPlan {
  if (mode === "points") {
    return {
      ok: false,
      reason:
        "Motion clips record a Flame, Solid or Surface render — enter one of those modes first",
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
 * Await one frame's completion across a `setFourDView`/`setProjection`
 * accumulation restart — the two-phase signal wait, shared by the Flame and
 * Solid arms (the surface arm's convergence is awaited inside its own trace
 * instead).
 *
 * WHY TWO PHASES: at the moment the driver commits frame i's pose, frame
 * i−1 is always complete (`renderComplete.flame`/`renderComplete.solid`
 * true) — and the worker's last pre-restart chunk can still be in flight,
 * reporting budget-met for the OLD accumulation AFTER the commit was posted
 * but BEFORE its `restarted` event lands. A single "wait until complete"
 * would consume that stale true. Phase 1 therefore waits for the restart to
 * zero the flag (a `restarted` event is emitted unconditionally by both
 * workers' `startAccumulation`, so a commit that changed anything always
 * produces one); phase 2 then waits for the NEW accumulation's budget-met.
 * The solid worker's `viewRevision` echo gives its stale events a second,
 * independent guard — the main thread drops any event bearing a superseded
 * revision — but the flag itself needs the same two phases either way.
 * Frame 0 entering mid-convergence is the safe special case: the flag starts
 * false, phase 1 exits immediately, and the discarded pre-commit
 * accumulation cannot reach budget — the first `true` phase 2 sees is this
 * frame's.
 *
 * `isStopped` is checked on every wake so a stop (Cancel, a resize, the
 * session exiting) can't hang on a flag that will never move again; the
 * waiter re-arms per wake exactly like the export-wait/Save-PNG signal
 * pattern it mirrors. Returns false when stopped, true when the frame is
 * complete.
 */
export async function waitForFrameRestart(
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
