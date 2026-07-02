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
 * which force-reloads open pages whenever an updated worker activates: the
 * previously deployed behavior was for a new deploy's worker (which
 * `skipWaiting()`s + claims — see sw/sw.ts) to take over silently, and this
 * keeps it that way. The only reload this module ever performs is the
 * isolation dance, and only from a page that loaded non-isolated.
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
 * in the module doc.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return; // e.g. Firefox private mode.

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
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(
      (registration) => {
        // Active but not controlling: this page was deliberately loaded
        // around the already-installed worker (typically a hard reload), so
        // no controllerchange is coming — yet a PLAIN reload is still
        // interceptable. Trigger the dance directly.
        if (
          wantsIsolationReload &&
          registration.active &&
          !navigator.serviceWorker.controller
        ) {
          reloadForIsolation();
        }
      },
      (error: unknown) => {
        console.error("Service worker registration failed:", error);
      },
    );
  });
}
