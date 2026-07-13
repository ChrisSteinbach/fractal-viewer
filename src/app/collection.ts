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

/**
 * The render mode a scene was SAVED from, when it wasn't the points explorer
 * (fr-75sq). Absent means points — which also keeps every pre-fr-75sq entry
 * valid as-is. Deliberately a field on the collection ENTRY, never inside
 * `encoded`: the document (and with it share links, the autosave, and undo
 * history) stays render-mode-less per fr-39y; only the user's own gallery
 * remembers how a keeper was meant to be displayed.
 */
export type SavedSceneMode = "flame" | "solid";

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
}

/** localStorage key the collection is persisted under; distinct from
 * `persist.ts`'s own scene key so the two never collide. */
export const COLLECTION_STORAGE_KEY = "fractal-viewer:collection";

/** Cap on stored scenes; the oldest is evicted once a save pushes past it. */
export const COLLECTION_CAP = 60;

/** Injectable dependencies; both default to browser globals. */
export interface CollectionDeps {
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Clock for `createdAt`; defaults to `Date.now`. Injected for tests. */
  now?: () => number;
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
 * undefined (= points) — see `isSavedScene` on why this never rejects. */
function sanitizedMode(v: unknown): SavedSceneMode | undefined {
  return v === "flame" || v === "solid" ? v : undefined;
}

/**
 * Load the saved list from `storage`, newest-first. Never throws: no
 * storage, a missing key, invalid JSON, or a non-array payload all yield an
 * empty list. Malformed entries are dropped individually (see
 * `isSavedScene`) rather than discarding a whole otherwise-valid list, and
 * the survivors are truncated to `COLLECTION_CAP` — sliced from the front,
 * since the list is stored newest-first.
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
        thumbnail: s.thumbnail,
        createdAt: s.createdAt,
        mode: sanitizedMode(s.mode),
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
  private scenes: SavedScene[];
  /** Disambiguates two saves in the same millisecond — see `add`'s id
   * generation. Scoped to this instance, not persisted. */
  private counter = 0;

  constructor(deps?: CollectionDeps) {
    this.storage = deps?.storage ?? safeLocalStorage();
    this.now = deps?.now ?? Date.now;
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
  add(encoded: string, thumbnail: string, mode?: SavedSceneMode): SavedScene {
    this.scenes = this.scenes.filter((s) => s.encoded !== encoded);
    const createdAt = this.now();
    const scene: SavedScene = {
      id: `${createdAt}-${this.counter++}`,
      encoded,
      thumbnail,
      createdAt,
      mode,
    };
    this.scenes.unshift(scene);
    while (this.scenes.length > COLLECTION_CAP) this.scenes.pop();
    this.persist();
    return scene;
  }

  /** Remove the entry with this id (no-op if absent). Persists. */
  remove(id: string): void {
    this.scenes = this.scenes.filter((s) => s.id !== id);
    this.persist();
  }

  /**
   * The entry FOLLOWING the one with this id in gallery order (newest-first,
   * the order `all` returns and the gallery grid displays), wrapping past
   * the oldest back to the front — the collection-sourced drift show's loop
   * cursor (fr-w2ve). `null` for `id` asks for the front entry (a fresh
   * show's first departure); an id no longer present (deleted mid-show)
   * also yields the front entry, restarting the loop from the top rather
   * than guessing where the vanished entry used to sit. Returns `null` only
   * when the collection is empty.
   */
  after(id: string | null): SavedScene | null {
    if (this.scenes.length === 0) return null;
    if (id === null) return this.scenes[0];
    const at = this.scenes.findIndex((s) => s.id === id);
    return this.scenes[(at + 1) % this.scenes.length];
  }

  /**
   * Write the current list to storage. On a thrown error (e.g. a
   * `QuotaExceededError` from a full disk), evicts the oldest entry
   * (`this.scenes.pop()`) and retries, continuing to evict-and-retry while
   * more than one entry remains and writes keep throwing. A final failure is
   * swallowed silently — the in-memory list stays correct for the rest of
   * the session, just not durable. A no-op when no storage is available.
   */
  private persist(): void {
    if (!this.storage) return;
    let saved = false;
    do {
      try {
        this.storage.setItem(
          COLLECTION_STORAGE_KEY,
          JSON.stringify(this.scenes),
        );
        saved = true;
      } catch {
        if (this.scenes.length <= 1) return;
        this.scenes.pop();
      }
    } while (!saved);
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
