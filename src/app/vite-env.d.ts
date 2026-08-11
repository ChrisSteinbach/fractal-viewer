/// <reference types="vite/client" />

/** Build identity injected by vite.config.ts's `define` (commit short SHA +
 * build date; "unknown" outside a git checkout). Logged once at boot so
 * field reports self-identify the build the page ACTUALLY runs — the
 * service worker's wait-for-consent update (fr-o13) means an open tab can
 * serve a days-old precache long after a deploy. */
declare const __BUILD_ID__: string;
