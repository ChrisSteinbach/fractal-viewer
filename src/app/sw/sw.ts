/**
 * Hand-written service worker (fr-96i), built by vite-plugin-pwa's
 * `injectManifest` strategy (which compiles this file and substitutes the
 * real precache manifest for `self.__WB_MANIFEST`). It replaces the
 * generated (`generateSW`) worker for ONE reason: composing Workbox's
 * precache with a COOP/COEP response rewrap, which is what gives the app
 * cross-origin isolation — and therefore SharedArrayBuffer for the flame
 * renderer — on a host (GitHub Pages) that cannot send those headers itself.
 *
 * Why hand-composed: only the FIRST `respondWith()` on a fetch event wins,
 * so the precache lookup and the header rewrap must share one fetch handler.
 * Workbox's usual `precacheAndRoute` registers its own listener and would
 * serve cache hits unwrapped — breaking isolation exactly when the app is
 * offline, the case a PWA exists for. Hence the lower-level
 * `PrecacheController` API (which registers no listeners) inside a single
 * hand-rolled handler that calls `respondWith` exactly once.
 *
 * The rewrap itself is modeled on coi-serviceworker
 * (https://github.com/gzuidhof/coi-serviceworker): every non-opaque response
 * — network or cache — is rebuilt with `COOP: same-origin` + `COEP:
 * require-corp`, plus `CORP: cross-origin` so the rewrapped assets stay
 * embeddable under that COEP. `require-corp` rather than `credentialless`
 * because the app is fully self-contained (no cross-origin subresources that
 * would need degrading) and Safari only understands require-corp. The
 * client-side half of the scheme — registration plus the reload-once
 * bootstrap a first visit needs before any of this applies — lives in
 * `../register-sw.ts`.
 */
import { PrecacheController, cleanupOutdatedCaches } from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[];
};

const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);

// autoUpdate semantics, matching the previous generateSW output: a new
// deploy's worker takes over open pages immediately (skipWaiting +
// clients.claim below) instead of waiting for every tab to close. Old
// workbox cache-name generations are pruned the same way generateSW did.
void self.skipWaiting();
cleanupOutdatedCaches();

self.addEventListener("install", (event) => {
  event.waitUntil(precache.install(event));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(precache.activate(event).then(() => self.clients.claim()));
});

/**
 * Rebuild a response with the cross-origin-isolation headers injected. A
 * status of 0 marks an opaque (cross-origin no-cors) response, whose headers
 * can be neither read nor reconstructed — passed through untouched, exactly
 * as coi-serviceworker does. Not a concern for isolation in this app: every
 * subresource is same-origin, so opaque responses don't occur on the paths
 * that matter.
 */
function withIsolationHeaders(response: Response): Response {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The single fetch pipeline: navigations serve the precached app shell
 * (the SPA `navigateFallback` the generated worker used to configure —
 * query strings and all, since the shell is one page); everything else is
 * precache-first with a network fallback for the stray non-precached
 * request. Whatever the source, the response leaves with isolation headers.
 */
async function respond(request: Request): Promise<Response> {
  const url = request.mode === "navigate" ? "index.html" : request.url;
  const cached = await precache.matchPrecache(url);
  const response = cached ?? (await fetch(request));
  return withIsolationHeaders(response);
}

self.addEventListener("fetch", (event) => {
  // Chromium quirk, from coi-serviceworker: a devtools-originated
  // `only-if-cached` request from a non-same-origin mode would throw inside
  // fetch(); let the browser handle it instead of responding at all.
  const { request } = event;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin")
    return;
  event.respondWith(respond(request));
});
