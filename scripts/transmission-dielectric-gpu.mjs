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
import {
  attributeProcessTreeRssTimeline,
  sampleProcessTreeRss,
  sampleProcessTreeRssPeak,
} from "./lib/process-tree-memory.mjs";

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

// The staged authoritative arm must reproduce the canonical 256x144 glass
// RGBA, completion, residual and refusal metadata measured at the final
// qualified source (the consolidated evidence snapshot in
// docs/surface-dielectric-study.md). These pins make that identity gate
// executable even though the final records themselves are regenerable and
// gitignored; they are image/metadata hashes, not appearance approval, and
// the provisional staged rows never inherit them.
const STAGED_AUTHORITATIVE_BASELINES = {
  menger3: {
    pngSha256:
      "7d65815c8d33b2547caec36b906533eb2017e6f079de999d4978866066e453fb",
    rgbaSha256:
      "d9227ff34d479c7ca1dc198ada558f21f7820bb3267aa7c87550b60764d6120c",
    completion: {
      complete: 36864,
      residual: 7852,
      unresolved: 0,
      invalid: 0,
      capEvents: 0,
      sampleTotal: 147456,
      sampleComplete: 147456,
      sampleUnresolved: 0,
      sampleInvalid: 0,
      total: 36864,
    },
    radianceBound: 0.0009469667566008866,
    totalRadianceBound: 4.6180398175579285,
    totalSampleMaxChannelRadianceBound: 18.472159270231714,
    replay: {
      maxPerPixelMaxChannelLinearRgbBound: 0.0009469667566008866,
      allSamplesComplete: true,
      capFree: true,
      sampleComplete: 147456,
      sampleTotal: 147456,
      sampleUnresolved: 0,
      sampleInvalid: 0,
      unresolvedPixels: 0,
      invalidPixels: 0,
      capEvents: 0,
    },
    refusal: {
      failurePixels: {
        traversal: 0,
        insideMiss: 0,
        stackLimit: 0,
        interfaceLimit: 0,
        processedLimit: 0,
      },
      failureSamples: {
        traversal: 0,
        insideMiss: 0,
        stackLimit: 0,
        interfaceLimit: 0,
        processedLimit: 0,
      },
      traversalReasonPixels: {},
      witnesses: [],
    },
  },
  hyper4: {
    pngSha256:
      "0445ca389a81a1028a0f8c9bdf25287e36bb119e9d253eb3b39e7ed5aa521dcb",
    rgbaSha256:
      "c6356f978b07bd8af024e0959cbdeaeebf3100e2bca54430e1f3ff637fc0dce9",
    completion: {
      complete: 36864,
      residual: 7820,
      unresolved: 0,
      invalid: 0,
      capEvents: 0,
      sampleTotal: 147456,
      sampleComplete: 147456,
      sampleUnresolved: 0,
      sampleInvalid: 0,
      total: 36864,
    },
    radianceBound: 0.0009206709219142795,
    totalRadianceBound: 3.0286833386353464,
    totalSampleMaxChannelRadianceBound: 12.114733354541386,
    replay: {
      maxPerPixelMaxChannelLinearRgbBound: 0.0009206709219142795,
      allSamplesComplete: true,
      capFree: true,
      sampleComplete: 147456,
      sampleTotal: 147456,
      sampleUnresolved: 0,
      sampleInvalid: 0,
      unresolvedPixels: 0,
      invalidPixels: 0,
      capEvents: 0,
    },
    refusal: {
      failurePixels: {
        traversal: 0,
        insideMiss: 0,
        stackLimit: 0,
        interfaceLimit: 0,
        processedLimit: 0,
      },
      failureSamples: {
        traversal: 0,
        insideMiss: 0,
        stackLimit: 0,
        interfaceLimit: 0,
        processedLimit: 0,
      },
      traversalReasonPixels: {},
      witnesses: [],
    },
  },
};

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function dimensions(value, name) {
  const match = /^(\d+)x(\d+)$/.exec(String(value));
  if (!match) throw new Error(`${name} must be WIDTHxHEIGHT`);
  return {
    width: positive(match[1], `${name} width`),
    height: positive(match[2], `${name} height`),
  };
}

function pixelRegion(value, name) {
  const fields = String(value).split(",");
  if (fields.length !== 4) throw new Error(`${name} must be X,Y,WIDTH,HEIGHT`);
  const [x, y, width, height] = fields.map(Number);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error(`${name} must contain non-negative X/Y and positive sizes`);
  return { x, y, width, height };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function provenance(metafile) {
  const explicit = [
    "scripts/transmission-dielectric-gpu.mjs",
    "scripts/transmission-dielectric-gpu.page.ts",
    "scripts/lib/process-tree-memory.mjs",
    "scripts/lib/process-tree-memory.d.mts",
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

function rgbaBytes(base64, width, height) {
  const rgba = Buffer.from(base64, "base64");
  if (rgba.length !== width * height * 4)
    throw new Error("page image has unexpected byte size");
  return rgba;
}

function outputPng(base64, width, height) {
  const decodeStarted = performance.now();
  const rgba = rgbaBytes(base64, width, height);
  const base64DecodeMs = performance.now() - decodeStarted;
  const rgbConversionStarted = performance.now();
  const rgb = new Uint8Array(width * height * 3);
  for (
    let source = 0, target = 0;
    source < rgba.length;
    source += 4, target += 3
  )
    rgb.set(rgba.subarray(source, source + 3), target);
  const rgbaToRgbMs = performance.now() - rgbConversionStarted;
  const pngEncodeStarted = performance.now();
  const png = encodePng(width, height, rgb);
  const pngEncodeMs = performance.now() - pngEncodeStarted;
  return {
    png,
    rgba,
    timing: { base64DecodeMs, rgbaToRgbMs, pngEncodeMs },
  };
}

function cropRgba(rgba, fullWidth, region) {
  const cropped = Buffer.alloc(region.width * region.height * 4);
  const rowBytes = region.width * 4;
  for (let y = 0; y < region.height; y++) {
    const source = ((region.y + y) * fullWidth + region.x) * 4;
    rgba.copy(cropped, y * rowBytes, source, source + rowBytes);
  }
  return cropped;
}

function completedRow(item, row) {
  return (
    item.controls?.passed === true &&
    item.runtime?.uncaptured?.length === 0 &&
    item.runtime?.lost === null &&
    row.completion.complete === row.completion.total &&
    row.completion.unresolved === 0 &&
    row.completion.invalid === 0 &&
    row.completion.capEvents === 0 &&
    row.completion.sampleComplete === row.completion.sampleTotal &&
    row.completion.sampleUnresolved === 0 &&
    row.completion.sampleInvalid === 0 &&
    Number.isFinite(row.residual.radianceBound) &&
    row.residual.radianceBound <= row.residual.errorBudget &&
    row.residual.replay?.allSamplesComplete === true &&
    row.residual.replay?.capFree === true
  );
}

function compactInvariantRun(item, row, rgba, tile) {
  return {
    tile,
    tiles: item.schedule.totalTiles,
    rgbaBytes: rgba.byteLength,
    rgbaSha256: hash(rgba),
    complete: completedRow(item, row),
    completion: row.completion,
    radianceBound: row.residual.radianceBound,
    errorBudget: row.residual.errorBudget,
    runtime: item.runtime,
  };
}

const POSE_CHECK_CASES = Object.freeze([
  { id: "menger3-canonical", fixture: "menger3", camera: "canonical" },
  { id: "menger3-grazing", fixture: "menger3", camera: "grazing" },
  {
    id: "menger3-cornerAdjacent",
    fixture: "menger3",
    camera: "cornerAdjacent",
  },
  {
    id: "hyper4-canonical-canonical",
    fixture: "hyper4",
    camera: "canonical",
    hyperPose: "canonical",
  },
  {
    id: "hyper4-canonical-grazing",
    fixture: "hyper4",
    camera: "grazing",
    hyperPose: "canonical",
  },
  {
    id: "hyper4-canonical-cornerAdjacent",
    fixture: "hyper4",
    camera: "cornerAdjacent",
    hyperPose: "canonical",
  },
  {
    id: "hyper4-rotorA-grazing",
    fixture: "hyper4",
    camera: "grazing",
    hyperPose: "rotorA",
  },
  {
    id: "hyper4-rotorB-cornerAdjacent",
    fixture: "hyper4",
    camera: "cornerAdjacent",
    hyperPose: "rotorB",
  },
]);

const POSE_CAMERA_METADATA = Object.freeze({
  canonical: Object.freeze({
    eye: [2.1, 1.4, 3.2],
    target: [0, 0, 0],
    tanHalf: 0.39,
  }),
  grazing: Object.freeze({
    eye: [3.85, 0.28, 0.95],
    target: [0.05, -0.06, 0],
    tanHalf: 0.39,
  }),
  cornerAdjacent: Object.freeze({
    eye: [2.35, 2.25, 2.15],
    target: [-0.08, 0.07, 0.03],
    tanHalf: 0.39,
  }),
});

const POSE_GEOMETRY_METADATA = Object.freeze({
  menger3: Object.freeze({ rotation: {}, slice: 0 }),
  canonical: Object.freeze({ rotation: { xw: 0.57, yw: -0.31 }, slice: 0.18 }),
  rotorA: Object.freeze({
    rotation: { xw: 0.82, yw: -0.41, zw: 0.18 },
    slice: 0.34,
  }),
  rotorB: Object.freeze({
    rotation: { xw: -0.37, yw: 0.74, zw: -0.29, xy: 0.21 },
    slice: -0.28,
  }),
});

function sameNumbers(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameRecord(left, right) {
  return (
    left !== null &&
    typeof left === "object" &&
    !Array.isArray(left) &&
    right !== null &&
    typeof right === "object" &&
    !Array.isArray(right) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(right).every(([key, value]) => left[key] === value)
  );
}

function poseMetadataMatches(row, pose) {
  const camera = row.camera;
  const geometry = row.scene?.geometryPose;
  const expectedCamera = POSE_CAMERA_METADATA[pose.camera];
  const expectedGeometry =
    POSE_GEOMETRY_METADATA[
      pose.fixture === "menger3" ? "menger3" : (pose.hyperPose ?? "canonical")
    ];
  return (
    camera?.id === pose.camera &&
    sameNumbers(camera.eye, expectedCamera.eye) &&
    sameNumbers(camera.target, expectedCamera.target) &&
    camera.tanHalf === expectedCamera.tanHalf &&
    geometry?.id === (pose.hyperPose ?? "canonical") &&
    sameRecord(geometry.rotation, expectedGeometry.rotation) &&
    geometry.slice === expectedGeometry.slice &&
    geometry.preflight?.valid === true &&
    Array.isArray(geometry.rotorRows) &&
    geometry.rotorRows.length === 4 &&
    geometry.rotorRows.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 4 &&
        row.every(
          (value) => Number.isFinite(value) && Math.fround(value) === value,
        ),
    )
  );
}

const PROCESS_TREE_RSS_SCOPE =
  "Linux /proc resident-set snapshot for this Node launcher and recursively listed browser descendants, from immediately before page.evaluate through RGBA conversion, PNG encoding and PNG file write. It excludes GPU driver-private allocations, VRAM, browser-wide allocations outside that tree, and non-RSS memory; it is not total-memory certification.";

function unmeasuredProcessTreeRss(reason) {
  return {
    status: "unmeasured",
    scope: PROCESS_TREE_RSS_SCOPE,
    reason,
    baseline: null,
    peak: null,
    additionalRssBytes: null,
  };
}

function processTreeRssRecord(baseline, peak) {
  const complete = baseline.status === "ok" && peak.status === "ok";
  const status = complete
    ? "ok"
    : baseline.status === "unknown" || peak.status === "unknown"
      ? "unknown"
      : "partial";
  return {
    status,
    scope: PROCESS_TREE_RSS_SCOPE,
    baseline: {
      status: baseline.status,
      rssBytes: baseline.rssBytes,
      knownRssBytes: baseline.knownRssBytes,
      sampledPids: baseline.sampledPids,
      unavailableProcessCount: baseline.unavailableProcessCount,
      issues: baseline.issues,
    },
    peak: {
      status: peak.status,
      rssBytes: peak.peakRssBytes,
      knownRssBytes: peak.knownPeakRssBytes,
      sampleCount: peak.sampleCount,
      completeSampleCount: peak.completeSampleCount,
      partialSampleCount: peak.partialSampleCount,
      unknownSampleCount: peak.unknownSampleCount,
      intervalMs: peak.intervalMs,
      startedAtMs: peak.startedAtMs,
      endedAtMs: peak.endedAtMs,
      issues: peak.issues,
    },
    additionalRssBytes: complete ? peak.peakRssBytes - baseline.rssBytes : null,
  };
}

async function within(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (args.help) {
    console.log(
      "node scripts/transmission-dielectric-gpu.mjs --display=:0 [--width=1024 --height=1024 --tileWidth=128 --tileHeight=64 --fixture=menger3 --mode=glass [--camera=canonical|grazing|cornerAdjacent] [--hyperPose=canonical|rotorA|rotorB] [--submissionProbe] [--rssTrace] --cancelProbe [--provisionalCancel] | --tileCheck=100x55,73x47 --window=37,29,121,67 | --poseCheck | --staged [--stagedReuse] --fixture=menger3 --mode=glass --output=report.json]",
    );
    return;
  }
  const options = {
    width: positive(args.width ?? 1024, "width"),
    height: positive(args.height ?? 1024, "height"),
    tileWidth: positive(args.tileWidth ?? 128, "tileWidth"),
    tileHeight: positive(args.tileHeight ?? 64, "tileHeight"),
    diagnostic: args.diagnostic === true,
    submissionProbe: args.submissionProbe === true,
    ...(args.camera !== undefined ? { camera: String(args.camera) } : {}),
    ...(args.hyperPose !== undefined
      ? { hyperPose: String(args.hyperPose) }
      : {}),
  };
  const fixtureNames = args.fixture
    ? [String(args.fixture)]
    : ["menger3", "hyper4"];
  const modeNames = args.mode ? [String(args.mode)] : ["opaque", "glass"];
  if (!fixtureNames.every((value) => ["menger3", "hyper4"].includes(value)))
    throw new Error("--fixture must be menger3 or hyper4");
  if (!modeNames.every((value) => ["opaque", "glass"].includes(value)))
    throw new Error("--mode must be opaque or glass");
  if (
    args.camera !== undefined &&
    !["canonical", "grazing", "cornerAdjacent"].includes(String(args.camera))
  )
    throw new Error("--camera must be canonical, grazing or cornerAdjacent");
  if (
    args.hyperPose !== undefined &&
    !["canonical", "rotorA", "rotorB"].includes(String(args.hyperPose))
  )
    throw new Error("--hyperPose must be canonical, rotorA or rotorB");
  if (args.hyperPose !== undefined && String(args.fixture) !== "hyper4")
    throw new Error("--hyperPose requires --fixture=hyper4");
  const cancelProbeRequested = args.cancelProbe === true;
  const tileCheckRequested = args.tileCheck !== undefined;
  const poseCheckRequested = args.poseCheck === true;
  const stagedRequested = args.staged === true;
  if (
    poseCheckRequested &&
    (args.fixture !== undefined ||
      args.mode !== undefined ||
      args.camera !== undefined ||
      args.hyperPose !== undefined ||
      args.cancelProbe === true ||
      args.tileCheck !== undefined ||
      args.window !== undefined ||
      args.staged === true ||
      options.diagnostic ||
      options.submissionProbe)
  )
    throw new Error(
      "--poseCheck is a fixed glass matrix and cannot be combined with fixture, mode, camera, hyperPose, cancelProbe, tileCheck, window, staged, diagnostic or submissionProbe",
    );
  if (
    cancelProbeRequested &&
    (!args.fixture ||
      !args.mode ||
      fixtureNames.length !== 1 ||
      modeNames.length !== 1)
  )
    throw new Error("--cancelProbe requires one explicit --fixture and --mode");
  if (cancelProbeRequested && tileCheckRequested)
    throw new Error(
      "--cancelProbe and --tileCheck are separate qualification runs",
    );
  if (
    stagedRequested &&
    (!args.fixture ||
      !args.mode ||
      fixtureNames.length !== 1 ||
      modeNames.length !== 1 ||
      modeNames[0] !== "glass")
  )
    throw new Error(
      "--staged requires one explicit --fixture and --mode=glass",
    );
  if (
    stagedRequested &&
    (args.cancelProbe === true ||
      args.tileCheck !== undefined ||
      args.window !== undefined ||
      args.camera !== undefined ||
      args.hyperPose !== undefined ||
      options.diagnostic ||
      options.submissionProbe)
  )
    throw new Error(
      "--staged pins the canonical poses and refuses cancelProbe, tileCheck, window, camera, hyperPose, diagnostic and submissionProbe",
    );
  if (options.submissionProbe && (cancelProbeRequested || tileCheckRequested))
    throw new Error(
      "--submissionProbe decomposes uninterrupted submissions on the plain default path and cannot be combined with --cancelProbe or --tileCheck",
    );
  const rssTraceRequested = args.rssTrace === true;
  if (
    rssTraceRequested &&
    (cancelProbeRequested ||
      tileCheckRequested ||
      poseCheckRequested ||
      stagedRequested ||
      options.submissionProbe)
  )
    throw new Error(
      "--rssTrace attributes the process-tree RSS timeline on the plain default path and cannot be combined with --cancelProbe, --tileCheck, --poseCheck, --staged or --submissionProbe",
    );
  const provisionalCancelRequested = args.provisionalCancel === true;
  if (provisionalCancelRequested && !cancelProbeRequested)
    throw new Error("--provisionalCancel extends --cancelProbe");
  if (provisionalCancelRequested && modeNames[0] !== "glass")
    throw new Error("--provisionalCancel requires --mode=glass");
  // The provisional cancel probe runs every stage — baseline, cancelled run
  // and byte-identity follow-up — at the staged preview's one-sample shape.
  const provisionalCancelOptions = provisionalCancelRequested
    ? { samplesPerPixel: 1, provisional: true, replayPassDiagnostic: true }
    : {};
  const stagedReuseRequested = args.stagedReuse === true;
  if (stagedReuseRequested && !stagedRequested)
    throw new Error("--stagedReuse extends --staged");
  if (
    stagedRequested &&
    !Object.hasOwn(STAGED_AUTHORITATIVE_BASELINES, fixtureNames[0])
  )
    throw new Error(
      "--staged has no pinned authoritative baseline for this fixture",
    );
  if (tileCheckRequested && options.diagnostic)
    throw new Error("--tileCheck does not accept --diagnostic");
  if (tileCheckRequested && modeNames.some((mode) => mode !== "glass"))
    throw new Error("--tileCheck requires --mode=glass");
  if (args.window !== undefined && !tileCheckRequested)
    throw new Error("--window is only used with --tileCheck");
  const tileCheck = tileCheckRequested
    ? String(args.tileCheck)
        .split(",")
        .map((value, index) => dimensions(value, `tileCheck case ${index + 1}`))
    : [];
  if (tileCheckRequested && tileCheck.length !== 2)
    throw new Error("--tileCheck requires exactly two WIDTHxHEIGHT cases");
  if (
    tileCheckRequested &&
    tileCheck[0].width === tileCheck[1].width &&
    tileCheck[0].height === tileCheck[1].height
  )
    throw new Error("--tileCheck cases must be distinct");
  const checkWindow = tileCheckRequested
    ? pixelRegion(args.window ?? "37,29,121,67", "window")
    : null;
  if (
    checkWindow !== null &&
    (checkWindow.x + checkWindow.width > options.width ||
      checkWindow.y + checkWindow.height > options.height)
  )
    throw new Error("--window must remain inside the full image");
  if (
    tileCheckRequested &&
    tileCheck.some(
      (tile) =>
        tile.width >= options.width ||
        tile.height >= options.height ||
        options.width % tile.width === 0 ||
        options.height % tile.height === 0,
    )
  )
    throw new Error(
      "every --tileCheck case must leave partial right and bottom edges",
    );
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
    const readProgress = () =>
      page.evaluate(() => {
        const harness = globalThis.TransmissionDielectricGpu;
        return harness?.transmissionDielectricGpuProgress?.() ?? null;
      });
    const requestCancel = () =>
      page.evaluate(() => {
        const harness = globalThis.TransmissionDielectricGpu;
        return (
          harness?.cancelTransmissionDielectricGpu?.() ?? {
            requested: false,
            reason: "dielectric page did not expose cancellation",
          }
        );
      });
    const executeImage = async (runOptions, filename, traceRss = false) => {
      const processTreeRssBaseline = await sampleProcessTreeRss(process.pid);
      const observed = await sampleProcessTreeRssPeak(
        process.pid,
        async () => {
          const pageReturnEncodeWriteStarted = performance.now();
          let rssTimeline = null;
          let stopRssMonitor = async () => {};
          if (traceRss) {
            // Sample the process tree beside the page's own progress so each
            // RSS observation carries the run stage it was taken in. The
            // page-run scope only: the launcher's own decode/encode/write
            // work is accounted analytically in row.memory.
            const RSS_TRACE_INTERVAL_MS = 100;
            const samples = [];
            const traceStarted = performance.now();
            let tracing = true;
            const monitor = (async () => {
              while (tracing) {
                const progress = await readProgress();
                const rss = await sampleProcessTreeRss(process.pid);
                samples.push({
                  atMs: Math.round(performance.now() - traceStarted),
                  stage: progress?.stage ?? "before-run",
                  completedTiles: progress?.completedTiles ?? null,
                  replayPass: progress?.replayPass ?? null,
                  submissions: progress?.submissions ?? null,
                  rssStatus: rss.status,
                  ...(rss.status === "ok"
                    ? { rssBytes: rss.rssBytes }
                    : rss.status === "partial"
                      ? { knownRssBytes: rss.knownRssBytes }
                      : {}),
                });
                await new Promise((resolve) =>
                  setTimeout(resolve, RSS_TRACE_INTERVAL_MS),
                );
              }
            })();
            stopRssMonitor = async () => {
              tracing = false;
              await monitor;
            };
            rssTimeline = samples;
          }
          try {
            const item = await execute(runOptions);
            if (
              "inconclusive" in item ||
              "preflightRefusal" in item ||
              "controlRefusal" in item ||
              "cancelled" in item
            )
              return { item };
            if (!Array.isArray(item.rows) || item.rows.length !== 1)
              throw new Error("image invocation did not produce one row");
            const [row] = item.rows;
            const pageEvaluateWallMs =
              performance.now() - pageReturnEncodeWriteStarted;
            const {
              png,
              rgba,
              timing: launcherImageTiming,
            } = outputPng(row.imageBase64, row.width, row.height);
            const outputFilename =
              typeof filename === "function" ? filename(row) : filename;
            const pngWriteStarted = performance.now();
            await writeFile(path.join(outDir, outputFilename), png);
            const pngWriteMs = performance.now() - pngWriteStarted;
            return {
              item,
              row,
              png,
              rgba,
              outputFilename,
              launcherImageTiming,
              pageEvaluateWallMs,
              pngWriteMs,
              pageReturnEncodeWriteWallMs:
                performance.now() - pageReturnEncodeWriteStarted,
              rssTimeline,
            };
          } finally {
            await stopRssMonitor();
          }
        },
        { intervalMs: 25, initialSample: processTreeRssBaseline },
      );
      const { item } = observed.value;
      if (
        "inconclusive" in item ||
        "preflightRefusal" in item ||
        "controlRefusal" in item ||
        "cancelled" in item
      )
        return { item };
      const {
        row,
        png,
        rgba,
        outputFilename,
        launcherImageTiming,
        pageEvaluateWallMs,
        pngWriteMs,
        pageReturnEncodeWriteWallMs,
        rssTimeline,
      } = observed.value;
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
        crossProcessLimitCheck: knownCrossProcessBytes <= row.memory.limitBytes,
        processTreeRss: processTreeRssRecord(
          processTreeRssBaseline,
          observed.peak,
        ),
        ...(rssTimeline !== null
          ? {
              processTreeRssTimeline: {
                ...attributeProcessTreeRssTimeline(rssTimeline),
                scope:
                  "Process-tree RSS sampled beside the page run's own progress (stage, completedTiles) at a fixed interval; per-phase and render-tile-band attribution follows the sampler's complete/partial contract. This observes retained host RSS of the launcher and its browser descendants only — never VRAM, driver-private or browser-wide allocations.",
              },
            }
          : {}),
      };
      row.image = {
        path: path.relative(root, path.join(outDir, outputFilename)),
        sha256: hash(png),
        rgbaSha256: hash(rgba),
        naturalSize: { width: row.width, height: row.height },
      };
      row.scheduling = item.schedule;
      row.timing = {
        ...row.timing,
        pageEvaluateWallMs,
        launcherBase64DecodeMs: launcherImageTiming.base64DecodeMs,
        launcherRgbaToRgbMs: launcherImageTiming.rgbaToRgbMs,
        launcherPngEncodeMs: launcherImageTiming.pngEncodeMs,
        launcherPngWriteMs: pngWriteMs,
        pageReturnEncodeWriteWallMs,
        pageReturnEncodeWriteScope:
          "Node wall from immediately before page.evaluate through page return, RGBA base64 decode, PNG encode and PNG file write; excludes browser launch/startup and later checkpoint JSON serialization.",
      };
      delete row.imageBase64;
      return { item, row, png, rgba };
    };
    let cancellationProbe = null;
    if (cancelProbeRequested) {
      const baselineItem = await execute({
        ...options,
        ...provisionalCancelOptions,
        fixture: fixtureNames[0],
        mode: modeNames[0],
      });
      if (!Array.isArray(baselineItem.rows) || baselineItem.rows.length !== 1)
        throw new Error(
          "cancellation baseline did not produce exactly one image row",
        );
      const [baselineRow] = baselineItem.rows;
      const baseline = {
        rgbaSha256: hash(Buffer.from(baselineRow.imageBase64, "base64")),
        completion: baselineRow.completion,
        residual: baselineRow.residual,
        schedule: baselineItem.schedule,
        runtime: baselineItem.runtime,
      };
      const probeStarted = performance.now();
      let finished = false;
      const runPromise = execute({
        ...options,
        ...provisionalCancelOptions,
        fixture: fixtureNames[0],
        mode: modeNames[0],
      }).finally(() => {
        finished = true;
      });
      const progressSamples = [];
      const triggerWaitLimitMs = 130_000;
      const deadline = Date.now() + triggerWaitLimitMs;
      let trigger = null;
      while (!finished && Date.now() < deadline) {
        const progress = await readProgress();
        const previous = progressSamples.at(-1);
        if (
          progress !== null &&
          (previous === undefined ||
            previous.stage !== progress.stage ||
            previous.submissions !== progress.submissions ||
            previous.submissionInFlight !== progress.submissionInFlight ||
            previous.activeSubmission !== progress.activeSubmission)
        )
          progressSamples.push({
            ...progress,
            observedAtMs: performance.now() - probeStarted,
          });
        if (
          progress?.stage === "render" &&
          progress.submissionInFlight === true &&
          progress.activeSubmission >=
            Math.ceil(progress.totalSubmissions / 2) &&
          !progress.cancelRequested
        ) {
          trigger = progress;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const cancelCallStarted = performance.now();
      const request = await requestCancel();
      const item = await within(
        runPromise,
        30_000,
        "dielectric cancellation completion",
      );
      const hostAcknowledgementWallMs = performance.now() - cancelCallStarted;
      const cancellation = "cancelled" in item ? item.cancelled : null;
      const acknowledgementLatencyMs =
        cancellation?.acknowledgementLatencyMs ?? null;
      const cancellationTargetMs = 500;
      const acknowledgementWithinTarget =
        hostAcknowledgementWallMs <= cancellationTargetMs;
      const matchingTriggeredRun =
        trigger !== null &&
        trigger.stage === "render" &&
        request.runId === trigger.runId &&
        cancellation?.progress.runId === trigger.runId;
      const cancelledCleanly =
        matchingTriggeredRun &&
        request.requested === true &&
        cancellation !== null &&
        cancellation.progress.cleanupCompleted === true &&
        cancellation.progress.cleanupError === null &&
        item.runtime.uncaptured.length === 0 &&
        item.runtime.lost === null;
      cancellationProbe = {
        requested: true,
        provisional: provisionalCancelRequested,
        passed: cancelledCleanly && acknowledgementWithinTarget,
        cancelledCleanly,
        responsiveness: {
          targetMs: cancellationTargetMs,
          triggerWaitLimitMs,
          hostAcknowledgementWallMs,
          acknowledgementLatencyMs,
          acknowledgementWithinTarget,
          completedRunMaxCheckpointWallMs: null,
          completedRunWithinTarget: null,
          basis:
            "The 500 ms harness target bounds a human-visible cancel operation. Cancellation is requested by a separate browser task while a submission in the second half of the raster is in flight, measured from the host before that request until the run acknowledges and cleans up. The subsequent full run must keep every measured submission, map, tile assembly and base64 checkpoint within the same limit.",
        },
        trigger,
        request,
        result: cancellation,
        baseline,
        progressSamples,
        totalWallMs: performance.now() - probeStarted,
        followup: null,
      };
    }
    let tileInvariant = null;
    if (tileCheckRequested) {
      const cases = [];
      for (const fixture of fixtureNames) {
        const fullRuns = [];
        for (const tile of tileCheck) {
          const item = await execute({
            ...options,
            fixture,
            mode: "glass",
            tileWidth: tile.width,
            tileHeight: tile.height,
          });
          if (!Array.isArray(item.rows) || item.rows.length !== 1)
            throw new Error(
              `${fixture} tile invariant did not produce one full-image row`,
            );
          const [row] = item.rows;
          const rgba = rgbaBytes(row.imageBase64, row.width, row.height);
          fullRuns.push({
            item,
            row,
            rgba,
            record: compactInvariantRun(item, row, rgba, tile),
          });
        }
        const cropTile = tileCheck[1];
        const cropItem = await execute({
          ...options,
          fixture,
          mode: "glass",
          tileWidth: cropTile.width,
          tileHeight: cropTile.height,
          window: checkWindow,
        });
        if (!Array.isArray(cropItem.rows) || cropItem.rows.length !== 1)
          throw new Error(
            `${fixture} tile invariant did not produce one window row`,
          );
        const [cropRow] = cropItem.rows;
        const actualCrop = rgbaBytes(
          cropRow.imageBase64,
          cropRow.width,
          cropRow.height,
        );
        const expectedCrop = cropRgba(
          fullRuns[0].rgba,
          options.width,
          checkWindow,
        );
        const fullImageExact =
          Buffer.compare(fullRuns[0].rgba, fullRuns[1].rgba) === 0;
        const fullStatsExact =
          JSON.stringify(fullRuns[0].row.completion) ===
            JSON.stringify(fullRuns[1].row.completion) &&
          fullRuns[0].row.residual.radianceBound ===
            fullRuns[1].row.residual.radianceBound;
        const windowExact = Buffer.compare(expectedCrop, actualCrop) === 0;
        const rasterMetadataExact =
          cropRow.raster?.fullWidth === options.width &&
          cropRow.raster?.fullHeight === options.height &&
          JSON.stringify(cropRow.raster?.window) ===
            JSON.stringify(checkWindow);
        const windowRecord = {
          window: checkWindow,
          sourceTile: tileCheck[0],
          cropTile,
          expectedRgbaSha256: hash(expectedCrop),
          actualRgbaSha256: hash(actualCrop),
          exactRgbaEqual: windowExact,
          rasterMetadataExact,
          run: compactInvariantRun(cropItem, cropRow, actualCrop, cropTile),
        };
        const passed =
          fullRuns.every((run) => run.record.complete) &&
          fullImageExact &&
          fullStatsExact &&
          windowRecord.run.complete &&
          windowExact &&
          rasterMetadataExact;
        cases.push({
          fixture,
          mode: "glass",
          passed,
          fullImage: { width: options.width, height: options.height },
          decompositions: fullRuns.map((run) => run.record),
          exactRgbaEqual: fullImageExact,
          completionAndResidualExact: fullStatsExact,
          window: windowRecord,
        });
      }
      tileInvariant = {
        requested: true,
        passed: cases.every((item) => item.passed),
        cases,
        basis:
          "Two irregular full-image tile decompositions must produce exactly equal RGBA bytes and completion/residual totals. A separately rendered unaligned window must equal the corresponding full-image RGBA rectangle while retaining full-image ray coordinates.",
      };
    }
    let poseCheck = null;
    if (poseCheckRequested) {
      const cases = [];
      const runtime = { uncaptured: [], lost: null };
      let browserAdapter = null;
      let controls = null;
      const writePoseCheckpoint = async (status = "PARTIAL") => {
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
              options: { ...options, poseCheck: true },
              report: {
                browserAdapter,
                options: { ...options, poseCheck: true },
                rows: [],
                poseCheck,
                cancellationProbe,
                tileInvariant,
                runtime,
                controls,
                executionScope:
                  "Fixed finite D2 glass pose matrix; each completed pose is encoded before the next invocation.",
              },
              verdict: {
                status,
                scope:
                  "A recoverable pose qualification checkpoint, not an owner review artifact.",
              },
            },
            null,
            2,
          )}\n`,
        );
      };
      poseCheck = {
        requested: true,
        passed: false,
        matrix: POSE_CHECK_CASES.map((item) => ({ ...item })),
        cases,
        distinctImages: false,
        duplicateImageHashes: [],
      };
      for (const pose of POSE_CHECK_CASES) {
        const runOptions = {
          ...options,
          fixture: pose.fixture,
          mode: "glass",
          camera: pose.camera,
          ...(pose.hyperPose === undefined
            ? {}
            : { hyperPose: pose.hyperPose }),
        };
        const observed = await executeImage(
          runOptions,
          `pose-${pose.id}-${options.width}x${options.height}.png`,
        );
        const item = observed.item;
        if (
          "inconclusive" in item ||
          "preflightRefusal" in item ||
          "controlRefusal" in item ||
          "cancelled" in item
        ) {
          cases.push({
            ...pose,
            passed: false,
            failure:
              item.inconclusive ??
              item.preflightRefusal?.reason ??
              item.controlRefusal?.reason ??
              "pose invocation was cancelled",
          });
          await writePoseCheckpoint(
            "inconclusive" in item ? "INCONCLUSIVE" : "REFUSED",
          );
          process.exitCode = "inconclusive" in item ? 2 : 3;
          return;
        }
        browserAdapter ??= item.browserAdapter;
        controls = item.controls;
        runtime.uncaptured.push(...item.runtime.uncaptured);
        runtime.lost ??= item.runtime.lost;
        const row = observed.row;
        const expectedHyperPose = pose.hyperPose ?? "canonical";
        const metadataMatches = poseMetadataMatches(row, pose);
        const rasterMatches =
          row.width === options.width &&
          row.height === options.height &&
          row.raster?.fullWidth === options.width &&
          row.raster?.fullHeight === options.height &&
          row.raster?.window?.x === 0 &&
          row.raster?.window?.y === 0 &&
          row.raster?.window?.width === options.width &&
          row.raster?.window?.height === options.height;
        const complete =
          completedRow(item, row) &&
          row.completion.capEvents === 0 &&
          row.completion.sampleUnresolved === 0 &&
          row.completion.sampleInvalid === 0 &&
          row.residual?.replay?.allSamplesComplete === true &&
          row.residual?.replay?.capFree === true &&
          row.memory?.crossProcessLimitCheck === true &&
          metadataMatches &&
          rasterMatches;
        cases.push({
          ...pose,
          hyperPose: expectedHyperPose,
          passed: complete,
          complete,
          metadataMatches,
          rasterMatches,
          image: row.image,
          cameraMetadata: row.camera,
          geometryMetadata: row.scene?.geometryPose,
          completion: row.completion,
          residual: row.residual,
          memory: row.memory,
          timing: row.timing,
        });
        await writePoseCheckpoint();
      }
      const imageHashes = cases
        .map((item) => item.image?.rgbaSha256)
        .filter((value) => typeof value === "string");
      const hashCounts = new Map();
      for (const imageHash of imageHashes)
        hashCounts.set(imageHash, (hashCounts.get(imageHash) ?? 0) + 1);
      const duplicateImageHashes = [...hashCounts]
        .filter(([, count]) => count > 1)
        .map(([imageHash]) => imageHash);
      poseCheck = {
        ...poseCheck,
        browserAdapter,
        controls,
        runtime,
        distinctImages:
          imageHashes.length === POSE_CHECK_CASES.length &&
          duplicateImageHashes.length === 0,
        duplicateImageHashes,
      };
      poseCheck.passed =
        cases.length === POSE_CHECK_CASES.length &&
        cases.every((item) => item.passed === true) &&
        poseCheck.distinctImages &&
        controls?.passed === true &&
        runtime.uncaptured.length === 0 &&
        runtime.lost === null;
      await writePoseCheckpoint(poseCheck.passed ? "RECORDED" : "REFUSED");
      if (!poseCheck.passed) {
        process.exitCode = 3;
        return;
      }
      for (const item of cases)
        log(
          `pose/${item.id}: complete=${item.completion.complete}/${item.completion.total} residual=${item.residual.radianceBound}`,
        );
      process.exitCode = 0;
      return;
    }
    if (stagedRequested) {
      const fixture = fixtureNames[0];
      const stagedRows = [];
      const arms = [];
      const runtime = { uncaptured: [], lost: null };
      let browserAdapter = null;
      let controls = null;
      const stagedFailure = async (item, scope) => {
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
              report: { options, arms, rows: stagedRows },
              verdict: {
                status: "INCONCLUSIVE",
                reason: item.inconclusive ?? scope,
              },
            },
            null,
            2,
          )}\n`,
        );
        process.exitCode = "inconclusive" in item ? 2 : 3;
      };
      const runArm = async (name, armOptions, filename) => {
        const armStarted = performance.now();
        const observed = await executeImage(armOptions, filename);
        const { item } = observed;
        if (
          "inconclusive" in item ||
          "preflightRefusal" in item ||
          "controlRefusal" in item ||
          "cancelled" in item
        ) {
          await stagedFailure(
            item,
            "preflightRefusal" in item
              ? item.preflightRefusal.reason
              : "controlRefusal" in item
                ? item.controlRefusal.reason
                : "cancelled" in item
                  ? "staged arm was cancelled unexpectedly"
                  : undefined,
          );
          return true;
        }
        browserAdapter ??= item.browserAdapter;
        controls ??= item.controls;
        runtime.uncaptured.push(...item.runtime.uncaptured);
        runtime.lost ??= item.runtime.lost;
        const { row } = observed;
        stagedRows.push(row);
        const t = row.timing;
        arms.push({
          name,
          fixture,
          mode: "glass",
          samplesPerPixel: row.samplesPerPixel,
          provisional: row.provisional,
          reusedGpuContext: item.reusedGpuContext === true,
          reusedGpuContextHit: item.reusedGpuContextHit === true,
          ...(row.replayAttempts !== undefined
            ? {
                replayMaxResolvedPass: row.replayAttempts.maxResolvedPass,
                replayMinPassesForCompletion:
                  row.replayAttempts.minPassesForCompletion,
                replayPixelsResolvedAtPass: [
                  ...row.replayAttempts.pixelsResolvedAtPass,
                ],
              }
            : {}),
          outputFilename: observed.outputFilename,
          adapterDeviceSetupMs: t.adapterDeviceSetupMs,
          controlsMs: t.controlsMs,
          pipelineSetupMs: t.pipelineSetupMs,
          tileEncodeSubmitMapWallMs: t.tileEncodeSubmitMapWallMs,
          replayPassFenceWallMs: t.replayPassFenceWallMs,
          replayPassFenceWallSumMs: t.replayPassFenceWallMs.reduce(
            (sum, value) => sum + value,
            0,
          ),
          pageWorkWallMs: t.pageWorkWallMs,
          pageEvaluateWallMs: t.pageEvaluateWallMs,
          pageReturnEncodeWriteWallMs: t.pageReturnEncodeWriteWallMs,
          launcherDecodeEncodeWriteWallMs:
            t.pageReturnEncodeWriteWallMs - t.pageEvaluateWallMs,
          armWallMs: performance.now() - armStarted,
        });
        return false;
      };
      const stopped = await (async () => {
        if (
          await runArm(
            "provisional-cold",
            {
              ...options,
              fixture,
              mode: "glass",
              samplesPerPixel: 1,
              provisional: true,
              replayPassDiagnostic: true,
              ...(stagedReuseRequested ? { reuseGpuContext: true } : {}),
            },
            (row) =>
              `staged-provisional-cold-${fixture}-${row.width}x${row.height}.png`,
          )
        )
          return true;
        if (
          await runArm(
            "authoritative",
            {
              ...options,
              fixture,
              mode: "glass",
              samplesPerPixel: 4,
              ...(stagedReuseRequested ? { reuseGpuContext: true } : {}),
            },
            (row) =>
              `staged-authoritative-${fixture}-${row.width}x${row.height}.png`,
          )
        )
          return true;
        if (
          await runArm(
            "provisional-warm",
            {
              ...options,
              fixture,
              mode: "glass",
              samplesPerPixel: 1,
              provisional: true,
              replayPassDiagnostic: true,
              ...(stagedReuseRequested ? { reuseGpuContext: true } : {}),
            },
            (row) =>
              `staged-provisional-warm-${fixture}-${row.width}x${row.height}.png`,
          )
        )
          return true;
        return false;
      })();
      if (stopped) return;
      const baseline = STAGED_AUTHORITATIVE_BASELINES[fixture];
      const [coldRow, authoritativeRow, warmRow] = stagedRows;
      // Decided feasibility envelope (2026-09-13, delegated authority): the
      // provisional-preview line is 1.5 s in both dimensions, judged on the
      // production-realistic warm arm; the cold arm stays recorded. The
      // previous 1 s working target is superseded by the study doc's decided
      // envelope section.
      const previewTargetMs = 1500;
      const identity = {
        basis: `The authoritative arm is a separate independent four-sample render with fresh device state, never a continuation of the provisional aggregate. Its RGBA bytes, completion, residual and refusal metadata must equal the final qualified source's canonical 256x144 glass measurement, pinned above.${
          stagedReuseRequested
            ? " Under --stagedReuse the device, layout, pipelines and controls run are held across arms (the production-realistic shape); each arm still allocates its own buffers, the kernel re-initialises every pixel at pass 0, and this identity gate still applies in full."
            : ""
        }`,
        samplesPerPixelMatches: authoritativeRow.samplesPerPixel === 4,
        notProvisional: authoritativeRow.provisional === false,
        imageIdentical:
          authoritativeRow.image.rgbaSha256 === baseline.rgbaSha256 &&
          authoritativeRow.image.sha256 === baseline.pngSha256,
        completionIdentical:
          JSON.stringify(authoritativeRow.completion) ===
          JSON.stringify(baseline.completion),
        residualIdentical:
          authoritativeRow.residual.radianceBound === baseline.radianceBound &&
          authoritativeRow.residual.totalRadianceBound ===
            baseline.totalRadianceBound &&
          authoritativeRow.residual.totalSampleMaxChannelRadianceBound ===
            baseline.totalSampleMaxChannelRadianceBound &&
          JSON.stringify(authoritativeRow.residual.replay) ===
            JSON.stringify(baseline.replay),
        refusalIdentical:
          JSON.stringify(authoritativeRow.refusal) ===
          JSON.stringify(baseline.refusal),
      };
      identity.passed = Object.entries(identity)
        .filter(([key]) => key !== "basis" && key !== "passed")
        .every(([, value]) => value === true);
      const provisionalRows = [coldRow, warmRow];
      const provisionalDeclared = provisionalRows.every(
        (row) =>
          row.provisional === true &&
          row.samplesPerPixel === 1 &&
          row.completion.sampleTotal === row.width * row.height * 1,
      );
      const provisionalGate = {
        declaredSamplesPerPixel: 1,
        previewTargetMs,
        labelledProvisional: provisionalDeclared,
        arms: arms
          .filter((arm) => arm.provisional === true)
          .map((arm) => ({
            name: arm.name,
            pageReturnEncodeWriteWallMs: arm.pageReturnEncodeWriteWallMs,
            pageWorkWallMs: arm.pageWorkWallMs,
            replayPassFenceWallSumMs: arm.replayPassFenceWallSumMs,
            withinTarget: arm.pageReturnEncodeWriteWallMs <= previewTargetMs,
          })),
        scope:
          "Provisional preview delivery wall is Node time from immediately before the page call through PNG write, matching the consolidated preview rows' practical-time scope. A provisional row is complete only at its declared one-sample count with the same six replay attempts, transport, cutoff and residual bound per rendered sample; it never inherits the owner approval of the four-sample 1024 images and is not appearance evidence.",
      };
      provisionalGate.passed =
        provisionalGate.labelledProvisional &&
        provisionalRows.every(
          (row) =>
            row.completion.complete === row.completion.total &&
            row.completion.unresolved === 0 &&
            row.completion.invalid === 0 &&
            row.completion.capEvents === 0 &&
            row.completion.sampleComplete === row.completion.sampleTotal &&
            row.residual.radianceBound <= row.residual.errorBudget &&
            row.residual.replay.allSamplesComplete === true &&
            row.residual.replay.capFree === true,
        );
      const staged = {
        mode: stagedReuseRequested ? "staged-preview-reuse" : "staged-preview",
        fixture,
        width: options.width,
        height: options.height,
        provisionalGate,
        authoritativeIdentity: identity,
        passed: provisionalGate.passed && identity.passed,
      };
      const rows = stagedRows;
      if (runtime.uncaptured.length > 0 || runtime.lost !== null) {
        staged.passed = false;
      }
      const report = {
        browserAdapter,
        options,
        rows,
        staged,
        cancellationProbe: null,
        tileInvariant: null,
        runtime,
        controls,
        executionScope:
          "Each staged arm runs in a separate page invocation with fresh device state; only one full image base64 payload crosses the browser boundary at a time.",
      };
      const refused =
        !staged.passed ||
        report.controls?.passed !== true ||
        report.rows.some((row) => !completedRow(report, row)) ||
        report.rows.some(
          (row) =>
            !Number.isFinite(row.residual.radianceBound) ||
            !Number.isFinite(row.residual.totalRadianceBound) ||
            row.residual.radianceBound > row.residual.errorBudget,
        ) ||
        report.rows.some((row) => !row.memory.crossProcessLimitCheck) ||
        report.runtime.uncaptured.length > 0 ||
        report.runtime.lost !== null;
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
      record.verdict = {
        status: refused ? "REFUSED" : "RECORDED",
        scope:
          "Harness-only staged finite-cell images. The provisional preview is not appearance evidence; the authoritative arm must reproduce the pinned final-source identity.",
      };
      await writeFile(reportFile, `${JSON.stringify(record, null, 2)}\n`);
      for (const arm of arms)
        log(
          `staged/${arm.name}: spp=${arm.samplesPerPixel} provisional=${arm.provisional} page=${arm.pageWorkWallMs.toFixed(1)}ms fullWall=${arm.pageReturnEncodeWriteWallMs.toFixed(1)}ms replaySum=${arm.replayPassFenceWallSumMs.toFixed(1)}ms`,
        );
      for (const arm of arms)
        if (arm.replayMaxResolvedPass !== undefined)
          log(
            `staged/${arm.name}: replay resolutions resolvedAtPass=[${arm.replayPixelsResolvedAtPass.join(", ")}] maxResolvedPass=${arm.replayMaxResolvedPass} minPassesForCompletion=${arm.replayMinPassesForCompletion}`,
          );
      log(
        `staged identity passed=${identity.passed} provisionalGate passed=${provisionalGate.passed}`,
      );
      if (refused) process.exitCode = 3;
      return;
    }
    const rows = [];
    const runtime = { uncaptured: [], lost: null };
    let browserAdapter = null;
    let controls = null;
    for (const fixture of fixtureNames)
      for (const mode of modeNames) {
        const poseSuffix =
          options.camera !== undefined || options.hyperPose !== undefined
            ? `-${options.camera ?? "canonical"}-${options.hyperPose ?? "canonical"}`
            : "";
        const itemOptions = {
          ...options,
          ...provisionalCancelOptions,
          fixture,
          mode,
        };
        const observed = await executeImage(
          itemOptions,
          (row) =>
            `${fixture}-${mode}${poseSuffix}${
              provisionalCancelRequested ? "-provisional1spp" : ""
            }-${row.width}x${row.height}.png`,
          rssTraceRequested,
        );
        const { item } = observed;
        const partialRecord = {
          generatedAt: new Date().toISOString(),
          display,
          renderer,
          browserVersion: browser.version(),
          quiet,
          sourceProvenance,
          options,
          cancellationProbe,
          tileInvariant,
          report: item,
          memory: {
            processTreeRss: unmeasuredProcessTreeRss(
              "The page returned before a normal image row, so RSS is not reported as a row measurement.",
            ),
          },
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
        if ("cancelled" in item) {
          partialRecord.verdict = {
            status: "REFUSED",
            reason: "normal image row was cancelled unexpectedly",
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
        const { row } = observed;
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
                cancellationProbe,
                tileInvariant,
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
    if (cancellationProbe !== null) {
      const completedRunMaxCheckpointWallMs = Math.max(
        ...rows.map((row) => row.timing.maxCancellationCheckpointWallMs),
      );
      const completedRunWithinTarget =
        completedRunMaxCheckpointWallMs <=
        cancellationProbe.responsiveness.targetMs;
      cancellationProbe.responsiveness.completedRunMaxCheckpointWallMs =
        completedRunMaxCheckpointWallMs;
      cancellationProbe.responsiveness.completedRunWithinTarget =
        completedRunWithinTarget;
      cancellationProbe.passed =
        cancellationProbe.passed && completedRunWithinTarget;
      const [postCancelRow] = rows;
      const imageIdentical =
        postCancelRow.image.rgbaSha256 ===
        cancellationProbe.baseline.rgbaSha256;
      const postCancelComplete =
        postCancelRow.completion.complete === postCancelRow.completion.total &&
        postCancelRow.completion.unresolved === 0 &&
        postCancelRow.completion.invalid === 0;
      cancellationProbe.followup = {
        passed: imageIdentical && postCancelComplete,
        imageIdentical,
        postCancelComplete,
        baselineRgbaSha256: cancellationProbe.baseline.rgbaSha256,
        postCancelRgbaSha256: postCancelRow.image.rgbaSha256,
        basis:
          "A complete baseline runs first. The cancelled invocation returns no image row, cleans up, and a fresh-device run must reproduce the baseline RGBA bytes exactly.",
      };
      cancellationProbe.passed =
        cancellationProbe.passed && cancellationProbe.followup.passed;
    }
    const report = {
      browserAdapter,
      options,
      rows,
      cancellationProbe,
      tileInvariant,
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
      (cancellationProbe !== null && !cancellationProbe.passed) ||
      (tileInvariant !== null && !tileInvariant.passed) ||
      report.controls?.passed !== true ||
      report.rows.some((row) => !completedRow(report, row)) ||
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
