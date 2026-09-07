#!/usr/bin/env node
/**
 * 3D Surface POST-AFFINE browser gate. This is not an npm script because it
 * drives a production build through a real browser:
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-post.verify.mjs [--display=:0] [--url=…]
 *
 * Four embedded `#v1=` documents carry genuinely non-identity post-affines
 * through every 3D WebGL estimator shape that consumes them:
 *
 *   - recursive inverse affine descent;
 *   - recursive inverse folded-map descent;
 *   - recursive inverse descent under a posted final fold lens;
 *   - forward escape-time iteration.
 *
 * Every leg loads through the document boundary, clicks the real
 * `#modeSurfaceBtn`, forces `?surfacegl`, reaches the `?surfacestate` settled
 * latch on engine="webgl", retains every authored post in the live hash, and
 * draws covered rays plus a non-backdrop share in a canvas SCREENSHOT. A
 * pre-app WebGL probe also requires a successful program link with
 * `SURFACE_POST=1`, the fixture's exact affine/fold/escape defines, and the
 * `SurfacePosts3` uniform block. The two fold-shaped rows are deliberately
 * separate: one requires `SURFACE_FOLDS=1`; the affine-base lens row requires
 * `SURFACE_FOLDS=0` plus `SURFACE_FOLD_LENS=1` and authors posts on both the
 * recursive maps and final fold, keeping the posted final-lens path live
 * instead of mistaking a recursive folded-map compile for that wrapper.
 *
 * MEASURED 2026-09-07 on verified Mesa Intel Iris Xe: all four rows linked,
 * entered, settled and retained their posts on engine=webgl with hardware
 * ANGLE; screenshot coverage was 14.84%, 11.85%, 16.40% and 18.89% in the
 * order above.
 *
 * The screenshot is decoded only after capture in an offscreen 2D canvas.
 * It never reads the live WebGL drawing buffer outside its renderer rAF. Its
 * backdrop oracle is row-local: the authored linear gradient is constant in
 * x, so the median of edge pixels at the same y is a better miss reference
 * than four corners of a vertical gradient.
 *
 * With `--display`, every row additionally requires the app's unmasked WebGL
 * backend disclosure to say hardware (`backend.software === false`). Set the
 * live display's XAUTHORITY first as documented in AGENTS.md; otherwise Chrome
 * can silently measure SwiftShader instead of the requested driver.
 *
 * Options:
 *   --url=URL        app origin (default https://localhost:4173)
 *   --display=:0     headed X11 run; omit for headless SwiftShader
 *   --settle=MS      per-leg settle budget (default 180000)
 *   --viewport=WxH   browser viewport (default 800x500)
 *   --draw=FRACTION  minimum non-backdrop screenshot share (default 0.002)
 *   --outdir=PATH    screenshot directory
 *                    (default .playwright-mcp/surface-post)
 *
 * Exit 0 = all four rows passed.
 * Exit 1 = CHECKING/setup failure (bad args, browser/navigation/image decode);
 *          rerun — this is not a renderer verdict.
 * Exit 3 = a scene verdict failed (entry, settle, draw, document, shader arm,
 *          backend, engine, page/console error, or render-error banner).
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
  "surface-post",
);
const POLL_MS = 250;
const BACKDROP_TOLERANCE = 10;
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
  fogDensity: 0.8,
  fogTint: "#ffffff",
  fogTintStrength: 0,
  groundPlane: false,
  background: { mode: "dark", shape: "linear" },
};

// Persistence's exact post wire: [row-major m0..m8, tx, ty, tz]. Every matrix
// is invertible, non-orthogonal, translated, and visibly non-identity.
const POST_A = [0.86, 0.14, 0, 0, 0.88, 0.08, 0, 0, 0.9, 0.08, -0.04, 0.03];
const POST_B = [0.9, 0, 0.1, 0.04, 0.86, 0, 0, 0.05, 0.88, -0.06, 0.03, 0.04];
const POST_LENS = [
  0.92, 0.08, 0, -0.04, 0.9, 0.06, 0, 0, 0.88, 0.05, -0.03, 0.02,
];
const POST_ESCAPE = [
  0.82, 0.12, 0, 0, 0.88, 0.05, 0.04, 0, 0.86, 0.12, -0.06, 0.04,
];

const HALF = [0.5, 0.5, 0.5];
const ZERO = [0, 0, 0];
const TETRA = [
  [0, 0.8, 0],
  [0.75, -0.4, 0],
  [-0.375, -0.4, 0.65],
  [-0.375, -0.4, -0.65],
].map((position, index) => ({
  position,
  rotation: ZERO,
  scale: HALF,
  post: index % 2 === 0 ? POST_A : POST_B,
}));

const FOLD_MAPS = [
  {
    position: [0.4, 0.1, 0],
    rotation: [0.3, 0.2, 0],
    scale: [0.45, 0.45, 0.45],
    variations: [{ type: "boxfold", weight: 1 }],
    post: POST_A,
  },
  {
    position: [-0.35, -0.2, 0.3],
    rotation: [0, 0.5, 0.1],
    scale: HALF,
    variations: [{ type: "boxfold", weight: 0.9 }],
    post: POST_B,
  },
];

const FOLD_LENS = {
  position: [0.15, -0.1, 0.05],
  rotation: [0.2, 0.3, 0.1],
  scale: [0.9, 0.9, 0.9],
  variations: [{ type: "boxfold", weight: 0.55 }],
  post: POST_LENS,
};

const FIXTURES = [
  {
    name: "inverse-affine",
    family: "recursive inverse affine",
    document: {
      ...COMMON_DOCUMENT,
      transforms: TETRA,
      camera: {
        target: [0.3154, 0.3074, 0.0106],
        radius: 4.1747,
        theta: 0.7854,
        phi: 1.056,
      },
    },
    defines: {
      SURFACE_POST: 1,
      SURFACE_FOLDS: 0,
      SURFACE_FOLD_LENS: 0,
      SURFACE_ESCAPE: 0,
    },
  },
  {
    name: "inverse-fold",
    family: "recursive inverse folded maps",
    document: {
      ...COMMON_DOCUMENT,
      transforms: FOLD_MAPS,
    },
    defines: {
      SURFACE_POST: 1,
      SURFACE_FOLDS: 1,
      SURFACE_FOLD_LENS: 0,
      SURFACE_ESCAPE: 0,
    },
  },
  {
    name: "inverse-affine-lens",
    family: "recursive inverse affine maps + final fold lens",
    document: {
      ...COMMON_DOCUMENT,
      transforms: TETRA,
      finalTransform: FOLD_LENS,
    },
    defines: {
      SURFACE_POST: 1,
      SURFACE_FOLDS: 0,
      SURFACE_FOLD_LENS: 1,
      SURFACE_ESCAPE: 0,
    },
  },
  {
    name: "forward-escape",
    family: "forward escape-time",
    document: {
      ...COMMON_DOCUMENT,
      transforms: [
        {
          position: [0.6, 0.45, 0.3],
          rotation: ZERO,
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
          post: POST_ESCAPE,
        },
      ],
    },
    defines: {
      SURFACE_POST: 1,
      SURFACE_FOLDS: 0,
      SURFACE_FOLD_LENS: 0,
      SURFACE_ESCAPE: 1,
    },
  },
];

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    display: undefined,
    settle: 180_000,
    viewport: "800x500",
    draw: 0.002,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`unknown argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    if (key === "display") args.display = value || ":0";
    else if (key === "settle" || key === "draw") {
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
  if (args.settle <= 0 || args.draw < 0 || args.draw > 1) {
    throw new Error("--settle must be positive and --draw must be 0..1");
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
  const flags = ["--ignore-certificate-errors", "--no-sandbox"];
  if (args.display !== undefined) {
    env.DISPLAY = args.display;
  } else {
    delete env.DISPLAY;
    flags.push(
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    );
  }
  return { env, args: flags };
}

async function installShaderProbe(page) {
  await page.addInitScript(() => {
    const probe = { links: [] };
    window.__surfacePostProbe = probe;
    const DEFINE_RE =
      /#define\s+(SURFACE_POST|SURFACE_FOLDS|SURFACE_FOLD_LENS|SURFACE_ESCAPE)\s+(\d+)/g;
    const shaderFacts = new WeakMap();
    for (const ctor of [
      window.WebGL2RenderingContext,
      window.WebGLRenderingContext,
    ]) {
      if (!ctor) continue;
      const originalShaderSource = ctor.prototype.shaderSource;
      ctor.prototype.shaderSource = function (shader, source) {
        const defines = {};
        let match;
        DEFINE_RE.lastIndex = 0;
        while ((match = DEFINE_RE.exec(source))) {
          defines[match[1]] = Number(match[2]);
        }
        if (Object.keys(defines).length > 0) {
          shaderFacts.set(shader, {
            defines,
            postBlock: /uniform\s+SurfacePosts3\s*\{/.test(source),
          });
        }
        return originalShaderSource.call(this, shader, source);
      };
      const originalLinkProgram = ctor.prototype.linkProgram;
      ctor.prototype.linkProgram = function (program) {
        const result = originalLinkProgram.call(this, program);
        const facts = (this.getAttachedShaders(program) || [])
          .map((shader) => shaderFacts.get(shader))
          .filter(Boolean);
        if (facts.length > 0) {
          const defines = {};
          for (const fact of facts) Object.assign(defines, fact.defines);
          const ok = Boolean(
            this.getProgramParameter(program, this.LINK_STATUS),
          );
          probe.links.push({
            defines,
            postBlock: facts.some((fact) => fact.postBlock),
            ok,
            info: ok ? "" : this.getProgramInfoLog(program) || "",
          });
        }
        return result;
      };
    }
  });
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

function postWirePass(persisted, authored) {
  if (!Array.isArray(persisted.transforms)) return false;
  for (let i = 0; i < authored.transforms.length; i++) {
    const expected = authored.transforms[i].post;
    if (
      expected !== undefined &&
      JSON.stringify(persisted.transforms[i]?.post) !== JSON.stringify(expected)
    ) {
      return false;
    }
  }
  const expectedFinal = authored.finalTransform?.post;
  return (
    expectedFinal === undefined ||
    JSON.stringify(persisted.finalTransform?.post) ===
      JSON.stringify(expectedFinal)
  );
}

function shaderPathPass(links, expected) {
  return links.some(
    (link) =>
      link.ok &&
      link.postBlock &&
      Object.entries(expected).every(
        ([name, value]) => Number(link.defines[name] ?? 0) === value,
      ),
  );
}

async function screenshotCoverage(page, png) {
  return page.evaluate(
    async ({ base64, tolerance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const width = 160;
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
      const channel = (x, y, c) => data[(y * width + x) * 4 + c];
      const median = (values) => {
        values.sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      };
      let nonBackdrop = 0;
      for (let y = 0; y < height; y++) {
        const edgeXs = [0, 1, 2, 3, width - 4, width - 3, width - 2, width - 1];
        const backdrop = [0, 1, 2].map((c) =>
          median(edgeXs.map((x) => channel(x, y, c))),
        );
        for (let x = 4; x < width - 4; x++) {
          const delta = Math.max(
            Math.abs(channel(x, y, 0) - backdrop[0]),
            Math.abs(channel(x, y, 1) - backdrop[1]),
            Math.abs(channel(x, y, 2) - backdrop[2]),
          );
          if (delta > tolerance) nonBackdrop++;
        }
      }
      const compared = Math.max(1, (width - 8) * height);
      return {
        coverage: nonBackdrop / compared,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    },
    { base64: png.toString("base64"), tolerance: BACKDROP_TOLERANCE },
  );
}

async function runLeg(browser, args, fixture, index) {
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
  await installShaderProbe(page);
  const url =
    `${args.url}/?surfacegl&surfacestate&postcase=${index}` +
    encodeHash(fixture.document);
  const started = Date.now();
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
        reason: `Surface button disabled: ${button.title}`,
        elapsedMs: Date.now() - started,
        pageErrors,
        consoleErrors,
      };
    }
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
    const engine = state?.engine ?? null;
    const backend = state?.backend ?? null;
    const census = state?.census ?? null;
    const persisted = decodeHash(await page.evaluate(() => location.hash));
    const documentPass = postWirePass(persisted, fixture.document);
    const links = await page.evaluate(
      () => window.__surfacePostProbe?.links ?? [],
    );
    const shaderPass = shaderPathPass(links, fixture.defines);
    const failedLinks = links.filter((link) => !link.ok);
    const errorText = await visibleErrorText(page);

    let coverage = null;
    if (entered) {
      await hideOverlays(page);
      const canvas = await page.$("canvas");
      if (!canvas) throw new Error("main canvas is missing");
      const png = await canvas.screenshot({ type: "png" });
      coverage = (await screenshotCoverage(page, png)).coverage;
      await mkdir(args.outdir, { recursive: true });
      await writeFile(path.join(args.outdir, `${fixture.name}.png`), png);
    }

    const realBackendPass =
      args.display === undefined || backend?.software === false;
    const ok =
      entered &&
      settled &&
      engine === "webgl" &&
      backend !== null &&
      realBackendPass &&
      documentPass &&
      shaderPass &&
      failedLinks.length === 0 &&
      census !== null &&
      census.covered > 0 &&
      coverage !== null &&
      coverage >= args.draw &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      errorText.length === 0;
    return {
      ok,
      name: fixture.name,
      family: fixture.family,
      entered,
      settled,
      engine,
      backend,
      documentPass,
      shaderPass,
      failedLinks,
      census,
      coverage,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      errorText,
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
    `${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(18)} ` +
      `entered=${String(Boolean(result.entered)).padEnd(5)} ` +
      `settled=${String(Boolean(result.settled)).padEnd(5)} ` +
      `engine=${String(result.engine ?? "none").padEnd(6)} ` +
      `drawn=${coverage.padEnd(7)} covered=${String(result.census?.covered ?? "n/a").padEnd(7)} ` +
      `document=${String(Boolean(result.documentPass)).padEnd(5)} ` +
      `shader=${String(Boolean(result.shaderPass)).padEnd(5)} ` +
      `backend=${backend} time=${(result.elapsedMs / 1000).toFixed(1)}s\n` +
      `  ${result.family}${result.reason ? ` — ${result.reason}` : ""}\n`,
  );
  for (const link of result.failedLinks ?? []) {
    process.stdout.write(
      `  WebGL link failure: ${link.info || "no info log"}\n`,
    );
  }
  for (const error of result.pageErrors ?? []) {
    process.stdout.write(`  page error: ${error}\n`);
  }
  for (const error of result.consoleErrors ?? []) {
    process.stdout.write(`  console error: ${error}\n`);
  }
  if (result.errorText)
    process.stdout.write(`  app error: ${result.errorText}\n`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  for (const fixture of FIXTURES) {
    const decoded = decodeHash(encodeHash(fixture.document));
    if (!postWirePass(decoded, fixture.document)) {
      throw new Error(`${fixture.name}: embedded post hash failed round-trip`);
    }
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    ...launchOptions(args),
  });
  let verdictFailed = false;
  try {
    for (let i = 0; i < FIXTURES.length; i++) {
      const result = await runLeg(browser, args, FIXTURES[i], i);
      printLeg(result);
      if (!result.ok) verdictFailed = true;
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (verdictFailed) process.exitCode = 3;
}

run().catch((error) => {
  process.stderr.write(
    `surface-post CHECKING FAILURE: ${error?.stack ?? String(error)}\n`,
  );
  process.exitCode = 1;
});
