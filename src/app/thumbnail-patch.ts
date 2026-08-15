import type { SavedSceneMode } from "./collection";

/**
 * The bookkeeping behind fr-r777's LATE thumbnail correction.
 *
 * A ★ Save to collection / 📍 Add keyframe taken during a flame/solid/surface
 * render's first-frame gap files an entry TAGGED with that render mode
 * (`SavedScene.mode`/`TimelineStep.mode`, fr-75sq/fr-v3au) carrying a
 * POINT-CLOUD picture: main.ts's `captureCurrentThumbnail` falls through to
 * the explorer capture there, because during the gap the screen honestly
 * still shows the explorer. The entry itself is correct — it re-enters the
 * tracer on load — only its picture disagrees with its glyph.
 *
 * The fix cannot be the one fr-61a2 applied to Save-PNG, which WAITS for the
 * render behind the export modal: a thumbnail must be INSTANT. Blocking ★
 * Save to collection on a flame convergence would be far worse than a wrong
 * thumbnail, and the export modal is not available to a save — it is not an
 * export. So the save keeps its honest explorer picture, and this module
 * remembers WHICH entries to re-photograph once the render's own first frame
 * lands. A correction, never a wait.
 *
 * The load-bearing part is INVALIDATION. A saved entry froze a DOCUMENT, and
 * a correction is taken from the LIVE one — so it is the same picture only
 * while the live document still encodes, byte for byte, to the string the
 * entry holds AND the live render mode is still the one the entry was tagged
 * with. Everything else drops the patch and leaves the point-cloud thumbnail
 * where it is: an edit, a preset load, an undo, a CAMERA move (the pose rides
 * the document since fr-1k4, so an orbit really does mean a different
 * document — which is why a re-capture after one would be a picture of
 * something the entry does not hold), leaving the mode, or a session that
 * dies without ever producing a frame. A stale-but-honest picture of the
 * entry beats a sharp picture of something else.
 *
 * Pure, like the two stores it addresses: ids and `encoded` strings are
 * opaque comparable values here — this module never decodes one, the same
 * stance `collection.ts`, `timeline.ts` and `history.ts` take. main.ts owns
 * the stores, the capture, and the render sessions; the patches themselves
 * are session state and are deliberately never persisted (a reload
 * legitimately abandons them).
 */

/** Which store holds the entry a patch addresses — the two consumers of
 * `captureCurrentThumbnail`. */
export type ThumbnailPatchStore = "collection" | "timeline";

/** One entry saved during a render's first-frame gap, waiting to be
 * re-photographed. */
export interface PendingThumbnailPatch {
  store: ThumbnailPatchStore;
  /** `SavedScene.id` / `TimelineStep.id` — the entry the save produced. */
  id: string;
  /** The render mode the entry was TAGGED with, i.e. the session whose first
   * frame this patch waits for. */
  mode: SavedSceneMode;
  /** The `persist.ts` `encodeScene` string the entry FROZE — the invalidation
   * key (see the module doc). Opaque here. */
  encoded: string;
}

/**
 * How many corrections may be in flight at once. More than one entry can be
 * saved during a single startup gap (★ then 📍, or two ★ saves), so this is a
 * list rather than a slot — but the window is one render's startup gap, so a
 * long queue means something else is wrong, and the cost of dropping one is
 * only a thumbnail that stays stale-but-honest. The OLDEST goes first: the
 * newest save is the one the user is still looking at.
 */
export const PENDING_THUMBNAIL_PATCH_CAP = 8;

/** Append `patch`, bounded by {@link PENDING_THUMBNAIL_PATCH_CAP} (oldest
 * dropped first). Returns a new list; never mutates the input. */
export function recordThumbnailPatch(
  pending: readonly PendingThumbnailPatch[],
  patch: PendingThumbnailPatch,
): PendingThumbnailPatch[] {
  const next = [...pending, patch];
  return next.length > PENDING_THUMBNAIL_PATCH_CAP
    ? next.slice(next.length - PENDING_THUMBNAIL_PATCH_CAP)
    : next;
}

/**
 * Drop every patch whose render mode is no longer the live one — a mode exit,
 * or a session that ended without ever producing a frame. `liveMode` is
 * `null` for the points explorer, which drops all of them: the picture each
 * one waits for will never arrive now.
 */
export function dropStaleThumbnailPatches(
  pending: readonly PendingThumbnailPatch[],
  liveMode: SavedSceneMode | null,
): PendingThumbnailPatch[] {
  return pending.filter((patch) => patch.mode === liveMode);
}

/**
 * Split the pending patches at the moment `live.frameMode`'s session produces
 * its first frame: which may be corrected NOW, and which stay pending. The
 * invalidation rule of the module doc, in one place —
 *
 *  - a patch tagged with a mode that is no longer live is DROPPED (it appears
 *    in neither half): the user left the renderer the save was tagged with;
 *  - a patch still waiting on a DIFFERENT mode's session is kept;
 *  - a patch whose frozen `encoded` no longer matches the live document is
 *    DROPPED: re-capturing would file a picture of something the entry does
 *    not hold;
 *  - everything left is applied.
 *
 * Every surviving patch matched `live.encoded` and `live.frameMode`, so one
 * capture serves the whole `apply` list.
 */
export function resolveThumbnailPatches(
  pending: readonly PendingThumbnailPatch[],
  live: {
    /** The mode whose session just produced its first frame. */
    frameMode: SavedSceneMode;
    /** The live render mode; `null` = the points explorer. */
    mode: SavedSceneMode | null;
    /** The live document's `encodeScene` string. */
    encoded: string;
  },
): { apply: PendingThumbnailPatch[]; keep: PendingThumbnailPatch[] } {
  const apply: PendingThumbnailPatch[] = [];
  const keep: PendingThumbnailPatch[] = [];
  for (const patch of pending) {
    if (patch.mode !== live.mode) continue;
    if (patch.mode !== live.frameMode) keep.push(patch);
    else if (patch.encoded === live.encoded) apply.push(patch);
  }
  return { apply, keep };
}
