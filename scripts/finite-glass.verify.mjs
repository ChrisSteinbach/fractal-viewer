/**
 * The finite-solid glass milestone's real-driver app gate (not an npm
 * script) — drives the BUILT app on a REAL X display (WebGPU through
 * Vulkan) through the exact path no unit test reaches: the preset's
 * document hash, the finite routing arm, the compute renderer, and a
 * settled frame with complete optical transport in every antialias sample.
 *
 *   npm run build && npm run preview &
 *   node scripts/finite-glass.verify.mjs --url=https://localhost:4173 [--display=:0]
 *   node scripts/finite-glass.verify.mjs --display=:0 --poses=study \
 *     --pose-report=bench-results/finite-glass-report.json --out=scripts/out/finite-poses
 *
 * The optional study sweep clones the current build's app-authored documents
 * and runs its frozen eight camera/rotor poses at 256x144, one sample. It
 * qualifies complete optical work at those poses, not their performance or
 * final appearance. Omitting --pose-report authors fresh presets first.
 * Every qualification run requests reduced motion before app boot so the
 * loaded camera/rotor cannot advance in Points before Surface entry. The
 * diagnostic --reduced-motion=no-preference reproduces the earlier moving
 * boot; it retains the same strict post-settle live-document checks.
 *
 * Legs (both dimensions — the posed 4D slice is HALF the milestone):
 *   0. Author each document FROM THE APP (load the glass preset, wait out
 *      the replace-load morph, read `#v1=`): a hand-built document is a
 *      trap — the strict decoder drops a partial one wholesale. Asserts
 *      the finiteSolid block and per-map optics are really in the
 *      document, including its authored camera and native posed 4D slice.
 *   1. Compute settle: enter Surface, wait on the `?surfacestate` latch
 *      (the settle discipline's own readout) and assert engine ===
 *      "compute", opticsBackend === "finiteSolid", a named hardware
 *      adapter, firstFrame, and a settled geometry census. Coverage alone
 *      says nothing about glass resolution: the floor also counts.
 *   2. Capture the live `?surfacetrace` console feed, which survives the
 *      app's bounded ring being truncated. Require every sample in the
 *      final settle token, in order, with a final transport tally and zero
 *      unresolved/invalid paths, march exhaustion or truncation. The
 *      accepted study completed every sample; a percentage is no waiver.
 *
 * Browser screenshots and finite-glass-report.json land in bench-results/.
 * The scene screenshot clips the live canvas to its panel-free viewport,
 * hiding DOM overlays without changing layout, projection or render state.
 * These are browser captures, not the app's separately gated Save-PNG export.
 * The report records exact documents, actual engine, raster, all sample tallies,
 * trace and PNG hashes, including on failure. Timing is observational, not
 * the separate frozen performance-envelope qualification. This gate does
 * not grant owner visual acceptance, export identity or lifecycle coverage.
 * Exit 1 is a verdict failure; a browser/launch failure says so (exit 2).
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { completionFailures, traceFrames } from "./lib/finite-glass-trace.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = {
  url: "https://localhost:4173",
  display: ":0",
  out: "bench-results",
  "reduced-motion": "reduce",
};
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}
if (args.poses !== undefined && args.poses !== "study")
  throw new Error("--poses must be study");
if (!["reduce", "no-preference"].includes(args["reduced-motion"]))
  throw new Error("--reduced-motion must be reduce or no-preference");
const poseSweep = args.poses === "study" || Boolean(args["pose-report"]);

// Frozen camera cases from transmission-dielectric-gpu.mjs's POSE_CHECK_CASES.
// Geometry rotations themselves are imported from the study's source below.
const STUDY_CAMERAS = {
  canonical: { eye: [2.1, 1.4, 3.2], target: [0, 0, 0] },
  grazing: { eye: [3.85, 0.28, 0.95], target: [0.05, -0.06, 0] },
  cornerAdjacent: { eye: [2.35, 2.25, 2.15], target: [-0.08, 0.07, 0.03] },
};
const STUDY_POSES = [
  { label: "menger3-canonical", dim: 3, camera: "canonical" },
  { label: "menger3-grazing", dim: 3, camera: "grazing" },
  { label: "menger3-cornerAdjacent", dim: 3, camera: "cornerAdjacent" },
  {
    label: "hyper4-canonical-canonical",
    dim: 4,
    camera: "canonical",
    hyperPose: "canonical",
  },
  {
    label: "hyper4-canonical-grazing",
    dim: 4,
    camera: "grazing",
    hyperPose: "canonical",
  },
  {
    label: "hyper4-canonical-cornerAdjacent",
    dim: 4,
    camera: "cornerAdjacent",
    hyperPose: "canonical",
  },
  {
    label: "hyper4-rotorA-grazing",
    dim: 4,
    camera: "grazing",
    hyperPose: "rotorA",
  },
  {
    label: "hyper4-rotorB-cornerAdjacent",
    dim: 4,
    camera: "cornerAdjacent",
    hyperPose: "rotorB",
  },
];

/** Use the production encoder and pose algebra, never a second rotor wire. */
async function studyPoseBuilder() {
  const { build } = await import("esbuild");
  const bundled = await build({
    stdin: {
      contents: `
import { decodeScene, encodeScene } from "./src/app/persist.ts";
import { presetCameraPose, presetRotorPair } from "./src/app/preset-view.ts";
import { rotorMatrix } from "./src/app/rotor4.ts";
import { rotationMatrix4 } from "./src/fractal/affine4.ts";
import { DIELECTRIC_HYPER_POSES } from "./scripts/transmission-dielectric-solid.ts";
export function poseDocument(hash, camera, hyperPose) {
  const snapshot = decodeScene("v1=" + hash);
  if (!snapshot?.finiteSolid || snapshot.finiteSolid.level !== 2)
    throw new Error("Production decoder refused finite preset source");
  snapshot.camera = presetCameraPose({camera: {...camera, fov: 360 * Math.atan(0.39) / Math.PI}});
  snapshot.surface.antialiasSamples = 1;
  let geometry = null;
  if (hyperPose) {
    geometry = DIELECTRIC_HYPER_POSES[hyperPose];
    if (!geometry || !snapshot.fourD) throw new Error("Missing native study pose");
    // rotationMatrix4's factors appear left-to-right in this order. Applying
    // their negatives on top of each prior view factor makes the inverse,
    // which the finite packer transposes back to the study query matrix.
    const rotation = ["yz", "xz", "xy", "xw", "yw", "zw"]
      .filter(plane => geometry.rotation[plane] !== undefined)
      .map(plane => [plane, -geometry.rotation[plane]]);
    const pair = presetRotorPair({rotation, w0: geometry.slice});
    const view = rotorMatrix(pair);
    const query = rotationMatrix4(geometry.rotation);
    if (query.some((value, i) => Math.abs(value - view[(i % 4) * 4 + Math.floor(i / 4)]) > 1e-12))
      throw new Error("Authored inverse rotor differs from frozen study matrix");
    snapshot.fourD = {...snapshot.fourD, pair, sliceOn: true, sliceW: geometry.slice, sliceThickness: 0};
  }
  const encoded = encodeScene(snapshot);
  const decoded = decodeScene(encoded);
  if (!decoded?.camera || decoded.finiteSolid?.level !== 2 ||
      (hyperPose && decoded.fourD?.sliceW !== geometry.slice))
    throw new Error("Production decoder dropped study pose fields");
  return {hash: encoded.slice(3), geometry};
}`,
      resolveDir: process.cwd(),
      loader: "ts",
      sourcefile: "finite-glass-study-poses.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
}

const log = (s) => console.log(`[finite-glass.verify] ${s}`);
mkdirSync(args.out, { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Preserve the settled projection: closing the panel would reframe/retrace. */
async function captureSceneScreenshot(page, path) {
  const framing = await page.evaluate(() => {
    const canvas = document.querySelector("#container canvas");
    if (!(canvas instanceof HTMLCanvasElement))
      throw new Error("the live scene canvas is missing");
    const rect = canvas.getBoundingClientRect();
    // Scene.setRightInset mirrors its actual inset here even while this
    // Points overlay is dormant. Unlike the panel's bounding box, this is
    // the inset used by the projection, including its desktop-only clamp.
    const rightInset = Number.parseFloat(
      document.getElementById("pointsViewGrid")?.style.right || "0",
    );
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const width = Math.min(innerWidth, rect.right - rightInset) - x;
    const height = Math.min(innerHeight, rect.bottom) - y;
    if (!(width > 0 && height > 0))
      throw new Error("the live scene viewport is empty");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      canvas: {
        width: canvas.width,
        height: canvas.height,
        cssBounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      },
      rightInsetCssPixels: rightInset,
      clip: { x, y, width, height },
    };
  });
  const mask = await page.addStyleTag({
    content: `
      body *, body *::before, body *::after { visibility: hidden !important; }
      #container canvas { visibility: visible !important; }
    `,
  });
  try {
    const png = await page.screenshot({ path, clip: framing.clip });
    return {
      kind: "browser-scene-screenshot",
      path,
      sha256: sha256(png),
      ...framing,
    };
  } finally {
    await mask.evaluate((style) => style.remove());
    await mask.dispose();
  }
}

const report = {
  startedAt: new Date().toISOString(),
  url: args.url,
  display: args.display,
  viewport: poseSweep
    ? { width: 256, height: 144 }
    : { width: 960, height: 640 },
  scope: poseSweep
    ? "Frozen eight study poses: finite completion at 256x144, one sample"
    : "Finite glass routing and complete settled transport in both dimensions",
  expectedLegs: poseSweep
    ? STUDY_POSES.map((pose) => pose.label)
    : ["menger3", "menger4"],
  ownerVisualAcceptance: "pending",
  performanceQualification: "not measured by this gate",
  media: { reducedMotion: args["reduced-motion"] },
  viewMotionScope:
    args["reduced-motion"] === "reduce"
      ? "Frozen authored view qualification"
      : "Diagnostic: automatic motion permitted; live view must still match",
  verdict: "checking-failed",
  failures: [],
  checkingFailures: [],
  legs: [],
};
const freshDist = await guardFreshDist({ url: args.url });
report.freshDist = freshDist;
try {
  report.gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  report.gitStatus = execFileSync("git", ["status", "--short"], {
    encoding: "utf8",
  });
} catch {
  report.gitHead = null;
}

const quiet = await quietBaseline((line) => log(line));
const contended = contendedReason(quiet);
report.quietBaseline = quiet;
report.timingCertified = quiet.contended === false && freshDist.checked;
if (contended) {
  log(
    `UNCERTIFIED: another process was already on the GPU — ${contended};` +
      " do not read this run's timing rows.",
  );
}

// Geometry coverage is a routing sanity check. The independent transport
// completion checks below are what prevent black unresolved glass passing.
const MIN_COVERED_FRACTION = 0.2;
const SETTLE_TIMEOUT_S = 300;

let browser;
let failed = false;
let checkingFailed = false;
const fail = (message) => {
  failed = true;
  report.failures.push(message);
  log(`FAIL ${message}`);
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
    viewport: report.viewport,
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ reducedMotion: args["reduced-motion"] });
  let activeLeg = null;
  page.on("pageerror", (e) => {
    fail(`PAGE ERROR: ${e.message}`);
  });
  page.on("console", (m) => {
    const message = m.text();
    if (activeLeg && message.startsWith("[surfacetrace] ")) {
      activeLeg.trace.push(message.slice("[surfacetrace] ".length));
    }
    if (m.type() === "error") {
      activeLeg?.consoleErrors.push(message);
      log(`console.error: ${message}`);
    }
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

  /** Load the actual preset and retain its own document, including its
   * framing. Hash and document are both evidence: no hidden camera patch
   * is allowed to make a broken or poorly framed preset pass. */
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
      async ({ name, want4D }) => {
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
        const expectedMaps = want4D ? 48 : 20;
        if (
          glassMaps.length !== expectedMaps ||
          glassMaps.length !== json.transforms.length
        ) {
          throw new Error(
            `${name}: only ${glassMaps.length}/${json.transforms.length} maps carry the Glass model`,
          );
        }
        if (want4D) {
          const pose = json.fourD;
          if (
            !pose?.sliceOn ||
            !Array.isArray(pose.p) ||
            !Array.isArray(pose.q)
          ) {
            throw new Error(`${name}: no sliced 4D pose in document`);
          }
          // Equal quaternion halves preserve w, including opposite-sign
          // representations. A nonzero difference in both sign choices
          // proves the view mixes the fourth coordinate into the slice.
          const same = Math.hypot(...pose.p.map((v, i) => v - pose.q[i]));
          const opposite = Math.hypot(...pose.p.map((v, i) => v + pose.q[i]));
          if (!(Math.min(same, opposite) > 1e-6)) {
            throw new Error(
              `${name}: pose preserves w; this is not the native posed slice`,
            );
          }
        }
        if (!json.camera || !Number.isFinite(json.camera.fov)) {
          throw new Error(`${name}: no authored camera/FOV in document`);
        }
        if (
          json.background?.mode !== "custom" ||
          json.background.top !== "#cdd6e1" ||
          json.background.bottom !== "#949aa8" ||
          (json.background.shape !== undefined &&
            json.background.shape !== "linear") ||
          !json.groundPlane ||
          json.surface?.floorPattern !== "checker"
        ) {
          throw new Error(
            `${name}: missing authored studio background or checker floor`,
          );
        }
        const label = document.getElementById(
          "surfaceAntialiasLabel",
        )?.textContent;
        const expectedSamples = Number(
          /^(\d+) samples\/pixel$/.exec(label ?? "")?.[1],
        );
        if (
          !Number.isInteger(expectedSamples) ||
          expectedSamples < 1 ||
          (json.surface.antialiasSamples !== undefined &&
            json.surface.antialiasSamples !== expectedSamples)
        ) {
          throw new Error(
            `${name}: antialias sample count is absent or disagrees with the document`,
          );
        }
        let copiedLink = null;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              copiedLink = text;
            },
          },
        });
        document.getElementById("copyLinkBtn").click();
        const copyDeadline = performance.now() + 10_000;
        while (copiedLink === null && performance.now() < copyDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (copiedLink === null)
          throw new Error(`${name}: Copy Link produced no payload`);
        const copiedHash = new URL(copiedLink).hash.slice(4);
        const copiedDocument = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(
              atob(
                copiedHash.replace(/-/g, "+").replace(/_/g, "/") +
                  "=".repeat((4 - (copiedHash.length % 4)) % 4),
              ),
              (c) => c.charCodeAt(0),
            ),
          ),
        );
        for (const field of ["camera", "fourD", "finiteSolid", "background"]) {
          if (
            JSON.stringify(copiedDocument[field]) !==
            JSON.stringify(json[field])
          ) {
            throw new Error(
              `${name}: persisted ${field} differs from the app's copied live document`,
            );
          }
        }
        return { hash: h, document: json, expectedSamples, copiedLink };
      },
      { name: preset, want4D: fourD },
    );
  };

  /** One dimension's compute leg: enter Surface and hold the session to
   * its own latch until it settles, then judge the census + tally. */
  const settleLeg = async (label, authored) => {
    const leg = {
      label,
      ...authored,
      documentSha256: sha256(JSON.stringify(authored.document)),
      trace: [],
      consoleErrors: [],
      state: null,
      settled: false,
    };
    report.legs.push(leg);
    activeLeg = leg;
    const started = performance.now();
    try {
      await page.goto(
        `${args.url}/?surfacestate&surfacetrace${poseSweep ? "&surfacesamples=1" : ""}&finiteglass=${label}#v1=${authored.hash}`,
      );
      await page.waitForFunction(
        () => typeof window.__surfaceState === "function",
      );
      if (!(await enterSurface())) {
        fail(`[${label}]: surface mode never became clickable`);
        return;
      }
      let state = null;
      let settled = false;
      for (let i = 0; i < SETTLE_TIMEOUT_S && !settled; i++) {
        await page.waitForTimeout(1000);
        state = await probe();
        leg.state = state;
        if (!state) continue;
        if (state.firstFrame && leg.firstFrameObservedMs === undefined) {
          leg.firstFrameObservedMs = performance.now() - started;
        }
        if (state.firstFrame && state.settled && !state.settleActive) {
          settled = true;
        }
      }
      if (!state) {
        fail(`[${label}]: ?surfacestate never answered`);
        return;
      }
      log(
        `[${label}] engine=${state.engine} opticsBackend=${state.opticsBackend}` +
          ` firstFrame=${state.firstFrame} settled=${settled}`,
      );
      if (state.engine !== "compute") {
        fail(`[${label}]: session did not route to the compute engine`);
      }
      if (state.opticsBackend !== "finiteSolid") {
        fail(`[${label}]: backend is ${state.opticsBackend}, not finiteSolid`);
      }
      if (
        !state.backend?.label ||
        state.backend.software ||
        /swiftshader|llvmpipe|software/i.test(state.backend.label)
      ) {
        checkingFailed = true;
        const reason = `[${label}]: no verified hardware adapter (${JSON.stringify(state.backend)})`;
        report.checkingFailures.push(reason);
        log(`CHECKING failure ${reason}`);
      }
      leg.settled = settled;
      leg.settleObservedMs = performance.now() - started;
      if (!settled) {
        fail(`[${label}]: no settled frame in ${SETTLE_TIMEOUT_S}s`);
        return;
      }
      const census = state.census;
      if (!census || census.rays === 0) {
        fail(`[${label}]: no settled census`);
        return;
      }
      const covered = census.covered / census.rays;
      log(
        `[${label}] census: covered=${census.covered}/${census.rays}` +
          ` (${(covered * 100).toFixed(1)}%) miss=${census.miss}` +
          ` exhausted=${census.exhausted}`,
      );
      if (!poseSweep && covered < MIN_COVERED_FRACTION) {
        fail(
          `[${label}]: covered fraction ${(covered * 100).toFixed(1)}%` +
            ` below the ${(MIN_COVERED_FRACTION * 100).toFixed(0)}% bar — the` +
            " session routed but did not draw the solid",
        );
      }
      // A page evaluation after the latch also drains earlier console events.
      leg.loadedHash = await page.evaluate(() => location.hash);
      if (poseSweep && census.rays !== 256 * 144)
        fail(
          `[${label}] settled raster is ${census.rays} rays, expected 256x144`,
        );
      // The address-bar hash is not a live camera/rotor observable: automatic
      // Points motion and gestures deliberately do not save every frame.
      // Read the actual scene shown after settle through the app's own share
      // action, and keep mismatched documents for diagnosing view drift.
      const liveEvidence = await page.evaluate(async () => {
        const previous = Object.getOwnPropertyDescriptor(
          navigator,
          "clipboard",
        );
        try {
          let copied = null;
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text) => {
                copied = text;
              },
            },
          });
          const button = document.getElementById("copyLinkBtn");
          if (!(button instanceof HTMLButtonElement) || button.disabled)
            throw new Error("Live scene Copy Link is unavailable");
          button.click();
          const deadline = performance.now() + 10_000;
          while (copied === null && performance.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 50));
          if (copied === null)
            throw new Error("Live scene Copy Link produced no payload");
          return {
            copiedLink: copied,
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
          };
        } finally {
          if (previous) Object.defineProperty(navigator, "clipboard", previous);
          else delete navigator.clipboard;
        }
      });
      leg.copiedLiveLink = liveEvidence.copiedLink;
      leg.reducedMotionObserved = liveEvidence.reducedMotion;
      if (liveEvidence.reducedMotion !== (args["reduced-motion"] === "reduce"))
        fail(`[${label}] browser reduced-motion media differs from requested`);
      const liveHash = new URL(liveEvidence.copiedLink).hash;
      if (!liveHash.startsWith("#v1="))
        throw new Error("Live scene Copy Link has an unexpected document wire");
      leg.liveDocument = JSON.parse(
        Buffer.from(liveHash.slice(4), "base64url").toString(),
      );
      leg.liveDocumentDifferences = [];
      for (const field of [
        "camera",
        "finiteSolid",
        "transforms",
        "background",
      ]) {
        if (
          JSON.stringify(leg.liveDocument[field]) !==
          JSON.stringify(authored.document[field])
        ) {
          leg.liveDocumentDifferences.push(field);
          fail(
            `[${label}] settled live ${field} differs from authored document`,
          );
        }
      }
      const authoredFourD = authored.document.fourD;
      const liveFourD = leg.liveDocument.fourD;
      if (Boolean(authoredFourD) !== Boolean(liveFourD)) {
        leg.liveDocumentDifferences.push("fourD");
        fail(`[${label}] settled live 4D pose presence differs from authored`);
      } else if (authoredFourD) {
        // sliceW names the physical hyperplane. sliceCenter is normalized
        // against a sampled cloud's support and can legitimately change on
        // reload while that world plane and the actual rotor stay fixed.
        // A legacy normalized-only document still gates its center exactly.
        const worldSlice = Number.isFinite(authoredFourD.sliceW);
        leg.fourDSliceComparison = {
          authority: worldSlice ? "world sliceW" : "normalized sliceCenter",
          normalizedCenter: {
            authored: authoredFourD.sliceCenter,
            live: liveFourD.sliceCenter,
            changed: authoredFourD.sliceCenter !== liveFourD.sliceCenter,
            scope: worldSlice ? "diagnostic only" : "required exact agreement",
          },
        };
        for (const field of [
          "p",
          "q",
          "sliceOn",
          "sliceW",
          "sliceThickness",
          "sliceRelColor",
          ...(worldSlice ? [] : ["sliceCenter"]),
        ]) {
          if (
            JSON.stringify(liveFourD[field]) !==
            JSON.stringify(authoredFourD[field])
          ) {
            leg.liveDocumentDifferences.push(`fourD.${field}`);
            fail(
              `[${label}] settled live fourD.${field} differs from authored pose`,
            );
          }
        }
      }
      leg.liveDocumentComparisonScope =
        "Exact authored camera, physical 4D pose, finite geometry, transforms and background; normalized sliceCenter is diagnostic when sliceW exists";
      leg.liveDocumentMatchesAuthored =
        leg.liveDocumentDifferences.length === 0;
      leg.frames = traceFrames(leg.trace);
      const last = leg.frames.at(-1);
      leg.finalSamples = leg.frames.filter(
        (frame) => frame.token === last?.token,
      );
      for (const message of completionFailures(
        leg.frames,
        authored.expectedSamples,
        census.rays,
      ))
        fail(`[${label}] ${message}`);
      for (const frame of leg.finalSamples) {
        const tally = frame.tallies[0];
        log(
          `[${label}] sample=${frame.sample}/${frame.samples} token=${frame.token} transport=${JSON.stringify(tally ?? null)}`,
        );
      }
    } finally {
      leg.elapsedMs = performance.now() - started;
      leg.frames ??= traceFrames(leg.trace);
      try {
        leg.raster = await page.evaluate(() => ({
          devicePixelRatio,
          canvases: [...document.querySelectorAll("#container canvas")].map(
            (canvas) => ({
              width: canvas.width,
              height: canvas.height,
              cssWidth: canvas.getBoundingClientRect().width,
              cssHeight: canvas.getBoundingClientRect().height,
            }),
          ),
        }));
        const path = `${args.out}/finite-glass-${label}.png`;
        const png = await page.screenshot({ path });
        leg.screenshot = {
          kind: "browser-page-screenshot",
          viewport: page.viewportSize(),
          path,
          sha256: sha256(png),
        };
        const scenePath = `${args.out}/finite-glass-${label}-scene.png`;
        leg.sceneScreenshot = await captureSceneScreenshot(page, scenePath);
      } catch (error) {
        checkingFailed = true;
        report.checkingFailures.push(
          `[${label}] screenshot failed: ${error.message}`,
        );
      }
      activeLeg = null;
    }
  };

  // ---- leg 0: author both documents from the app ----------------------
  let hash3 = null;
  let hash4 = null;
  try {
    if (poseSweep && args["pose-report"]) {
      const source = JSON.parse(readFileSync(args["pose-report"], "utf8"));
      if (
        source.verdict !== "pass" ||
        !freshDist.checked ||
        source.freshDist?.builtMs !== freshDist.builtMs
      )
        throw new Error(
          "Pose source must be a passing canonical report from this exact build",
        );
      const sources = [3, 4].map((dim) => {
        const leg = source.legs?.find((row) => row.label === `menger${dim}`);
        if (
          !leg?.hash ||
          !leg.document ||
          JSON.stringify(
            JSON.parse(Buffer.from(leg.hash, "base64url").toString()),
          ) !== JSON.stringify(leg.document)
        )
          throw new Error(
            `Pose source lacks a consistent app-authored ${dim}D document`,
          );
        return leg;
      });
      [hash3, hash4] = sources;
      report.poseSource = {
        path: args["pose-report"],
        freshDist: source.freshDist,
      };
    } else {
      hash3 = await authorDocument("glassMenger", { fourD: false });
      log(`3D document authored (${String(hash3.hash.length)} chars)`);
      hash4 = await authorDocument("glassMenger4", { fourD: true });
      log(`4D document authored (${String(hash4.hash.length)} chars)`);
    }
  } catch (e) {
    fail(`[author]: ${e.message}`);
  }

  if (poseSweep && hash3 && hash4) {
    const { poseDocument } = await studyPoseBuilder();
    for (const pose of STUDY_POSES) {
      const source = pose.dim === 3 ? hash3 : hash4;
      const authored = poseDocument(
        source.hash,
        STUDY_CAMERAS[pose.camera],
        pose.hyperPose,
      );
      await settleLeg(pose.label, {
        ...authored,
        document: JSON.parse(
          Buffer.from(authored.hash, "base64url").toString(),
        ),
        expectedSamples: 1,
        pose: { ...pose, cameraSpec: STUDY_CAMERAS[pose.camera] },
      });
    }
  } else if (!poseSweep) {
    if (hash3) await settleLeg("menger3", hash3);
    if (hash4) await settleLeg("menger4", hash4);
  }
  for (const label of report.expectedLegs) {
    if (report.legs.filter((leg) => leg.label === label).length !== 1)
      fail(`[${label}] required leg did not run exactly once`);
  }
} catch (e) {
  checkingFailed = true;
  report.checkingFailures.push(e.message);
  log(`CHECKING failure: ${e.message}`);
} finally {
  await browser?.close().catch((e) => {
    checkingFailed = true;
    report.checkingFailures.push(`browser cleanup: ${e.message}`);
  });
  report.finishedAt = new Date().toISOString();
  report.verdict = checkingFailed
    ? "checking-failed"
    : failed
      ? "fail"
      : "pass";
  writeFileSync(
    `${args.out}/${poseSweep ? "finite-glass-poses-report" : "finite-glass-report"}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  log(
    `report: ${args.out}/${poseSweep ? "finite-glass-poses-report" : "finite-glass-report"}.json`,
  );
}
if (checkingFailed) {
  log("exit 2 — a checking failure (browser/display), not a verdict");
  process.exit(2);
}
log(
  failed
    ? "FAIL"
    : "PASS — routing/completion only; owner visual acceptance pending",
);
process.exit(failed ? 1 : 0);
