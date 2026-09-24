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
 *   4. The owner-authored Glass flow, end to end: the general block
 *      authored from the panel on the Sierpinski document, then GLASS
 *      authored on the head map through the Finish group's bundle —
 *      FROM THE APP, never a hand-built document — then a reboot on the
 *      authored `#v1=` hash so the settled session is deterministic, then
 *      Surface with the word tree's own optical backend LIVE
 *      (`opticsBackend: "finiteSolid"`), complete transport in every
 *      antialias sample (the finite-glass gate's strict completion
 *      helpers), the drew-something coverage bar, and two Save-PNG
 *      exports byte for byte.
 *   5. The shaped read-only state: load the glassMenger preset, assert the
 *      checkbox reads checked+disabled beside its reason, the depth select
 *      reads 2, the eligibility note names the Menger route — and Surface
 *      enters on compute with the finiteSolid optics backend LIVE (the
 *      shipped byte-identical path serving the preset's own construction).
 *   6. Glass on the viewer's own ROTATING boot document (the box tree
 *      refused it; the simplicial tree's derived root admits it) at depth
 *      3, Glass authored from the panel on the head map AND the third map
 *      (the bundle must be ENABLED at each pick — a non-head map's Finish
 *      was once refused under the general block) — under the per-map media
 *      a MIXED session, two glass subtrees and two opaque: routed, the
 *      64-cell depth note, the section note's "2 of 4 maps are Glass", the
 *      finiteSolid optics backend LIVE, complete
 *      transport in every antialias sample, two Save-PNGs byte for byte
 *      (the first kept under scripts/out/ for the owner's look review).
 *   7. The same flow one dimension up on the pentatope preset at depth 2
 *      (25 cells; "1 of 5"): the 4D half, native posed slice.
 *   8. The owner's Menger document, Glass on maps 1 and 20 at depth 2.
 *   Legs 6-8 are MIXED blocks, so each asserts the COMPOSITE route
 *   (`finiteComposite` on the probe): the opaque maps render as the true
 *   attractor under the glass cells (finite-composite-route.ts).
 *
 * A behavior gate: no timing rows, no screenshots, no appearance claims.
 * Exit 1 is a verdict failure; a browser/display failure says so (exit 2).
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { completionFailures, traceFrames } from "./lib/finite-glass-trace.mjs";
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

/** Noise from the preview origin itself, not from the renderer (the
 * capture-export gate's own filter, same rig): the browser's fixed
 * service-worker-registration-failure log and register-sw.ts's echo of it.
 * Surface mode needs neither the worker nor cross-origin isolation, so
 * this is genuinely unrelated to anything under test here. */
const isKnownServiceWorkerSslNoise = (text) =>
  text === "An SSL certificate error occurred when fetching the script." ||
  (text.startsWith("Service worker registration failed:") &&
    text.includes("SecurityError") &&
    text.includes("sw.js") &&
    text.includes("SSL certificate error"));

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
    const message = m.text();
    // The owner-glass leg's trace feed: the app's ?surfacetrace debug
    // lines, captured only while that leg is active (the shipped legs'
    // scoping is untouched — they carry no trace array).
    if (activeLeg?.trace && message.startsWith("[surfacetrace] ")) {
      activeLeg.trace.push(message.slice("[surfacetrace] ".length));
      return;
    }
    if (m.type() === "error") {
      if (isKnownServiceWorkerSslNoise(message)) {
        log(`known preview-origin noise: ${message}`);
        return;
      }
      activeLeg?.consoleErrors.push(message);
      log(`console.error: ${message}`);
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
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const pngDimensions = (bytes) => {
    if (bytes.length < 24 || bytes.readUInt32BE(12) !== 0x49484452) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
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
  // Load the Sierpinski tetrahedron preset first (the owner's example
  // document, the hull root), wait out the replace-load morph, then check
  // the box. (The rotating boot document routes too — legs 6 and 7.)
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

  // ——— Leg 4: the owner-authored Glass flow, through export identity ———
  // The owner's own authoring path, end to end: the general block from the
  // panel, then GLASS on the head map through the Finish group's bundle
  // (from the app, never a hand-built document), a reboot on the authored
  // `#v1=` hash so the settled session is deterministic, Surface with the
  // word tree's own optical backend LIVE, complete transport in every
  // antialias sample, and two exports byte for byte.
  const glassLeg = leg("owner-glass-authored-and-exported");
  glassLeg.trace = [];
  await boot();
  await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    sel.value = "sierpinski";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(8000);
  await page.click("#glassSolidSection > summary");
  await page.click("#glassSolidEnabledCheckbox");
  await page.waitForTimeout(300);
  // The Finish group lives under the transforms section (the exclusive
  // accordion closes the Glass solid section — its block is already in the
  // document). The head map is the finite cores' ONE material slot
  // (firstChoice 0), so Glass lands on the list's first numbered transform.
  await page.click("#transformsSection > summary");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const buttons = document.getElementById("transformList").children;
    buttons[1].click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const details = [
      ...document.querySelectorAll("#transformEditor > details"),
    ].find((d) => d.querySelector("summary")?.textContent?.trim() === "Finish");
    if (details && !details.open) details.querySelector("summary")?.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const bundle = document.querySelector("#transformEditor .finish-bundle");
    bundle.value = "glass";
    bundle.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const authoredGlass = await decodeHash();
  if (JSON.stringify(authoredGlass?.finiteSolid) !== '{"level":1}') {
    fail(
      `the authored document carries ${JSON.stringify(authoredGlass?.finiteSolid)}, expected {level:1}`,
    );
  }
  const glassMaps = (authoredGlass?.transforms ?? []).filter(
    (t) => t.optics?.model === "dielectric",
  );
  if (
    glassMaps.length !== 1 ||
    authoredGlass?.transforms?.[0]?.optics?.model !== "dielectric"
  ) {
    fail(
      `expected Glass on the head map only, got ${glassMaps.length} dielectric map(s)`,
    );
  }
  // Reboot on the authored hash — the finite-glass recipe: the settled
  // session must reproduce the authored document deterministically. The
  // trace listener attaches from boot; the shipped legs keep their own
  // scoping untouched.
  const glassHash = await page.evaluate(() => location.hash);
  activeLeg = glassLeg;
  await page.goto(
    `${args.url.replace(/\/+$/, "")}/?surfacestate&surfacetrace${glassHash}`,
  );
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    undefined,
    { timeout: 60_000 },
  );
  await enterSurface(glassLeg);
  // The settle latch can fire before the trailing antialias passes finish;
  // the trace feed is the ground truth for completion: wait for the final
  // token's full sample set, each frame complete and untruncated.
  const expectedSamples = await page.evaluate(() => {
    const label = document.getElementById("surfaceAntialiasLabel")?.textContent;
    return Number(/^(\d+) samples\/pixel$/.exec(label ?? "")?.[1]);
  });
  if (!Number.isInteger(expectedSamples) || expectedSamples < 1) {
    fail(`the antialias label did not read a sample count: ${expectedSamples}`);
  }
  const glassDeadline = Date.now() + 240_000;
  for (;;) {
    const frames = traceFrames(glassLeg.trace);
    const last = frames.at(-1);
    let complete = false;
    if (last && Number.isInteger(last.token)) {
      const final = frames.filter((frame) => frame.token === last.token);
      complete =
        final.length === expectedSamples &&
        final.every((frame) => frame.completed);
    }
    if (complete) break;
    if (Date.now() > glassDeadline) {
      throw new Error(
        "timed out waiting for the owner-glass session's complete antialias settle",
      );
    }
    await page.waitForTimeout(500);
  }
  const glassState = await probe();
  if (glassState.opticsBackend !== "finiteSolid") {
    fail(
      `optics backend read ${glassState.opticsBackend}, expected finiteSolid (Glass authored on the head map)`,
    );
  }
  const census = glassState.census;
  if (!census || census.rays === 0) {
    fail(`no settled ray census: ${JSON.stringify(glassState.census)}`);
  } else {
    // A drew-nothing bar, not a quality line: the simplicial depth-1
    // gasket is four corner TETRAHEDRA (a tetrahedron fills about a sixth
    // of its box), measured 8.1% of the auto-fit frame where the retired
    // box tree's four corner boxes cleared 20%.
    const covered = census.covered / census.rays;
    if (covered < 0.05) {
      fail(
        `covered fraction ${(covered * 100).toFixed(1)}% below the 5% bar — the session routed but did not draw the solid`,
      );
    }
  }
  glassLeg.frames = traceFrames(glassLeg.trace);
  for (const message of completionFailures(
    glassLeg.frames,
    expectedSamples,
    census?.rays,
  )) {
    fail(`owner-glass: ${message}`);
  }
  const tallies = glassLeg.frames
    .filter((frame) => frame.token === glassLeg.frames.at(-1)?.token)
    .map((frame) => frame.tallies[0]);
  for (const frame of glassLeg.frames.filter(
    (frame) => frame.token === glassLeg.frames.at(-1)?.token,
  )) {
    if (Object.keys(frame.failureClasses).length > 0) {
      log(
        `[owner-glass] sample ${frame.sample} failure classes: ` +
          JSON.stringify(frame.failureClasses),
      );
    }
  }
  log(
    `[owner-glass] samples=${expectedSamples} rays=${census?.rays} transport=` +
      JSON.stringify(tallies.at(-1) ?? null),
  );
  // Export identity: two Save-PNG runs of the same settled session must be
  // byte for byte (the app's own export determinism, pinned for the general
  // word tree at the export seam the unit tests cannot reach).
  await page.click("#captureSection > summary");
  await page.selectOption("#exportScale", "1");
  const exports = [];
  for (const run of [1, 2]) {
    const promise = page.waitForEvent("download", { timeout: 120_000 });
    await page.click("#savePngBtn");
    const download = await promise;
    const bytes = readFileSync(await download.path());
    exports.push({
      run,
      bytes: bytes.length,
      dimensions: pngDimensions(bytes),
      sha256: sha256(bytes),
    });
  }
  activeLeg = null;
  if (exports[0].sha256 !== exports[1].sha256) {
    fail(
      `the two exports differ (${exports[0].bytes} vs ${exports[1].bytes} bytes)` +
        " — the general session's export is not reproducible",
    );
  }
  if (
    !exports[0].dimensions ||
    JSON.stringify(exports[0].dimensions) !==
      JSON.stringify(exports[1].dimensions)
  ) {
    fail(`the export dimensions read ${JSON.stringify(exports[0].dimensions)}`);
  }
  mkdirSync("scripts/out", { recursive: true });
  writeFileSync(
    "scripts/out/glass-media-owner-glass.trace.txt",
    [`hash ${glassHash}`, ...glassLeg.trace].join("\n"),
  );
  log(
    `[owner-glass] export identity: ${exports[0].bytes} bytes ` +
      `${exports[0].dimensions?.width}x${exports[0].dimensions?.height} ` +
      `sha ${exports[0].sha256.slice(0, 12)}…`,
  );

  // ——— Leg 5: the shaped block reads read-only and still serves optics ———
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

  // ——— Legs 6 and 7: Glass on documents the box tree refused ———
  // The simplicial construction's reason to exist, end to end in the app:
  // the viewer's own BOOT document (three of four maps rotate — the box
  // tree refused it, the derived root admits it) at depth 3, and the 4D
  // half on the pentatope preset at depth 2. Both authored FROM THE PANEL
  // (the block, then Glass on the head map through the Finish bundle),
  // rebooted on the authored hash, and gated on the word tree's own optics
  // backend LIVE with complete transport in every antialias sample.
  const simplicialGlassLeg = async (name, preset, depth, cells, glassMaps) => {
    const record = leg(name);
    record.trace = [];
    await boot();
    if (preset) {
      await page.evaluate((value) => {
        const sel = document.getElementById("presetSelect");
        sel.value = value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, preset);
      await page.waitForTimeout(8000);
    }
    await page.click("#glassSolidSection > summary");
    await page.click("#glassSolidEnabledCheckbox");
    await page.waitForTimeout(300);
    await page.selectOption("#glassSolidDepthSelect", String(depth));
    await page.waitForTimeout(300);
    const routed = await page.evaluate(() => ({
      note: document.getElementById("surfaceNote").textContent,
      depthNote: document.getElementById("glassSolidDepthNote").textContent,
    }));
    if (!routed.note.includes("Word-tree render")) {
      fail(`${name}: the eligibility note did not route: "${routed.note}"`);
    }
    if (!routed.depthNote.includes(String(cells))) {
      fail(
        `${name}: the depth note did not name the ${cells}-cell construction: "${routed.depthNote}"`,
      );
    }
    await page.click("#transformsSection > summary");
    await page.waitForTimeout(300);
    // Glass on each listed map (list row = map index + 1; row 0 is the
    // camera card). The bundle must be ENABLED at the pick: a scripted
    // value write succeeds on a disabled select, so without this check the
    // gate could not see a panel that refuses non-head maps (the owner's
    // report — the general Glass solid reads every map's material).
    for (const mapIndex of glassMaps) {
      await page.evaluate((row) => {
        document.getElementById("transformList").children[row].click();
      }, mapIndex + 1);
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const details = [
          ...document.querySelectorAll("#transformEditor > details"),
        ].find(
          (d) => d.querySelector("summary")?.textContent?.trim() === "Finish",
        );
        if (details && !details.open) details.querySelector("summary")?.click();
      });
      await page.waitForTimeout(200);
      const pickable = await page.evaluate(() => {
        const bundle = document.querySelector(
          "#transformEditor .finish-bundle",
        );
        if (!bundle || bundle.disabled) return false;
        bundle.value = "glass";
        bundle.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      if (!pickable) {
        fail(
          `${name}: map ${mapIndex + 1}'s Finish bundle is disabled at the Glass pick`,
        );
      }
      await page.waitForTimeout(500);
    }
    const authoredDoc = await decodeHash();
    if (JSON.stringify(authoredDoc?.finiteSolid) !== `{"level":${depth}}`) {
      fail(
        `${name}: the document carries ${JSON.stringify(authoredDoc?.finiteSolid)}, expected {level:${depth}}`,
      );
    }
    const glassIndices = (authoredDoc?.transforms ?? [])
      .map((t, i) => (t.optics?.model === "dielectric" ? i : -1))
      .filter((i) => i >= 0);
    if (JSON.stringify(glassIndices) !== JSON.stringify(glassMaps)) {
      fail(
        `${name}: Glass landed on maps ${JSON.stringify(glassIndices)}, expected ${JSON.stringify(glassMaps)}`,
      );
    }
    // The per-map media: the listed maps' subtrees are glass and every
    // other subtree opaque — the section note counts them.
    const mapCount = (authoredDoc?.transforms ?? []).length;
    const mediaNote = await page.evaluate(
      () => document.getElementById("glassSolidNote").textContent,
    );
    if (
      !mediaNote.includes(`${glassMaps.length} of ${mapCount} maps are Glass`)
    ) {
      fail(
        `${name}: the section note did not count the glass maps: "${mediaNote}"`,
      );
    }
    const hash = await page.evaluate(() => location.hash);
    activeLeg = record;
    await page.goto(
      `${args.url.replace(/\/+$/, "")}/?surfacestate&surfacetrace${hash}`,
    );
    await page.waitForFunction(
      () => typeof window.__surfaceState === "function",
      undefined,
      { timeout: 60_000 },
    );
    await enterSurface(record);
    const samples = await page.evaluate(() => {
      const label = document.getElementById(
        "surfaceAntialiasLabel",
      )?.textContent;
      return Number(/^(\d+) samples\/pixel$/.exec(label ?? "")?.[1]);
    });
    const deadline = Date.now() + 300_000;
    for (;;) {
      const frames = traceFrames(record.trace);
      const last = frames.at(-1);
      if (last && Number.isInteger(last.token)) {
        const final = frames.filter((frame) => frame.token === last.token);
        if (
          final.length === samples &&
          final.every((frame) => frame.completed)
        ) {
          break;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${name}'s complete settle`);
      }
      await page.waitForTimeout(500);
    }
    activeLeg = null;
    const state = await probe();
    if (state.opticsBackend !== "finiteSolid") {
      fail(
        `${name}: optics backend read ${state.opticsBackend}, expected finiteSolid`,
      );
    }
    // A mixed block renders its opaque maps as the attractor (the
    // composite route, finite-composite-route.ts) — every leg here is mixed.
    if (state.finiteComposite !== true) {
      fail(
        `${name}: the session did not take the composite route (finiteComposite=${state.finiteComposite})`,
      );
    }
    const legCensus = state.census;
    const covered = legCensus?.rays ? legCensus.covered / legCensus.rays : 0;
    if (covered < 0.05) {
      fail(
        `${name}: covered fraction ${(covered * 100).toFixed(1)}% — the session routed but did not draw the solid`,
      );
    }
    record.frames = traceFrames(record.trace);
    for (const message of completionFailures(
      record.frames,
      samples,
      legCensus?.rays,
    )) {
      fail(`${name}: ${message}`);
    }
    const lastToken = record.frames.at(-1)?.token;
    const finalFrames = record.frames.filter(
      (frame) => frame.token === lastToken,
    );
    const legTallies = finalFrames.map((frame) => frame.tallies[0]);
    // Recorded, never gated: the settle's summed per-sample frame wall and
    // its worst transport submission's GPU work (the watchdog question —
    // every segment also marches the opaque term under the composite).
    let token = null;
    let worstTransportMs = 0;
    for (const line of record.trace) {
      const start = / frame start .*token=(\d+)/.exec(line);
      if (start) token = Number(start[1]);
      const work = /transport pass=\d+ .*workMs=([\d.]+)/.exec(line);
      if (work && token === lastToken) {
        worstTransportMs = Math.max(worstTransportMs, Number(work[1]));
      }
    }
    record.settleWallMs = finalFrames.reduce(
      (sum, frame) => sum + (frame.wallMs || 0),
      0,
    );
    record.worstTransportMs = worstTransportMs;
    log(
      `[${name}] samples=${samples} rays=${legCensus?.rays} covered=${(covered * 100).toFixed(1)}% transport=` +
        JSON.stringify(legTallies.at(-1) ?? null),
    );
    log(
      `[${name}] settle (summed sample walls) ${(record.settleWallMs / 1000).toFixed(2)} s; worst transport submission ${worstTransportMs.toFixed(1)} ms`,
    );
    // Export identity for the MIXED-MEDIA session (a glass subtree in front
    // of opaque ones), and the export kept for the owner's look review.
    await page.click("#captureSection > summary");
    await page.selectOption("#exportScale", "1");
    const shots = [];
    for (const run of [1, 2]) {
      const promise = page.waitForEvent("download", { timeout: 180_000 });
      await page.click("#savePngBtn");
      const download = await promise;
      const bytes = readFileSync(await download.path());
      shots.push({ run, bytes, sha256: sha256(bytes) });
    }
    if (shots[0].sha256 !== shots[1].sha256) {
      fail(
        `${name}: the two exports differ — the mixed-media export is not reproducible`,
      );
    }
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(`scripts/out/glass-media-${name}.png`, shots[0].bytes);
    // The leg's document and settle trace, for profiling a slow leg
    // without rerunning the gate (regenerated, gitignored like the PNG).
    writeFileSync(
      `scripts/out/glass-media-${name}.trace.txt`,
      [`hash ${hash}`, ...record.trace].join("\n"),
    );
    log(
      `[${name}] export identity: ${shots[0].bytes.length} bytes sha ${shots[0].sha256.slice(0, 12)}… -> scripts/out/glass-media-${name}.png`,
    );
  };
  // The boot system is the "default" preset ("Twisted Tetrahedron"); load
  // it explicitly — a boot restores the previous leg's saved scene.
  await simplicialGlassLeg(
    "rotating-boot-document-glass",
    "default",
    3,
    64,
    [0, 2],
  );
  await simplicialGlassLeg("pentatope-4d-glass", "pentatope", 2, 25, [0]);
  // The owner's own document: the Menger maps with Glass on maps 1 and 20
  // (two opposite corners) at depth 2 — under the composite the other 18
  // maps render as the sponge itself, seen through the glass corners.
  await simplicialGlassLeg("menger-corners-glass", "menger", 2, 400, [0, 19]);
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
