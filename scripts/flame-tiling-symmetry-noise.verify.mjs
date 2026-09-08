#!/usr/bin/env node
/**
 * CPU noise calibration for the EXACT tiling-symmetry-4d GPU-bench scenario.
 *
 * Run: node scripts/flame-tiling-symmetry-noise.verify.mjs
 * Optional: --url=https://localhost:5173 --chrome=/path/to/chrome --out=DIR
 *
 * A private Vite server and headless browser load the real benchmark without
 * autorun. The browser's response for gpu-bench/main.ts receives a diagnostic
 * closure over its existing buildEngines/cpuChunk/downsample/tonemap/diff/TV
 * functions. No source file, framing formula, renderer math or threshold is
 * modified. navigator.gpu is disabled before loading, so this never creates
 * a GPU backend or runs a GPU workload.
 *
 * Three exact 50,331,648-iteration CPU runs use the benchmark's 2M chunks:
 * seeds 0xc0ffee and 0xbadcafe, then an order-1 negative control at 0xc0ffee.
 * The negative control changes ONLY prepare4D's prepared orbit symmetry;
 * its explorer cloud, camera, rotor, palette, slice and tiling plan still
 * derive from the untouched scenario. The hook fails closed if that precise
 * constructor call is no longer recognizable. Output records both source
 * digests, the scenario and benchmark constants, per-run counters, ordinary
 * noise and dropped-symmetry metrics, plus PNGs from the real tone mapper.
 *
 * One seed pair measures a noise floor; it is not a confidence interval and
 * does not on its own authorize changing a production acceptance threshold.
 *
 * MEASURED 2026-09-08 at the complete budget and 960x540 display:
 * - CPU seed pair: RGB MAE 2.1311670525, density TV 0.0528759543,
 *   signed RGB bias [-0.0067766, -0.0136921, -0.0167438].
 * - Same-camera symmetry-disabled control: MAE 12.8491628086,
 *   TV 0.3107128496, bias [4.1965837, 8.3945139, 10.5080845].
 * - The preceding AMD CPU/GPU agreement row measured MAE 2.13077 and
 *   TV 0.0528124: its failure against the historic default MAE 1.0 matched
 *   this independently measured CPU noise, rather than dropped symmetry.
 * The owning scenario subsequently chose MAE 4.5 (the next half-unit above
 * twice this floor) and TV 0.12, keeping global bias 0.3. Both controls are
 * well separated by those bars. This instrument does not set those bars,
 * does not qualify other defects, and its one seed pair remains one pair.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const at = arg.indexOf("=");
    if (!arg.startsWith("--") || at < 0)
      throw new Error(`Expected --name=value, got ${arg}`);
    return [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
for (const name of args.keys()) {
  if (!["url", "chrome", "out"].includes(name))
    throw new Error(`Unknown option --${name}`);
}
const out = path.resolve(
  ROOT,
  args.get("out") ?? "scripts/out/flame-tiling-symmetry-noise",
);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const scenarioName = "tiling-symmetry-4d";
const sourcePath = path.join(ROOT, "src/app/gpu-bench/main.ts");
const sourceHash = digest(await readFile(sourcePath));
let transformedHash = null;
let vite;
let browser;

const diagnostic = String.raw`
window.__FLAME_SYMMETRY_NOISE_RUN__ = async function () {
  const def = SCENARIOS.find((scenario) => scenario.name === "tiling-symmetry-4d");
  if (!def || def.kind !== "4d") throw new Error("Exact 4D symmetry scenario missing");
  if (EQUAL_N_ITERATIONS !== 50331648 || CPU_CHUNK_ITERATIONS !== 2000000 || DISPLAY_WIDTH !== 960 || DISPLAY_HEIGHT !== 540) {
    throw new Error("Benchmark budget/resolution changed; requalify this calibration");
  }
  const results = [];
  const runs = [
    { name: "cpu-c0ffee", seed: 0xc0ffee, disableSymmetry: false },
    { name: "cpu-badcafe", seed: 0xbadcafe, disableSymmetry: false },
    { name: "symmetry-disabled", seed: 0xc0ffee, disableSymmetry: true },
  ];
  for (const run of runs) {
    window.__FLAME_SYMMETRY_NOISE_DISABLE__ = run.disableSymmetry;
    const engines = buildEngines(def);
    window.__FLAME_SYMMETRY_NOISE_DISABLE__ = false;
    const rng = mulberry32(run.seed);
    let histogram;
    let iterations = 0;
    const start = performance.now();
    console.log("[symmetry-noise] starting " + run.name);
    while (iterations < EQUAL_N_ITERATIONS) {
      const n = Math.min(CPU_CHUNK_ITERATIONS, EQUAL_N_ITERATIONS - iterations);
      histogram = engines.cpuChunk(n, histogram, rng);
      iterations += n;
      console.log("[symmetry-noise] " + run.name + " " + iterations + "/" + EQUAL_N_ITERATIONS);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const display = downsampleFlame(histogram, DISPLAY_WIDTH, DISPLAY_HEIGHT, FLAME_FILTER_RADIUS);
    const image = tonemapFlame(display, TONEMAP_PARAMS);
    const canvas = document.createElement("canvas");
    canvas.width = DISPLAY_WIDTH;
    canvas.height = DISPLAY_HEIGHT;
    drawImage(canvas, image);
    results.push({
      ...run, iterations, elapsedMs: performance.now() - start,
      hitMass: histogram.hitMass, maxHits: histogram.maxHits,
      tiling: histogram.pointTiling ?? null,
      display, image, dataUrl: canvas.toDataURL("image/png"),
    });
    console.log("[symmetry-noise] completed " + run.name);
  }
  const compare = (a, b) => {
    const diff = buildDiffImage(a.image, b.image, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    return {
      maeRGB: diff.maeRGB, biasRGB: diff.biasRGB, maxAbs: diff.maxAbs,
      densityTv: hitDensityTotalVariation(a.display, b.display),
    };
  };
  return {
    scenario: { ...def, system: def.system(), pointTilingPlan: {
      kind: def.pointTilingPlan.kind,
      dimension: def.pointTilingPlan.dimension,
      tiling: def.pointTilingPlan.tiling,
    } },
    constants: { DISPLAY_WIDTH, DISPLAY_HEIGHT, ACCUM_WIDTH, ACCUM_HEIGHT, CPU_CHUNK_ITERATIONS, EQUAL_N_ITERATIONS, FLAME_FILTER_RADIUS, TONEMAP_PARAMS },
    noise: compare(results[0], results[1]),
    droppedSymmetry: compare(results[0], results[2]),
    runs: results.map(({ display, image, ...run }) => run),
    gpuAvailable: navigator.gpu !== undefined,
  };
};
`;

function instrument(code) {
  const start = code.indexOf("function prepare4D(def)");
  const call = code.indexOf("const prepared4 = prepareChaosGame4(", start);
  const end = code.indexOf(");", call);
  if (start < 0 || call < start || end < call)
    throw new Error("Cannot locate exact prepare4D orbit constructor");
  const original = code.slice(call, end);
  if (original.split("def.symmetry").length !== 2)
    throw new Error(
      "prepare4D orbit symmetry no longer has one isolated argument",
    );
  const replacement = original.replace(
    "def.symmetry",
    "window.__FLAME_SYMMETRY_NOISE_DISABLE__ ? { ...def.symmetry, order: 1, twist: 0 } : def.symmetry",
  );
  return (
    code.slice(0, call) + replacement + code.slice(end) + "\n" + diagnostic
  );
}

try {
  await mkdir(out, { recursive: true });
  let baseUrl = args.get("url");
  if (!baseUrl) {
    process.chdir(ROOT);
    vite = await createServer({
      configFile: path.join(ROOT, "vite.config.ts"),
      server: { host: "127.0.0.1", port: 5199, strictPort: true },
    });
    await vite.listen();
    baseUrl = vite.resolvedUrls.local[0];
  }
  browser = await chromium.launch({
    executablePath:
      args.get("chrome") ?? process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: false,
      value: undefined,
    });
  });
  let intercepted = 0;
  await context.route("**/gpu-bench/main.ts*", async (route) => {
    const response = await route.fetch();
    const code = await response.text();
    transformedHash = digest(code);
    intercepted++;
    await route.fulfill({
      response,
      body: instrument(code),
      contentType: "text/javascript",
    });
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.text().startsWith("[symmetry-noise]"))
      console.log(message.text());
  });
  page.on("pageerror", (error) =>
    console.error("[symmetry-noise] browser error:", error.message),
  );
  const url = new URL(
    "gpu-bench/index.html",
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
  );
  url.searchParams.set("scenarios", scenarioName);
  await page.goto(url.href, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(
    () => typeof window.__FLAME_SYMMETRY_NOISE_RUN__ === "function",
    undefined,
    { timeout: 60_000 },
  );
  if (intercepted !== 1)
    throw new Error(`Expected one instrumented module, got ${intercepted}`);
  console.log("[symmetry-noise] CPU CALIBRATION START; GPU disabled");
  const result = await page.evaluate(() =>
    window.__FLAME_SYMMETRY_NOISE_RUN__(),
  );
  if (result.gpuAvailable)
    throw new Error("GPU was available in the CPU-only diagnostic");
  for (const run of result.runs) {
    const file = `${run.name}.png`;
    await writeFile(
      path.join(out, file),
      Buffer.from(run.dataUrl.split(",")[1], "base64"),
    );
    delete run.dataUrl;
    run.image = file;
  }
  result.source = { sourcePath, sourceHash, transformedHash };
  result.finishedAt = new Date().toISOString();
  result.method =
    "Existing benchmark buildEngines/cpuChunk in 2M chunks, exact budget, own mulberry32 seeds, existing downsample/tonemap/diff/TV; control disables only prepared orbit symmetry, retaining original framing and plan.";
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        noise: result.noise,
        droppedSymmetry: result.droppedSymmetry,
        runs: result.runs.map(({ tiling, ...run }) => run),
        output: out,
      },
      null,
      2,
    ),
  );
  console.log("[symmetry-noise] CPU CALIBRATION END");
} finally {
  await browser?.close();
  await vite?.close();
}
