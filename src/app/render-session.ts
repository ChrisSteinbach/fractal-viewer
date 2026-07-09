/**
 * The enter / exit / terminate + first-frame-gate choreography shared by
 * main.ts's two render controllers — the flame render (fr-o7s) and the
 * solid voxel render (fr-v4f). Both are session-only overlays OF the explorer:
 * a Render click freezes (flame) or accumulates a world-space volume over
 * (solid) the current system in a fresh worker, and the app returns to the
 * live explorer on Back, on a render error, or on an undo/redo that
 * time-travels the document.
 *
 * The two controllers were near-twins — the solid one's comment literally said
 * it "mirrors the flame session above exactly". Both share: the enter/exit
 * ordering; a defensive "double-entry" terminate guarding against a leaked
 * worker; the first-frame gate (main.ts's animate() keeps showing the
 * frozen/live explorer until the session's first image/grid lands, avoiding a
 * flash of the render canvas's blank-or-stale contents during the worker
 * startup gap); and the error->exit fallback. They differ only in their
 * GENUINE specifics — the flame render freezes the camera and owns a
 * SharedArrayBuffer transport; the solid render keeps the camera
 * live and drops the transform selection (its lens has no guide box, so pointer
 * gestures should orbit instead of dragging a box that is no longer shown).
 * This class owns the shared skeleton; every genuine difference is injected via
 * {@link RenderSessionDeps}.
 *
 * No DOM, no Three.js, no worker globals: the handle is any
 * `{ post, terminate }` (a real Worker wrapped in one), and every side effect
 * is injected — so the choreography is unit-tested with fakes the same way
 * `EditSession` and `FourDView` are, no browser required.
 */

/**
 * A running render session, reduced to the two operations this controller
 * needs after the mode-specific `start` hands one back: forward a command to
 * it, and tear it down. main.ts's flame path wraps the flame Worker in one;
 * its solid path wraps the voxel Worker's `postMessage`/`terminate` in one.
 * `C` is the mode's worker command type (`FlameWorkerCommand` /
 * `VoxelWorkerCommand`).
 */
export interface RenderSessionHandle<C> {
  post(command: C): void;
  terminate(): void;
}

/**
 * The genuine per-mode differences, injected so {@link RenderSession} owns only
 * the shared choreography.
 */
export interface RenderSessionDeps<C> {
  /**
   * Spin up the session and post its `start` command, returning the handle to
   * post to / tear down later. Runs AFTER {@link RenderSession.enter} has
   * cleared the previous render's notes + progress and reset the first-frame
   * gate, so it only has to build and kick off. The flame path decides its
   * WebGPU host + SharedArrayBuffer transport here; the solid path creates the
   * voxel worker and wires its message/error handlers. It posts its own `start`
   * via the freshly-created handle, NOT via {@link RenderSession.post} —
   * `enter` only stores the returned handle afterwards, so `post` can't reach
   * the new session yet.
   */
  start: () => RenderSessionHandle<C>;
  /**
   * Clear this mode's UI render notes (flame: supersample + backend; solid:
   * resolution) so a previous render's note can't linger and mislabel this one.
   * Runs on BOTH enter (before the fresh session reports its own) and exit
   * (back to the explorer).
   */
  clearNotes: () => void;
  /**
   * Reset the progress label to 0 / budget so a previous render's "100%"
   * doesn't stick until the first progress event lands. Enter only — the
   * explorer hides the label, so exit needn't touch it.
   */
  resetProgress: () => void;
  /**
   * Flip the app's active flag ON, run any enter-only extras, and refresh the
   * UI. Flame just flips `setFlameActive`; solid additionally drops the
   * transform selection and refreshes guides before refreshing the UI.
   */
  activate: () => void;
  /**
   * Flip the app's active flag OFF, run any exit-only extras, and refresh the
   * UI. Flame additionally drops its half of the SharedArrayBuffer transport
   * (with the worker's half gone too, the SABs become collectable); solid just
   * flips `setSolidActive`.
   */
  deactivate: () => void;
}

/**
 * The enter/exit/terminate + first-frame-gate state machine shared by main.ts's
 * flame and solid render controllers. main.ts constructs one per mode with the
 * mode's {@link RenderSessionDeps}, calls {@link enter}/{@link exit} from the
 * Render/Back buttons (and `exit` from the worker error handlers and
 * undo/redo), calls {@link markFirstFrame} from the session's first-frame
 * event, and reads {@link hasFirstFrame} + {@link post}s live tone-map/param
 * commands from the animate loop and control handlers.
 */
export class RenderSession<C> {
  private handle: RenderSessionHandle<C> | null = null;
  private firstFrame = false;

  constructor(private readonly deps: RenderSessionDeps<C>) {}

  /**
   * True once the CURRENT session's first frame — a flame image / a solid grid
   * — has arrived. main.ts's animate() reads this to keep drawing the frozen
   * (flame) or live (solid) explorer during the worker's startup gap instead of
   * flashing the render canvas's blank-or-stale contents. Reset to false by
   * every {@link enter}/{@link exit}, so a stray frame can't leak across
   * sessions.
   */
  get hasFirstFrame(): boolean {
    return this.firstFrame;
  }

  /** Record that the current session's first frame has arrived — called from
   * the mode's worker-event handler on the first "progress"/"sharedFrame"
   * (flame) or "grid" (solid) event. */
  markFirstFrame(): void {
    this.firstFrame = true;
  }

  /** Forward a command to the running session, or a no-op when none is running.
   * Used for live tone-map / render-param changes after {@link enter}; the
   * `start` command itself is posted inside {@link RenderSessionDeps.start}. */
  post(command: C): void {
    this.handle?.post(command);
  }

  /**
   * Start a fresh render. Defensively terminates any session still running (a
   * theoretical double-entry would otherwise leak a worker/host), clears the
   * previous render's UI notes + progress, resets the first-frame gate, then
   * starts the new session and flips the app into this mode.
   */
  enter(): void {
    this.handle?.terminate();
    this.deps.clearNotes();
    this.deps.resetProgress();
    this.firstFrame = false;
    this.handle = this.deps.start();
    this.deps.activate();
  }

  /**
   * Discard the in-progress render and return to the explorer. Terminates the
   * session outright rather than winding it down — an in-flight accumulate
   * chunk can't be interrupted mid-call anyway (a worker is single-threaded
   * JS too), and the next {@link enter} spins up a fresh session regardless. Idempotent: calling
   * `exit` with nothing running just clears notes and re-flips the
   * already-off flag, which is how main.ts's undo/redo can call it
   * unconditionally.
   */
  exit(): void {
    this.handle?.terminate();
    this.handle = null;
    this.firstFrame = false;
    this.deps.clearNotes();
    this.deps.deactivate();
  }
}
