#!/usr/bin/env node
/**
 * The optical transport's RESOLVE gate — the smallest real-browser repro
 * of the boundary-query repair class, promoted from the session-local
 * bisect probe when the repair landed (the follow-ups bead's promotion
 * item). Per fixture it boots the built app in a real browser, enters
 * Surface from the UI, waits for the TRUE settled latch, and asserts the
 * settled transport's LAST-pass resolved fraction clears the fixture's
 * floor — the black-pixel question in one number, tally-asserted.
 *
 * WHY THESE TWO. `oneBox3` is one glass box: oblique faces drive grazing
 * TIR crawls along the walls and near-miss grazes at the silhouette —
 * the geometry the pre-repair query stranded (19% resolved, the frame
 * black). `oneSphere3` is the near-normal control the class must not
 * regress (76% pre-repair). The box's floor sits well under its measured
 * resolve so a machine/pose variance cannot flake it; the sphere's sits
 * under its own.
 *
 * MEASURED (this script's own runs, radeonsi RX 7900 XTX, 1024x640,
 * compute, settled): oneBox3 97.1%, oneSphere3 99.95%.
 *
 * Exit codes: 0 pass, 3 fail, 2 inconclusive (no compute engine, a
 * software rasterizer, the settle never landed, or no transport line —
 * the tally is the only observable), 1 harness failure.
 */
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { LONE_SOLID_SCENES } from "./lib/optics-fixtures.mjs";

function parseArgs(argv) {
  const out = { url: "https://localhost:4173", display: undefined };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display" && value) out.display = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const log = (line) => console.log(`[transport-resolve] ${line}`);

await guardFreshDist();
const quiet = await quietBaseline(console.error, { display: args.display });
const contended = contendedReason(quiet);
if (contended) {
  log(`NOTE: another process was already on the GPU — ${contended}.`);
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
  ...(args.display !== undefined
    ? { env: { ...process.env, DISPLAY: args.display } }
    : {}),
});

const failures = [];
let inconclusive = null;
try {
  for (const scene of Object.values(LONE_SOLID_SCENES)) {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 640 },
    });
    const pageErrors = [];
    page.on("pageerror", (error) =>
      pageErrors.push(`pageerror: ${error.message}`),
    );
    const t0 = Date.now();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `${args.url}/?surfacestate&surfacetrace&surfacesamples=1#${scene.hash}`,
      { waitUntil: "load", timeout: 60000 },
    );
    await page.waitForFunction(
      () => typeof window.__surfaceState === "function",
      { timeout: 30000 },
    );
    await page.click("#modeSurfaceBtn");
    let state = null;
    while (Date.now() - t0 < 240000) {
      state = await page.evaluate(() => window.__surfaceState?.() ?? null);
      if (state?.settled) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const trace = await page.evaluate(() =>
      (window.__surfaceTraceLog ?? [])
        .filter((line) => /transport done final/.test(line))
        .slice(-1),
    );
    const engineOk =
      state?.settled &&
      state.engine === "compute" &&
      state.backend?.software === false;
    let resolved = null;
    const match = trace[0]?.match(
      /transport done final resolved=(\d+) unresolved=(\d+)/,
    );
    if (match) {
      const total = Number(match[1]) + Number(match[2]);
      resolved = total > 0 ? Number(match[1]) / total : 0;
    }
    log(
      `${scene.name}: settled=${Boolean(state?.settled)} engine=${state?.engine ?? "null"} software=${state?.backend?.software ?? "null"} resolved=${resolved === null ? "n/a" : (resolved * 100).toFixed(1) + "%"} floor=${(scene.floor * 100).toFixed(0)}%`,
    );
    if (!engineOk) {
      inconclusive ??=
        "the session never settled on a hardware compute engine — the tally is not observable";
    } else if (resolved === null) {
      inconclusive ??= `${scene.name}: no transport tally line — the lane never ran`;
    } else if (resolved < scene.floor) {
      failures.push(
        `${scene.name}: resolved ${(resolved * 100).toFixed(1)}% below the ${(scene.floor * 100).toFixed(0)}% floor`,
      );
    }
    await page.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}

if (inconclusive) {
  log(`INCONCLUSIVE: ${inconclusive}`);
  process.exit(2);
}
if (failures.length > 0) {
  for (const f of failures) log(`FAIL  ${f}`);
  process.exit(3);
}
log("PASS");
