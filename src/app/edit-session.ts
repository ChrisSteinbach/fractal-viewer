/**
 * The edit-burst / debounced-save / undo-redo choreography, layered over
 * `SceneHistory`'s session-only undo/redo stacks (see `history.ts`).
 *
 * The app persists the scene document `SAVE_DEBOUNCE_MS` after the last edit
 * — a debounce that ALSO defines "one edit burst" for undo coalescing: a
 * slider drag fires many edits in quick succession, but they must collapse
 * into a SINGLE undo step, not one per tick. So a checkpoint is cut only on
 * the LEADING edge of a burst (the first edit while no burst is open);
 * subsequent edits in the same burst just re-arm the debounce. When the
 * debounce finally fires (or a flush happens), it persists the document AND
 * closes the burst, so the next edit opens a fresh one.
 *
 * A whole-system replacement (preset load / Surprise Me) is the one
 * exception: it must cut its own fresh checkpoint even in the middle of an
 * open burst, and tag that history transition as `replaced` so undo/redo can
 * re-frame the camera when crossing it (see `HistoryEntry.replaced`). Since
 * fr-uf3 that re-framing restores the EXACT pre-replace pose, captured out of
 * band at each checkpoint/undo/redo push via `EditSessionDeps.pose` and parked
 * on `HistoryEntry.pose`, rather than a fresh auto-fit of the restored system.
 *
 * Undo/redo settle an in-progress burst first — flushing it so the
 * half-finished edit becomes its own undo step instead of being silently
 * lost, mirroring the page-hide flush contract — then step the stack and
 * restore. Restoring a snapshot is never itself an edit: it must not cut a
 * checkpoint, but the restored document DOES still need persisting, which is
 * why `EditSessionDeps.restore` is forbidden from persisting or checkpointing
 * on its own — `undo`/`redo` arm that bare debounced save themselves once
 * `restore` returns.
 *
 * No DOM, no `main.ts`, no Three.js: every side effect (reading/persisting
 * the scene document, applying a restored snapshot, reflecting undo/redo
 * availability in the UI, and the debounce timer itself) is injected via
 * `EditSessionDeps`, so this policy is unit-tested with a fake clock and no
 * browser — like the rest of `src/app/history.ts` and `src/fractal/`.
 */
import { SceneHistory } from "./history";
import type { CameraPose } from "./orbit";

/** The debounce window: the delay after the last edit before the scene is
 * persisted, which also defines "one edit burst" for undo coalescing. */
export const SAVE_DEBOUNCE_MS = 300;

/**
 * Everything EditSession needs from the app, injected so the burst/undo/save
 * policy is unit-testable without persist.ts, the DOM, or a real clock.
 */
export interface EditSessionDeps {
  /** Encode the CURRENT scene document to its history-entry string
   * (encodeScene(toSnapshot(state)) in the app). Read on the leading edge of a
   * burst and when stepping the undo/redo stacks. */
  snapshot: () => string;
  /** Persist the CURRENT scene document (saveScene(toSnapshot(state)) in the
   * app). Called on the debounce's trailing edge and on flush(). */
  persist: () => void;
  /** Apply a history snapshot back to the app: decode it, swap it into state,
   * and refresh scene + ui. MUST NOT cut a checkpoint (EditSession guarantees
   * restore never opens a burst — it handles the resulting bare save itself).
   * `pose` (fr-uf3) is the framing captured with the restored entry: the app
   * restores it across a `replaced` step (instead of auto-fitting) and ignores
   * it for a tweak step (which leaves the camera alone). */
  restore: (snapshot: string, replaced: boolean, pose?: CameraPose) => void;
  /** Reflect undo/redo availability in the UI (ui.setUndoRedo in the app). */
  syncUi: (canUndo: boolean, canRedo: boolean) => void;
  /** Read the CURRENT live orbit-camera pose (cameraPose() in the app),
   * captured out of band onto each history entry (fr-uf3) at every checkpoint
   * and at each undo/redo's park of the state being left — so undo/redo across
   * a whole-system replace restores the exact framing instead of refitting.
   * Never encoded into the snapshot string (that would defeat history.ts's
   * `===` dedup); see `HistoryEntry.pose`. */
  pose: () => CameraPose;
  /** Arm the debounced save: run `fn` after SAVE_DEBOUNCE_MS, returning a
   * canceler that unschedules it if called before it fires. In the app:
   * `const id = setTimeout(fn, SAVE_DEBOUNCE_MS); return () => clearTimeout(id);`
   * Injected (not a bare setTimeout) so tests drive the debounce deterministically. */
  schedule: (fn: () => void) => () => void;
}

/**
 * The edit-burst / debounced-save / undo-redo state machine, layered over
 * SceneHistory. main.ts's edit handlers call beginEdit() before mutating the
 * scene document; the page-hide handlers call flush(); Ctrl+Z / Ctrl+Shift+Z
 * call undo()/redo().
 */
export class EditSession {
  /** True while the CURRENT edit burst already has a checkpoint — see the
   * module doc's burst-coalescing rationale. Closed by the debounce's
   * trailing edge or by flush(); reopened by the next beginEdit(). */
  private burstOpen = false;
  /** Cancels the pending debounced save, or null when none is armed. */
  private cancel: (() => void) | null = null;

  /** `history` defaults to a fresh SceneHistory; injectable for tests that want
   * to pre-seed or inspect it (not required — the documented behavior is all
   * observable through this class's own surface). */
  constructor(
    private readonly deps: EditSessionDeps,
    private readonly history: SceneHistory = new SceneHistory(),
  ) {}

  /**
   * Bookkeeping for a scene-document edit ABOUT to happen — call BEFORE the
   * state mutation. On a burst's leading edge (or always, for a "replace")
   * cut an undo checkpoint of the PRE-edit state; then (re-)arm the debounced
   * save. "replace" (preset load / Surprise Me) cuts a fresh checkpoint even
   * mid-burst and tags the transition so undo/redo re-frames the camera.
   */
  beginEdit(kind: "tweak" | "replace" = "tweak"): void {
    if (!this.burstOpen || kind === "replace") {
      this.history.checkpoint(
        this.deps.snapshot(),
        kind === "replace",
        this.deps.pose(),
      );
      this.burstOpen = true;
      this.syncUi();
    }
    this.scheduleSave();
  }

  /** Flush any pending debounced save immediately and close the burst (page
   * hide / pagehide, and internally before an undo/redo steps behind an open
   * burst). Persists the current document without cutting a checkpoint. */
  flush(): void {
    this.cancel?.();
    this.cancel = null;
    this.deps.persist();
    this.burstOpen = false;
  }

  /** Step back one undo step. Settles an open burst first (so it becomes its
   * own step), then pops history and restores — restore never checkpoints; a
   * bare debounced save of the restored document is armed. */
  undo(): void {
    if (this.burstOpen) this.flush();
    const entry = this.history.undo(this.deps.snapshot(), this.deps.pose());
    if (entry) {
      this.deps.restore(entry.snapshot, entry.replaced, entry.pose);
      this.scheduleSave();
    }
    this.syncUi();
  }

  /** Step forward one redo step — the mirror of undo(). */
  redo(): void {
    if (this.burstOpen) this.flush();
    const entry = this.history.redo(this.deps.snapshot(), this.deps.pose());
    if (entry) {
      this.deps.restore(entry.snapshot, entry.replaced, entry.pose);
      this.scheduleSave();
    }
    this.syncUi();
  }

  /** Push current undo/redo availability to deps.syncUi. Called internally
   * after any stack change; exposed so main.ts can sync once at boot. */
  syncUi(): void {
    this.deps.syncUi(this.history.canUndo, this.history.canRedo);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** (Re-)arm the debounced save: cancel whatever was pending and schedule a
   * fresh one that persists the current document and closes the burst when
   * it fires. Called on every edit within a burst, so only the LAST edit's
   * timer ever actually fires — the essence of the debounce. */
  private scheduleSave(): void {
    this.cancel?.();
    this.cancel = this.deps.schedule(() => {
      this.cancel = null;
      this.deps.persist();
      this.burstOpen = false;
    });
  }
}
