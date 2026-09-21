/**
 * The Glass solid panel section's real-driver app gate (Phase 3 of the
 * general finite-solid work — the owner's authoring control). Not an npm
 * script: it drives the BUILT app in a real browser through the path no
 * unit test reaches — the checkbox, the document encode, the general
 * routing arm and the compute session.
 *
 *   npm run build && npm run preview &
 *   node scripts/glass-solid-panel.verify.mjs [--url=https://localhost:4173] [--display=:0]
 *
 * Legs:
 *   1. The general flow: click #glassSolidEnabledCheckbox, assert the
 *      depth row appears at depth 1, the eligibility note names the
 *      word-tree route, and the DOCUMENT carries `{level: 1}` — decoded
 *      from the `#v1=` hash, not read off the panel.
 *   2. Enter Surface: the session settles on the compute engine with a
 *      first frame and a settled census (estimator optics — no Glass
 *      authored on the default system).
 *   3. Depth rewrite: set depth 2, the session restarts and re-settles on
 *      compute, and the depth note discloses the 4-map construction's own
 *      cell count within the enumeration cap.
 *   4. The shaped read-only state: load the glassMenger preset, assert the
 *      checkbox reads checked+disabled beside its reason, the depth select
 *      reads 2, the eligibility note names the Menger route — and Surface
 *      enters on compute with the finiteSolid optics backend LIVE (the
 *      shipped byte-identical path serving the preset's own construction).
 *
 * A behavior gate: no timing rows, no screenshots, no appearance claims.
 * Exit 1 is a verdict failure; a browser/display failure says so (exit 2).
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = {
  url: "https://localhost:4173",
  display: ":0",
};
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}

const log = (s) => console.log(`[glass-solid-panel.verify] ${s}`);

const report = {
  startedAt: new Date().toISOString(),
  url: args.url,
  display: args.display,
  scope: "Glass solid panel: the general route's authoring, entry and restart",
  verdict: "checking-failed",
  failures: [],
  legs: [],
};
const freshDist = await guardFreshDist({ url: args.url });
report.freshDist = freshDist;
try {
  report.gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  report.gitHead = null;
}
const quiet = await quietBaseline((line) => log(line));
report.quietBaseline = quiet;
const contended = contendedReason(quiet);
if (contended) {
  log(
    `NOTE: another process was already on the GPU — ${contended}.` +
      " A behavior verdict still stands; no timing is read here.",
  );
}

let browser;
let failed = false;
let checkingFailed = false;
const fail = (message) => {
  failed = true;
  report.failures.push(message);
  log(`FAIL ${message}`);
};
const leg = (name) => {
  const record = { name, consoleErrors: [] };
  report.legs.push(record);
  log(`LEG ${name}`);
  return record;
};

try {
  browser = await chromium.launch({
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
  report.browser = browser.version();
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 960, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let activeLeg = null;
  page.on("pageerror", (e) => fail(`PAGE ERROR: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      activeLeg?.consoleErrors.push(m.text());
      log(`console.error: ${m.text()}`);
    }
  });

  const boot = async () => {
    const base = args.url.replace(/\/+$/, "");
    await page.goto(`${base}/?surfacestate`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pointCount");
        return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 60_000, polling: 100 },
    );
  };
  const probe = () => page.evaluate(() => window.__surfaceState?.() ?? null);
  const waitSurface = async (test, timeoutMs = 120_000, what = "state") => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await probe();
      if (state && test(state)) return state;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${what}: ${JSON.stringify(state)}`,
        );
      }
      await page.waitForTimeout(250);
    }
  };
  const decodeHash = () =>
    page.evaluate(() => {
      const h = location.hash.slice(4);
      if (!h) return null;
      const pad = "=".repeat((4 - (h.length % 4)) % 4);
      return JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(h.replace(/-/g, "+").replace(/_/g, "/") + pad),
            (c) => c.charCodeAt(0),
          ),
        ),
      );
    });
  const enterSurface = async (legRecord) => {
    for (let i = 0; i < 60; i++) {
      const pressed = await page.evaluate(() => {
        const btn = document.getElementById("modeSurfaceBtn");
        if (!btn.disabled) btn.click();
        return btn.getAttribute("aria-pressed") === "true";
      });
      if (pressed) break;
      await page.waitForTimeout(1000);
    }
    await waitSurface(
      (s) =>
        s.mode === "surface" &&
        s.engine === "compute" &&
        s.firstFrame === true &&
        s.settled === true,
      180_000,
      "the compute session's settled first frame",
    );
    if (legRecord.consoleErrors.length > 0) {
      fail(`${legRecord.name}: console errors ${legRecord.consoleErrors[0]}`);
    }
  };

  // ——— Leg 1: the general flow, authored FROM THE PANEL ———
  // The route needs the document's OWN diagonal contractions: load the
  // Sierpinski tetrahedron preset first (the owner's example document),
  // wait out the replace-load morph, then check the box. The default
  // system's maps rotate and the analyzer refuses them — which is the
  // refusal disclosure working, not a defect.
  const generalLeg = leg("general-block-authored-from-panel");
  await boot();
  await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    sel.value = "sierpinski";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(8000);
  // The section ships closed (the native exclusive-open accordion): open it
  // first, the same trusted gesture the owner makes.
  await page.click("#glassSolidSection > summary");
  await page.click("#glassSolidEnabledCheckbox");
  await page.waitForTimeout(300);
  const checkbox = await page.evaluate(() => ({
    checked: document.getElementById("glassSolidEnabledCheckbox").checked,
    depthHidden: document
      .getElementById("glassSolidDepthRow")
      .classList.contains("hidden"),
    depth: document.getElementById("glassSolidDepthSelect").value,
    note: document.getElementById("surfaceNote").textContent,
    sectionNote: document.getElementById("glassSolidNote").textContent,
  }));
  if (!checkbox.checked) fail("the checkbox did not latch checked");
  if (checkbox.depthHidden) fail("the depth row stayed hidden with a block");
  if (checkbox.depth !== "1") {
    fail(`the depth select read ${checkbox.depth}, expected 1`);
  }
  if (!checkbox.note.includes("Word-tree render")) {
    fail(
      `the eligibility note did not name the word-tree route: "${checkbox.note}"`,
    );
  }
  if (!checkbox.sectionNote.includes("contract")) {
    fail(
      `the section note did not name the admission limits: "${checkbox.sectionNote}"`,
    );
  }
  const authored = await decodeHash();
  if (
    authored === null ||
    JSON.stringify(authored.finiteSolid) !== '{"level":1}'
  ) {
    fail(
      `the document carries ${JSON.stringify(authored?.finiteSolid)}, expected {level:1}`,
    );
  }

  // ——— Leg 2: enter Surface on the general route ———
  const enterLeg = leg("general-session-enters-compute");
  await enterSurface(enterLeg);
  const entered = await probe();
  if (entered.opticsBackend !== "estimator") {
    fail(
      `optics backend read ${entered.opticsBackend}, expected estimator (no Glass authored)`,
    );
  }
  if (!entered.census || entered.census.traced === 0) {
    fail(`no settled ray census: ${JSON.stringify(entered.census)}`);
  }

  // ——— Leg 3: the depth rewrite restarts and re-settles ———
  const depthLeg = leg("depth-rewrite-restarts-and-settles");
  await page.selectOption("#glassSolidDepthSelect", "2");
  await page.waitForTimeout(500);
  const depthState = await page.evaluate(() => ({
    note: document.getElementById("glassSolidDepthNote").textContent,
    hash: null,
  }));
  if (!depthState.note.includes("16")) {
    fail(
      `the depth note did not name the 16-cell construction: "${depthState.note}"`,
    );
  }
  if (depthState.note.includes("refuse")) {
    fail(
      `the 4-map depth-2 note wrongly discloses the cap: "${depthState.note}"`,
    );
  }
  await waitSurface(
    (s) => s.mode === "surface" && s.engine === "compute" && s.settled === true,
    180_000,
    "the depth-2 session's re-settle",
  );
  const depthDoc = await decodeHash();
  if (JSON.stringify(depthDoc?.finiteSolid) !== '{"level":2}') {
    fail(
      `the document carries ${JSON.stringify(depthDoc?.finiteSolid)}, expected {level:2}`,
    );
  }

  // ——— Leg 4: the shaped block reads read-only and still serves optics ———
  const shapedLeg = leg("shaped-preset-reads-read-only");
  await page.goto(`${args.url}/?surfacestate`);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
  await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    sel.value = "glassMenger";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The preset lands via a replace-load morph; wait it out.
  await page.waitForTimeout(8000);
  const shaped = await page.evaluate(() => ({
    checked: document.getElementById("glassSolidEnabledCheckbox").checked,
    disabled: document.getElementById("glassSolidEnabledCheckbox").disabled,
    depth: document.getElementById("glassSolidDepthSelect").value,
    depthDisabled: document.getElementById("glassSolidDepthSelect").disabled,
    note: document.getElementById("glassSolidNote").textContent,
    eligibility: document.getElementById("surfaceNote").textContent,
  }));
  if (!shaped.checked) fail("the shaped block did not read checked");
  if (!shaped.disabled) fail("the checkbox stayed editable on a shaped block");
  if (!shaped.depthDisabled)
    fail("the depth select stayed editable on a shaped block");
  if (shaped.depth !== "2")
    fail(`the depth select read ${shaped.depth}, expected 2`);
  if (!shaped.note.includes("read-only")) {
    fail(`the shaped note did not name the read-only state: "${shaped.note}"`);
  }
  if (!shaped.eligibility.includes("Menger")) {
    fail(
      `the eligibility note did not name the Menger route: "${shaped.eligibility}"`,
    );
  }
  await enterSurface(shapedLeg);
  const shapedState = await probe();
  if (shapedState.opticsBackend !== "finiteSolid") {
    fail(
      `optics backend read ${shapedState.opticsBackend}, expected finiteSolid (the preset's Glass)`,
    );
  }
} catch (err) {
  checkingFailed = true;
  report.checkingFailure = err instanceof Error ? err.message : String(err);
  console.error(
    "[glass-solid-panel.verify] CHECKING FAILURE:",
    report.checkingFailure,
  );
} finally {
  await browser?.close().catch(() => {});
}

if (checkingFailed) {
  console.log(
    "[glass-solid-panel.verify] exit 2 — a checking failure (browser/display), not a verdict",
  );
  process.exit(2);
}
report.verdict = failed ? "fail" : "pass";
console.log(
  `[glass-solid-panel.verify] verdict=${report.verdict} legs=${report.legs.length} failures=${report.failures.length}`,
);
process.exit(failed ? 1 : 0);
