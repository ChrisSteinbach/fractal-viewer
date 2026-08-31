#!/usr/bin/env node
/**
 * Mirrored-lattice Surface browser gate. This is not an npm script because
 * it drives a production build through a real browser:
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-lattice.verify.mjs [--display=:0] [--url=…]
 *
 * All fixtures are embedded JSON documents encoded to `#v1=` at runtime, so
 * the route matrix stays independent of panel layout and exercises the same
 * document boundary as an imported or copied link. The separate panel and
 * exact-numeric gates own authoring interaction. This matrix covers:
 *
 *   - 3D inverse IFS lattice: forced WebGL and forced WebGPU;
 *   - 3D forward escape lattice: forced WebGL and WebGPU;
 *   - genuinely non-flat 4D inverse lattice: forced WebGL and WebGPU;
 *   - genuinely 4D forward escape lattice: its compute-only route;
 *   - the 3D inverse lattice with the ground plane: both engines.
 *
 * Every leg must enter Surface from the real mode button, reach the
 * `?surfacestate` settled latch, draw a non-backdrop share in a SCREENSHOT,
 * retain its authored lattice block in the document hash, and report the
 * expected engine. `?surfacegl` forces fragment WebGL; `?surfacecompute`
 * forces compute where the production routing rule otherwise prefers WebGL
 * and is harmless on already-compute routes. With `--display`, every leg
 * must additionally report a non-software backend, making the compute rows
 * a real-display WebGPU gate rather than a SwiftShader exercise.
 *
 * On top of the per-leg matrix the gate asserts THREE distinctness pairs
 * (untiled vs finite-tiled vs lattice on the SAME transforms and camera —
 * a knob that never reaches the renderer draws the same picture twice) and
 * one persisted-document reload (the current `#v1=` hash re-enters Surface
 * and settles on the restored camera). The UI gate separately clicks the
 * app's Copy Link control for the authored lattice arm.
 *
 * NOTE on headless SwiftShader: the fold WEBGL arms settle only with a
 * generous budget (the software rasterizer is 10-50x slower than a real
 * driver; the compute arms settle fine). The shipped qualification runs
 * on a verified display, exactly like the finite gate.
 *
 * Screenshot PNGs are decoded through an offscreen 2D canvas only AFTER
 * capture; this never calls getImageData on the live WebGL canvas (that
 * readback is empty outside its own rAF).
 *
 * MEASURED 2026-08-31 on verified Mesa Intel Iris Xe with the shipped 8-pass
 * settle: all ten routed lattice rows exposed progress, settled, drew and
 * retained their document on the expected hardware engine. Coverage ranged
 * 34.32-74.67%; untiled/finite/lattice pair differences were
 * 8.10%/25.09%/25.07%, and the persisted-document reload differed by 7.87%
 * under its 15% rerender ceiling.
 *
 * Options:
 *   --url=URL        app origin (default https://localhost:4173)
 *   --display=:0     headed X11 run; omit for headless SwiftShader
 *   --settle=MS      per-leg settle budget (default 180000)
 *   --viewport=WxH   browser viewport (default 800x500)
 *   --draw=FRACTION  minimum non-backdrop screenshot share (default 0.005)
 *   --diff=FRACTION  minimum structural diff floor (default 0.01)
 *   --outdir=PATH    screenshot directory (default .playwright-mcp/surface-lattice)
 *
 * Exit 0 = every leg and comparison passed.
 * Exit 1 = CHECKING/setup failure (bad args, browser/navigation/image decode);
 *          rerun — this is not a renderer verdict.
 * Exit 3 = a scene verdict failed (entry, settle, draw, document, backend,
 *          engine, page error, distinctness, or reload); failing rows print.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(
  SCRIPT_DIR,
  "..",
  ".playwright-mcp",
  "surface-lattice",
);
const POLL_MS = 250;
const NON_BACKDROP_TOLERANCE = 10;
const STRUCTURAL_DELTA = 12;
const OVERLAYS = [
  "#panel",
  "#help",
  "#legend",
  "#menuToggle",
  "#loading",
  "#error",
  "#updateBanner",
  "#renderError",
  "#toast",
];

const COMMON_DOCUMENT = {
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
    // The shipped eight-pass settle keeps even the fastest one-dispatch
    // compute fixtures in the user-visible progress state before the latch.
    antialiasSamples: 8,
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
  fogDensity: 0.8,
  fogTint: "#ffffff",
  fogTintStrength: 0,
  groundPlane: false,
  background: { mode: "dark" },
};

const HALF_SCALE = [0.5, 0.5, 0.5];
const ZERO_ROTATION = [0, 0, 0];

/** A3-aligned tetrahedron: the chamber vertex's four-point orbit. */
const IFS3_TRANSFORMS = [
  [0.6532, 0.3771, 0.2667],
  [-0.6532, 0.3771, 0.2667],
  [0, -0.7542, 0.2667],
  [0, 0, -0.8],
].map((position) => ({
  position,
  rotation: ZERO_ROTATION,
  scale: HALF_SCALE,
}));

/** A4-aligned pentatope: non-flat because every map carries authored w. */
const IFS4_TRANSFORMS = [
  [[-0.6325, -0.3651, -0.2582], -0.2],
  [[0.6325, -0.3651, -0.2582], -0.2],
  [[0, 0.7303, -0.2582], -0.2],
  [[0, 0, 0.7746], -0.2],
  [[0, 0, 0], 0.8],
].map(([position, w]) => ({
  position,
  rotation: ZERO_ROTATION,
  scale: HALF_SCALE,
  w: { position: w },
}));

const ESCAPE3_TRANSFORMS = [
  {
    position: [0, 0, 0],
    rotation: ZERO_ROTATION,
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
  },
];

/** W rotation keeps the forward family genuinely 4D, not a flat lift. */
const ESCAPE4_TRANSFORMS = [
  {
    position: [0, 0, 0],
    rotation: ZERO_ROTATION,
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    w: { rotation: { xw: 0.4 } },
  },
  {
    position: [0, 0, 0],
    rotation: ZERO_ROTATION,
    scale: [1, 1, 1],
    variations: [{ type: "boxfold", weight: 1.6 }],
  },
];

/** Lattice cell scale: 1.6R cells keep the canonical cell's copies inside
 * the frozen 10R window with several mirrored rows visible. */
const LATTICE_CELL_SCALE = 1.6;

const LATTICE = { kind: "lattice", cellScale: LATTICE_CELL_SCALE };

const LATTICE_CLIP = {
  parts: [
    {
      primitive: { kind: "sphere", radius: 0.55 },
      combine: "union",
      pose: { offset: [1.3064, 0.7542, 0.5333] },
    },
  ],
};

function sceneDocument(transforms, tiling, extra = {}) {
  return {
    ...COMMON_DOCUMENT,
    transforms,
    tiling,
    ...extra,
  };
}

const FIXTURES = [
  {
    name: "ifs3",
    family: "inverse 3D lattice",
    document: sceneDocument(IFS3_TRANSFORMS, LATTICE),
    arms: ["webgl", "compute"],
  },
  {
    name: "ifs3-clip",
    family: "inverse 3D lattice + analytic clip",
    document: sceneDocument(IFS3_TRANSFORMS, {
      ...LATTICE,
      clip: LATTICE_CLIP,
    }),
    arms: ["webgl"],
  },
  {
    name: "escape3",
    family: "forward 3D lattice",
    document: sceneDocument(ESCAPE3_TRANSFORMS, LATTICE),
    arms: ["webgl", "compute"],
  },
  {
    name: "ifs4",
    family: "inverse 4D lattice",
    document: sceneDocument(IFS4_TRANSFORMS, LATTICE),
    arms: ["webgl", "compute"],
  },
  {
    name: "escape4",
    family: "forward 4D lattice",
    document: sceneDocument(ESCAPE4_TRANSFORMS, LATTICE),
    arms: ["compute"],
  },
  {
    name: "ifs3-plane",
    family: "inverse 3D lattice + ground plane",
    document: sceneDocument(IFS3_TRANSFORMS, LATTICE, { groundPlane: true }),
    arms: ["webgl", "compute"],
  },
];

/** The distinctness trio: SAME transforms, SAME authored camera, three
 * tiling blocks. A knob that never reaches the renderer draws the same
 * picture three times — the pair diffs must clear the floor. */
const DISTINCTNESS_TRIO = [
  {
    name: "untiled",
    document: sceneDocument(IFS3_TRANSFORMS, undefined),
  },
  {
    name: "finite-a3",
    document: sceneDocument(IFS3_TRANSFORMS, { group: "a3" }),
  },
  {
    name: "lattice",
    document: sceneDocument(IFS3_TRANSFORMS, LATTICE),
  },
];

/** The trio's authored camera: the app's default orbit pose pinned into the
 * document so the three sessions frame IDENTICALLY (the lattice session's
 * entry camera-fit would otherwise re-frame the canonical cell and the
 * comparison would measure framing instead of content). */
const TRIO_CAMERA = {
  camera: {
    theta: 0.8,
    phi: 1.15,
    distance: 4.2,
    target: [0, 0, 0],
  },
};

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    display: undefined,
    settle: 180_000,
    viewport: "800x500",
    draw: 0.005,
    diff: 0.01,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`unknown argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    if (key === "display") args.display = value || ":0";
    else if (["settle", "draw", "diff"].includes(key)) {
      args[key] = Number(value);
      if (!Number.isFinite(args[key])) {
        throw new Error(`--${key} wants a finite number`);
      }
    } else if (key === "url") args.url = value.replace(/\/+$/, "");
    else args[key] = value;
  }
  const viewport = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!viewport) {
    throw new Error(`--viewport wants WxH (got ${args.viewport})`);
  }
  args.width = Number(viewport[1]);
  args.height = Number(viewport[2]);
  if (args.width < 320 || args.height < 240) {
    throw new Error("--viewport must be at least 320x240");
  }
  if (args.settle <= 0 || args.draw < 0 || args.diff < 0) {
    throw new Error("--settle must be positive and fractions nonnegative");
  }
  if (!args.url) throw new Error("--url must not be empty");
  return args;
}

function encodeHash(document) {
  return `#v1=${Buffer.from(JSON.stringify(document), "utf8").toString("base64url")}`;
}

function decodeHash(hash) {
  const raw = hash.replace(/^#v1=/, "");
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
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
  if (args.display !== undefined) {
    env.DISPLAY = args.display;
  } else {
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

/** Install before the Surface click so even a fast compute settle cannot hide
 * the visible progress transition between polling samples. */
async function armSurfaceProgressProbe(page) {
  await page.evaluate(() => {
    window.__tilingProgressSeen = false;
    const row = document.getElementById("surfaceProgress");
    if (!row) throw new Error("surface progress row missing");
    const sample = () => {
      if (
        !row.classList.contains("hidden") &&
        (row.textContent ?? "").trim().length > 0
      ) {
        window.__tilingProgressSeen = true;
      }
    };
    sample();
    new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "attributes" &&
            record.attributeName === "class" &&
            record.oldValue?.split(/\s+/).includes("hidden"),
        ) &&
        (row.textContent ?? "").trim().length > 0
      ) {
        window.__tilingProgressSeen = true;
      }
      sample();
    }).observe(row, {
      attributes: true,
      attributeOldValue: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}

async function hideOverlays(page) {
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        element.style.setProperty("visibility", "hidden", "important");
      }
    }
  }, OVERLAYS);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function visibleErrorText(page) {
  return page.evaluate(() =>
    ["#error", "#renderError"]
      .map((selector) => document.querySelector(selector))
      .filter((element) => {
        if (!element || element.classList.contains("hidden")) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0
        );
      })
      .map((element) => element.textContent ?? "")
      .join(" ")
      .trim(),
  );
}

async function screenshotMetrics(page, png) {
  return page.evaluate(
    async ({ base64, tolerance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const width = 128;
      const height = Math.max(
        1,
        Math.round((image.naturalHeight / image.naturalWidth) * width),
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("screenshot 2D decode context unavailable");
      ctx.drawImage(image, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      const pixel = (x, y) => {
        const at = (y * width + x) * 4;
        return [data[at], data[at + 1], data[at + 2]];
      };
      const corners = [
        pixel(0, 0),
        pixel(width - 1, 0),
        pixel(0, height - 1),
        pixel(width - 1, height - 1),
      ];
      let nonBackdrop = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = pixel(x, y);
          const backdrop = corners.some(
            (c) =>
              Math.abs(c[0] - p[0]) <= tolerance &&
              Math.abs(c[1] - p[1]) <= tolerance &&
              Math.abs(c[2] - p[2]) <= tolerance,
          );
          if (!backdrop) nonBackdrop++;
        }
      }
      return {
        coverage: nonBackdrop / (width * height),
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    },
    { base64: png.toString("base64"), tolerance: NON_BACKDROP_TOLERANCE },
  );
}

async function screenshotDiff(page, a, b) {
  return page.evaluate(
    async ({ a64, b64, threshold }) => {
      async function decode(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("diff 2D decode context unavailable");
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
        throw new Error(
          `screenshot size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`,
        );
      }
      // Ignore a 5% edge band where browser/compositor clipping is least
      // stable. Overlay elements were hidden before both screenshots.
      const x0 = Math.floor(A.width * 0.05);
      const x1 = Math.ceil(A.width * 0.95);
      const y0 = Math.floor(A.height * 0.05);
      const y1 = Math.ceil(A.height * 0.95);
      let compared = 0;
      let structural = 0;
      let maxDelta = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * A.width + x) * 4;
          const delta = Math.max(
            Math.abs(A.data[at] - B.data[at]),
            Math.abs(A.data[at + 1] - B.data[at + 1]),
            Math.abs(A.data[at + 2] - B.data[at + 2]),
          );
          compared++;
          if (delta > threshold) structural++;
          if (delta > maxDelta) maxDelta = delta;
        }
      }
      return {
        fraction: compared > 0 ? structural / compared : 0,
        structural,
        compared,
        maxDelta,
      };
    },
    {
      a64: a.toString("base64"),
      b64: b.toString("base64"),
      threshold: STRUCTURAL_DELTA,
    },
  );
}

function latticeWirePass(persisted, document) {
  const authored = document.tiling;
  const kept = persisted.tiling;
  if (!kept || kept.kind !== "lattice") return false;
  return (
    kept.cellScale === authored.cellScale &&
    Boolean(kept.clip) === Boolean(authored.clip)
  );
}

async function runLeg(browser, args, fixture, arm, index) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const expectedHash = encodeHash(fixture.document);
  const force = arm === "webgl" ? "surfacegl" : "surfacecompute";
  const url = `${args.url}/?surfacestate&${force}&tilingcase=${index}${expectedHash}`;
  const started = Date.now();
  let png = null;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.bringToFront();
    await waitForBoot(page);
    const button = await page.$eval("#modeSurfaceBtn", (element) => ({
      disabled: element.disabled,
      title: element.title,
    }));
    if (button.disabled) {
      return {
        ok: false,
        name: fixture.name,
        family: fixture.family,
        arm,
        reason: `Surface button disabled: ${button.title}`,
        elapsedMs: Date.now() - started,
        pageErrors,
        consoleErrors,
      };
    }
    await armSurfaceProgressProbe(page);
    await page.click("#modeSurfaceBtn");

    let entered = false;
    let state = null;
    const deadline = Date.now() + args.settle;
    while (Date.now() < deadline) {
      state = await page.evaluate(() => window.__surfaceState?.() ?? null);
      if (state?.firstFrame) entered = true;
      if (state?.settled || (state && state.mode !== "surface")) break;
      await page.waitForTimeout(POLL_MS);
    }

    const settled = Boolean(state?.settled);
    const progressSeen = await page.evaluate(
      () => window.__tilingProgressSeen === true,
    );
    const engine = state?.engine ?? null;
    const backend = state?.backend ?? null;
    const persisted = decodeHash(await page.evaluate(() => location.hash));
    const documentPass = latticeWirePass(persisted, fixture.document);
    const errorText = await visibleErrorText(page);
    let metrics = null;
    if (entered) {
      await hideOverlays(page);
      const canvas = await page.$("canvas");
      if (!canvas) throw new Error("main canvas is missing");
      png = await canvas.screenshot({ type: "png" });
      metrics = await screenshotMetrics(page, png);
      await mkdir(args.outdir, { recursive: true });
      await writeFile(
        path.join(args.outdir, `${fixture.name}-${arm}.png`),
        png,
      );
    }
    const realBackendPass =
      args.display === undefined || backend?.software === false;
    const ok =
      entered &&
      progressSeen &&
      settled &&
      engine === arm &&
      documentPass &&
      metrics !== null &&
      metrics.coverage >= args.draw &&
      realBackendPass &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      errorText.length === 0;
    return {
      ok,
      name: fixture.name,
      family: fixture.family,
      arm,
      entered,
      progressSeen,
      settled,
      engine,
      backend,
      documentPass,
      coverage: metrics?.coverage ?? null,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      errorText,
      png,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function printLeg(result) {
  const coverage =
    result.coverage === null || result.coverage === undefined
      ? "n/a"
      : `${(result.coverage * 100).toFixed(2)}%`;
  const backend = result.backend
    ? `${result.backend.software ? "software" : "hardware"}:${result.backend.label ?? "?"}`
    : "n/a";
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(11)} ${result.arm.padEnd(7)} ` +
      `entered=${String(Boolean(result.entered)).padEnd(5)} ` +
      `progress=${String(Boolean(result.progressSeen)).padEnd(5)} ` +
      `settled=${String(Boolean(result.settled)).padEnd(5)} ` +
      `engine=${String(result.engine ?? "none").padEnd(7)} ` +
      `drawn=${coverage.padEnd(7)} document=${String(Boolean(result.documentPass)).padEnd(5)} ` +
      `backend=${backend} time=${(result.elapsedMs / 1000).toFixed(1)}s\n` +
      `  ${result.family}${result.reason ? ` — ${result.reason}` : ""}\n`,
  );
  for (const error of result.pageErrors ?? []) {
    process.stdout.write(`  page error: ${error}\n`);
  }
  for (const error of result.consoleErrors ?? []) {
    process.stdout.write(`  console error: ${error}\n`);
  }
  if (result.errorText)
    process.stdout.write(`  app error: ${result.errorText}\n`);
}

/** Enter Surface, settle, screenshot — shared by the trio and the persisted
 * document reload. */
async function settleAndShoot(browser, args, url, label, writePng) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const started = Date.now();
  let png = null;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.bringToFront();
    await waitForBoot(page);
    const button = await page.$eval("#modeSurfaceBtn", (element) => ({
      disabled: element.disabled,
      title: element.title,
    }));
    if (button.disabled) {
      return {
        ok: false,
        label,
        reason: `Surface button disabled: ${button.title}`,
        elapsedMs: Date.now() - started,
        pageErrors,
        consoleErrors,
      };
    }
    await armSurfaceProgressProbe(page);
    await page.click("#modeSurfaceBtn");
    let entered = false;
    let state = null;
    const deadline = Date.now() + args.settle;
    while (Date.now() < deadline) {
      state = await page.evaluate(() => window.__surfaceState?.() ?? null);
      if (state?.firstFrame) entered = true;
      if (state?.settled || (state && state.mode !== "surface")) break;
      await page.waitForTimeout(POLL_MS);
    }
    const errorText = await visibleErrorText(page);
    const progressSeen = await page.evaluate(
      () => window.__tilingProgressSeen === true,
    );
    let coverage = null;
    if (entered) {
      await hideOverlays(page);
      const canvas = await page.$("canvas");
      if (!canvas) throw new Error("main canvas is missing");
      png = await canvas.screenshot({ type: "png" });
      const metrics = await screenshotMetrics(page, png);
      coverage = metrics.coverage;
      if (writePng) {
        await mkdir(args.outdir, { recursive: true });
        await writeFile(path.join(args.outdir, `${label}.png`), png);
      }
    }
    const ok =
      entered &&
      progressSeen &&
      Boolean(state?.settled) &&
      coverage !== null &&
      coverage >= args.draw &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      errorText.length === 0;
    return {
      ok,
      label,
      entered,
      progressSeen,
      settled: Boolean(state?.settled),
      coverage,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      errorText,
      png,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  // Make the authored-document claim executable before a browser is opened.
  for (const fixture of FIXTURES) {
    const decoded = decodeHash(encodeHash(fixture.document));
    if (!latticeWirePass(decoded, fixture.document)) {
      throw new Error(
        `${fixture.name}: embedded lattice hash failed round-trip`,
      );
    }
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    ...launchOptions(args),
  });
  const results = new Map();
  let verdictFailed = false;
  try {
    let index = 0;
    for (const fixture of FIXTURES) {
      for (const arm of fixture.arms) {
        const result = await runLeg(browser, args, fixture, arm, index++);
        results.set(`${fixture.name}:${arm}`, result);
        printLeg(result);
        if (!result.ok) verdictFailed = true;
      }
    }

    // The distinctness trio: untiled vs finite-a3 vs lattice on the SAME
    // transforms and the SAME pinned camera. A tiling knob that never
    // reaches the renderer draws the same picture three times.
    const trioShots = new Map();
    for (const member of DISTINCTNESS_TRIO) {
      const document = {
        ...member.document,
        ...TRIO_CAMERA,
      };
      const result = await settleAndShoot(
        browser,
        args,
        `${args.url}/?surfacestate&tilingcase=trio-${member.name}${encodeHash(document)}`,
        `trio-${member.name}`,
        true,
      );
      trioShots.set(member.name, result);
      printLeg({
        ok: result.ok,
        name: member.name,
        family: "distinctness trio",
        arm: "compute",
        entered: result.entered,
        progressSeen: result.progressSeen,
        settled: result.settled,
        engine: "compute",
        backend: null,
        documentPass: true,
        coverage: result.coverage,
        elapsedMs: result.elapsedMs,
        pageErrors: result.pageErrors,
        consoleErrors: result.consoleErrors,
        errorText: result.errorText,
      });
      if (!result.ok) verdictFailed = true;
    }
    const trioPairs = [
      ["untiled", "finite-a3"],
      ["untiled", "lattice"],
      ["finite-a3", "lattice"],
    ];
    for (const [a, b] of trioPairs) {
      const shotA = trioShots.get(a);
      const shotB = trioShots.get(b);
      if (!shotA?.png || !shotB?.png) {
        process.stdout.write(
          `FAIL  distinctness ${a} vs ${b}: screenshots unavailable\n`,
        );
        verdictFailed = true;
        continue;
      }
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      let diff;
      try {
        diff = await screenshotDiff(page, shotA.png, shotB.png);
      } finally {
        await context.close();
      }
      const pass = diff.fraction >= args.diff;
      if (!pass) verdictFailed = true;
      process.stdout.write(
        `${pass ? "PASS" : "FAIL"}  distinctness ${a} vs ${b} ` +
          `structural=${(diff.fraction * 100).toFixed(2)}% ` +
          `(floor ${(args.diff * 100).toFixed(2)}%, maxDelta ${diff.maxDelta})\n`,
      );
    }

    // The persisted-document reload: re-enter Surface from the current hash
    // (the camera pose rides the document), settle again, and draw again.
    // tiling-ui.verify.mjs owns the distinct app Copy Link interaction.
    const source = results.get("ifs3:compute");
    if (!source) {
      process.stdout.write(
        "FAIL  document reload: ifs3:compute screenshots unavailable\n",
      );
      verdictFailed = true;
    } else {
      const appHash = await (async () => {
        const context = await browser.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: args.width, height: args.height },
        });
        try {
          const page = await context.newPage();
          const appUrl = `${args.url}/?surfacestate&tilingcase=reload${encodeHash(fixtureDocument("ifs3"))}`;
          await page.goto(appUrl, { waitUntil: "load", timeout: 60_000 });
          await page.bringToFront();
          await waitForBoot(page);
          return await page.evaluate(() => location.hash);
        } finally {
          await context.close();
        }
      })();
      const reload = await settleAndShoot(
        browser,
        args,
        `${args.url}/?surfacestate${appHash}`,
        "document-reload",
        true,
      );
      printLeg({
        ok: reload.ok,
        name: "reload",
        family: "persisted document reload",
        arm: "compute",
        entered: reload.entered,
        progressSeen: reload.progressSeen,
        settled: reload.settled,
        engine: "compute",
        backend: null,
        documentPass: true,
        coverage: reload.coverage,
        elapsedMs: reload.elapsedMs,
        pageErrors: reload.pageErrors,
        consoleErrors: reload.consoleErrors,
        errorText: reload.errorText,
      });
      if (!reload.ok) verdictFailed = true;
      else {
        const context = await browser.newContext({
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        let diff;
        try {
          diff = await screenshotDiff(page, source.png, reload.png);
        } finally {
          await context.close();
        }
        // The reloaded session must reproduce the original picture, not
        // merely draw: the diff is between two runs of the SAME document
        // and camera, so a LOW floor is the assertion.
        const pass = diff.fraction <= 0.15;
        if (!pass) verdictFailed = true;
        process.stdout.write(
          `${pass ? "PASS" : "FAIL"}  document reload reproduces ` +
            `structural=${(diff.fraction * 100).toFixed(2)}% ` +
            `(ceiling 15%, maxDelta ${diff.maxDelta})\n`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(verdictFailed ? 3 : 0);
}

function fixtureDocument(name) {
  return FIXTURES.find((fixture) => fixture.name === name).document;
}

run().catch((error) => {
  process.stderr.write(
    `[surface-lattice] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
