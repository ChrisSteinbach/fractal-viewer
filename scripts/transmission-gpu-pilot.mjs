/**
 * Harness-only real-driver feasibility pilot for sampled transmission
 * clearance. It bundles the page half against the repository's production
 * estimator generator, launches a minimal secure origin, and writes a
 * regenerable report under scripts/out/.
 *
 * Usage (only in a root-coordinated quiet-GPU slot):
 *   export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
 *   node scripts/transmission-gpu-pilot.mjs --display=:0
 *
 * Exit 0 is a completed qualifying pilot, 3 is a measured refusal, 2 is
 * INCONCLUSIVE (including unknown or contended machine conditions), and
 * 1 is a harness/runtime failure.
 */
import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { clearancePilotRefusal } from "./transmission-gpu-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-gpu-pilot");
const bundle = path.join(outDir, "pilot.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);
const display = String(args.display ?? ":0");
const log = (...values) => console.error("[transmission-gpu-pilot]", ...values);

function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0)
    throw new Error(`${name} must be a positive integer`);
  return result;
}

async function assertHardwareRenderer() {
  // A browser may fall back while an X server is accessible. `glxinfo` is the
  // project-prescribed preflight and its renderer string is evidence in the
  // report, not an assumption based on DISPLAY alone.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("glxinfo", ["-B"], {
    env: { ...process.env, DISPLAY: display },
  });
  const renderer =
    stdout
      .split("\n")
      .find((line) => /OpenGL renderer string/i.test(line))
      ?.trim() ?? "";
  if (!renderer || /swiftshader|llvmpipe/i.test(renderer))
    throw new Error(
      `real-driver refusal: ${renderer || "glxinfo returned no renderer"}`,
    );
  return renderer;
}

async function serve() {
  const source = await readFile(bundle);
  const html = `<!doctype html><meta charset="utf-8"><script src="/pilot.js"></script>`;
  const server = createServer((request, response) => {
    if (request.url === "/pilot.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      response.end(source);
    } else {
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-store",
      });
      response.end(html);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("pilot server did not obtain a TCP port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function main() {
  if (args.help) {
    console.log(
      "node scripts/transmission-gpu-pilot.mjs --display=:0 [--width=512 --height=288 --batchSamples=65536 --maxSamples=8000000 --checkChunkInvariant]",
    );
    return;
  }
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(root, "scripts/transmission-gpu-pilot.page.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    logLevel: "silent",
  });
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
    renderer = await assertHardwareRenderer();
  } catch (error) {
    log("INCONCLUSIVE before launch:", error.message ?? String(error));
    process.exitCode = 2;
    return;
  }
  log(`renderer: ${renderer}`);
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
        // Chrome/Dawn exposes timestamp-query on this real-driver stack only
        // behind this explicit unsafe-api feature; the renderer doc records
        // the timestamp probe and its required launch shape.
        "--enable-dawn-features=allow_unsafe_apis",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    });
    const browserVersion = browser.version();
    const page = await browser.newPage({
      viewport: { width: 960, height: 540 },
    });
    await page.goto(url, { waitUntil: "load" });
    const options = {
      width:
        args.width === undefined ? 512 : positiveInteger(args.width, "width"),
      height:
        args.height === undefined
          ? 288
          : positiveInteger(args.height, "height"),
      batchSamples:
        args.batchSamples === undefined
          ? 65536
          : positiveInteger(args.batchSamples, "batchSamples"),
      maxSamples:
        args.maxSamples === undefined
          ? 8_000_000
          : positiveInteger(args.maxSamples, "maxSamples"),
      checkChunkInvariant: args.checkChunkInvariant === true,
    };
    const report = await page.evaluate(async (pilotOptions) => {
      const pilot = globalThis.TransmissionGpuPilot;
      if (!pilot || typeof pilot.runTransmissionGpuPilot !== "function")
        throw new Error("pilot page did not expose runner");
      return pilot.runTransmissionGpuPilot(pilotOptions);
    }, options);
    const record = {
      generatedAt: new Date().toISOString(),
      display,
      renderer,
      browserVersion,
      quiet,
      report,
    };
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        path.join(outDir, "report.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      ),
    );
    if ("inconclusive" in report) {
      log(`INCONCLUSIVE: ${report.inconclusive}`);
      process.exitCode = 2;
    } else {
      log(`wrote ${path.join(outDir, "report.json")}`);
      for (const row of report.rows)
        log(
          `${row.fixture}: samples=${row.phase.clearance.samples} submissions=${row.phase.clearance.submissions} unresolved=${row.result.unresolved}`,
        );
      const refusal = clearancePilotRefusal(report);
      if (refusal) {
        log(`REFUSED: ${refusal}`);
        process.exitCode = 3;
      } else if (report.rows.some((row) => row.timing.gpuPassMs === null)) {
        log(
          "INCONCLUSIVE: timestamp-query was unavailable; no device-time row",
        );
        process.exitCode = 2;
      }
    }
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
