---
name: verify
description: Build, serve, and drive the production app (including the service-worker path) to verify a change end-to-end in a real browser.
---

# Verifying changes by running the app

## Headless WebGL: boot the app on a no-GPU / CI box

The default MCP Playwright browser (HeadlessChrome) and the system
`google-chrome` both return `null` from `canvas.getContext("webgl2")`, so
`main.ts`'s `webglAvailable()` boot guard trips ("WebGL is not supported"),
`FractalScene` is never constructed, and the Render buttons never appear — **no
frontend change can be verified in the browser.** A real software-GL context
(ANGLE + SwiftShader) fixes this.

**One command** — spawns the dev server, boots the app under SwiftShader, and
asserts a WebGL context + no boot error + a non-zero point count (exit 0 =
booted and rendered):

```bash
node scripts/webgl-smoke.mjs                                # spawns its own `npm run dev`
node scripts/webgl-smoke.mjs --url=https://localhost:5173   # reuse a running server
node scripts/webgl-smoke.mjs --screenshot=smoke.png         # + capture a frame
```

A correct boot logs the renderer as `ANGLE (… SwiftShader …)`. Use it as a fast
regression gate for anything touching the boot path, the scene, or WebGL. It is
the committed form of the recipe below.

**Driving a browser yourself** (a bespoke Playwright script — *not* the MCP
browser, which has no WebGL) needs the same four things lined up;
`scripts/webgl-smoke.mjs` and the `scripts/gpu-flame-*.mjs` monitors are the
worked examples:

- **Bundled Chromium, not system Chrome** — only Playwright's bundle ships
  SwiftShader/ANGLE: `executablePath: chromium.executablePath()`
  (`playwright-core`).
- **`headless: false` + pass `--headless=new` yourself** — asking Playwright
  for `headless: true` gets Chrome's OLD headless mode, which never yields a
  WebGL context. `false` stops Playwright injecting that old flag; new headless
  is then requested explicitly via the arg.
- **Clear `DISPLAY`** (`delete env.DISPLAY` in the child env) — otherwise Chrome
  tries a (broken, over-SSH) X11 GLX instead of the offscreen SwiftShader path.
- **`args: --headless=new --enable-unsafe-swiftshader --use-gl=angle
  --use-angle=swiftshader --no-sandbox`**, plus `newPage({ ignoreHTTPSErrors:
  true })` for the dev server's self-signed cert.

## Dev server (no service worker)

`npm run dev` — HTTPS (self-signed via basicSsl), COOP/COEP sent natively by
Vite, **no service worker**. Right surface for UI/scene/interaction changes;
wrong surface for anything touching `register-sw.ts` or `sw/sw.ts`.

## Production build + service worker

The SW path (registration, isolation dance, waiting-update flow) only exists
in a production build. `npm run preview` works but is HTTPS with a self-signed cert,
which browser automation may reject. A plain HTTP static server on localhost is
equivalent (localhost is a secure context, and Chromium honors SW-injected
COOP/COEP there — `crossOriginIsolated` comes back `true`):

```bash
npm run build
python3 -m http.server 8737 --directory dist/app --bind 127.0.0.1
```

Drive it with the Playwright MCP browser. Useful checks from
`browser_evaluate`:

- `navigator.serviceWorker.controller` — page controlled?
- `window.crossOriginIsolated` — SAB fast path active?
- First visit auto-reloads once (the isolation dance); the console shows
  "Reloading once to activate cross-origin isolation".

## Simulating "a deploy landed while a tab was open"

1. Load the page, let the dance settle (controlled + isolated).
2. Make any content change (e.g. drop a temporary HTML comment into
   `src/app/index.html`) and `npm run build` again — the changed precache
   manifest makes `sw.js` byte-different, which is what an update IS.
3. In the open tab: `(await navigator.serviceWorker.getRegistration()).update()`
   — the new worker installs and parks in `waiting` (fr-o13: no takeover),
   which shows the update banner while the OLD worker keeps serving the old
   precache (`fetch("./index.html")` should NOT contain your marker yet).
4. Click the banner's Reload: the page posts `SKIP_WAITING`, the new worker
   activates and claims, and the page reloads once onto the new build (now
   the served HTML DOES contain the marker). Any other open tab is NOT
   reloaded — it re-shows the banner instead (replaced-controller path).
5. Revert the temporary marker and rebuild when done.

## Gotchas

- `pkill -f "http.server 8737"` matches your own shell's command line and
  kills it. Kill by port instead: `fuser -k 8737/tcp`.
- `browser_take_screenshot` with a `filename` writes to the MCP server's cwd
  (repo root), not `.playwright-mcp/`; omit `filename` to get the image
  inline and auto-saved under `.playwright-mcp/` (gitignored).
- Playwright's element `target` accepts plain CSS selectors (`#updateBanner`)
  — no snapshot ref needed.
- At mobile widths the open panel (z-index 99) covers bottom overlays like
  the update banner (z-index 20) by design; `#menuToggle` overlays
  `#panelClose`, so close the panel by clicking `#menuToggle`.
