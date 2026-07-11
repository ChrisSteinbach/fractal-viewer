/**
 * Viewer preferences — a tiny localStorage slice deliberately kept SEPARATE
 * from the scene document (persist.ts).
 *
 * `persist.ts`'s scene doc lives under `fractal-viewer:scene` in localStorage
 * AND in the `#`-hash share URL — anything that lands there travels with a
 * shared link. Viewer prefs must never do that (fr-0ya): a preference like
 * "I turned auto-motion off" belongs to the person sitting at this browser,
 * not to whoever opens a link they share. So this module keeps its own
 * localStorage key (`STORAGE_KEY` below) and never touches the URL, hash, or
 * `history` — localStorage only, always.
 *
 * Right now there is exactly ONE pref — see {@link ViewerPrefs.autoMotion}.
 *
 * Deliberately does NOT import from persist.ts, even though the two share a
 * tiny "safe localStorage" helper and the same `deps?.storage ?? ...`
 * resolution pattern: this module is about a different storage key with a
 * different (much smaller) validation contract, and the shared bits are a
 * few lines — copying them beats coupling two otherwise-unrelated
 * persistence concerns to save a handful of lines.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The persistent viewer-preferences document (fr-0ya). */
export interface ViewerPrefs {
  /** The combined auto-motion on/off preference (fr-0ya): the 3D auto-orbit
   * and 4D auto-tumble share ONE remembered choice across reloads. `undefined`
   * = never chosen, so boot follows the prefers-reduced-motion default. Set to
   * true/false once the user flips EITHER motion toggle; seeds BOTH on next load. */
  autoMotion?: boolean;
}

/** Injectable storage; defaults to `window.localStorage`. Mirrors persist.ts's PersistDeps. */
export interface ViewerPrefsDeps {
  storage?: Pick<Storage, "getItem" | "setItem">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Own key, distinct from persist.ts's `fractal-viewer:scene` and
 * collection.ts's `fractal-viewer:collection` — same `fractal-viewer:*`
 * namespace, but prefs must never live inside the scene document (see this
 * module's header).
 */
const STORAGE_KEY = "fractal-viewer:prefs";

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Read the stored viewer prefs. NEVER throws: no storage, an absent key,
 * malformed JSON, or a throwing `getItem` all quietly yield `{}` — the same
 * robustness-boundary spirit as persist.ts's `decodeScene`, just scoped to
 * one small always-optional document instead of a whole scene.
 *
 * Validates strictly: the parsed value must be a non-null, non-array object,
 * and `autoMotion` is copied into the result ONLY when it is literally
 * `typeof === "boolean"`. A non-boolean `autoMotion` (a stray string, number,
 * or null from a hand-edited or foreign value) is dropped, leaving it
 * `undefined` in the result — exactly as if it had never been stored. `false`
 * is a real, meaningful choice (auto-motion off) and MUST survive: this never
 * treats it as absent the way a careless `parsed.autoMotion || default` would.
 */
export function loadViewerPrefs(deps?: ViewerPrefsDeps): ViewerPrefs {
  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined);
  if (!storage) return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return {};

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const p = parsed as Record<string, unknown>;
    const prefs: ViewerPrefs = {};
    if (typeof p.autoMotion === "boolean") prefs.autoMotion = p.autoMotion;
    return prefs;
  } catch {
    return {};
  }
}

/**
 * Persist `prefs` to localStorage ONLY — never the URL, hash, or `history`,
 * unlike persist.ts's `saveScene` (see this module's header for why: a
 * shared link must not carry the author's personal preference). Swallows a
 * throwing `setItem` (private-mode / sandboxed contexts, a full quota) so a
 * failed write never surfaces as an app-level error — the live in-session
 * value stays correct even when nothing durable got saved.
 */
export function saveViewerPrefs(
  prefs: ViewerPrefs,
  deps?: ViewerPrefsDeps,
): void {
  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined);
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // QuotaExceededError / private-mode SecurityError — ignore silently.
  }
}

/** localStorage access throws in some private-browsing / sandboxed contexts.
 * Identical in spirit to persist.ts's own helper of the same name — kept as
 * a local copy rather than a shared import (see this module's header). */
function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
