/**
 * Service-worker registration + the cross-origin-isolation bootstrap
 * (fr-96i), modeled on coi-serviceworker
 * (https://github.com/gzuidhof/coi-serviceworker).
 *
 * GitHub Pages cannot send the COOP/COEP headers that SharedArrayBuffer (the
 * flame renderer's fast transport — see flame-worker-core.ts) requires, so
 * the hand-written service worker (`sw/sw.ts`) injects them into every
 * response it serves. That only helps a page the service worker is
 * CONTROLLING — and a first-ever visit is fetched before any service worker
 * exists, so it loads non-isolated. The dance here reloads such a page ONCE,
 * as soon as the fresh service worker takes control, so the reloaded
 * navigation gets intercepted and comes back isolated. A page that is
 * already isolated (or a browser where isolation can't work) never reloads;
 * the flame renderer just falls back to its postMessage-transfer mode.
 *
 * The registration call itself deliberately reproduces what
 * vite-plugin-pwa's auto-injected script did before this module took over
 * (`injectRegister: false` now) — a plain register on window load. Notably
 * it does NOT adopt the `virtual:pwa-register` module's autoUpdate client,
 * which force-reloads open pages whenever an updated worker activates: a new
 * deploy's worker (see sw/sw.ts) now waits rather than taking over, and this
 * module only ever hands control to it once the user asks (below). The only
 * reload this module ever performs unprompted is the isolation dance, and
 * only from a page that loaded non-isolated.
 *
 * A new deploy's worker now waits instead of taking over (fr-o13): it parks
 * in `waiting` until this page tells it to go ahead. `registerServiceWorker`
 * detects that waiting worker — immediately at registration, or via
 * `updatefound` once a fresh install completes — and reports it through
 * `onUpdateAvailable`, handing the app an `acceptUpdate` callback. Accepting
 * posts `SKIP_WAITING` to the waiting worker and reloads once on the
 * resulting `controllerchange`; ignoring the banner costs nothing, because
 * the OLD worker keeps serving the OLD precache for as long as this tab
 * stays open — lazily-loaded chunks (the flame/voxel workers) can no longer
 * 404 mid-session. The only takeover-without-asking left is another tab
 * accepting the same update — `SKIP_WAITING` activates the waiting worker
 * for every open tab at once — which is why the replaced-controller
 * listener below survives. The isolation reload and the update reload are
 * separate, individually-guarded dances that cannot loop or double-fire
 * each other: the isolation one is guarded by the sessionStorage marker and
 * only ever arms from a non-isolated page; the update one is armed only on
 * an explicit accept, and only once. (Migration note: the currently
 * deployed worker still `skipWaiting()`s unconditionally, but that decision
 * always belongs to the NEW, incoming worker — so the very first deploy
 * carrying this change already behaves as wait-and-ask.)
 */

/** sessionStorage key marking "the load after our own isolation reload". */
const RELOADED_KEY = "coi-reloaded";

/** Read-and-clear the reload marker: true exactly when THIS page load is the
 * one `reloadForIsolation` produced — the once-only guard that stops the
 * dance from looping in a browser where SW-injected COOP/COEP doesn't
 * actually isolate. Storage can be unavailable (sandboxed frame, hardened
 * privacy modes); report "already reloaded" then, because without loop
 * protection no dance is safer than an unbounded reload loop. */
function readAndClearReloadMarker(): boolean {
  try {
    const marked = sessionStorage.getItem(RELOADED_KEY) !== null;
    sessionStorage.removeItem(RELOADED_KEY);
    return marked;
  } catch {
    return true;
  }
}

function reloadForIsolation(): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    return; // couldn't persist the loop guard — don't risk reloading forever.
  }
  console.info(
    "Reloading once to activate cross-origin isolation (SharedArrayBuffer).",
  );
  window.location.reload();
}

/**
 * Register `sw.js` (production builds only — dev serves no service worker
 * and gets COOP/COEP straight from vite's dev-server headers instead) and,
 * when this page loaded non-isolated, arrange the one-time reload described
 * in the module doc. `onUpdateAvailable`, when given, is handed an
 * `acceptUpdate` callback whenever a waiting (or replaced) worker is
 * detected; call it to apply the update, per the dance described above.
 */
export function registerServiceWorker(
  onUpdateAvailable?: (acceptUpdate: () => void) => void,
): void {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return; // e.g. Firefox private mode.

  let registration: ServiceWorkerRegistration | null = null;
  let updateReloadArranged = false;

  const acceptUpdate = (): void => {
    const waiting = registration?.waiting ?? null;
    if (!waiting) {
      // The new worker already activated (e.g. another tab accepted first):
      // nothing to message — a plain reload lands on the new version.
      window.location.reload();
      return;
    }
    if (!updateReloadArranged) {
      updateReloadArranged = true;
      // Reload exactly once, when the waiting worker's activation replaces
      // this page's controller. Distinct from the isolation dance's listener:
      // this one is armed only on explicit user accept, so it cannot loop.
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true },
      );
    }
    waiting.postMessage({ type: "SKIP_WAITING" }); // handled in sw/sw.ts
  };

  const reloadedBySelf = readAndClearReloadMarker();
  const wantsIsolationReload =
    // `=== false`, not `!`: undefined means the browser predates the whole
    // concept, so a reload has nothing to gain.
    window.crossOriginIsolated === false &&
    window.isSecureContext &&
    !reloadedBySelf;

  if (wantsIsolationReload) {
    // Fires when the just-registered worker activates and claims this page
    // (clients.claim() in sw/sw.ts): from here on a reload's navigation
    // request will be intercepted and served with COOP/COEP.
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      reloadForIsolation,
      { once: true },
    );
  } else if (onUpdateAvailable) {
    // Under the waiting model a controller replacement no longer happens on
    // every deploy — it now means the waiting worker activated WITHOUT this
    // page asking, which typically means another tab accepted the update
    // (SKIP_WAITING activates the waiting worker for every open tab at
    // once). The old precache is gone at that point regardless, so notify
    // here too; `acceptUpdate` degrades to a plain reload because
    // `registration.waiting` is already null by then. `hadController` is
    // still tracked for the same reason as before: a first-ever claim in a
    // browser where `crossOriginIsolated` is undefined must not notify.
    let hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !updateReloadArranged) {
        onUpdateAvailable(acceptUpdate);
      }
      hadController = true;
    });
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", {
        scope: "./",
        // GitHub Pages serves sw.js with `max-age=600` — without this, the
        // browser's update check can trust that stale HTTP cache entry for
        // up to 10 minutes instead of fetching a fresh copy to compare
        // against. Only affects THIS check; the worker's own precache/
        // install lifecycle (sw/sw.ts) is unaffected.
        updateViaCache: "none",
      })
      .then(
        (reg) => {
          registration = reg;

          // Active but not controlling: this page was deliberately loaded
          // around the already-installed worker (typically a hard reload), so
          // no controllerchange is coming — yet a PLAIN reload is still
          // interceptable. Trigger the dance directly, and skip arming
          // update detection below — this page is about to navigate away.
          if (
            wantsIsolationReload &&
            reg.active &&
            !navigator.serviceWorker.controller
          ) {
            reloadForIsolation();
            return;
          }

          if (onUpdateAvailable) {
            // A deploy that landed while no tab was open parks its worker in
            // `waiting` before this page ever loads — surface it immediately.
            if (reg.waiting) onUpdateAvailable(acceptUpdate);
            // A deploy landing while this tab is open: the new worker
            // installs in the background and parks in `waiting`. `installed`
            // with an existing controller distinguishes that from a
            // first-ever install (which has no controller yet and activates
            // immediately — no banner on first visit).
            reg.addEventListener("updatefound", () => {
              const installing = reg.installing;
              if (!installing) return;
              installing.addEventListener("statechange", () => {
                if (
                  installing.state === "installed" &&
                  navigator.serviceWorker.controller !== null
                ) {
                  onUpdateAvailable(acceptUpdate);
                }
              });
            });
          }

          // Long-lived PWA tabs shouldn't have to wait out the browser's
          // ~24h update-check schedule: re-check whenever the tab becomes
          // visible again (pairs with `updateViaCache: "none"` above, so
          // this always compares against a fresh sw.js).
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              void reg.update().catch(() => {
                // Offline or transient network failure — a later check retries.
              });
            }
          });
        },
        (error: unknown) => {
          console.error("Service worker registration failed:", error);
        },
      );
  });
}
