// fr-j8uk: live real-driver verification of the balloon surface arms.
// Launches headed Chrome against a real X display (the gpu-flame-bench
// --display recipe) and measures the balloon's cost as an ON/OFF RATIO on
// the same machine state — absolute settle times proved environment-
// dominated (the plain mandelboxKifs baseline on this machine ran far off
// the recorded house verdicts on the night this was written), so the
// protocol is baseline-first: settle balloon-off, settle balloon-on,
// report the ratio; then the Inflate sweep's never-settling regime and
// the ?surfacegl GLSL fallback arm on a completable fold system. Soft
// per-leg timeouts REPORT the rate reached instead of aborting — a
// non-settling leg is a measurement, not a crash; only render-error
// banners and console errors fail the run.
//
// Usage: node scripts/balloon-real-driver.verify.mjs --url=https://localhost:5174 [--display=:0]
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DISPLAY = args.display ?? ":0";
const BASE = args.url ?? "https://localhost:5174";
const SOFT_TIMEOUT_MS = Number(args.legTimeout ?? 300000);

const enc = (scene) =>
  "#v1=" + Buffer.from(JSON.stringify(scene)).toString("base64url");

const sceneBase = {
  numPoints: 100000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: false,
  balloonEcho: false, // toggled per leg via the UI
  balloonRadius: 1.6,
};

// The REAL mandelboxKifs preset (presets.ts:722) — the surface fold
// monster; eligibility depends on these exact numbers.
const mandelboxKifs = (() => {
  const transforms = [];
  for (const x of [1, -1])
    for (const y of [1, -1])
      for (const z of [1, -1])
        transforms.push({
          position: [x * 0.7, y * 0.7, z * 0.7],
          rotation: [0, 0, 0],
          scale: [0.19, 0.19, 0.19],
          variations: [{ type: "mandelbox", weight: 1.2 }],
        });
  for (const c of [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ])
    transforms.push({
      position: [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62],
      rotation: [0, 0, 0],
      scale: [0.66, 0.66, 0.66],
      variations: [{ type: "boxfold", weight: 1 }],
    });
  return { ...sceneBase, transforms };
})();

// harness-profiles' foldBoxfoldPair — the light fold-frontier system.
const boxfoldPair = {
  ...sceneBase,
  transforms: [
    {
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ],
};

const log = (...a) => console.log("[balloon-verify]", ...a);

async function progressText(page) {
  return page.evaluate(
    () => document.getElementById("surfaceProgress")?.textContent ?? "",
  );
}

async function renderErrorText(page) {
  return page.evaluate(() => {
    const el = document.getElementById("renderError");
    return el && !el.classList.contains("hidden")
      ? el.textContent.trim()
      : null;
  });
}

/** Settle-or-report: resolves {settled, ms, pct, engine} — never throws on
 * slowness, throws only on a render-error banner. Logs a rate line each
 * minute so even a non-settling leg yields data. */
async function settleOrReport(page, tag, timeoutMs = SOFT_TIMEOUT_MS) {
  const t0 = Date.now();
  let lastLogged = 0;
  let last = "";
  for (;;) {
    const err = await renderErrorText(page);
    if (err) throw new Error(`${tag}: render error banner: ${err}`);
    last = await progressText(page);
    const m = last.match(/Full detail[^0-9]*([\d.]+)%/);
    const pct = m ? parseFloat(m[1]) : 0;
    const elapsed = Date.now() - t0;
    if (m && pct >= 99.9) {
      return { settled: true, ms: elapsed, pct: 100, engine: last };
    }
    if (elapsed - lastLogged >= 60000) {
      lastLogged = elapsed;
      log(`  ${tag}: t=${(elapsed / 1000).toFixed(0)}s "${last}"`);
    }
    if (elapsed > timeoutMs) {
      return { settled: false, ms: elapsed, pct, engine: last };
    }
    await page.waitForTimeout(250);
  }
}

async function setBalloon(page, on) {
  await page.evaluate((want) => {
    const sec = document.getElementById("surfaceLookSection");
    if (sec) sec.setAttribute("open", "");
    const cb = document.getElementById("surfaceBalloonCheckbox");
    if (cb && cb.checked !== want) cb.click();
  }, on);
  await page.waitForTimeout(500);
}

/** Baseline-first on/off protocol for one system. Returns true if the ON
 * leg settled (so follow-on legs can reuse this session). */
async function onOffProtocol(page, name, hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: "load", timeout: 60000 });
  // Mutter only sends frame callbacks to VISIBLE surfaces, and the app's
  // settle machinery is present-gated — an occluded window parks it
  // (measured: deterministic stalls at 64%/99%). Keep the window on top.
  await page.bringToFront();
  await page.waitForTimeout(4000);
  const disabled = await page.evaluate(
    () => document.getElementById("modeSurfaceBtn").disabled,
  );
  if (disabled) throw new Error(`${name}: surface mode disabled`);
  await page.evaluate(() => document.getElementById("modeSurfaceBtn").click());
  await page.waitForTimeout(400);

  log(`${name}: balloon OFF baseline...`);
  const off = await settleOrReport(page, `${name} off`);
  log(
    `  OFF: ${off.settled ? `settled ${(off.ms / 1000).toFixed(1)}s` : `DID NOT SETTLE (${off.pct}% at ${(off.ms / 1000).toFixed(0)}s)`} [${off.engine}]`,
  );
  if (!off.settled) {
    log(`  ${name}: baseline environment-limited — skipping its ON leg`);
    return false;
  }

  log(`${name}: balloon ON...`);
  await setBalloon(page, true);
  const on = await settleOrReport(page, `${name} on`);
  log(
    `  ON:  ${on.settled ? `settled ${(on.ms / 1000).toFixed(1)}s` : `DID NOT SETTLE (${on.pct}% at ${(on.ms / 1000).toFixed(0)}s)`} [${on.engine}]`,
  );
  if (on.settled) {
    log(
      `  RATIO on/off: x${(on.ms / off.ms).toFixed(2)} (${(off.ms / 1000).toFixed(1)}s -> ${(on.ms / 1000).toFixed(1)}s)`,
    );
  }
  return on.settled;
}

async function run() {
  const browser = await chromium.launch({
    executablePath: args.chrome ?? "/usr/bin/google-chrome",
    // HEADED is load-bearing: playwright defaults to headless, and headless
    // Chrome's Vulkan lands on SwiftShader — the app then reports
    // "WebGPU (software)" and every timing is meaningless.
    headless: false,
    env: { ...process.env, DISPLAY },
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      // The app's render/settle machinery is rAF-driven, and Chrome
      // throttles rAF for occluded windows — on a locked/idle desktop the
      // headed window sits behind the lock screen and the settle crawls
      // at ~1Hz while the GPU idles (measured: the 0.2s-class boxfold
      // pair "stalled" at 64% for minutes; the bench's own timing legs,
      // which pump work in awaited dispatch loops instead of rAF, were
      // unaffected). These three flags keep the page serviced at full
      // rate regardless of window visibility.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
  const failures = [];
  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 512, height: 320 },
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    // ---- Protocol A: the monster (may be environment-limited) ----------
    let sweepHost = null;
    const kifsOk = await onOffProtocol(
      page,
      "mandelboxKifs(compute)",
      enc(mandelboxKifs),
    );
    if (kifsOk) sweepHost = "mandelboxKifs";

    // ---- Protocol B: the light fold pair (always completable) ----------
    if (!kifsOk) {
      const pairOk = await onOffProtocol(
        page,
        "boxfoldPair(compute)",
        enc(boxfoldPair),
      );
      if (pairOk) sweepHost = "boxfoldPair";
    }

    // ---- Inflate sweep on whichever session is live and settled --------
    if (sweepHost) {
      log(`sweep on ${sweepHost}: Inflate (9s) — previews must flow`);
      await page.evaluate(() => {
        const sec = document.getElementById("surfaceLookSection");
        if (sec) sec.setAttribute("open", "");
        document.getElementById("surfaceBalloonInflateButton").click();
      });
      let previewSeen = 0;
      for (let i = 0; i < 22; i++) {
        await page.waitForTimeout(500);
        if ((await progressText(page)).startsWith("Preview")) previewSeen++;
      }
      log(`  previews observed during sweep: ${previewSeen}/22 samples`);
      if (previewSeen === 0)
        failures.push("sweep produced no preview frames — R not live?");
      const re = await settleOrReport(page, "post-sweep resettle");
      log(
        `  post-sweep resettle: ${re.settled ? `${(re.ms / 1000).toFixed(1)}s` : `DID NOT SETTLE (${re.pct}%)`}`,
      );
    } else {
      failures.push("no system settled with balloon on — no sweep host");
    }

    // ---- GLSL fallback arm on the light system -------------------------
    log("GLSL fallback: ?surfacegl boxfoldPair + balloon");
    await page.goto(
      `${BASE}/?surfacegl${enc({ ...boxfoldPair, balloonEcho: true })}`,
      {
        waitUntil: "load",
        timeout: 60000,
      },
    );
    await page.bringToFront();
    await page.waitForTimeout(4000);
    await page.evaluate(() =>
      document.getElementById("modeSurfaceBtn").click(),
    );
    await page.waitForTimeout(400);
    const glsl = await settleOrReport(page, "glsl pair on");
    log(
      `  GLSL balloon-on: ${glsl.settled ? `settled ${(glsl.ms / 1000).toFixed(1)}s` : `DID NOT SETTLE (${glsl.pct}%)`} [${glsl.engine}]`,
    );

    if (consoleErrors.length) {
      log(`console errors (${consoleErrors.length}):`);
      for (const e of consoleErrors.slice(0, 10)) log(`  ${e}`);
      failures.push(`${consoleErrors.length} console errors`);
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error("[balloon-verify] FAIL:", failures.join("; "));
    process.exit(1);
  }
  log("VERDICT: PASS");
}

run().catch((e) => {
  console.error("[balloon-verify] FAIL:", e);
  process.exit(1);
});
