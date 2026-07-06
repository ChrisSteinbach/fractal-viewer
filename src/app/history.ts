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
 * graph a `SceneSnapshot` happens to retain). No DOM, no app-module imports —
 * plain strings in, plain strings out — so this is unit-tested with no
 * browser, like the rest of `src/fractal/`.
 */

/** One step in either stack. */
export interface HistoryEntry {
  /** Encoded scene (encodeScene output) captured before an edit burst. */
  snapshot: string;
  /** True when the edit adjacent to this entry (toward the state that replaced
   * it) was a whole-system replacement (preset load / Surprise Me). The flag
   * travels with that transition between the stacks, so undo/redo can decide
   * whether to re-frame the camera when crossing it in either direction. */
  replaced: boolean;
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
   * Record the pre-edit state at the leading edge of an edit burst. If the
   * top entry already has this exact snapshot, a burst ended right back where
   * it started — replace its flag rather than pushing a duplicate step, so
   * undo never has to walk through a no-op. Otherwise push, evicting the
   * oldest entry once past the cap. Any checkpoint clears the redo stack —
   * the redone-past-this-point future no longer exists once a new edit
   * branches off.
   */
  checkpoint(snapshot: string, replaced: boolean): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.snapshot === snapshot) {
      top.replaced = replaced;
    } else {
      this.undoStack.push({ snapshot, replaced });
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
   * `replaced` flag (so redo can later restore the correct transition kind),
   * and returns the popped entry. Null when nothing is left to undo.
   */
  undo(current: string): HistoryEntry | null {
    while (
      this.undoStack.length > 0 &&
      this.undoStack[this.undoStack.length - 1].snapshot === current
    ) {
      this.undoStack.pop();
    }
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ snapshot: current, replaced: entry.replaced });
    return entry;
  }

  /**
   * Step forward: the mirror of `undo`. Pops the redo top, pushes `current`
   * back onto the undo stack tagged with that entry's `replaced` flag
   * (evicting past the cap, same as `checkpoint`), and returns the popped
   * entry. Null when nothing is left to redo.
   */
  redo(current: string): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ snapshot: current, replaced: entry.replaced });
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    return entry;
  }
}
