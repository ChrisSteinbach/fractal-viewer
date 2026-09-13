#!/usr/bin/env node
/** Launches the isolated archived Brick CPU/GPU divergence trace. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-gpu-divergence");
const bundle = path.join(outDir, "divergence.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);
const display = String(args.display ?? ":0");
const log = (...values) =>
  console.error("[transmission-gpu-divergence]", ...values);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function provenance(metafile) {
  const explicit = [
    "scripts/transmission-gpu-divergence.mjs",
    "scripts/transmission-gpu-divergence.page.ts",
    "scripts/transmission-gpu-contract.ts",
    "scripts/transmission-layer-field.ts",
    "src/fractal/surface-de-gpu.ts",
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
    if (request.url === "/divergence.js") {
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
      '<!doctype html><meta charset="utf-8"><script src="/divergence.js"></script>',
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

async function main() {
  if (args.help) {
    console.log("node scripts/transmission-gpu-divergence.mjs --display=:0");
    return;
  }
  if (Object.keys(args).some((key) => key !== "display"))
    throw new Error(
      "this archived-witness diagnostic accepts only --display=:0",
    );
  await mkdir(outDir, { recursive: true });
  await rm(bundle, { force: true });
  const built = await build({
    entryPoints: [
      path.join(root, "scripts/transmission-gpu-divergence.page.ts"),
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
    const report = await page.evaluate(async () => {
      const probe = globalThis.TransmissionGpuDivergence;
      if (!probe || typeof probe.runTransmissionGpuDivergence !== "function")
        throw new Error("divergence page did not expose its runner");
      return probe.runTransmissionGpuDivergence();
    });
    const record = {
      generatedAt: new Date().toISOString(),
      display,
      renderer,
      browserVersion: browser.version(),
      quiet,
      sourceProvenance,
      report,
    };
    if ("inconclusive" in report) {
      record.verdict = { status: "INCONCLUSIVE", reason: report.inconclusive };
      await writeFile(
        path.join(outDir, "report.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      log(`INCONCLUSIVE: ${report.inconclusive}`);
      process.exitCode = 2;
      return;
    }
    const reproduce = report.reproduction;
    const reproduced =
      reproduce.sampleCount === reproduce.expectedSampleCount &&
      reproduce.canonicalHashes.matched &&
      reproduce.exactOldCpuTau &&
      reproduce.exactOldGpuTau &&
      reproduce.exactOldCpuVariation &&
      reproduce.exactOldGpuVariation;
    const runtimeClean =
      report.runtime.uncaptured.length === 0 && report.runtime.lost === null;
    record.verdict = {
      status: reproduced && runtimeClean ? "RECORDED" : "REFUSED",
      reproductionScope:
        "Exact old final values are compared to source-hashed literals transcribed from the archived diagnostic JSON; this launcher does not read or hash that archive at runtime. The old record retained only coordinate-hash agreement, not the numeric hash, so current device-captured versus local canonical hashes are compared directly.",
      reproduced,
      runtimeClean,
    };
    await writeFile(
      path.join(outDir, "report.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    log(
      `samples=${reproduce.sampleCount} hash=${reproduce.canonicalHashes.matched} oldTau=${reproduce.exactOldCpuTau}/${reproduce.exactOldGpuTau} oldVariation=${reproduce.exactOldCpuVariation}/${reproduce.exactOldGpuVariation}`,
    );
    if (!reproduced || !runtimeClean) process.exitCode = 3;
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
