/**
 * Session-only undo/redo stacks over ENCODED scene snapshots (`persist.ts`'s
 * `encodeScene` wire strings).
 *
 * Undo time-travels exactly the persistent subset `persist.ts` serializes —
 * transforms, render settings, symmetry, and so on (see `SceneSnapshot`).
 * View state (camera orbit, 4D tumble/slice, the current selection) stays
 * live: none of it is part of the document a user is editing, so stepping
 * through history must never yank the camera around or collapse a selection
 * the user still has open.
 *
 * Entries are stored as already-ENCODED strings rather than `SceneSnapshot`
 * objects: they are immutable (nothing can reach back into history and mutate
 * a past entry), cheap to compare for the dedupe check in `checkpoint` (`===`
 * on a string instead of a deep equality over nested transforms), and bounded
 * in memory (a string's size is exactly its wire size, not whatever object
 * graph a `SceneSnapshot` happens to retain).
 *
 * Each entry ALSO carries an out-of-band camera pose (fr-uf3, see
 * {@link HistoryEntry.pose}) alongside — but deliberately NOT inside — its
 * snapshot string, so undo/redo across a whole-system replace can restore the
 * exact pre-replace framing while the `===` dedup keeps comparing only the
 * camera-less string. The pose is a type-only import ({@link CameraPose} from
 * the pure `orbit.ts`), so this stays free of any DOM or runtime app-module
 * dependency and is unit-tested with no browser, like the rest of
 * `src/fractal/`.
 */
import type { CameraPose } from "./orbit";

/** One step in either stack. */
export interface HistoryEntry {
  /** Encoded scene (encodeScene output) captured before an edit burst. */
  snapshot: string;
  /** True when the edit adjacent to this entry (toward the state that replaced
   * it) was a whole-system replacement (preset load / Surprise Me). The flag
   * travels with that transition between the stacks, so undo/redo can decide
   * whether to re-frame the camera when crossing it in either direction. */
  replaced: boolean;
  /**
   * The orbit-camera pose the state {@link snapshot} was viewed WITH, captured
   * out of band when this entry was pushed (fr-uf3): at a `checkpoint` it is
   * the framing of the pre-edit state; on an undo/redo push it is the framing
   * the state being parked was just left with. Undo/redo restores it when it
   * lands on this entry across a `replaced` transition, instead of auto-fitting
   * the restored attractor — so undoing a preset/gallery load returns to the
   * exact pre-load framing. Deliberately NOT folded into {@link snapshot}: the
   * encoded string stays camera-less so `checkpoint`'s `===` dedup survives
   * camera drift (see `persist.ts`'s `SceneSnapshot.camera` doc). Optional
   * because a caller may push a step with no pose (tests, or a future
   * non-camera caller); a `replaced` step with no pose falls back to
   * auto-fitting the restored attractor. Ignored entirely for non-`replaced` (tweak) steps,
   * which leave the live camera alone. */
  pose?: CameraPose;
}

/**
 * Cap on stack depth. Bounds memory for a long session without limiting
 * ordinary back-and-forth: each entry is a short encoded string (see the
 * module doc), so even a full 100 entries is negligible next to the
 * chaos-game buffers already resident.
 */
export const HISTORY_CAP = 100;

/**
 * Undo/redo over encoded scene snapshots. `main.ts` is the only caller: it
 * checkpoints the pre-edit state at the leading edge of an edit burst (see
 * its `beginSceneEdit`) and steps the stacks on Ctrl+Z / Ctrl+Shift+Z.
 */
export class SceneHistory {
  private readonly cap: number;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(cap: number = HISTORY_CAP) {
    this.cap = cap;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Record the pre-edit state at the leading edge of an edit burst, tagged
   * with the current live camera `pose` (fr-uf3) so undo can later return to
   * this exact framing across a replace. If the top entry already has this
   * exact snapshot, a burst ended right back where it started — refresh its
   * flag AND pose rather than pushing a duplicate step, so undo never has to
   * walk through a no-op and the parked framing stays the freshest one. Otherwise
   * push, evicting the oldest entry once past the cap. Any checkpoint clears
   * the redo stack — the redone-past-this-point future no longer exists once a
   * new edit branches off.
   */
  checkpoint(snapshot: string, replaced: boolean, pose?: CameraPose): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.snapshot === snapshot) {
      top.replaced = replaced;
      top.pose = pose;
    } else {
      this.undoStack.push({ snapshot, replaced, pose });
      if (this.undoStack.length > this.cap) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Step back. First drops any top entries that already equal `current` —
   * no-op steps (e.g. a checkpointed burst that never actually changed
   * anything) that would otherwise waste an undo click restoring the state
   * the user is already looking at. Then pops the next (genuinely different)
   * entry, pushes `current` onto the redo stack tagged with that entry's own
   * `replaced` flag (so redo can later restore the correct transition kind)
   * and the current live `pose` (the framing `current` is being parked with,
   * so a later redo can restore it — fr-uf3), and returns the popped entry
   * (whose own pose the caller restores). Null when nothing is left to undo.
   */
  undo(current: string, pose?: CameraPose): HistoryEntry | null {
    while (
      this.undoStack.length > 0 &&
      this.undoStack[this.undoStack.length - 1].snapshot === current
    ) {
      this.undoStack.pop();
    }
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ snapshot: current, replaced: entry.replaced, pose });
    return entry;
  }

  /**
   * Step forward: the mirror of `undo`. Pops the redo top, pushes `current`
   * back onto the undo stack tagged with that entry's `replaced` flag and the
   * current live `pose` (the framing `current` is being parked with, so a
   * later undo can restore it — fr-uf3; evicting past the cap, same as
   * `checkpoint`), and returns the popped entry (whose own pose the caller
   * restores). Null when nothing is left to redo.
   */
  redo(current: string, pose?: CameraPose): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ snapshot: current, replaced: entry.replaced, pose });
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    return entry;
  }
}
