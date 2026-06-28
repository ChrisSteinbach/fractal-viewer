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
  },
  build: {
    outDir: "../../dist/app",
    emptyOutDir: true,
  },
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: "Interactive 3D IFS fractal viewer built with Three.js",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
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
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // The bundled Three.js runtime exceeds Workbox's 2 MiB default
        // precache size limit; raise it so the app shell works offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
