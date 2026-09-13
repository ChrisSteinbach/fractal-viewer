#!/usr/bin/env node
/** Launches the harness-only layered bend GPU image experiment. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { encodePng } from "./de-preview.ts";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-bend-gpu");
const bundle = path.join(outDir, "bend-gpu.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);
const display = String(args.display ?? ":0");
const log = (...values) => console.error("[transmission-bend-gpu]", ...values);

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function sourceProvenance(...metafiles) {
  const explicit = [
    "scripts/transmission-bend-gpu.mjs",
    "scripts/transmission-bend-gpu.page.ts",
    "scripts/transmission-bend-study.ts",
    "scripts/transmission-bend-fixtures.ts",
    "scripts/transmission-layer-field.ts",
    "src/fractal/surface-de-gpu.ts",
    "src/fractal/surface-finish.ts",
  ].map((file) => path.join(root, file));
  const esbuildInputs = metafiles.flatMap((metafile) =>
    Object.keys(metafile.inputs ?? {}),
  );
  const virtualOracleInput = path.join(
    root,
    "transmission-bend-gpu-cpu-oracle.ts",
  );
  const inputs = esbuildInputs
    .map((input) =>
      path.isAbsolute(input) ? input : path.resolve(root, input),
    )
    .filter((input) => input !== virtualOracleInput);
  const files = [...new Set([...explicit, ...inputs])].sort();
  const entries = await Promise.all(
    files.map(async (file) => [
      path.relative(root, file),
      hash(await readFile(file)),
    ]),
  );
  const fileHashes = Object.fromEntries(entries);
  return {
    algorithm: "sha256",
    sourceHash: hash(JSON.stringify(fileHashes)),
    files: fileHashes,
    esbuildInputs: [...new Set(esbuildInputs)].sort(),
    virtualInputs: {
      [path.relative(root, virtualOracleInput)]:
        "esbuild stdin source; its literal text is part of scripts/transmission-bend-gpu.mjs, which is hashed above",
    },
  };
}
async function hardwareRenderer() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("glxinfo", ["-B"], {
    env: { ...process.env, DISPLAY: display },
  });
  const renderer =
    stdout
      .split("\n")
      .find((line) => /OpenGL renderer string/i.test(line))
      ?.trim() ?? "";
  if (!renderer || /swiftshader|llvmpipe/i.test(renderer))
    throw new Error(
      `real-driver refusal: ${renderer || "missing glxinfo renderer"}`,
    );
  return renderer;
}
async function serve() {
  const source = await readFile(bundle);
  const server = createServer((request, response) => {
    if (request.url === "/bend-gpu.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      response.end(source);
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html",
      "cache-control": "no-store",
    });
    response.end(
      '<!doctype html><meta charset="utf-8"><script src="/bend-gpu.js"></script>',
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server did not obtain a TCP port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}
function outputRgb(base64, width, height) {
  const rgba = Buffer.from(base64, "base64");
  if (rgba.length !== width * height * 4)
    throw new Error("page image has unexpected byte size");
  const rgb = new Uint8Array(width * height * 3);
  for (
    let source = 0, target = 0;
    source < rgba.length;
    source += 4, target += 3
  )
    rgb.set(rgba.subarray(source, source + 3), target);
  return encodePng(width, height, rgb);
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const at = (fraction) =>
    values.length
      ? sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
        ]
      : null;
  return {
    max: Math.max(0, ...values),
    mean: values.length ? total / values.length : null,
    p50: at(0.5),
    p95: at(0.95),
  };
}
async function loadCpuOracle() {
  const oracle = path.join(outDir, "cpu-oracle.mjs");
  const built = await build({
    stdin: {
      resolveDir: root,
      sourcefile: "transmission-bend-gpu-cpu-oracle.ts",
      contents: `
        import { renderBentTransmission } from "./scripts/transmission-bend-study";
        import { BEND_REFERENCE_OPTIONS, createBendVisualFixture, proceduralFloor } from "./scripts/transmission-bend-fixtures";
        export function render(fixtureId, mode, size) {
          const fixture = createBendVisualFixture(fixtureId);
          return renderBentTransmission(fixture, size, {
            ...BEND_REFERENCE_OPTIONS, bendOnset: mode, maxLayers: 128,
            maxSamples: 4096, residualTolerance: 0,
            terminalRadiance: proceduralFloor(fixture.scene.boundingRadius),
          });
        }
        export function shared() {
          const visual = (key) => {
            const fixture = createBendVisualFixture(key);
            const scene = fixture.scene;
            const target = scene.target ?? [0, 0, 0];
            const center = scene.boundingCenter ?? target;
            const offset = scene.eyeOffset ?? [1.55, 1.1, 1.8];
            return {
              radius: scene.boundingRadius, center, target,
              eye: scene.eye ?? [target[0] + offset[0] * scene.boundingRadius, target[1] + offset[1] * scene.boundingRadius, target[2] + offset[2] * scene.boundingRadius],
              zoom: scene.zoom ?? .55,
            };
          };
          return {
            visuals: { menger3: visual("menger3"), native4: visual("native4") },
            reference: { transmit: BEND_REFERENCE_OPTIONS.transmit, ior: BEND_REFERENCE_OPTIONS.ior, slabFraction: BEND_REFERENCE_OPTIONS.slabFraction, maxOffsetFraction: BEND_REFERENCE_OPTIONS.maxOffsetFraction, opticalNormalFraction: BEND_REFERENCE_OPTIONS.opticalNormalFraction },
          };
        }`,
    },
    outfile: oracle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    metafile: true,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(oracle).href}?${Date.now()}`),
    metafile: built.metafile,
  };
}
function compareCpu(cpu, diagnostic) {
  const gpu = diagnostic.arrays;
  const rgba = Buffer.from(diagnostic.imageBase64, "base64");
  const eventMismatch = [],
    sampleMismatch = [],
    statusMismatch = [];
  const tau = [],
    variation = [],
    strength = [],
    rgb = [];
  for (let ray = 0; ray < gpu.eventCounts.length; ray++) {
    if (cpu.eventCounts[ray] !== gpu.eventCounts[ray]) eventMismatch.push(ray);
    if (cpu.sampleCounts[ray] !== gpu.samples[ray]) sampleMismatch.push(ray);
    if (cpu.unresolved !== 0 || gpu.status[ray] !== 1) statusMismatch.push(ray);
    tau.push(Math.abs(cpu.throughput[ray] - gpu.tau[ray]));
    variation.push(Math.abs(cpu.variation[ray] - gpu.variation[ray]));
    strength.push(Math.abs(cpu.bendStrength[ray] - gpu.strength[ray]));
    for (let channel = 0; channel < 3; channel++)
      rgb.push(
        Math.abs(cpu.stats.rgb[ray * 3 + channel] - rgba[ray * 4 + channel]) /
          255,
      );
  }
  const gpuReasons = diagnostic.report.completion.reasons;
  const tolerances = {
    rgb: diagnostic.f32ComparisonProposal,
    tau: 1 / 1024,
    variation: 1 / 1024,
    strength: 1 / 1024,
  };
  const terminationAggregateMatches =
    cpu.termination.domainComplete === gpuReasons.domainComplete &&
    cpu.termination.opaque === gpuReasons.opaque &&
    cpu.termination.noIntersection === gpuReasons.noIntersection &&
    cpu.termination.sampleCap === gpuReasons.sampleCap &&
    cpu.termination.layerCap === gpuReasons.layerCap &&
    gpuReasons.schedulerCap === 0 &&
    cpu.termination.unresolved ===
      gpuReasons.sampleCap +
        gpuReasons.layerCap +
        gpuReasons.unresolved +
        gpuReasons.invalid;
  return {
    size: diagnostic.report.width,
    cpuTermination: cpu.termination,
    gpuCompletion: diagnostic.report.completion,
    terminationAggregateMatches,
    statusCheckScope:
      "per-ray GPU completed status plus aggregate CPU/GPU termination reasons; CPU panel does not retain a per-ray termination vector",
    eventMismatchCount: eventMismatch.length,
    firstEventMismatch: eventMismatch[0] ?? null,
    sampleMismatchCount: sampleMismatch.length,
    firstSampleMismatch: sampleMismatch[0] ?? null,
    statusMismatchCount: statusMismatch.length,
    firstStatusMismatch: statusMismatch[0] ?? null,
    tauResidual: distribution(tau),
    variationResidual: distribution(variation),
    strengthResidual: distribution(strength),
    rgbResidual: distribution(rgb),
    tolerances,
  };
}

async function main() {
  if (args.help) {
    console.log(
      "node scripts/transmission-bend-gpu.mjs --display=:0 [--width=512 --height=512 --k=8 --fixture=menger3|native4 --mode=none|weighted --cpuCompareSize=32]",
    );
    return;
  }
  const options = {
    width: positive(args.width ?? 512, "width"),
    height: positive(args.height ?? 512, "height"),
    k: positive(args.k ?? 8, "k"),
    fixture: args.fixture === undefined ? "" : String(args.fixture),
    mode: args.mode === undefined ? "" : String(args.mode),
    cpuCompareSize: positive(args.cpuCompareSize ?? 32, "cpuCompareSize"),
  };
  if (![1, 2, 4, 8].includes(options.k))
    throw new Error("k must be one of 1, 2, 4 or 8");
  await mkdir(outDir, { recursive: true });
  await rm(bundle, { force: true });
  const built = await build({
    entryPoints: [path.join(root, "scripts/transmission-bend-gpu.page.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    metafile: true,
    logLevel: "silent",
  });
  const cpuOracleBuild = await loadCpuOracle();
  const provenance = await sourceProvenance(
    built.metafile,
    cpuOracleBuild.metafile,
  );
  const cpuOracle = cpuOracleBuild.module;
  Object.assign(options, cpuOracle.shared());
  const quiet = await quietBaseline((line) => log(line));
  const contention = contendedReason(quiet);
  if (contention || quiet.contended === null) {
    log(
      `INCONCLUSIVE before launch: ${contention ? `contended by ${contention}` : "GPU conditions UNKNOWN"}`,
    );
    process.exitCode = 2;
    return;
  }
  let renderer;
  try {
    renderer = await hardwareRenderer();
  } catch (error) {
    log(
      "INCONCLUSIVE before launch:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 2;
    return;
  }
  const { server, url } = await serve();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false,
      env: { ...process.env, DISPLAY: display },
      args: [
        "--ozone-platform=x11",
        "--enable-unsafe-webgpu",
        "--enable-dawn-features=allow_unsafe_apis",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 960, height: 540 },
    });
    await page.goto(url, { waitUntil: "load" });
    const result = await page.evaluate(async (runOptions) => {
      const runner = globalThis.TransmissionBendGpu;
      if (!runner || typeof runner.runTransmissionBendGpu !== "function")
        throw new Error("bend GPU page did not expose its runner");
      return runner.runTransmissionBendGpu(runOptions);
    }, options);
    const record = {
      generatedAt: new Date().toISOString(),
      display,
      renderer,
      browserVersion: browser.version(),
      quiet,
      sourceProvenance: provenance,
      options,
      report: result,
    };
    if ("inconclusive" in result) {
      log(`INCONCLUSIVE: ${result.inconclusive}`);
      record.verdict = {
        status: "INCONCLUSIVE",
        reason: result.inconclusive,
      };
      await writeFile(
        path.join(outDir, "report.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      process.exitCode = 2;
      return;
    }
    if ("refused" in result) {
      log(`REFUSED: ${result.refused.reason}`);
      record.verdict = { status: "REFUSED", ...result.refused };
      await writeFile(
        path.join(outDir, "report.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      process.exitCode = 3;
      return;
    }
    for (const row of result.rows) {
      const cpu = cpuOracle.render(
        row.fixture,
        row.mode,
        row.cpuDiagnostic.report.width,
      );
      row.cpuComparison = {
        ...compareCpu(cpu, row.cpuDiagnostic),
        kInvariant: row.cpuDiagnostic.kInvariant,
      };
      delete row.cpuDiagnostic;
      const png = outputRgb(row.imageBase64, row.width, row.height);
      const name = `${row.fixture}-${row.mode}-${row.width}x${row.height}.png`;
      await writeFile(path.join(outDir, name), png);
      row.image = {
        path: path.relative(root, path.join(outDir, name)),
        sha256: hash(png),
        naturalSize: { width: row.width, height: row.height },
      };
      delete row.imageBase64;
      const trace = Buffer.from(row.traceBase64, "base64");
      if (trace.length !== row.width * row.height * 8)
        throw new Error("page trace has unexpected byte size");
      const traceName = `${row.fixture}-${row.mode}-${row.width}x${row.height}.trace.bin`;
      await writeFile(path.join(outDir, traceName), trace);
      row.trace = {
        path: path.relative(root, path.join(outDir, traceName)),
        sha256: hash(trace),
        record:
          "little-endian u32 sampleIndex, u16 eventCount, u8 status, u8 terminationReason",
      };
      delete row.traceBase64;
      log(
        `${row.fixture}/${row.mode}: complete=${row.completion.complete}/${row.completion.total} unresolved=${row.completion.unresolved} maxPass=${row.timing.gpuMaxPassMs.toFixed(3)}ms`,
      );
    }
    const refused = result.rows.some(
      (row) =>
        row.completion.unresolved ||
        row.completion.invalid ||
        row.cpuComparison.eventMismatchCount ||
        row.cpuComparison.sampleMismatchCount ||
        row.cpuComparison.statusMismatchCount ||
        !row.cpuComparison.terminationAggregateMatches ||
        ![
          row.cpuComparison.rgbResidual.max,
          row.cpuComparison.tauResidual.max,
          row.cpuComparison.variationResidual.max,
          row.cpuComparison.strengthResidual.max,
        ].every(Number.isFinite) ||
        row.cpuComparison.rgbResidual.max > row.cpuComparison.tolerances.rgb ||
        row.cpuComparison.tauResidual.max > row.cpuComparison.tolerances.tau ||
        row.cpuComparison.variationResidual.max >
          row.cpuComparison.tolerances.variation ||
        row.cpuComparison.strengthResidual.max >
          row.cpuComparison.tolerances.strength ||
        !row.cpuComparison.kInvariant.complete ||
        !row.cpuComparison.kInvariant.sameImage ||
        !row.cpuComparison.kInvariant.sameWork ||
        Object.values(row.cpuComparison.kInvariant.samePerRay).some(
          (same) => !same,
        ),
    );
    record.verdict = {
      status: refused ? "REFUSED" : "PASS",
      transportCompletionScope:
        "row.completion reports device transport completion only; it is not a full-image CPU-agreement verdict",
      cpuAgreementScope: `CPU and K invariance comparisons are limited to the ${options.cpuCompareSize}x${options.cpuCompareSize} diagnostic raster; the actual image has device transport completion only, not a full-image CPU or K-invariance comparison.`,
    };
    await writeFile(
      path.join(outDir, "report.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    if (refused) {
      log(
        "REFUSED: incomplete/invalid device row or semantic CPU comparison mismatch",
      );
      process.exitCode = 3;
    } else log(`wrote ${path.join(outDir, "report.json")}`);
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  log(
    "fatal:",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
