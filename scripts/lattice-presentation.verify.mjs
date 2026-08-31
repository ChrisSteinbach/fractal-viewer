#!/usr/bin/env node
/**
 * Mirrored-lattice presentation-edge measurement and regression gate.
 * It drives a production build through a real browser; the policy pair is a
 * renderer-only query diagnostic and never enters the #v1 document.
 *
 *   npm run build && npm run preview &
 *   node scripts/lattice-presentation.verify.mjs --display=:0 [--url=...]
 *
 * The candidate sheet uses one camera outside the largest carrier so every
 * frame contains ordinary long chords and grazing silhouette rays. It screens
 * hard 8R/10R/12R and 6->10R/8->10R/9->10R smooth fades on both WebGL and
 * WebGPU with the 3D inverse fixture. The accepted 8->10R policy is then
 * promoted through ground-plane and genuinely non-flat 4D inverse rows on
 * both engines, 3D/4D forward compute, paired depth-fog controls, and paired
 * DoF/radial-background capture rows.
 * Final-policy rows download a real Save PNG and compare it with the settled
 * live canvas at the exact authored camera.
 *
 * PNGs are decoded only after screenshot/download, in an offscreen 2D canvas.
 * This never reads the live WebGL canvas outside its renderer-owned rAF.
 *
 * MEASURED 2026-08-31, 800x500, verified Mesa Intel Iris Xe: 22/22 scene
 * rows passed. Hard 8/10/12R coverage was 45.17/47.99/49.02% in WebGL and
 * 45.16/47.99/49.02% in compute; 6/8/9->10R fades covered
 * 45.47/46.10/47.63%. The selected 8->10R pair reduced the analytic carrier
 * edge jump P95 from 48 to 9 while retaining 0.93 coverage points beyond an
 * 8R hard cut. Candidate engine mean-channel deltas were 0.013-0.014 with at
 * most 0.028% of pixels over delta 8. Promoted 3D/4D inverse/forward,
 * ground-plane and fog rows drew 15.89-64.78%; 4D inverse mask IoU was 1.0,
 * both fog comparisons differed by mean 14.42 with smooth carrier/plane
 * edges, and all ten Save PNGs matched their settled closed-panel live frames
 * (the compute DoF/radial-background row had mean channel delta 0.010; all
 * others were pixel-identical).
 *
 * Exit 0 = measured policy and parity verdicts passed.
 * Exit 1 = checking/setup failure; rerun, it is not a renderer verdict.
 * Exit 3 = a scene, edge, policy, capture, or backend verdict failed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(
  SCRIPT_DIR,
  "..",
  ".playwright-mcp",
  "lattice-presentation",
);
const POLL_MS = 250;
const BACKDROP_TOLERANCE = 10;
const STRUCTURAL_DELTA = 12;
const FINAL_FADE = 8;
const FINAL_WINDOW = 10;
const CAPTURE_MEAN_MAX = 0.5;
const CAPTURE_OVER8_MAX = 0.005;
const CAPTURE_MASK_IOU_MIN = 0.8;

const COMMON = {
  numPoints: 100_000,
  pointSize: 1,
  colorMode: "transform",
  colorGamma: 1,
  rampPaletteId: "legacy",
  fourDColor: "wBlueOrange",
  fourDDepthFade: false,
  renderStyle: "depthFade",
  showGuides: false,
  flame: {
    exposure: 1,
    iterations: 20_000_000,
    gamma: 2.4,
    vibrancy: 1,
    supersample: 2,
    estimatorRadius: 6,
    estimatorMinimumRadius: 0,
    estimatorCurve: 0.4,
    paletteId: "spectrum",
  },
  solid: {
    resolution: 192,
    iterations: 20_000_000,
    threshold: 0.3,
    lightAzimuth: 135,
    lightElevation: 50,
    ambient: 0.25,
    paletteId: "spectrum",
  },
  surface: {
    antialiasSamples: 1,
    lightAzimuth: 135,
    lightElevation: 50,
    ambient: 0.25,
    colorSource: "transform",
    paletteId: "spectrum",
    colorSpeed: 0.5,
  },
  symmetry: { order: 1, plane: "xz" },
  glowBrightness: 1,
  balloonEcho: false,
  balloonRadius: 1.6,
  fogDensity: 0,
  fogTint: "#ffffff",
  fogTintStrength: 0,
  groundPlane: false,
  background: { mode: "dark" },
};

const IFS3 = [
  [0.6532, 0.3771, 0.2667],
  [-0.6532, 0.3771, 0.2667],
  [0, -0.7542, 0.2667],
  [0, 0, -0.8],
].map((position) => ({
  position,
  rotation: [0, 0, 0],
  scale: [0.5, 0.5, 0.5],
}));

const IFS4 = [
  [[-0.6325, -0.3651, -0.2582], -0.2],
  [[0.6325, -0.3651, -0.2582], -0.2],
  [[0, 0.7303, -0.2582], -0.2],
  [[0, 0, 0.7746], -0.2],
  [[0, 0, 0], 0.8],
].map(([position, w]) => ({
  position,
  rotation: [0, 0, 0],
  scale: [0.5, 0.5, 0.5],
  w: { position: w },
}));

const ESCAPE3 = [
  {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
  },
];

const ESCAPE4 = [
  {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    w: { rotation: { xw: 0.4 } },
  },
  {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "boxfold", weight: 1.6 }],
  },
];

const LATTICE = { kind: "lattice", cellScale: 1.6 };

const FIXTURES = {
  ifs3Edge: {
    name: "ifs3-edge",
    transforms: IFS3,
  },
  ifs3Plane: {
    name: "ifs3-plane",
    transforms: IFS3,
    groundPlane: true,
  },
  escape3: { name: "escape3", transforms: ESCAPE3 },
  ifs4: { name: "ifs4", transforms: IFS4 },
  escape4: { name: "escape4", transforms: ESCAPE4 },
};

const CANDIDATES = [
  { name: "hard8", fade: 8, window: 8 },
  { name: "hard10", fade: 10, window: 10 },
  { name: "hard12", fade: 12, window: 12 },
  { name: "fade6-10", fade: 6, window: 10 },
  { name: "fade8-10", fade: 8, window: 10 },
  { name: "fade9-10", fade: 9, window: 10 },
];

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    display: undefined,
    settle: 180_000,
    capture: 240_000,
    viewport: "800x500",
    outdir: DEFAULT_OUT,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`unknown argument ${raw}`);
    const at = raw.indexOf("=");
    const key = raw.slice(2, at < 0 ? undefined : at);
    const value = at < 0 ? "" : raw.slice(at + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    if (key === "display") args.display = value || ":0";
    else if (key === "settle" || key === "capture") {
      args[key] = Number(value);
      if (!Number.isFinite(args[key]) || args[key] <= 0) {
        throw new Error(`--${key} wants a positive finite number`);
      }
    } else if (key === "url") args.url = value.replace(/\/+$/, "");
    else args[key] = value;
  }
  const viewport = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!viewport) throw new Error("--viewport wants WxH");
  args.width = Number(viewport[1]);
  args.height = Number(viewport[2]);
  return args;
}

function scene(fixture, fogDensity = 0, camera = undefined) {
  return {
    ...COMMON,
    transforms: fixture.transforms,
    tiling: LATTICE,
    groundPlane: fixture.groundPlane === true,
    fogDensity,
    ...(camera ? { camera } : {}),
  };
}

function encodeHash(document) {
  return `#v1=${Buffer.from(JSON.stringify(document), "utf8").toString("base64url")}`;
}

function edgeCamera(contentRadius) {
  return {
    target: [0, 0, 0],
    // Fixed against the largest 12R candidate, so candidate screenshots
    // compare policy rather than a changing view. The 100-unit document
    // clamp is mirrored here explicitly.
    radius: Math.min(100, Math.max(1, contentRadius * 12 * 2.2)),
    theta: 0.8,
    phi: 1.25,
  };
}

function launchOptions(args) {
  const env = { ...process.env };
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--ignore-certificate-errors",
    "--no-sandbox",
  ];
  if (args.display !== undefined) env.DISPLAY = args.display;
  else {
    delete env.DISPLAY;
    flags.push(
      "--headless=new",
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
    );
  }
  return { env, args: flags };
}

async function waitForBoot(page) {
  await page.waitForFunction(
    () => {
      const count = document.getElementById("pointCount")?.textContent ?? "";
      return (
        typeof window.__surfaceState === "function" &&
        Number(count.replace(/[^\d]/g, "")) > 0
      );
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}

async function settle(page, timeout) {
  let entered = false;
  let progressSeen = false;
  let state = null;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(() => ({
      state: window.__surfaceState?.() ?? null,
      progress: document.getElementById("surfaceProgress")?.textContent ?? "",
      progressVisible: !document
        .getElementById("surfaceProgress")
        ?.classList.contains("hidden"),
    }));
    state = sample.state;
    entered ||= state?.firstFrame === true;
    progressSeen ||=
      sample.progressVisible && sample.progress.trim().length > 0;
    if (state?.settled || (state && state.mode !== "surface")) break;
    await page.waitForTimeout(POLL_MS);
  }
  return { entered, progressSeen, state };
}

async function analyzePng(page, png, cameraRadius, carrierRadius) {
  return page.evaluate(
    async ({ base64, tolerance, edgeDelta, eyeRadius, windowRadius }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("presentation image decode unavailable");
      ctx.drawImage(image, 0, 0);
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      const rgb = (x, y) => {
        const at = (y * width + x) * 4;
        return [data[at], data[at + 1], data[at + 2]];
      };
      const maxDelta = (a, b) =>
        Math.max(
          Math.abs(a[0] - b[0]),
          Math.abs(a[1] - b[1]),
          Math.abs(a[2] - b[2]),
        );
      const edgeWidth = Math.max(2, Math.floor(width * 0.015));
      let total = 0;
      let ordinary = 0;
      let ordinaryPx = 0;
      let grazing = 0;
      let grazingPx = 0;
      const jumps = [];
      const floorJumps = [];
      const tanHalfFov = Math.tan(Math.PI / 6);
      const aspect = width / height;
      const rayChord = (x, y) => {
        const u = (((x + 0.5) / width) * 2 - 1) * aspect * tanHalfFov;
        const v = (1 - ((y + 0.5) / height) * 2) * tanHalfFov;
        const directionScale = Math.sqrt(1 + u * u + v * v);
        const impact = (eyeRadius * Math.hypot(u, v)) / directionScale;
        return impact < windowRadius
          ? 2 * Math.sqrt(windowRadius * windowRadius - impact * impact)
          : 0;
      };
      for (let y = 0; y < height; y++) {
        const leftSamples = [];
        const rightSamples = [];
        for (let x = 0; x < edgeWidth; x++) {
          leftSamples.push(rgb(x, y));
          rightSamples.push(rgb(width - 1 - x, y));
        }
        const mean = (samples, channel) =>
          samples.reduce((sum, p) => sum + p[channel], 0) / samples.length;
        const bg = [0, 1, 2].map(
          (channel) =>
            (mean(leftSamples, channel) + mean(rightSamples, channel)) / 2,
        );
        for (let x = 0; x < width; x++) {
          const foreground = maxDelta(rgb(x, y), bg) > tolerance;
          if (foreground) total++;
          const chord = rayChord(x, y);
          if (chord >= windowRadius * 1.5) {
            ordinaryPx++;
            if (foreground) ordinary++;
          } else if (chord > 0 && chord <= windowRadius * 0.75) {
            grazingPx++;
            if (foreground) grazing++;
          }
        }
        const v = (1 - ((y + 0.5) / height) * 2) * tanHalfFov;
        const ratio = windowRadius / eyeRadius;
        const projectedRadiusSq = (ratio * ratio) / (1 - ratio * ratio);
        const uSq = projectedRadiusSq - v * v;
        if (uSq >= 0) {
          const ndcX = Math.sqrt(uSq) / (aspect * tanHalfFov);
          const left = Math.round(((1 - ndcX) * width) / 2 - 0.5);
          const right = Math.round(((1 + ndcX) * width) / 2 - 0.5);
          const pair = [];
          if (left >= 1 && left + 1 < width) {
            pair.push(maxDelta(rgb(left - 1, y), rgb(left + 1, y)));
          }
          if (right - 1 >= 0 && right + 1 < width) {
            pair.push(maxDelta(rgb(right - 1, y), rgb(right + 1, y)));
          }
          jumps.push(...pair);
          if (y >= height * 0.6) floorJumps.push(...pair);
        }
      }
      jumps.sort((a, b) => a - b);
      floorJumps.sort((a, b) => a - b);
      const percentile = (values, q) =>
        values.length === 0
          ? 0
          : values[Math.min(values.length - 1, Math.floor(q * values.length))];
      return {
        width,
        height,
        coverage: total / (width * height),
        ordinaryCoverage: ordinary / Math.max(1, ordinaryPx),
        grazingCoverage: grazing / Math.max(1, grazingPx),
        edgeJumpP95: percentile(jumps, 0.95),
        edgeJumpOver12:
          jumps.filter((v) => v > edgeDelta).length / Math.max(1, jumps.length),
        floorJumpP95: percentile(floorJumps, 0.95),
      };
    },
    {
      base64: png.toString("base64"),
      tolerance: BACKDROP_TOLERANCE,
      edgeDelta: STRUCTURAL_DELTA,
      eyeRadius: cameraRadius,
      windowRadius: carrierRadius,
    },
  );
}

async function comparePngs(page, a, b) {
  return page.evaluate(
    async ({ a64, b64, tolerance }) => {
      async function decode(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("presentation diff decode unavailable");
        ctx.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const A = await decode(a64);
      const B = await decode(b64);
      if (A.width !== B.width || A.height !== B.height) {
        return {
          sizeMismatch: `${A.width}x${A.height}/${B.width}x${B.height}`,
        };
      }
      let sum = 0;
      let over8 = 0;
      let max = 0;
      let intersection = 0;
      let union = 0;
      let centerSum = 0;
      let centerOver8 = 0;
      let centerPixels = 0;
      let borderSum = 0;
      let borderOver8 = 0;
      let borderPixels = 0;
      const pixels = A.width * A.height;
      const edgeWidth = Math.max(2, Math.floor(A.width * 0.015));
      const rowBackdrop = (decoded, y) => {
        const sums = [0, 0, 0];
        for (let edge = 0; edge < edgeWidth; edge++) {
          for (const x of [edge, decoded.width - 1 - edge]) {
            const at = (y * decoded.width + x) * 4;
            for (let c = 0; c < 3; c++) sums[c] += decoded.data[at + c];
          }
        }
        return sums.map((value) => value / (edgeWidth * 2));
      };
      for (let y = 0; y < A.height; y++) {
        const aBackdrop = rowBackdrop(A, y);
        const bBackdrop = rowBackdrop(B, y);
        for (let x = 0; x < A.width; x++) {
          const at = (y * A.width + x) * 4;
          let delta = 0;
          let aBackdropDelta = 0;
          let bBackdropDelta = 0;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(A.data[at + c] - B.data[at + c]);
            sum += d;
            delta = Math.max(delta, d);
            aBackdropDelta = Math.max(
              aBackdropDelta,
              Math.abs(A.data[at + c] - aBackdrop[c]),
            );
            bBackdropDelta = Math.max(
              bBackdropDelta,
              Math.abs(B.data[at + c] - bBackdrop[c]),
            );
          }
          if (delta > 8) over8++;
          max = Math.max(max, delta);
          const center =
            x >= A.width * 0.25 &&
            x < A.width * 0.75 &&
            y >= A.height * 0.25 &&
            y < A.height * 0.75;
          if (center) {
            centerSum += delta;
            centerPixels++;
            if (delta > 8) centerOver8++;
          } else {
            borderSum += delta;
            borderPixels++;
            if (delta > 8) borderOver8++;
          }
          const aMask = aBackdropDelta > tolerance;
          const bMask = bBackdropDelta > tolerance;
          if (aMask && bMask) intersection++;
          if (aMask || bMask) union++;
        }
      }
      return {
        width: A.width,
        height: A.height,
        mean: sum / (pixels * 3),
        over8: over8 / pixels,
        max,
        maskIoU: intersection / Math.max(1, union),
        centerMean: centerSum / Math.max(1, centerPixels),
        centerOver8: centerOver8 / Math.max(1, centerPixels),
        borderMean: borderSum / Math.max(1, borderPixels),
        borderOver8: borderOver8 / Math.max(1, borderPixels),
      };
    },
    {
      a64: a.toString("base64"),
      b64: b.toString("base64"),
      tolerance: BACKDROP_TOLERANCE,
    },
  );
}

async function probeRadius(browser, args, fixture) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    const url = `${args.url}/?surfacestate&surfacecompute&latticewindow=10&latticefade=8${encodeHash(scene(fixture))}`;
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await waitForBoot(page);
    await page.click("#modeSurfaceBtn");
    await page.waitForFunction(
      () => window.__surfaceState?.().latticePresentation !== null,
      undefined,
      { timeout: args.settle, polling: POLL_MS },
    );
    const presentation = await page.evaluate(
      () => window.__surfaceState?.().latticePresentation ?? null,
    );
    if (!presentation)
      throw new Error(`${fixture.name}: no presentation probe`);
    return presentation.contentRadius;
  } finally {
    await context.close().catch(() => {});
  }
}

async function runRow(browser, args, row) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const force = row.arm === "webgl" ? "surfacegl" : "surfacecompute";
  const document = scene(row.fixture, row.fogDensity, row.camera);
  if (row.depthOfField) {
    document.surface = { ...document.surface, depthOfField: true };
  }
  if (row.background) document.background = row.background;
  const query =
    `surfacestate&${force}&latticewindow=${String(row.policy.window)}` +
    `&latticefade=${String(row.policy.fade)}&presentationcase=${row.label}`;
  const started = Date.now();
  try {
    await page.goto(`${args.url}/?${query}${encodeHash(document)}`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.bringToFront();
    await waitForBoot(page);
    await page.click("#modeSurfaceBtn");
    let settled = await settle(page, args.settle);
    if (
      await page
        .locator("#panel")
        .evaluate((panel) => panel.classList.contains("open"))
    ) {
      await page.click("#menuToggle");
      await page.waitForFunction(
        () => !document.getElementById("panel")?.classList.contains("open"),
      );
      await page.waitForTimeout(600);
      settled = await settle(page, args.settle);
    }
    const state = settled.state;
    const backendPass =
      args.display === undefined || state?.backend?.software === false;
    const policyPass =
      state?.latticePresentation?.contentRadius === row.contentRadius &&
      state?.latticePresentation?.fadeStartRadius ===
        row.contentRadius * row.policy.fade &&
      state?.latticePresentation?.outerRadius ===
        row.contentRadius * row.policy.window;
    // Element screenshots include fixed-position siblings composited above
    // the canvas. Hide that chrome without changing the viewport or authored
    // camera, so the live frame and Save PNG contain the same pixels.
    await page.evaluate(() => {
      for (const child of document.body.children) {
        if (child.tagName !== "MAIN" && child.tagName !== "SCRIPT") {
          child.setAttribute(
            "data-presentation-hidden",
            child.style.visibility,
          );
          child.style.visibility = "hidden";
        }
      }
    });
    const canvas = page.locator("#container canvas").first();
    const live = settled.entered
      ? await canvas.screenshot({ type: "png" })
      : null;
    const metrics = live
      ? await analyzePng(
          page,
          live,
          row.camera.radius,
          row.contentRadius * row.policy.window,
        )
      : null;
    let capture = null;
    let captureDiff = null;
    if (live && row.capture) {
      const downloadPromise = page.waitForEvent("download", {
        timeout: args.capture,
      });
      await page.evaluate(() => {
        const button = document.getElementById("savePngBtn");
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
          throw new Error("Save PNG button unavailable");
        }
        button.click();
      });
      const download = await downloadPromise;
      const downloadPath = await download.path();
      if (!downloadPath) throw new Error("Save PNG download has no path");
      capture = await readFile(downloadPath);
      captureDiff = await comparePngs(page, live, capture);
    }
    await mkdir(args.outdir, { recursive: true });
    if (live)
      await writeFile(path.join(args.outdir, `${row.label}-live.png`), live);
    if (capture) {
      await writeFile(
        path.join(args.outdir, `${row.label}-capture.png`),
        capture,
      );
    }
    const capturePass =
      !row.capture ||
      (captureDiff &&
        !captureDiff.sizeMismatch &&
        captureDiff.mean < CAPTURE_MEAN_MAX &&
        captureDiff.over8 < CAPTURE_OVER8_MAX &&
        captureDiff.maskIoU >= CAPTURE_MASK_IOU_MIN);
    const ok =
      settled.entered &&
      state?.settled === true &&
      state?.engine === row.arm &&
      backendPass &&
      policyPass &&
      metrics?.coverage > 0.001 &&
      metrics?.ordinaryCoverage > 0 &&
      metrics?.grazingCoverage > 0 &&
      capturePass &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0;
    return {
      ...row,
      ok,
      entered: settled.entered,
      progressSeen: settled.progressSeen,
      settled: state?.settled === true,
      engine: state?.engine ?? null,
      backend: state?.backend ?? null,
      backendPass,
      policyPass,
      metrics,
      captureDiff,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      live,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function printRow(result) {
  const m = result.metrics;
  const capture = result.captureDiff?.sizeMismatch
    ? `size=${result.captureDiff.sizeMismatch}`
    : result.captureDiff
      ? `mean=${result.captureDiff.mean.toFixed(3)} over8=${(
          result.captureDiff.over8 * 100
        ).toFixed(3)}% iou=${result.captureDiff.maskIoU.toFixed(3)}`
      : "n/a";
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"} ${result.label.padEnd(28)} ` +
      `engine=${String(result.engine).padEnd(7)} settled=${String(result.settled).padEnd(5)} ` +
      `draw=${m ? `${(m.coverage * 100).toFixed(2)}%` : "n/a"} ` +
      `ordinary=${m ? `${(m.ordinaryCoverage * 100).toFixed(2)}%` : "n/a"} ` +
      `grazing=${m ? `${(m.grazingCoverage * 100).toFixed(2)}%` : "n/a"}\n` +
      `  edgeP95=${m?.edgeJumpP95 ?? "n/a"} edge>12=${
        m ? `${(m.edgeJumpOver12 * 100).toFixed(1)}%` : "n/a"
      } floorP95=${m?.floorJumpP95 ?? "n/a"} capture=${capture} ` +
      `time=${(result.elapsedMs / 1000).toFixed(1)}s\n`,
  );
  for (const error of result.pageErrors)
    process.stdout.write(`  page: ${error}\n`);
  for (const error of result.consoleErrors)
    process.stdout.write(`  console: ${error}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    ...launchOptions(args),
  });
  const failures = [];
  try {
    const radii = new Map();
    for (const fixture of Object.values(FIXTURES)) {
      const radius = await probeRadius(browser, args, fixture);
      radii.set(fixture.name, radius);
      process.stdout.write(`PROBE ${fixture.name} R=${radius.toFixed(6)}\n`);
    }

    const rows = [];
    const candidateRadius = radii.get(FIXTURES.ifs3Edge.name);
    const candidateCamera = edgeCamera(candidateRadius);
    for (const policy of CANDIDATES) {
      for (const arm of ["webgl", "compute"]) {
        rows.push({
          label: `candidate-${policy.name}-${arm}`,
          fixture: FIXTURES.ifs3Edge,
          contentRadius: candidateRadius,
          camera: candidateCamera,
          policy,
          arm,
          fogDensity: 0,
          capture: policy.name === "fade8-10",
        });
      }
    }
    const finalPolicy = {
      name: "fade8-10",
      fade: FINAL_FADE,
      window: FINAL_WINDOW,
    };
    for (const [fixture, arm] of [
      [FIXTURES.ifs3Plane, "webgl"],
      [FIXTURES.ifs3Plane, "compute"],
      [FIXTURES.escape3, "compute"],
      [FIXTURES.ifs4, "webgl"],
      [FIXTURES.ifs4, "compute"],
      [FIXTURES.escape4, "compute"],
    ]) {
      const contentRadius = radii.get(fixture.name);
      rows.push({
        label: `final-${fixture.name}-${arm}`,
        fixture,
        contentRadius,
        camera: edgeCamera(contentRadius),
        policy: finalPolicy,
        arm,
        fogDensity: 0,
        capture: true,
      });
    }
    for (const arm of ["webgl", "compute"]) {
      rows.push({
        label: `final-ifs3-edge-${arm}-dof`,
        fixture: FIXTURES.ifs3Edge,
        contentRadius: candidateRadius,
        camera: candidateCamera,
        policy: finalPolicy,
        arm,
        fogDensity: 0,
        depthOfField: true,
        background: { mode: "haze", shape: "radial" },
        capture: true,
      });
    }
    for (const arm of ["webgl", "compute"]) {
      rows.push({
        label: `final-ifs3-plane-${arm}-fog`,
        fixture: FIXTURES.ifs3Plane,
        contentRadius: candidateRadius,
        camera: candidateCamera,
        policy: finalPolicy,
        arm,
        fogDensity: 0.8,
        capture: false,
      });
    }

    const results = [];
    for (const row of rows) {
      const result = await runRow(browser, args, row);
      results.push(result);
      printRow(result);
      if (!result.ok) failures.push(result.label);
    }

    const byLabel = new Map(results.map((result) => [result.label, result]));
    const coverage = (policy, arm) =>
      byLabel.get(`candidate-${policy}-${arm}`)?.metrics?.coverage;
    for (const arm of ["webgl", "compute"]) {
      const hard8 = coverage("hard8", arm);
      const hard10 = coverage("hard10", arm);
      const hard12 = coverage("hard12", arm);
      const fade6 = coverage("fade6-10", arm);
      const fade8 = coverage("fade8-10", arm);
      const fade9 = coverage("fade9-10", arm);
      const hard10Metrics = byLabel.get(`candidate-hard10-${arm}`)?.metrics;
      const fade8Metrics = byLabel.get(`candidate-fade8-10-${arm}`)?.metrics;
      const fade9Metrics = byLabel.get(`candidate-fade9-10-${arm}`)?.metrics;
      const selectionPass =
        [hard8, hard10, hard12, fade6, fade8, fade9].every(
          (value) => value !== undefined,
        ) &&
        hard10 - hard8 >= 0.02 &&
        hard12 - hard10 <= 0.015 &&
        Math.abs(fade6 - hard8) <= 0.007 &&
        fade8 - hard8 >= 0.005 &&
        hard10 - fade8 >= 0.01 &&
        hard10 - fade9 <= 0.007 &&
        hard10Metrics?.edgeJumpP95 >= 30 &&
        fade8Metrics?.edgeJumpP95 <= 12 &&
        fade8Metrics?.edgeJumpOver12 <= 0.055 &&
        fade9Metrics?.edgeJumpP95 > fade8Metrics?.edgeJumpP95 &&
        fade8Metrics?.ordinaryCoverage >= 0.7 &&
        fade8Metrics?.grazingCoverage >= 0.4 &&
        candidateCamera.radius > candidateRadius * 12;
      process.stdout.write(
        `${selectionPass ? "PASS" : "FAIL"} policy selection ${arm}: ` +
          `hard 8/10/12=${[hard8, hard10, hard12]
            .map((value) => `${(value * 100).toFixed(2)}%`)
            .join("/")} fade 6/8/9->10=${[fade6, fade8, fade9]
            .map((value) => `${(value * 100).toFixed(2)}%`)
            .join("/")}\n`,
      );
      if (!selectionPass) failures.push(`policy selection ${arm}`);
    }

    const decodeContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const decodePage = await decodeContext.newPage();
    try {
      for (const policy of CANDIDATES) {
        const webgl = byLabel.get(`candidate-${policy.name}-webgl`);
        const compute = byLabel.get(`candidate-${policy.name}-compute`);
        if (!webgl?.live || !compute?.live) {
          failures.push(`candidate parity ${policy.name}`);
          continue;
        }
        const parity = await comparePngs(decodePage, webgl.live, compute.live);
        const parityPass =
          !parity.sizeMismatch &&
          parity.mean <= 0.05 &&
          parity.over8 <= 0.0005 &&
          parity.maskIoU >= 0.999;
        process.stdout.write(
          `${parityPass ? "PASS" : "FAIL"} candidate parity ${policy.name}: ` +
            `mean=${parity.mean?.toFixed(3) ?? "n/a"} ` +
            `over8=${parity.over8 === undefined ? "n/a" : `${(parity.over8 * 100).toFixed(3)}%`}\n`,
        );
        if (!parityPass) failures.push(`candidate parity ${policy.name}`);
      }
      for (const arm of ["webgl", "compute"]) {
        const hard = byLabel.get(`candidate-hard10-${arm}`);
        const fade = byLabel.get(`candidate-fade8-10-${arm}`);
        if (!hard?.live || !fade?.live) {
          failures.push(`candidate comparison ${arm}`);
          continue;
        }
        const diff = await comparePngs(decodePage, hard.live, fade.live);
        const fadeEffectPass =
          !diff.sizeMismatch && diff.mean >= 0.5 && diff.over8 >= 0.005;
        process.stdout.write(
          `${fadeEffectPass ? "PASS" : "FAIL"} hard10/fade8-10 ${arm}: ` +
            `mean=${diff.mean?.toFixed(3) ?? "n/a"} ` +
            `over8=${diff.over8 === undefined ? "n/a" : `${(diff.over8 * 100).toFixed(3)}%`} ` +
            `center=${diff.centerMean?.toFixed(3) ?? "n/a"} ` +
            `border=${diff.borderMean?.toFixed(3) ?? "n/a"}\n`,
        );
        if (!fadeEffectPass) failures.push(`fade effect ${arm}`);
      }
      for (const arm of ["webgl", "compute"]) {
        const plane = byLabel.get(`final-ifs3-plane-${arm}`);
        const fog = byLabel.get(`final-ifs3-plane-${arm}-fog`);
        if (!plane?.live || !fog?.live) {
          failures.push(`ground/fog comparison ${arm}`);
        } else {
          const fogDiff = await comparePngs(decodePage, plane.live, fog.live);
          const groundFadePass =
            !fogDiff.sizeMismatch &&
            fogDiff.mean >= 1 &&
            plane.metrics?.edgeJumpP95 <= 12 &&
            plane.metrics?.floorJumpP95 <= 8 &&
            fog.metrics?.edgeJumpP95 <= 12 &&
            fog.metrics?.floorJumpP95 <= 8;
          process.stdout.write(
            `${groundFadePass ? "PASS" : "FAIL"} ground/fog fade ${arm}: ` +
              `mean=${fogDiff.mean?.toFixed(3) ?? "n/a"} ` +
              `edge=${plane.metrics?.edgeJumpP95 ?? "n/a"}/${fog.metrics?.edgeJumpP95 ?? "n/a"} ` +
              `floor=${plane.metrics?.floorJumpP95 ?? "n/a"}/${fog.metrics?.floorJumpP95 ?? "n/a"}\n`,
          );
          if (!groundFadePass) failures.push(`ground/fog fade ${arm}`);
        }
      }
      for (const fixtureName of ["ifs3-plane", "ifs4"]) {
        const webgl = byLabel.get(`final-${fixtureName}-webgl`);
        const compute = byLabel.get(`final-${fixtureName}-compute`);
        if (!webgl?.live || !compute?.live) {
          failures.push(`final parity ${fixtureName}`);
          continue;
        }
        const parity = await comparePngs(decodePage, webgl.live, compute.live);
        const parityPass =
          !parity.sizeMismatch &&
          parity.maskIoU >= 0.95 &&
          parity.over8 <= 0.25;
        process.stdout.write(
          `${parityPass ? "PASS" : "FAIL"} final parity ${fixtureName}: ` +
            `mean=${parity.mean?.toFixed(3) ?? "n/a"} ` +
            `over8=${parity.over8 === undefined ? "n/a" : `${(parity.over8 * 100).toFixed(3)}%`} ` +
            `iou=${parity.maskIoU?.toFixed(3) ?? "n/a"}\n`,
        );
        if (!parityPass) failures.push(`final parity ${fixtureName}`);
      }
    } finally {
      await decodeContext.close().catch(() => {});
    }

    process.stdout.write(
      `lattice-presentation: ${String(results.filter((result) => result.ok).length)}/${String(results.length)} rows passed\n`,
    );
    if (failures.length > 0) {
      process.stdout.write(`FAILURES: ${failures.join(", ")}\n`);
      process.exitCode = 3;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("lattice-presentation: checking failure", error);
  process.exitCode = 1;
});
