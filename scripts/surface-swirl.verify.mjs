#!/usr/bin/env node
/**
 * Production-browser qualification of pure swirl final lenses, both dimensions
 * and both engines, including the menu showcases. Build and preview first, then run:
 *   node scripts/surface-swirl.verify.mjs --display=:0
 * XAUTHORITY must authorize the live display; every capture requires a hardware
 * backend when --display is supplied. Captures use the shared eight-pass settle
 * latch, real canvas screenshots and ray census, never a live WebGL readback.
 *
 * The app's Copy Link encoder persists each signed-weight, posted final before
 * a fresh context restores it. The restored document must retain every final
 * field. 4D also verifies the disabled slab and its swirl-specific explanation.
 * Eval/march/hit-info agreement belongs to bench:surface; fixed-geometry thin-
 * slice fidelity belongs to swirl-lens.harness.ts, not an image-IoU allowance.
 *
 * The near-cap, default-radius fixtures now gate paired echo strides with
 * unchanged global-G acceptance. The same-camera/source-ball control and
 * the rejected intermediate strategies live in docs/swirl-surface-lens.md.
 * --measure records failures before returning 2; it never reports a pass.
 *
 * Balloon is a measured compositional budget limit, not covered by the radius
 * cap alone. On AMD RX 7900 XTX at 960x540, the near-cap 3D final exhausted
 * 39,983 rays at balloon R=.6 versus 395 for its affine-output control and 38
 * for the plain core. At the default R=1.6, near-cap 3D/4D swirl exhausted
 * 2,873/111 rays while affine-output and plain controls both completed. The
 * affine control absorbs the fixed pi/2 phase, weight and pre-affine into an
 * ordinary final; each document uses its production opening pose and ball.
 * R=.35 still exhausted 9,550/160 near-cap swirl rays. The Balloon fixtures
 * therefore use that established early-echo radius with a milder, nonzero
 * pre-affine (scale AND translation): .2x in 3D, .4x in 4D, and reciprocal
 * signed weights preserve output size/center. The posted composition and
 * visible echo remain live. Zero exhausted rays is never relaxed; reducing
 * the bound without preserving full-hit-epsilon compensation is not a fix.
 *
 * Exit 0: complete pass. Exit 1: browser/setup failure. Exit 3: scene failure.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureSettledSurface,
  launchSurfaceBrowser,
  RELEASE_VIEWPORT,
} from "./lib/surface-browser-runner.mjs";
import { decodePng } from "./lib/pattern-release-artifacts.mjs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

const options = {
  url: "https://localhost:4173",
  display: null,
  timeoutMs: 180_000,
  outdir: "scripts/out/surface-swirl",
  measure: false,
};
for (const argument of process.argv.slice(2)) {
  if (argument === "--measure") {
    options.measure = true;
    continue;
  }
  const match = /^--(url|display|settle|outdir)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown option ${argument}`);
  if (match[1] === "settle") options.timeoutMs = Number(match[2]);
  else options[match[1]] = match[2];
}
if (!(options.timeoutMs > 0 && Number.isFinite(options.timeoutMs))) {
  throw new Error(
    "--settle must be a positive finite duration in milliseconds",
  );
}
options.url = options.url.replace(/\/+$/, "");

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
    antialiasSamples: 8,
    lightAzimuth: 135,
    lightElevation: 50,
    ambient: 0.25,
    colorSource: "transform",
    paletteId: "spectrum",
    colorSpeed: 0.5,
  },
  symmetry: { order: 1, plane: "xy" },
  glowBrightness: 1,
  balloonEcho: false,
  balloonRadius: 1.6,
  fogDensity: 0.8,
  fogTint: "#ffffff",
  fogTintStrength: 0,
  groundPlane: false,
  background: { mode: "dark", shape: "linear" },
};

const POST = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0.04, -0.02, 0.01];
function finalLens(fourD, balloon = false) {
  return {
    position: balloon
      ? fourD
        ? [0.008, -0.004, 0.012]
        : [0.004, -0.002, 0.006]
      : [0.02, -0.01, 0.03],
    rotation: [0.15, -0.2, 0.25],
    scale: balloon
      ? fourD
        ? [0.16, 0.1632, 0.1568]
        : [0.05, 0.051, 0.049]
      : fourD
        ? [0.4, 0.408, 0.392]
        : [0.25, 0.255, 0.245],
    variations: [
      { type: "swirl", weight: balloon ? (fourD ? -5 : 16) : fourD ? -2 : 3.2 },
    ],
    post: POST,
    ...(fourD
      ? {
          w: {
            position: balloon ? 0.008 : 0.02,
            rotation: { xw: 0.3, yw: -0.15 },
          },
        }
      : {}),
  };
}
const tetra = [
  [0, 0.8, 0],
  [0.75, -0.4, 0],
  [-0.375, -0.4, 0.65],
  [-0.375, -0.4, -0.65],
].map((position) => ({
  position,
  rotation: [0, 0, 0],
  scale: [0.5, 0.5, 0.5],
}));
const penta = [
  [0.2795, 0.2795, 0.2795, -0.125],
  [0.2795, -0.2795, -0.2795, -0.125],
  [-0.2795, 0.2795, -0.2795, -0.125],
  [-0.2795, -0.2795, 0.2795, -0.125],
  [0, 0, 0, 0.5],
].map(([x, y, z, w]) => ({
  position: [x, y, z],
  rotation: [0, 0, 0],
  scale: [0.5, 0.5, 0.5],
  w: { position: w },
}));
const fixtures = [
  { name: "swirl3", fourD: false, transforms: tetra },
  { name: "swirl4", fourD: true, transforms: penta },
  { name: "swirl3-balloon", fourD: false, transforms: tetra, balloon: true },
  { name: "swirl4-balloon", fourD: true, transforms: penta, balloon: true },
  {
    name: "swirl3-balloon-default",
    fourD: false,
    transforms: tetra,
    balloon: true,
    nearCap: true,
    balloonRadius: COMMON.balloonRadius,
  },
  {
    name: "swirl4-balloon-default",
    fourD: true,
    transforms: penta,
    balloon: true,
    nearCap: true,
    balloonRadius: COMMON.balloonRadius,
  },
  { name: "preset-swirl3", fourD: false, preset: "swirlTetrahedron" },
  { name: "preset-swirl4", fourD: true, preset: "swirlPentatope" },
];
const encode = (document) =>
  `#v1=${Buffer.from(JSON.stringify(document)).toString("base64url")}`;
const decode = (hash) =>
  JSON.parse(Buffer.from(hash.replace(/^#?v1=/, ""), "base64url").toString());

// The linear dark gradient cannot exceed either authored stop in a channel;
// the DOM vignette and overlay shadows only darken it. Read the owning source
// so changing the built-in palette cannot silently invalidate this bound.
const darkStops = (
  await readFile(new URL("../src/app/constants.ts", import.meta.url), "utf8")
).match(
  /DARK_BACKDROP\s*=\s*\{\s*top:\s*"(#[0-9a-f]{6})",\s*bottom:\s*"(#[0-9a-f]{6})"/i,
);
assert.ok(darkStops, "the pinned dark backdrop must disclose its RGB stops");
const DARK_STOP_RGB = darkStops
  .slice(1)
  .map((hex) =>
    [0, 1, 2].map((channel) =>
      Number.parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16),
    ),
  );
const DARK_MAX_RGB = [0, 1, 2].map((channel) =>
  Math.max(...DARK_STOP_RGB.map((stop) => stop[channel])),
);
// The pinned viewport leaves this strip clear of the panel, help and legend.
// Cropping also permits the exact metric to recheck already saved captures.
const DRAW_REGION = { x: 160, y: 0, width: 480, height: 540 };

async function boot(page, hash) {
  await page.goto(`${options.url}/?surfacestate${hash}`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      Number(
        document
          .getElementById("pointCount")
          ?.textContent?.replace(/[^\d]/g, ""),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
}

async function copiedHash(page) {
  await page.evaluate(() => {
    window.__swirlCopiedLink = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__swirlCopiedLink = text;
        },
      },
    });
    document.getElementById("shareSection").open = true;
    document.getElementById("copyLinkBtn").click();
  });
  await page.waitForFunction(
    () => typeof window.__swirlCopiedLink === "string",
  );
  const link = await page.evaluate(() => window.__swirlCopiedLink);
  return new URL(link).hash;
}

async function persistFixture(browser, fixture) {
  if (fixture.preset) return persistPresetFixture(browser, fixture);
  const final = finalLens(
    fixture.fourD,
    (fixture.balloon ?? false) && !fixture.nearCap,
  );
  const initial = encode({
    ...COMMON,
    transforms: fixture.transforms,
    finalTransform: final,
    balloonEcho: fixture.balloon ?? false,
    balloonRadius:
      fixture.balloonRadius ?? (fixture.balloon ? 0.35 : COMMON.balloonRadius),
  });
  let hash;
  for (const restoring of [false, true]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: RELEASE_VIEWPORT,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await boot(page, restoring ? hash : initial);
      hash = await copiedHash(page);
      assert.deepEqual(
        decode(hash).finalTransform,
        final,
        `${fixture.name}: copied final transform`,
      );
      assert.equal(
        decode(hash).background?.mode ?? "dark",
        "dark",
        `${fixture.name}: pinned backdrop`,
      );
      if (restoring && fixture.fourD) {
        await page.evaluate(() =>
          document.getElementById("modeSurfaceBtn").click(),
        );
        await page.waitForFunction(
          () => window.__surfaceState?.().mode === "surface",
        );
        const slab = await page.evaluate(() => ({
          disabled: document.getElementById("fourDSliceThicknessSlider")
            .disabled,
          reason: document.getElementById("fourDSliceThicknessRow").title,
        }));
        assert.equal(slab.disabled, true, "swirl4: nonzero slab refused");
        assert.match(
          slab.reason,
          /swirl final/,
          "swirl4: adjacent slab reason",
        );
      }
    } finally {
      await context.close();
    }
  }
  return hash;
}

async function selectPreset(page, key) {
  await page.evaluate(() => {
    document.getElementById("presetSelect").closest("details").open = true;
  });
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page.waitForFunction(
    (hash) => location.hash !== hash && location.hash !== "",
    before,
    { timeout: 15_000 },
  );
}

async function persistPresetFixture(browser, fixture) {
  const contextOptions = {
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    reducedMotion: "reduce",
  };
  const context = await browser.newContext(contextOptions);
  let hash;
  let authored;
  try {
    const page = await context.newPage();
    await boot(page, encode({ ...COMMON, transforms: tetra }));
    for (const returning of [false, true]) {
      await selectPreset(page, fixture.preset);
      await page.waitForFunction(
        () => window.__surfaceState?.().mode === "surface",
        undefined,
        { timeout: 30_000 },
      );
      hash = await copiedHash(page);
      const scene = decode(hash);
      assert.equal(
        scene.finalTransform?.variations?.length,
        1,
        `${fixture.name}: preset must install its pure final lens`,
      );
      assert.equal(scene.finalTransform.variations[0].type, "swirl");
      assert.notEqual(scene.finalTransform.variations[0].weight, 0);
      assert.equal(
        scene.transforms.some((transform) => transform.w !== undefined),
        fixture.fourD,
        `${fixture.name}: authored dimension`,
      );
      if (returning) {
        assert.deepEqual(scene.finalTransform, authored.finalTransform);
        assert.deepEqual(scene.transforms, authored.transforms);
      } else {
        authored = scene;
        await selectPreset(page, "sierpinski");
        assert.equal(
          decode(await copiedHash(page)).finalTransform ?? null,
          null,
          `${fixture.name}: an ordinary preset must clear the swirl final`,
        );
      }
    }
  } finally {
    await context.close();
  }
  const restored = await browser.newContext(contextOptions);
  try {
    const page = await restored.newPage();
    await boot(page, hash);
    hash = await copiedHash(page);
    const scene = decode(hash);
    assert.deepEqual(scene.finalTransform, authored.finalTransform);
    assert.deepEqual(scene.transforms, authored.transforms);
  } finally {
    await restored.close();
  }
  return hash;
}

function screenshotCoverage(decoded, overlays) {
  const { width, height, data: rgba } = decoded;
  assert.equal(width, RELEASE_VIEWPORT.width, "pinned capture width");
  assert.equal(height, RELEASE_VIEWPORT.height, "pinned capture height");
  assert.ok(
    !overlays.some(
      (r) =>
        r.x < DRAW_REGION.x + DRAW_REGION.width &&
        r.x + r.width > DRAW_REGION.x &&
        r.y < DRAW_REGION.y + DRAW_REGION.height &&
        r.y + r.height > DRAW_REGION.y,
    ),
    "the draw-measurement strip must remain unobscured",
  );
  let visible = 0;
  let covered = 0;
  for (let y = DRAW_REGION.y; y < DRAW_REGION.y + DRAW_REGION.height; y++) {
    for (let x = DRAW_REGION.x; x < DRAW_REGION.x + DRAW_REGION.width; x++) {
      const i = (y * width + x) * 4;
      visible++;
      // A one-row edge comparison is unsound: the DOM vignette darkens
      // even an unobscured reference column. Count only pixels the whole
      // authored gradient (including that darkening) cannot produce.
      if (
        [0, 1, 2].some(
          (channel) => rgba[i + channel] > DARK_MAX_RGB[channel] + 10,
        )
      )
        covered++;
    }
  }
  return covered / visible;
}

function verifyBackdropMetric() {
  const { width, height } = RELEASE_VIEWPORT;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const shade = 0.5 + 0.5 * Math.sin((Math.PI * x) / (width - 1));
      for (let channel = 0; channel < 3; channel++) {
        data[(y * width + x) * 4 + channel] = Math.round(
          (DARK_STOP_RGB[0][channel] * (1 - t) +
            DARK_STOP_RGB[1][channel] * t) *
            shade,
        );
      }
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  assert.equal(
    screenshotCoverage({ width, height, data }, []),
    0,
    "a backdrop-only image with a vignette must never count as drawn",
  );
  for (let y = 220; y < 300; y++) {
    for (let x = 400; x < 480; x++) data[(y * width + x) * 4] = 200;
  }
  assert.ok(
    screenshotCoverage({ width, height, data }, []) > 0.002,
    "the metric must detect a visible foreground patch",
  );
}

async function main() {
  await guardFreshDist({ url: options.url });
  verifyBackdropMetric();
  await mkdir(options.outdir, { recursive: true });
  const browser = await launchSurfaceBrowser(
    options.display ? `x11:${options.display}` : "sw",
  );
  const records = [];
  const failures = [];
  try {
    for (const fixture of fixtures) {
      const hash = await persistFixture(browser, fixture);
      for (const engine of ["compute", "webgl"]) {
        const name = `${fixture.name}-${engine}`;
        console.log(`[surface-swirl] ${name}`);
        const result = await captureSettledSurface(browser, {
          url: options.url,
          hash,
          engine,
          timeoutMs: options.timeoutMs,
          release: Boolean(options.display),
        });
        const pngFile = path.join(options.outdir, `${name}.png`);
        await writeFile(pngFile, result.png);
        const row = {
          name,
          engine,
          hash,
          backend: result.backend,
          draw: null,
          drawRegion: DRAW_REGION,
          geometry: result.geometry,
          census: result.census,
          elapsedMs: result.elapsedMs,
          finalTransform: decode(hash).finalTransform,
          balloonRadius: decode(hash).balloonRadius,
          copyReloadVerified: true,
          slabRefusalVerified: fixture.fourD,
        };
        records.push(row);
        // Persist before even the screenshot's reference-column assertions:
        // every completed capture retains its backend and ray census.
        await writeFile(
          path.join(options.outdir, "results.json"),
          JSON.stringify(records, null, 2),
        );
        console.log(
          JSON.stringify({
            name,
            backend: row.backend,
            elapsedMs: row.elapsedMs,
            census: {
              rays: row.census.rays,
              covered: row.census.covered,
              miss: row.census.miss,
              exhausted: row.census.exhausted,
            },
          }),
        );
        const page = await browser.newPage();
        let decoded;
        try {
          decoded = await decodePng(page, result.png);
        } finally {
          await page.close();
        }
        const draw = screenshotCoverage(decoded, result.geometry.overlays);
        row.draw = draw;
        // Preserve the complete matrix before enforcing scene assertions.
        // A failing near-cap case must not erase its sibling-engine census.
        await writeFile(
          path.join(options.outdir, "results.json"),
          JSON.stringify(records, null, 2),
        );
        console.log(JSON.stringify({ name, draw }));
        if (!(draw > 0.002)) {
          failures.push(
            `${name}: screenshot must contain the fractal (draw=${draw})`,
          );
        }
        if (!(result.census.covered > 0)) {
          failures.push(`${name}: completed rays must hit`);
        }
        if (result.census.exhausted !== 0) {
          failures.push(
            `${name}: ${result.census.exhausted} rays did not finish`,
          );
        }
      }
    }
    await writeFile(
      path.join(options.outdir, "results.json"),
      JSON.stringify(records, null, 2),
    );
    await writeFile(
      path.join(options.outdir, "verdict.json"),
      JSON.stringify(
        { mode: options.measure ? "measurement" : "qualification", failures },
        null,
        2,
      ),
    );
    if (options.measure) {
      console.log(
        `[surface-swirl] MEASUREMENT ONLY: ${records.length} captures, ${failures.length} failing assertions; no pass verdict`,
      );
      process.exitCode = 2;
      return;
    }
    assert.deepEqual(
      failures,
      [],
      "all production scenes must complete and draw",
    );
    console.log(
      "[surface-swirl] PASS: 3D/4D menu showcases, copy/reload, slab refusal, default-radius Balloon, compute and WebGL render",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = error?.code === "ERR_ASSERTION" ? 3 : 1;
});
