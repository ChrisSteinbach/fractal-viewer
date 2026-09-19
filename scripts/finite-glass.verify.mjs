/**
 * The finite-solid glass milestone's real-driver app gate (not an npm
 * script) — drives the BUILT app on a REAL X display (WebGPU through
 * Vulkan) through the exact path no unit test reaches: the preset's
 * document hash, the finite routing arm, the compute renderer, and a
 * settled frame whose census proves the solid actually drew.
 *
 *   npm run build && npm run preview &
 *   node scripts/finite-glass.verify.mjs --url=https://localhost:4173 [--display=:0]
 *
 * Legs (both dimensions — the posed 4D slice is HALF the milestone):
 *   0. Author each document FROM THE APP (load the glass preset, wait out
 *      the replace-load morph, read `#v1=`): a hand-built document is a
 *      trap — the strict decoder drops a partial one wholesale. Asserts
 *      the finiteSolid block and per-map optics are really in the
 *      document, then patches the camera and re-encodes.
 *   1. Compute settle: enter Surface, wait on the `?surfacestate` latch
 *      (the settle discipline's own readout) and assert engine ===
 *      "compute", opticsBackend === "finiteSolid" (the finite routing
 *      arm's answer), firstFrame, and a settled census whose covered
 *      fraction clears the milestone bar (a routed-but-black session
 *      would be exactly the transport's unresolved failure).
 *   2. Trace tally: with `?surfacetrace`, read the "transport done final
 *      resolved=" line — the LAST pass's split (the black-pixel verdict),
 *      not the cumulative one — off `window.__surfaceTraceLog`.
 *
 * Screenshots land in bench-results/finite-glass-*.png for eyeballing.
 * Exit 1 is a verdict failure; a browser/launch failure says so (exit 2).
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = { url: "https://localhost:4173", display: ":0" };
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}

const log = (s) => console.log(`[finite-glass.verify] ${s}`);
mkdirSync("bench-results", { recursive: true });

const quiet = await quietBaseline((line) => log(line));
const contended = contendedReason(quiet);
if (contended) {
  log(
    `UNCERTIFIED: another process was already on the GPU — ${contended};` +
      " do not read this run's timing rows.",
  );
}

// The covered-fraction bar: a settled finite frame at the authored view
// fills a large majority of the pane (the solid is the frame's subject);
// a transport that unresolved to black would crater this. Deliberately
// generous — this gate judges ROUTING and non-blackness, not framing.
const MIN_COVERED_FRACTION = 0.2;
const SETTLE_TIMEOUT_S = 300;

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
let checkingFailed = false;
try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 960, height: 640 },
  });
  page.on("pageerror", (e) => {
    failed = true;
    log(`PAGE ERROR: ${e.message}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") log(`console.error: ${m.text()}`);
  });

  const probe = () => page.evaluate(() => window.__surfaceState?.() ?? null);

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

  /** Author one glass document in the app itself; returns the camera-
   * patched hash. The double-prefix bug: the app prepends `#v1=` itself
   * on goto — hand the RAW base64url only. */
  const authorDocument = async (preset, { fourD }) => {
    await page.goto(`${args.url}/`);
    await page.waitForTimeout(5000);
    await page.evaluate((name) => {
      const sel = document.getElementById("presetSelect");
      sel.value = name;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, preset);
    // The preset lands via a replace-load morph; wait it out.
    await page.waitForTimeout(8000);
    return page.evaluate(
      ({ name, want4D }) => {
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
        const block = json.finiteSolid;
        if (!block)
          throw new Error(`${name}: no finiteSolid block in document`);
        const wantShape = want4D ? "hyperMenger" : "menger";
        if (block.shape !== wantShape || block.level !== 2) {
          throw new Error(
            `${name}: finiteSolid ${JSON.stringify(block)} is not ${wantShape}@2`,
          );
        }
        const glassMaps = json.transforms.filter(
          (t) => t.optics?.model === "dielectric",
        );
        if (glassMaps.length !== json.transforms.length) {
          throw new Error(
            `${name}: only ${glassMaps.length}/${json.transforms.length} maps carry the Glass model`,
          );
        }
        if (want4D && !json.fourD) {
          throw new Error(`${name}: no 4D pose in document`);
        }
        json.camera = {
          target: [0, 0, 0],
          radius: want4D ? 3.4 : 2.9,
          theta: 0.9,
          phi: 1.1,
        };
        return btoa(
          String.fromCharCode(
            ...new TextEncoder().encode(JSON.stringify(json)),
          ),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      },
      { name: preset, want4D: fourD },
    );
  };

  /** One dimension's compute leg: enter Surface and hold the session to
   * its own latch until it settles, then judge the census + tally. */
  const settleLeg = async (label, hash) => {
    await page.goto(`${args.url}/?surfacestate&surfacetrace#v1=${hash}`);
    await page.reload();
    await page.waitForTimeout(4000);
    if (!(await enterSurface())) {
      failed = true;
      log(`FAIL [${label}]: surface mode never became clickable`);
      return;
    }
    let state = null;
    let settled = false;
    for (let i = 0; i < SETTLE_TIMEOUT_S && !settled; i++) {
      await page.waitForTimeout(1000);
      state = await probe();
      if (!state) continue;
      if (state.firstFrame && state.settled && !state.settleActive) {
        settled = true;
      }
    }
    if (!state) {
      failed = true;
      log(`FAIL [${label}]: ?surfacestate never answered`);
      return;
    }
    log(
      `[${label}] engine=${state.engine} opticsBackend=${state.opticsBackend}` +
        ` firstFrame=${state.firstFrame} settled=${settled}`,
    );
    if (state.engine !== "compute") {
      failed = true;
      log(`FAIL [${label}]: session did not route to the compute engine`);
    }
    if (state.opticsBackend !== "finiteSolid") {
      failed = true;
      log(
        `FAIL [${label}]: backend is ${state.opticsBackend}, not finiteSolid`,
      );
    }
    if (!settled) {
      failed = true;
      log(`FAIL [${label}]: no settled frame in ${SETTLE_TIMEOUT_S}s`);
      return;
    }
    const census = state.census;
    if (!census || census.rays === 0) {
      failed = true;
      log(`FAIL [${label}]: no settled census`);
      return;
    }
    const covered = census.covered / census.rays;
    log(
      `[${label}] census: covered=${census.covered}/${census.rays}` +
        ` (${(covered * 100).toFixed(1)}%) miss=${census.miss}` +
        ` exhausted=${census.exhausted}`,
    );
    if (covered < MIN_COVERED_FRACTION) {
      failed = true;
      log(
        `FAIL [${label}]: covered fraction ${(covered * 100).toFixed(1)}%` +
          ` below the ${(MIN_COVERED_FRACTION * 100).toFixed(0)}% bar — the` +
          " session routed but did not draw the solid",
      );
    }
    // The transport's LAST-pass split — the black-pixel verdict (the
    // cumulative tally re-counts every replay retry, so only the final
    // line reads as "how much of this frame is unresolved work").
    const tally = await page.evaluate(() => {
      const lines = window.__surfaceTraceLog ?? [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = /transport done final resolved=(\d+) unresolved=(\d+)/.exec(
          lines[i],
        );
        if (m) return { resolved: Number(m[1]), unresolved: Number(m[2]) };
      }
      return null;
    });
    if (tally) {
      const total = tally.resolved + tally.unresolved;
      log(
        `[${label}] transport final: resolved=${tally.resolved}` +
          ` unresolved=${tally.unresolved}` +
          ` (${total ? ((tally.resolved / total) * 100).toFixed(1) : "0.0"}% resolved)`,
      );
    } else {
      log(`[${label}] transport tally: no final line in the trace log`);
    }
    await page.screenshot({
      path: `bench-results/finite-glass-${label}.png`,
    });
  };

  // ---- leg 0: author both documents from the app ----------------------
  let hash3 = null;
  let hash4 = null;
  try {
    hash3 = await authorDocument("glassMenger", { fourD: false });
    log(`3D document authored (${String(hash3.length)} chars)`);
    hash4 = await authorDocument("glassMenger4", { fourD: true });
    log(`4D document authored (${String(hash4.length)} chars)`);
  } catch (e) {
    failed = true;
    log(`FAIL [author]: ${e.message}`);
  }

  if (hash3) await settleLeg("menger3", hash3);
  if (hash4) await settleLeg("menger4", hash4);
} catch (e) {
  checkingFailed = true;
  log(`CHECKING failure: ${e.message}`);
} finally {
  await browser.close();
}
if (checkingFailed) {
  log("exit 2 — a checking failure (browser/display), not a verdict");
  process.exit(2);
}
log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
