---
name: verify
description: Build, serve, and drive the production app (including the service-worker path) to verify a change end-to-end in a real browser.
---

# Verifying changes by running the app

## Headless WebGL: the MCP browser can run the app

**Start with the MCP Playwright browser — it has WebGL.** Measured 2026-08-10 on
the pinned `@playwright/mcp@latest` (resolved 0.0.79, HeadlessChrome 150):
`canvas.getContext("webgl2")` returns a live context on `ANGLE (Google, Vulkan
1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, `main.ts`'s
`webglAvailable()` guard passes, and the dev server's app boots and renders
(default preset: 314,000 pts, full panel, all four Render buttons). A whole
multi-scenario verification runs through `browser_navigate` / `browser_click` /
`browser_evaluate` / `browser_take_screenshot` with no bespoke script (fr-k9nx).

The note this replaces said the MCP browser had **no** WebGL, which cost sessions
a detour into scripting or into skipping the browser check entirely. Re-measure
before believing either claim if the pin moves — `@latest` is not a pin:

```js
// browser_evaluate
() => { const g = document.createElement("canvas").getContext("webgl2");
  const d = g && g.getExtension("WEBGL_debug_renderer_info");
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : !!g; }
```

Caveats the SwiftShader context brings, all measured on that pin:

- **No WebGPU adapter.** `navigator.gpu` exists but `requestAdapter()` resolves
  `null` — the MCP launch passes none of the SwiftShader-Vulkan flags
  `scripts/gpu-flame-bench.mjs` uses. Both render paths say so in the panel, which
  is the cheap way to check: Flame prints "CPU accumulation — no GPU API in this
  browser", and the surface progress row's fr-tmgf engine label reads
  "Preview · **WebGL** …%". So flame takes the CPU backend and surface takes the
  **WebGL arms** (`SURFACE_FOLD_LENS`, `SURFACE_ESCAPE`, the 4D fragment tracer),
  never `surface-compute.ts`. Anything that must exercise WebGPU goes through
  `npm run bench:gpu` / `npm run bench:surface`, not this browser.
- **The app announces the software renderer too.** A red "Software WebGL renderer
  — ANGLE (… SwiftShader …). The browser is not using the GPU, so renders run
  10–50× slower" block sits in the panel. Expected here, and it makes panel
  screenshots differ from a GPU box.
- **Renders are software-slow, but they do arrive.** Measured on the default
  6-map preset at 1280×720: Points immediate, Flame converging within ~8s,
  Surface still at "Preview 57%" after 25s. Wait on the panel's own progress
  text, not a fixed sleep, and expect `render-tier.ts` to sit at coarse preview
  rungs far longer than on a GPU. Fold-heavy systems (Mandelbox KIFS) will be
  much worse — they are minutes on real hardware.
- **Canvas pixel readback is BLACK unless you sample inside the render frame.**
  The renderer runs without `preserveDrawingBuffer`, so `drawImage(canvas)` from
  a plain `browser_evaluate` gets a cleared buffer. Invalidate, then read from a
  `requestAnimationFrame` callback registered *after* the app's own — it runs
  later in the same frame, with the buffer still live:

  ```js
  () => new Promise((res) => { window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => { /* drawImage(canvas) → real pixels here */ }); })
  ```

  One frame later (or in a `setTimeout`) it is black again.

## The headless smoke gate

**One command** — spawns the dev server, boots the app under SwiftShader, and
asserts a WebGL context + no boot error + a non-zero point count (exit 0 =
booted and rendered):

```bash
node scripts/webgl-smoke.mjs                                # spawns its own `npm run dev`
node scripts/webgl-smoke.mjs --url=https://localhost:5173   # reuse a running server
node scripts/webgl-smoke.mjs --screenshot=smoke.png         # + capture a frame
```

A correct boot logs the renderer as `ANGLE (… SwiftShader …)`. This is a fast,
committed **regression gate** for anything touching the boot path, the scene, or
WebGL (`npm run smoke` is the same thing) — not the only way to see the app run;
for exploratory verification the MCP browser above is cheaper.

**Writing your own Playwright script** (`scripts/webgl-smoke.mjs` and the
`scripts/gpu-flame-*.mjs` monitors are the worked examples) — what those scripts
pin, and how much of it still load-bears, measured 2026-08-10 on
Chrome/Chromium 149–150:

- **`newPage({ ignoreHTTPSErrors: true })`** for the dev server's self-signed
  cert. Still required.
- **`args: --headless=new --enable-unsafe-swiftshader --use-gl=angle
  --use-angle=swiftshader --no-sandbox`** — now *determinism* insurance, not a
  prerequisite: they force SwiftShader whatever the host GPU is. Plain
  `headless: true` with only `--no-sandbox` also came up WebGL2/SwiftShader.
- **Bundled Chromium** (`executablePath: chromium.executablePath()` from
  `playwright-core`) — keeps the browser version pinned to the repo. The old
  reason ("only Playwright's bundle ships SwiftShader/ANGLE") is stale: system
  `google-chrome` 150 ships `libvk_swiftshader.so` and probes WebGL2/SwiftShader
  in `--headless=new` too.
- **`headless: false` + an explicit `--headless=new`** was needed when
  Playwright's `headless: true` meant Chrome's OLD headless mode, which yielded
  no WebGL context. Chrome removed old headless, so `headless: true` is the new
  mode now; the two-step spelling survives in the scripts and is harmless.
- **Clearing `DISPLAY`** (`delete env.DISPLAY`) guarded against a broken,
  over-SSH X11 GLX path. New headless does not touch the display: probes with
  `DISPLAY=:0` kept came back SwiftShader either way.

## Dev server (no service worker)

`npm run dev` — HTTPS (self-signed via basicSsl), COOP/COEP sent natively by
Vite, **no service worker**. Right surface for UI/scene/interaction changes;
wrong surface for anything touching `register-sw.ts` or `sw/sw.ts`.

## Production build + service worker

The SW path (registration, isolation dance, waiting-update flow) only exists
in a production build. `npm run preview` is HTTPS with a self-signed cert; the
MCP browser is launched with `--ignore-https-errors` (`.mcp.json`) and takes it
without complaint, as it does the dev server. A plain HTTP static server on
localhost is still the simplest surface, and is equivalent (localhost is a secure
context, and Chromium honors SW-injected COOP/COEP there — `crossOriginIsolated`
comes back `true`):

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

## Touch gestures (pinch-zoom / panel scroll) under emulation

Verified recipe from fr-vfk — a bespoke script on the SwiftShader launch above,
with a touch context (`isMobile: true, hasTouch: true`) and a CDP session:

- **`isMobile` viewports come out oversized on this box** when combined with
  the SwiftShader flags: `window.innerWidth` reports ~1.5–1.9× the requested
  width, nondeterministically (even Playwright's bundled `Pixel 7` preset
  lands above the app's 640px mobile breakpoint). Request a much smaller
  viewport (e.g. 280×622) and retry context creation until `innerWidth` is
  under the breakpoint; take gesture coordinates from live
  `getBoundingClientRect()`, never from `innerWidth` or hardcoded pixels.
- **`Input.synthesizePinchGesture`, `Input.synthesizeScrollGesture`, and
  `Emulation.resetPageScaleFactor` silently no-op here** — they resolve
  without error and do nothing. Drive gestures with raw
  `Input.dispatchTouchEvent` sequences instead (touchStart with two points,
  stepped touchMoves spreading/closing them, touchEnd) — the browser's
  gesture recognizer turns those into real pinch/pan. Assert on effects
  (`window.visualViewport.scale`, element `scrollTop`), never on the CDP
  call succeeding.
- Pair every "gesture is blocked" assertion with the same mechanism
  producing a positive effect elsewhere on the page (e.g. pinch over
  `#container` must NOT zoom, the same pinch over `#panel` MUST) — otherwise
  a broken gesture pipeline reads as a pass.
- **Park scrollers mid-range before asserting a swipe scrolls** (fr-zoi):
  `scrollIntoView({ block: "center" })` on a low element can pin the panel at
  max `scrollTop`, and a swipe in the only direction tested then reads
  "didn't scroll" when the truth is "no room". Set `scrollTop` to something
  like `min(60, max/2)` and exercise both directions.
- **Blink commits a range input's tap-jump on `pointerdown`** — before
  `touch-action: pan-y` can classify the gesture — and signals "this touch
  now pans" with **`pointercancel`** (touch events keep flowing; there is no
  `touchcancel`), even when the scroller has no room to move.
  `src/app/slider-scroll-guard.ts` is built on exactly that sequence;
  page-side event-log listeners (`pointerdown … pointercancel touchmove…`)
  are how it was established (fr-zoi).

## Gotchas

- `pkill -f "http.server 8737"` matches your own shell's command line and
  kills it. Kill by port instead: `fuser -k 8737/tcp`.
- `browser_take_screenshot` with a `filename` writes to the MCP server's cwd
  (repo root), not `.playwright-mcp/`; omit `filename` to get the image
  inline and auto-saved under `.playwright-mcp/` (gitignored).
- Playwright's element `target` accepts plain CSS selectors (`#updateBanner`)
  — no snapshot ref needed.
- At mobile widths the open panel (z-index 99) covers bottom overlays like
  the update banner (z-index 20) by design. Close the panel by clicking
  `#menuToggle` (the top-right ☰/✕ button) — it is the one open/close
  toggle; fr-ig0 removed the redundant, fully-covered `#panelClose`.
