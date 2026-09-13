/** Harness launcher for the device-owned transmission continuation pilot. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-gpu-resumable");
const bundle = path.join(outDir, "pilot.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);
const display = String(args.display ?? ":0");
const log = (...values) =>
  console.error("[transmission-gpu-resumable]", ...values);

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function sourceProvenance(metafile) {
  const explicit = [
    "scripts/transmission-gpu-resumable.mjs",
    "scripts/transmission-gpu-resumable.page.ts",
    "scripts/transmission-layer-field.ts",
    "scripts/transmission-gpu-contract.ts",
    "src/fractal/surface-de-gpu.ts",
  ].map((file) => path.join(root, file));
  const inputs = Object.keys(metafile.inputs ?? {}).map((input) =>
    path.isAbsolute(input) ? input : path.resolve(root, input),
  );
  const files = [...new Set([...explicit, ...inputs])].sort();
  const hashes = await Promise.all(
    files.map(async (file) => [
      path.relative(root, file),
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    ]),
  );
  return {
    algorithm: "sha256",
    files: Object.fromEntries(hashes),
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
    if (request.url === "/pilot.js") {
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
      '<!doctype html><meta charset="utf-8"><script src="/pilot.js"></script>',
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
    console.log(
      "node scripts/transmission-gpu-resumable.mjs --display=:0 [--fixture=mandelbox-brick-4d-posed-filled-escape --width=64 --height=36 --k=4 --windowRays=1024 --checkWindowInvariant]",
    );
    return;
  }
  await mkdir(outDir, { recursive: true });
  await rm(bundle, { force: true });
  const buildResult = await build({
    entryPoints: [
      path.join(root, "scripts/transmission-gpu-resumable.page.ts"),
    ],
    outfile: bundle,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    metafile: true,
    logLevel: "silent",
  });
  const provenance = await sourceProvenance(buildResult.metafile);
  const quiet = await quietBaseline((line) => log(line));
  const contended = contendedReason(quiet);
  if (contended || quiet.contended === null) {
    log(
      `INCONCLUSIVE before launch: ${contended ? `contended by ${contended}` : "GPU conditions UNKNOWN"}`,
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
    const k = positive(args.k ?? 4, "k");
    if (![1, 2, 4, 8].includes(k))
      throw new Error("k must be one of 1, 2, 4 or 8");
    const options = {
      width: positive(args.width ?? 64, "width"),
      height: positive(args.height ?? 36, "height"),
      k,
      windowRays: positive(args.windowRays ?? 1024, "windowRays"),
      checkWindowInvariant: args.checkWindowInvariant === true,
      fixture: args.fixture === undefined ? undefined : String(args.fixture),
    };
    const report = await page.evaluate(async (pilotOptions) => {
      const pilot = globalThis.TransmissionGpuResumable;
      if (!pilot || typeof pilot.runResumableTransmissionPilot !== "function")
        throw new Error("resumable pilot page did not expose its runner");
      return pilot.runResumableTransmissionPilot(pilotOptions);
    }, options);
    const record = {
      generatedAt: new Date().toISOString(),
      display,
      renderer,
      browserVersion: browser.version(),
      quiet,
      sourceProvenance: provenance,
      report,
    };
    await writeFile(
      path.join(outDir, "report.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    if ("inconclusive" in report) {
      log(`INCONCLUSIVE: ${report.inconclusive}`);
      process.exitCode = 2;
      return;
    }
    for (const row of report.rows) {
      log(
        `${row.fixture}: complete=${row.completion.complete}/${row.completion.total} maxPass=${row.gpuTimingMs.maxSubmission.toFixed(3)}ms transport=${row.cpuTransportOracle.residual.pass}`,
      );
    }
    const refused =
      report.rows.some(
        (row) =>
          row.completion.unresolved !== 0 ||
          row.completion.invalid !== 0 ||
          row.gpuTimingMs.submissionsOver4ms !== 0 ||
          !row.cpuTransportOracle.residual.pass,
      ) ||
      report.chunkInvariant.some(
        (row) =>
          !row.complete ||
          !row.samePerRay ||
          row.kComparisons.some(
            (check) => !check.complete || !check.samePerRay,
          ),
      );
    if (refused) {
      log(
        "REFUSED: completion, <=4ms bounded submission, transport oracle, or requested window invariance failed",
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
