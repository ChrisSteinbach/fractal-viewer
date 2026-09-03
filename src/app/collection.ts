/**
 * A user's saved-scene "collection" — a small, named library of ENCODED
 * scenes (`persist.ts`'s `encodeScene` wire strings) a user has explicitly
 * chosen to keep, distinct from the single current scene `persist.ts`
 * autosaves and from `history.ts`'s session-only undo stack. Backed by its
 * own localStorage key so saving a collection entry never disturbs the live
 * scene or its undo history.
 *
 * Entries are stored as already-ENCODED strings, never decoded: like
 * `history.ts`, this module treats `encoded` as an opaque, comparable value
 * and never imports `persist.ts` (or Three.js, or the DOM) to decode it. A
 * `thumbnail` data URL rides along so a gallery UI can render a saved entry
 * without re-running the chaos game.
 *
 * `CollectionDeps` injects storage — the same `Pick<Storage, "getItem" |
 * "setItem">` shape as `persist.ts`'s `PersistDeps` — and the clock, so both
 * persistence and timestamps are fully testable without a browser.
 */

import {
  sanitizeSampledSolidStatus,
  type SampledSolidStatus,
} from "./solid-render-status";

/**
 * The render mode a scene was SAVED from, when it wasn't the points explorer.
 * Absent means points — which also keeps every entry saved before
 * this field existed valid as-is. Deliberately a field on the collection ENTRY, never inside
 * `encoded`: the document (and with it share links, the autosave, and undo
 * history) stays render-mode-less under the unified render-mode model; only
 * the user's own gallery remembers how a keeper was meant to be displayed.
 */
export type SavedSceneMode = "flame" | "solid" | "surface";

/**
 * One saved scene in the collection. `encoded` is a `persist.ts`
 * `encodeScene` wire string (an opaque, immutable, comparable "v1=..."
 * string to this module — it never decodes it, just like `history.ts` never
 * decodes its entries). `thumbnail` is a small image data URL (may be `""`
 * if capture failed).
 */
export interface SavedScene {
  id: string;
  encoded: string;
  thumbnail: string;
  /** ms epoch, from the injected clock (see `CollectionDeps.now`). */
  createdAt: number;
  /** Display mode the scene was saved from; absent = the points explorer
   * (see {@link SavedSceneMode}). */
  mode?: SavedSceneMode;
  /** Optional sampled-Solid session snapshot at save time. Absent keeps old
   * entries and every non-Solid mode compatible. */
  solidStatus?: SampledSolidStatus;
}

/**
 * What a backup file hands to {@link SceneCollection.importScenes} — a
 * {@link SavedScene} minus its `id`. Ids are storage-internal,
 * minted per `SceneCollection` instance (see `counter` below); a backup
 * produced by a different session or device carries ids that mean nothing
 * here, so a merge always mints fresh ones rather than trusting the file's.
 */
export type ImportableScene = Omit<SavedScene, "id">;

/** localStorage key the collection is persisted under; distinct from
 * `persist.ts`'s own scene key so the two never collide. */
export const COLLECTION_STORAGE_KEY = "fractal-viewer:collection";

/** Cap on stored scenes; the oldest is evicted once a save pushes past it. */
export const COLLECTION_CAP = 60;

/**
 * Ceiling on one thumbnail's data-URL length, in characters, enforced on
 * EVERY path a thumbnail can enter the app from — the import file
 * (`scene-file.ts` re-exports this constant) and the collection's and
 * timeline's own localStorage loads, where a corrupt write, a manual edit,
 * or a hostile hand-edit could otherwise park an arbitrarily large string
 * in memory and under the gallery's `img.src`. The IMPORT in the name is
 * the path it was born on. Real captured thumbnails (see `scene.ts`'s
 * `captureThumbnail`) run roughly 10-20k characters.
 */
export const MAX_IMPORT_THUMBNAIL_CHARS = 256_000;

/** Injectable dependencies; both default to browser globals. */
export interface CollectionDeps {
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Clock for `createdAt`; defaults to `Date.now`. Injected for tests. */
  now?: () => number;
  /**
   * Called after a `persist()` whose storage write succeeded only after
   * evicting one or more entries to make room under a quota (see
   * `persist`'s quota-eviction retry). `count` is how many entries were
   * evicted for THIS write. Absent = eviction still happens, nobody is
   * told (today's behavior).
   */
  onEvicted?: (count: number) => void;
}

/**
 * Validate one untrusted parsed entry: a non-null object with the exact
 * `SavedScene` field shape. `localStorage` contents are just JSON text — a
 * corrupt write, a manual edit, or a future/older build's shape could put
 * anything there — so entries are checked individually and dropped rather
 * than rejecting the whole load, matching this module's never-throw
 * contract on untrusted input. The optional `mode` is NOT checked here —
 * a garbage value shouldn't cost the whole entry; `sanitizedMode` drops the
 * field alone instead, the same lenience `persist.ts` shows a malformed
 * camera pose.
 */
function isSavedScene(v: unknown): v is SavedScene {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.encoded === "string" &&
    typeof o.thumbnail === "string" &&
    Number.isFinite(o.createdAt)
  );
}

/** The entry's `mode` if it is a known {@link SavedSceneMode}, else
 * undefined (= points) — see `isSavedScene` on why this never rejects.
 * Exported for `timeline.ts`'s loader to reuse — the one
 * validator for a persisted `SavedSceneMode`. */
export function sanitizedMode(v: unknown): SavedSceneMode | undefined {
  return v === "flame" || v === "solid" || v === "surface" ? v : undefined;
}

/**
 * The ONE thumbnail validator, shared by every untrusted-input path a
 * thumbnail arrives on: `scene-file.ts`'s import files (which re-export
 * this helper and feed it every imported entry) and the collection's and
 * timeline's own localStorage loads (`loadScenes` here, `loadTimeline` in
 * `timeline.ts` — the same reuse pattern {@link sanitizedMode} established
 * for the persisted mode). Returns the value unchanged when it is a string
 * starting with `data:image/` and no longer than
 * {@link MAX_IMPORT_THUMBNAIL_CHARS}; anything else — a non-string, a
 * `http(s)`: URL, an over-long data URL — becomes `""`, the same degraded
 * cosmetic form the import path has always shown. Never throws.
 *
 * It lives HERE, not in `scene-file.ts`, because the storage layer cannot
 * import the file codec: `scene-file.ts` already imports this module (and
 * evaluates `10 * COLLECTION_CAP` at its top level), so the reverse import
 * would be a cycle that boots or crashes depending on which module the
 * entry graph reaches first — the same reason this module deliberately
 * imports neither `scene-file.ts` nor `persist.ts`. The `data:image/`
 * prefix requirement doubles as the safety net: it is what guarantees a
 * thumbnail string can never smuggle a non-image URL into the gallery's
 * `img.src`, whichever path carried it in.
 */
export function sanitizeThumbnailDataUrl(v: unknown): string {
  return typeof v === "string" &&
    v.startsWith("data:image/") &&
    v.length <= MAX_IMPORT_THUMBNAIL_CHARS
    ? v
    : "";
}

function sanitizedSolidStatusFields(
  mode: SavedSceneMode | undefined,
  value: unknown,
): { solidStatus?: SampledSolidStatus } {
  const status =
    mode === "solid" ? sanitizeSampledSolidStatus(value) : undefined;
  return status === undefined ? {} : { solidStatus: status };
}

/**
 * Load the saved list from `storage`, newest-first. Never throws: no
 * storage, a missing key, invalid JSON, or a non-array payload all yield an
 * empty list. Malformed entries are dropped individually (see
 * `isSavedScene`) rather than discarding a whole otherwise-valid list, and
 * the survivors are truncated to `COLLECTION_CAP` — sliced from the front,
 * since the list is stored newest-first. A survivor's `thumbnail` is
 * sanitized at decode time via `sanitizeThumbnailDataUrl` — a hostile or
 * corrupt stored value (anything not a `data:image/` string within the
 * length cap) degrades to `""` exactly as the import path's does, while
 * storage itself keeps whatever was written — so the gallery's `img.src`
 * never sees a non-image URL from this path.
 */
function loadScenes(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
): SavedScene[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(COLLECTION_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedScene)
      .slice(0, COLLECTION_CAP)
      .map((s) => ({
        id: s.id,
        encoded: s.encoded,
        thumbnail: sanitizeThumbnailDataUrl(s.thumbnail),
        createdAt: s.createdAt,
        mode: sanitizedMode(s.mode),
        ...sanitizedSolidStatusFields(
          sanitizedMode(s.mode),
          (s as SavedScene & { solidStatus?: unknown }).solidStatus,
        ),
      }));
  } catch {
    return [];
  }
}

/**
 * A user's saved-scene library, persisted to localStorage under
 * `COLLECTION_STORAGE_KEY`. The intended shape of use is a "save to
 * collection" UI action calling `add`, a gallery rendering `all`, and a
 * delete button calling `remove`.
 */
export class SceneCollection {
  private readonly storage?: Pick<Storage, "getItem" | "setItem">;
  private readonly now: () => number;
  private readonly onEvicted?: (count: number) => void;
  private scenes: SavedScene[];
  /** Disambiguates two saves in the same millisecond — see `add`'s id
   * generation. Scoped to this instance, not persisted. */
  private counter = 0;

  constructor(deps?: CollectionDeps) {
    this.storage = deps?.storage ?? safeLocalStorage();
    this.now = deps?.now ?? Date.now;
    this.onEvicted = deps?.onEvicted;
    this.scenes = loadScenes(this.storage);
  }

  /** Newest-first defensive copy of the saved scenes. */
  all(): SavedScene[] {
    return [...this.scenes];
  }

  get size(): number {
    return this.scenes.length;
  }

  /**
   * Save a scene. If an entry with the identical `encoded` already exists it
   * is removed first — a save "bumps" a duplicate to the front with a fresh
   * id, thumbnail, timestamp, and `mode` (a re-save from a different
   * renderer re-tags the keeper wholesale) rather than piling up copies. The
   * new entry is unshifted to the front (newest-first); if the collection
   * now exceeds `COLLECTION_CAP`, the oldest (last) entries are evicted.
   * Persists. `mode` is the renderer the save came from; omit for the
   * points explorer (see {@link SavedSceneMode}).
   */
  add(
    encoded: string,
    thumbnail: string,
    mode?: SavedSceneMode,
    solidStatus?: SampledSolidStatus,
  ): SavedScene {
    this.scenes = this.scenes.filter((s) => s.encoded !== encoded);
    const createdAt = this.now();
    const scene: SavedScene = {
      id: `${createdAt}-${this.counter++}`,
      encoded,
      thumbnail,
      createdAt,
      mode,
      ...(mode === "solid" && solidStatus ? { solidStatus } : {}),
    };
    this.scenes.unshift(scene);
    while (this.scenes.length > COLLECTION_CAP) this.scenes.pop();
    this.persist();
    return scene;
  }

  /**
   * Replace one entry's thumbnail, leaving everything else — `id`, `encoded`,
   * `createdAt`, `mode` — exactly as it was. The one field a save
   * can get wrong after the fact: a save taken during a flame/solid/surface
   * render's first-frame gap files a POINT-CLOUD picture under that render's
   * tag (the screen honestly still showed the explorer), and main.ts
   * re-photographs the entry once the render's own first frame lands — see
   * `thumbnail-patch.ts` for the correction and its invalidation rule.
   *
   * Deliberately narrower than {@link add}, which would re-bump the entry to
   * the front with a fresh id, timestamp and mode: a correction is not a new
   * save, and the gallery must not reshuffle under a user who is only waiting
   * for a render to start. Returns whether an entry with this id was found;
   * `false` — a deleted entry, or one a later save of the same document
   * already bumped away — is a no-op that does not persist.
   */
  setThumbnail(id: string, thumbnail: string): boolean {
    const scene = this.scenes.find((s) => s.id === id);
    if (!scene) return false;
    scene.thumbnail = thumbnail;
    this.persist();
    return true;
  }

  /** Remove the entry with this id (no-op if absent). Persists. */
  remove(id: string): void {
    this.scenes = this.scenes.filter((s) => s.id !== id);
    this.persist();
  }

  /**
   * Re-insert a previously removed entry — the undo side of {@link remove}:
   * a delete-confirmation toast's "Undo" action calls this with
   * the exact `SavedScene` `remove` took out, rather than re-deriving one —
   * there is nothing to re-derive `id`/`createdAt`/`mode` from once an entry
   * is gone. Reinserted at the position its OWN `createdAt` sorts to
   * (newest-first, matching every other read of this list), not unshifted
   * to the front, so an undo doesn't masquerade as a fresh save. A no-op if
   * an entry with this id is already present (a double-restore, or a fresh
   * save that raced the undo) rather than piling up a duplicate — the
   * dedupe key is `id` here, unlike `add`'s `encoded`, because this is
   * reinstating one specific known entry, not deciding whether a new save
   * collides with an old one. Subject to the same COLLECTION_CAP eviction
   * as `add`: restoring into an already-full collection can evict whatever
   * now sorts oldest, possibly the just-restored entry itself if nothing
   * present is older. Persists.
   */
  restore(entry: SavedScene): void {
    if (this.scenes.some((s) => s.id === entry.id)) return;
    const at = this.scenes.findIndex((s) => s.createdAt < entry.createdAt);
    if (at === -1) this.scenes.push(entry);
    else this.scenes.splice(at, 0, entry);
    while (this.scenes.length > COLLECTION_CAP) this.scenes.pop();
    this.persist();
  }

  /**
   * Merge a backup file's entries into the collection — the batch
   * counterpart to {@link add}/{@link restore}. Processes `entries` in the
   * given order:
   *
   *  - Skips an entry whose `encoded` matches one already present — the same
   *    dedupe key {@link add} uses — checked against the live list as it
   *    grows, so a duplicate WITHIN the batch is caught too, not just a
   *    repeat of what was already saved.
   *  - Otherwise mints an id (`${entry.createdAt}-${this.counter++}`, the
   *    same expression {@link add} uses), re-minting — same expression, so
   *    `counter` just keeps advancing — while it collides with any entry
   *    already present: a backup from a different session or device can
   *    carry a `createdAt` (and so a candidate id) that coincides with one
   *    already here, and gallery load/delete/{@link after} all key on `id`,
   *    so uniqueness has to be enforced rather than assumed.
   *  - Inserts at the position its OWN `createdAt` sorts to, newest-first —
   *    {@link restore}'s exact insertion rule (the first entry older than it,
   *    or the end when there is none) — so a merged backup interleaves
   *    chronologically with what's already here instead of stacking on top
   *    the way {@link add} does.
   *
   * Once every entry has been considered, the usual `COLLECTION_CAP`
   * eviction runs once, oldest (`pop()`) first, exactly like {@link add}/
   * {@link restore} — importing an old backup into an already-full
   * collection can insert entries this immediately evicts again. The return
   * value counts entries that actually SURVIVED eviction, not just
   * insertion: every minted id is tracked in a `Set`, popped ids are deleted
   * from it as eviction runs, and the set's final size is what's returned —
   * a caller reporting "imported N scenes" must not count ones that didn't
   * make it into the saved list.
   *
   * Persists at most once, at the very end, and only if at least one entry
   * was actually inserted (as opposed to every entry in the batch being
   * skipped as a duplicate) — a merge that added nothing must not touch
   * storage at all.
   *
   * `mode`/`thumbnail`/`createdAt` are stored exactly as given: this method
   * trusts its input. Validating untrusted file bytes into an
   * {@link ImportableScene}`[]` is `scene-file.ts`'s `decodeImportFile` job,
   * not this method's.
   */
  importScenes(entries: ImportableScene[]): number {
    const importedIds = new Set<string>();
    for (const entry of entries) {
      if (this.scenes.some((s) => s.encoded === entry.encoded)) continue;

      let id = `${entry.createdAt}-${this.counter++}`;
      while (this.scenes.some((s) => s.id === id)) {
        id = `${entry.createdAt}-${this.counter++}`;
      }

      const scene: SavedScene = { ...entry, id };
      const at = this.scenes.findIndex((s) => s.createdAt < entry.createdAt);
      if (at === -1) this.scenes.push(scene);
      else this.scenes.splice(at, 0, scene);
      importedIds.add(id);
    }

    if (importedIds.size === 0) return 0;

    while (this.scenes.length > COLLECTION_CAP) {
      const evicted = this.scenes.pop();
      if (evicted) importedIds.delete(evicted.id);
    }
    this.persist();
    return importedIds.size;
  }

  /**
   * The entry FOLLOWING the one with this id in gallery order (newest-first,
   * the order `all` returns and the gallery grid displays), wrapping past
   * the oldest back to the front — the collection-sourced drift show's loop
   * cursor. `null` for `id` asks for the front entry (a fresh
   * show's first departure); an id no longer present (deleted mid-show)
   * also yields the front entry, restarting the loop from the top rather
   * than guessing where the vanished entry used to sit. Returns `null` only
   * when the collection is empty.
   */
  after(id: string | null): SavedScene | null {
    if (this.scenes.length === 0) return null;
    if (id === null) return this.scenes[0];
    const at = this.scenes.findIndex((s) => s.id === id);
    if (at === -1) return this.scenes[0];
    return this.scenes[(at + 1) % this.scenes.length];
  }

  /**
   * Write the current list to storage. Only a QUOTA error (`isQuotaError` —
   * a full disk) is treated as recoverable: evicts the oldest entry
   * (`this.scenes.pop()`) and retries, continuing to evict-and-retry while
   * more than one entry remains and writes keep throwing quota errors. A
   * write that succeeds only after evicting reports how many entries
   * through `onEvicted` (absent dep = silent, matching the old behavior).
   *
   * Any OTHER error — storage disabled mid-session, a `SecurityError`, or a
   * quota error that still fails once evicted down to the one-entry floor —
   * is NOT recoverable by evicting further, so `this.scenes` is restored to
   * its snapshot from the top of this call and the write is abandoned.
   * Storage is left exactly as it last durably was. This is the opposite of
   * the old behavior, which kept evicting on ANY error and left the
   * truncated result in memory even after giving up: the NEXT successful
   * persist (from any caller — `add`/`remove`/`setThumbnail`/`restore`/
   * `importScenes`) would then overwrite storage's still-intact full list
   * with that truncated one, silently destroying user-authored content.
   * `timeline.ts`'s own persist swallows a failure the same way — in-memory
   * stays correct, nothing is corrected by shortening the list. A no-op
   * when no storage is available.
   */
  private persist(): void {
    if (!this.storage) return;
    const snapshot = [...this.scenes];
    let evictedCount = 0;
    for (;;) {
      try {
        this.storage.setItem(
          COLLECTION_STORAGE_KEY,
          JSON.stringify(this.scenes),
        );
        if (evictedCount > 0) this.onEvicted?.(evictedCount);
        return;
      } catch (err) {
        if (!isQuotaError(err) || this.scenes.length <= 1) {
          this.scenes = snapshot;
          return;
        }
        this.scenes.pop();
        evictedCount++;
      }
    }
  }
}

/** localStorage access throws in some private-browsing / sandboxed contexts,
 * and there is no `window` at all outside a browser. */
function safeLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** True for a storage-quota write failure — `persist`'s signal that
 * evict-and-retry can plausibly help, unlike any other write error (which
 * evicting the list does nothing to fix). Modern browsers throw a
 * `DOMException` named `QuotaExceededError`; legacy Safari sets the numeric
 * legacy `code` 22 instead. */
function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.code === 22)
  );
}
