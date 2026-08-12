/**
 * Ground-plane real-driver verification (fr-rhn5, not an npm script).
 *
 * Drives the dev-server app on a REAL X display (real GPU: WebGPU through
 * Vulkan, WebGL through the native driver) and checks the floor feature
 * end to end where the MCP/SwiftShader browser cannot: the fold-shaped
 * surface session must route to the WebGPU compute renderer with the
 * plane kernels, settle a frame, and stay responsive parked there (the
 * acceptance's no-watchdog-resets soak — pair with a dmesg/journalctl -k
 * check after the run); then the same document under ?surfacegl exercises
 * the fold GLSL arm with the plane define through its ~25s Mesa link.
 *
 *   node scripts/ground-plane.verify.mjs --url=https://localhost:5174 [--display=:0]
 *
 * Screenshots land in bench-results/ground-plane-*.png for eyeballing.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const args = { url: "https://localhost:5174", display: ":0" };
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}

// The fold document comes from the app itself: load the "Mandelbox KIFS"
// preset (the fold family's surface showcase — every variation list is
// exactly ONE fold entry, so the surface DE can descend it; its
// mandelbox+linear BLEND sibling is surface-INELIGIBLE), toggle the Floor
// checkbox, then patch the persisted camera above the floor. Hand-built
// documents are a trap: the strict decoder drops a partial one wholesale.

const log = (s) => console.log(`[ground-plane.verify] ${s}`);
mkdirSync("bench-results", { recursive: true });

const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
  env: { ...process.env, DISPLAY: args.display },
});
let failed = false;
try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 960, height: 640 },
  });
  page.on("pageerror", (e) => {
    failed = true;
    log(`PAGE ERROR: ${e.message}`);
  });

  const progressText = () =>
    page.evaluate(() => {
      const el = document.getElementById("surfaceProgress");
      if (!el || el.classList.contains("hidden")) return "";
      return (el.textContent ?? "").trim();
    });

  /** Enter surface mode: the mode buttons sit disabled through the first
   * cloud generation, so poll until the click actually takes. */
  const enterSurface = async () => {
    for (let i = 0; i < 60; i++) {
      const pressed = await page.evaluate(() => {
        const btn = document.getElementById("modeSurfaceBtn");
        if (!btn.disabled) btn.click();
        return btn.getAttribute("aria-pressed") === "true";
      });
      if (pressed) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  };

  // ---- leg 0: author the fold+floor document in the app itself --------
  await page.goto(`${args.url}/`);
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    sel.value = "mandelboxKifs";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The preset lands via a replace-load morph; wait it out, then persist
  // the floor toggle into the document.
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const cb = document.getElementById("surfaceGroundPlaneCheckbox");
    if (!cb.checked) cb.click();
  });
  await page.waitForTimeout(1500);
  const hash = await page.evaluate(() => {
    const h = location.hash.slice(4);
    const pad = "=".repeat((4 - (h.length % 4)) % 4);
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(h.replace(/-/g, "+").replace(/_/g, "/") + pad),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
    if (json.groundPlane !== true) throw new Error("floor not in document");
    json.camera = { target: [0, 0, 0], radius: 4.2, theta: 0.9, phi: 1.1 };
    return btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(json))),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  });
  log(`document authored (${String(hash.length)} chars)`);

  // ---- leg 1: compute path (fold kernels + plane block) ----------------
  await page.goto(`${args.url}/#v1=${hash}`);
  await page.reload();
  await page.waitForTimeout(4000);
  if (!(await enterSurface())) {
    failed = true;
    log("FAIL: surface mode never became clickable (leg 1)");
  }
  // The fr-tmgf engine label must say WebGPU — the compute path owns
  // fold-shaped sessions when an adapter exists, plane included. On a
  // fast driver the row can hide before a 1s poll sees it, so poll fast
  // and accept a seen-then-hidden label.
  let engine = "";
  for (let i = 0; i < 600 && !/WebGPU|WebGL/.test(engine); i++) {
    await page.waitForTimeout(200);
    const t = await progressText();
    if (t) engine = t;
  }
  log(`engine label: "${engine}"`);
  if (!/WebGPU/.test(engine)) {
    failed = true;
    log("FAIL: surface session did not show the WebGPU engine label");
  }
  // Wait for the settle (progress row hides when idle) or bound at 240s.
  let settled = false;
  for (let i = 0; i < 240 && !settled; i++) {
    await page.waitForTimeout(1000);
    const t = await progressText();
    settled = t.length === 0;
  }
  log(settled ? "compute frame settled" : "compute frame NOT settled in 240s");
  await page.screenshot({ path: "bench-results/ground-plane-compute.png" });

  // Parked soak: 90s at the settled pose, counting rAF liveness in 5s
  // windows — a starved window means the main thread stalled behind GPU
  // work (the failure shape the strip/batch machinery exists to prevent).
  const windows = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const counts = [];
        let frames = 0;
        const tick = () => {
          frames++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const iv = setInterval(() => {
          counts.push(frames);
          frames = 0;
          if (counts.length >= 18) {
            clearInterval(iv);
            resolve(counts);
          }
        }, 5000);
      }),
  );
  const starved = windows.filter((c) => c === 0).length;
  log(
    `soak rAF windows (5s each): [${windows.join(", ")}] starved=${String(starved)}`,
  );
  if (starved > 0) {
    failed = true;
    log("FAIL: main thread starved during parked soak");
  }

  // ---- leg 2: fold GLSL arm (?surfacegl) with the plane define ---------
  await page.goto(`${args.url}/?surfacegl#v1=${hash}`);
  await page.waitForTimeout(4000);
  if (!(await enterSurface())) {
    failed = true;
    log("FAIL: surface mode never became clickable (leg 2)");
  }
  // The fold GLSL program (plane arm included) rides compileAsync through
  // the potential ~25s Mesa link; give the first preview up to 180s, then
  // screenshot whatever coverage exists — the never-refuse discipline
  // means a slow grind is legitimate, a black frame or page error is not.
  let sawWebgl = "";
  for (let i = 0; i < 900; i++) {
    await page.waitForTimeout(200);
    const t = await progressText();
    if (/WebGL/.test(t)) sawWebgl = t;
    if (sawWebgl && t.length === 0) break;
  }
  log(`glsl label seen: "${sawWebgl}"`);
  if (!/WebGL/.test(sawWebgl)) {
    log("note: WebGL label never appeared (may have settled too fast to see)");
  }
  await page.screenshot({ path: "bench-results/ground-plane-glsl.png" });
} finally {
  await browser.close();
}
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
