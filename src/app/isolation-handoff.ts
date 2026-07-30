/**
 * Isolation-reload handoff (fr-su3r): a one-load-wide sessionStorage bridge
 * carrying the exact session-only slice of `AppState` that the cross-origin-
 * isolation reload (`register-sw.ts`) would otherwise silently discard.
 *
 * On a first-ever visit the page loads non-isolated (no COOP/COEP headers —
 * GitHub Pages can't send them), registers the service worker, and
 * `register-sw.ts`'s `reloadForIsolation` fires exactly one
 * `window.location.reload()` once that worker takes control, so the
 * reloaded navigation gets served WITH COOP/COEP and `SharedArrayBuffer`
 * becomes available. Anything the user does inside that window — before the
 * `controllerchange` fires — survives the reload only if it lives somewhere
 * the reloaded page reads back. The scene document does: `persist.ts` writes
 * every edit into the `#v1=` hash and `fractal-viewer:scene` localStorage as
 * it happens, and the reloaded page's boot sequence reads both back, so a
 * transform edit or a preset's authored system round-trips intact.
 *
 * `AppState.renderMode` does not, and deliberately so (see `state.ts`'s
 * `AppState.renderMode` doc and `persist.ts`'s `SceneSnapshot`, which omits
 * it): the app always boots into the `"points"` explorer, on every load, no
 * exception — a shared link must never silently drop its opener into a
 * flame/solid/surface render the recipient never asked for. That rule is
 * exactly right for every load EXCEPT this one: a preset's render-mode hint
 * (`PRESET_RENDER_HINTS`, see `presets.ts` / `main.ts`) or a manual mode
 * switch chosen inside the reload window is a real, current-session user
 * action, not scene content — yet the reload throws it away with nothing to
 * blame, because the restore that follows is a plain scene load, not a
 * preset load, so the hint never re-fires (fr-su3r: picking a Flame-group
 * preset in the reload window leaves the app in Points mode after reload,
 * even though the authored system itself comes back correctly).
 *
 * This module is the narrow fix: `saveIsolationHandoff` is meant to be
 * called immediately before the isolation reload's own
 * `window.location.reload()`, carrying the render mode that reload is about
 * to discard; `consumeIsolationHandoff` is meant to be called once, early in
 * the very next boot, to read it back and apply it on top of the restored
 * (always-`"points"`) scene.
 *
 * Why sessionStorage, not localStorage: this value's lifetime is exactly one
 * tab's session, precisely like `register-sw.ts`'s own `coi-reloaded`
 * dance-guard marker it rides alongside, and precisely like `renderMode`
 * itself, which is session-only for the same reason. A localStorage handoff
 * would leak "boot into flame" into every FUTURE visit from this browser,
 * not just the one reloaded page it was written for — silently reintroducing
 * exactly the boot behavior `persist.ts`'s `SceneSnapshot` was designed to
 * guarantee never happens.
 *
 * Why consumption CLEARS the entry (read-and-clear, exactly like
 * `register-sw.ts`'s `readAndClearReloadMarker`): the handoff means something
 * only for the very next load, and nothing else. An entry left in place would
 * silently re-arm on some later, unrelated reload (a manual refresh, an
 * accepted service-worker update) and reapply a render mode from a session
 * that is long over.
 *
 * Like `viewer-prefs.ts`, this module keeps its own key in the
 * `fractal-viewer:*` namespace and never touches the URL, hash, or
 * `history` — this is a volatile session bridge, not part of the shareable
 * scene document.
 */
import { RENDER_MODES } from "./state";
import type { RenderMode } from "./state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The one-load-wide handoff payload (fr-su3r): exactly the session-only
 * `AppState` slice the isolation reload would otherwise discard. A single
 * field today; more could join it later under the same one-shot,
 * read-and-clear contract without changing the storage key.
 */
export interface IsolationHandoff {
  /** The render mode in effect just before the reload — see `state.ts`'s
   * `AppState.renderMode` and `RENDER_MODES` for the vocabulary. */
  renderMode: RenderMode;
}

/**
 * Injectable storage; defaults to `window.sessionStorage` — NOT
 * `localStorage` (see this module's header for why). Shaped like
 * `persist.ts`'s `PersistDeps` / `viewer-prefs.ts`'s `ViewerPrefsDeps`,
 * extended with `removeItem` for the read-and-clear contract
 * `consumeIsolationHandoff` needs.
 */
export interface IsolationHandoffDeps {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Own key, distinct from `persist.ts`'s `fractal-viewer:scene`,
 * `collection.ts`'s `fractal-viewer:collection`, and `viewer-prefs.ts`'s
 * `fractal-viewer:prefs` — same `fractal-viewer:*` namespace, but this one
 * lives in sessionStorage, not localStorage (see this module's header).
 */
const STORAGE_KEY = "fractal-viewer:isolation-handoff";

/**
 * Exact set of valid RenderMode values, built FROM `RENDER_MODES` — the same
 * derive-the-guard-from-the-const-array idiom `persist.ts` uses for every
 * enum-shaped decoded field (its `VALID_COLOR_MODES`, `VALID_RENDER_STYLES`,
 * etc.): a value this module doesn't recognize can never be forged by
 * hand-editing sessionStorage, and a real future render mode is accepted
 * automatically the moment it joins `RENDER_MODES`, with nothing here to
 * update in step.
 */
const VALID_RENDER_MODES = new Set<string>(RENDER_MODES);

// ---------------------------------------------------------------------------
// Save / consume
// ---------------------------------------------------------------------------

/**
 * Write `handoff`, meant to be called immediately before the isolation
 * reload's `window.location.reload()` (see `register-sw.ts`'s
 * `reloadForIsolation`). Resolves storage exactly like
 * `loadViewerPrefs`/`saveViewerPrefs` (injected `deps.storage`, else
 * `window.sessionStorage` when `window` exists, else nothing) and returns
 * silently when there is no storage to write to. The write itself sits
 * inside a try/catch that swallows a throwing `setItem` (a full quota, or a
 * private-mode `SecurityError`) — a failed handoff just means the next load
 * falls back to its own default render mode, never an app-level error.
 */
export function saveIsolationHandoff(
  handoff: IsolationHandoff,
  deps?: IsolationHandoffDeps,
): void {
  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeSessionStorage() : undefined);
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // QuotaExceededError / private-mode SecurityError — ignore silently.
  }
}

/**
 * Read-and-CLEAR the handoff: returns the payload only when the very last
 * thing written under this key was a valid `IsolationHandoff`; `null`
 * otherwise. Mirrors `register-sw.ts`'s own `readAndClearReloadMarker` in
 * spirit: `getItem` then `removeItem` happen together inside one try/catch,
 * with the removal happening BEFORE the payload is parsed or validated — so
 * a malformed entry (hand-edited, truncated by a crash, written by some
 * future or older build) is cleared right along with a valid one, and can
 * never wedge every subsequent load by repeatedly failing to parse.
 *
 * Returns `null` — NEVER throws — when: there is no storage; the key is
 * absent; the stored text isn't valid JSON; the parsed value isn't a
 * non-null, non-array object; or `renderMode` isn't one of `RENDER_MODES`. A
 * successful read returns the payload with `renderMode` narrowed to
 * `RenderMode`.
 */
export function consumeIsolationHandoff(
  deps?: IsolationHandoffDeps,
): IsolationHandoff | null {
  const storage =
    deps?.storage ??
    (typeof window !== "undefined" ? safeSessionStorage() : undefined);
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    // Clear unconditionally, before parsing — see this function's doc for why.
    storage.removeItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const p = parsed as Record<string, unknown>;
    if (
      typeof p.renderMode !== "string" ||
      !VALID_RENDER_MODES.has(p.renderMode)
    ) {
      return null;
    }
    return { renderMode: p.renderMode as RenderMode };
  } catch {
    return null;
  }
}

/**
 * sessionStorage access throws in some private-browsing / sandboxed
 * contexts. Identical in spirit to `viewer-prefs.ts`'s `safeLocalStorage`
 * (and to the bare try/catch `register-sw.ts` wraps around its own
 * `sessionStorage` calls) — kept as a local copy rather than a shared
 * import, for the same reason `viewer-prefs.ts` gives for not importing
 * `persist.ts`'s helper: a different storage object, a handful of lines, not
 * worth coupling two otherwise-unrelated persistence concerns to save them.
 */
function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
