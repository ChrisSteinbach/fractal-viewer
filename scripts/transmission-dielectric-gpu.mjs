#!/usr/bin/env node
/** Launches the harness-only finite-cell dielectric image experiment. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { encodePng } from "./de-preview.ts";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-dielectric-gpu");
const bundle = path.join(outDir, "dielectric.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);
const display = String(args.display ?? ":0");
const requestedReport = String(args.output ?? "report.json");
const reportFile = path.resolve(outDir, requestedReport);
if (!reportFile.startsWith(`${outDir}${path.sep}`))
  throw new Error(
    "--output must remain under scripts/out/transmission-dielectric-gpu",
  );
const log = (...values) =>
  console.error("[transmission-dielectric-gpu]", ...values);

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function provenance(metafile) {
  const explicit = [
    "scripts/transmission-dielectric-gpu.mjs",
    "scripts/transmission-dielectric-gpu.page.ts",
  ].map((file) => path.join(root, file));
  const inputs = Object.keys(metafile.inputs ?? {}).map((input) =>
    path.isAbsolute(input) ? input : path.resolve(root, input),
  );
  const files = [...new Set([...explicit, ...inputs])].sort();
  const entries = await Promise.all(
    files.map(async (file) => [
      path.relative(root, file),
      hash(await readFile(file)),
    ]),
  );
  const filesByHash = Object.fromEntries(entries);
  return {
    algorithm: "sha256",
    sourceHash: hash(JSON.stringify(filesByHash)),
    files: filesByHash,
    esbuildInputs: Object.keys(metafile.inputs ?? {}).sort(),
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
    if (request.url === "/dielectric.js") {
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
      '<!doctype html><meta charset="utf-8"><script src="/dielectric.js"></script>',
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

function outputPng(base64, width, height) {
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

async function main() {
  if (args.help) {
    console.log(
      "node scripts/transmission-dielectric-gpu.mjs --display=:0 [--width=1024 --height=1024 --tileWidth=128 --tileHeight=64 --fixture=menger3 --mode=glass --diagnostic --output=report.json]",
    );
    return;
  }
  const options = {
    width: positive(args.width ?? 1024, "width"),
    height: positive(args.height ?? 1024, "height"),
    tileWidth: positive(args.tileWidth ?? 128, "tileWidth"),
    tileHeight: positive(args.tileHeight ?? 64, "tileHeight"),
    diagnostic: args.diagnostic === true,
  };
  const fixtureNames = args.fixture
    ? [String(args.fixture)]
    : ["menger3", "hyper4"];
  const modeNames = args.mode ? [String(args.mode)] : ["opaque", "glass"];
  if (!fixtureNames.every((value) => ["menger3", "hyper4"].includes(value)))
    throw new Error("--fixture must be menger3 or hyper4");
  if (!modeNames.every((value) => ["opaque", "glass"].includes(value)))
    throw new Error("--mode must be opaque or glass");
  await mkdir(outDir, { recursive: true });
  await rm(bundle, { force: true });
  const built = await build({
    entryPoints: [
      path.join(root, "scripts/transmission-dielectric-gpu.page.ts"),
    ],
    outfile: bundle,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    metafile: true,
    logLevel: "silent",
  });
  const sourceProvenance = await provenance(built.metafile);
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
    const execute = (runOptions) =>
      page.evaluate(async (pageOptions) => {
        const harness = globalThis.TransmissionDielectricGpu;
        if (
          !harness ||
          typeof harness.runTransmissionDielectricGpu !== "function"
        )
          throw new Error("dielectric page did not expose its runner");
        return harness.runTransmissionDielectricGpu(pageOptions);
      }, runOptions);
    const rows = [];
    const runtime = { uncaptured: [], lost: null };
    let browserAdapter = null;
    let controls = null;
    for (const fixture of fixtureNames)
      for (const mode of modeNames) {
        const pageReturnEncodeWriteStarted = performance.now();
        const item = await execute({ ...options, fixture, mode });
        const partialRecord = {
          generatedAt: new Date().toISOString(),
          display,
          renderer,
          browserVersion: browser.version(),
          quiet,
          sourceProvenance,
          options,
          report: item,
        };
        if ("inconclusive" in item) {
          partialRecord.verdict = {
            status: "INCONCLUSIVE",
            reason: item.inconclusive,
          };
          await writeFile(
            reportFile,
            `${JSON.stringify(partialRecord, null, 2)}\n`,
          );
          process.exitCode = 2;
          return;
        }
        if ("preflightRefusal" in item) {
          partialRecord.verdict = {
            status: "REFUSED",
            reason: item.preflightRefusal.reason,
            scope: "Allocation-free preflight; no device buffers were created.",
          };
          await writeFile(
            reportFile,
            `${JSON.stringify(partialRecord, null, 2)}\n`,
          );
          process.exitCode = 3;
          return;
        }
        if ("controlRefusal" in item) {
          partialRecord.verdict = {
            status: "REFUSED",
            reason: item.controlRefusal.reason,
            scope:
              "GPU image rows were not launched because current-source device controls failed.",
          };
          await writeFile(
            reportFile,
            `${JSON.stringify(partialRecord, null, 2)}\n`,
          );
          process.exitCode = 3;
          return;
        }
        browserAdapter ??= item.browserAdapter;
        controls ??= item.controls;
        runtime.uncaptured.push(...item.runtime.uncaptured);
        runtime.lost ??= item.runtime.lost;
        const [row] = item.rows;
        const png = outputPng(row.imageBase64, row.width, row.height);
        const filename = `${row.fixture}-${row.mode}-${row.width}x${row.height}.png`;
        await writeFile(path.join(outDir, filename), png);
        const pageReturnEncodeWriteWallMs =
          performance.now() - pageReturnEncodeWriteStarted;
        const launcherBase64DecodeBytes = row.width * row.height * 4;
        const launcherRgbEncodeBytes = row.width * row.height * 3;
        const knownCrossProcessBytes =
          row.memory.knownAdditionalBytes +
          launcherBase64DecodeBytes +
          launcherRgbEncodeBytes +
          png.byteLength;
        row.memory = {
          ...row.memory,
          launcherBase64DecodeBytes,
          launcherRgbEncodeBytes,
          launcherPngBytes: png.byteLength,
          knownCrossProcessBytes,
          crossProcessLimitCheck:
            knownCrossProcessBytes <= row.memory.limitBytes,
        };
        row.image = {
          path: path.relative(root, path.join(outDir, filename)),
          sha256: hash(png),
          naturalSize: { width: row.width, height: row.height },
        };
        row.timing = {
          ...row.timing,
          pageReturnEncodeWriteWallMs,
          pageReturnEncodeWriteScope:
            "Node wall from immediately before page.evaluate through page return, RGBA base64 decode, PNG encode and PNG file write; excludes browser launch/startup and later checkpoint JSON serialization.",
        };
        delete row.imageBase64;
        rows.push(row);
        await writeFile(
          reportFile,
          `${JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              display,
              renderer,
              browserVersion: browser.version(),
              quiet,
              sourceProvenance,
              options,
              report: {
                browserAdapter,
                options,
                rows,
                runtime,
                controls,
                executionScope:
                  "Checkpoint after one page invocation; each finished image is encoded before the next row begins.",
              },
              verdict: {
                status: "PARTIAL",
                scope:
                  "A recoverable harness checkpoint, not a candidate review artifact.",
              },
            },
            null,
            2,
          )}\n`,
        );
      }
    const report = {
      browserAdapter,
      options,
      rows,
      runtime,
      controls,
      executionScope:
        "Each row runs in a separate page invocation so only one full image base64 payload crosses the browser boundary at once.",
    };
    const record = {
      generatedAt: new Date().toISOString(),
      display,
      renderer,
      browserVersion: browser.version(),
      quiet,
      sourceProvenance,
      options,
      report,
    };
    const refused =
      report.controls?.passed !== true ||
      report.rows.some(
        (row) => row.completion.unresolved || row.completion.invalid,
      ) ||
      report.rows.some(
        (row) =>
          !Number.isFinite(row.residual.radianceBound) ||
          !Number.isFinite(row.residual.totalRadianceBound) ||
          row.residual.radianceBound > row.residual.errorBudget,
      ) ||
      report.rows.some((row) => !row.memory.crossProcessLimitCheck) ||
      report.runtime.uncaptured.length > 0 ||
      report.runtime.lost !== null;
    record.verdict = {
      status: refused ? "REFUSED" : "RECORDED",
      scope:
        "Harness-only finite-cell images. Completion/residual and selected CPU agreement are reported; this is not production renderer qualification.",
    };
    await writeFile(reportFile, `${JSON.stringify(record, null, 2)}\n`);
    for (const row of report.rows)
      log(
        `${row.fixture}/${row.mode}: complete=${row.completion.complete}/${row.completion.total} unresolved=${row.completion.unresolved} residual=${row.residual.radianceBound}`,
      );
    if (refused) process.exitCode = 3;
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
