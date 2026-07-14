import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

const APP_NAME = "Fractal Viewer";

export default defineConfig({
  root: "src/app",
  // Relative base so the build works at any path (project Pages site,
  // custom domain, or local file preview) without rebuilding.
  base: "./",
  server: {
    host: "0.0.0.0",
    // Native COOP/COEP in dev, where no service worker runs: makes the page
    // cross-origin isolated so `npm run dev` exercises the flame renderer's
    // SharedArrayBuffer transport (fr-96i). Production gets the same headers
    // injected by the hand-written service worker (src/app/sw/sw.ts)
    // instead, because GitHub Pages cannot send them. `npm run preview`
    // deliberately does NOT set them, so the service-worker path — including
    // the first-visit reload-once bootstrap in register-sw.ts — can be
    // exercised locally against the real production build.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    outDir: "../../dist/app",
    emptyOutDir: true,
  },
  plugins: [
    basicSsl(),
    VitePWA({
      // Hand-written worker (fr-96i): Workbox precache composed with a
      // COOP/COEP rewrap in ONE fetch handler — something generateSW cannot
      // express. See src/app/sw/sw.ts.
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      // Registration lives in src/app/register-sw.ts (it also runs the
      // isolation reload-once bootstrap); the auto-injected script would
      // register a second time.
      injectRegister: false,
      // With registration and the worker both hand-written this setting is
      // inert, but it documents the intended semantics (the worker
      // skipWaiting()s + claims, new deploys take over silently) — and keeps
      // them if injectRegister is ever switched back on.
      registerType: "autoUpdate",
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: "Interactive 3D/4D IFS fractal viewer built with Three.js",
        // Both mirror the WebGL backdrop's top stop (DARK_BACKDROP.top in
        // src/app/constants.ts) so the installed-PWA chrome tint and launch
        // splash match the page top. Keep in sync with index.html's
        // <meta name="theme-color">.
        theme_color: "#0d0d18",
        background_color: "#0d0d18",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        // webmanifest is listed explicitly: injectManifest only precaches
        // what the glob names, so the manifest must be named here to be
        // cached. txt covers THIRD-PARTY-LICENSES.txt (fr-a2l) so the offline copy
        // of the bundles keeps its third-party license notices.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,txt}"],
        // The bundled Three.js runtime exceeds Workbox's 2 MiB default
        // precache size limit; raise it so the app shell works offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A single classic-script bundle: sw.js is registered without
        // `type: "module"` (register-sw.ts), matching the widest browser
        // support, so its build output must not rely on module syntax.
        rollupFormat: "iife",
      },
    }),
  ],
});
