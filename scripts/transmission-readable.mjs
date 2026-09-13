#!/usr/bin/env node
/**
 * Readable still/motion record for the CPU thin-interface experiment.
 * Workers only schedule crop regions; renderBentTransmission keeps full-image
 * rays and the shared fixed world-space sample lattice for every tile.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { encodePng } from "./de-preview.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/out/transmission-readable");
const cacheDir = path.join(outDir, "cache");
const workerSource = path.join(root, "scripts/transmission-readable.worker.ts");
const workerBundle = path.join(outDir, "worker.mjs");
const fixtureSource = path.join(root, "scripts/transmission-bend-fixtures.ts");
const fixtureBundle = path.join(outDir, "fixtures.mjs");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);

function positive(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${name} needs a positive integer`);
  return number;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atomicWrite(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, value);
  renameSync(temp, file);
}

async function sourceProvenance(metafile) {
  const explicit = [
    "scripts/transmission-readable.mjs",
    "scripts/transmission-readable.worker.ts",
    "scripts/transmission-bend-study.ts",
    "scripts/transmission-bend-tiles.harness.ts",
    "scripts/transmission-bend-fixtures.ts",
    "scripts/transmission-layer-field.ts",
    "scripts/transmission-gpu-contract.ts",
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
  const fileHashes = Object.fromEntries(entries);
  return {
    algorithm: "sha256",
    sourceHash: hash(JSON.stringify(fileHashes)),
    files: fileHashes,
  };
}

function tiles(size, tileSize) {
  const result = [];
  for (let y = 0; y < size; y += tileSize)
    for (let x = 0; x < size; x += tileSize)
      result.push({
        x,
        y,
        width: Math.min(tileSize, size - x),
        height: Math.min(tileSize, size - y),
      });
  return result;
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source))
    target[key] = (target[key] ?? 0) + value;
}

function stitch(size, completed) {
  const rgb = new Uint8Array(size * size * 3);
  const counts = {
    stats: {},
    work: {},
    maxWork: { chunks: 0, worstRay: 0 },
    termination: {},
    attribution: {},
    calls: 0,
    unresolved: 0,
    rearHits: 0,
    frontThenGuard: 0,
    bentPixels: 0,
    reversalStops: 0,
    offsetLimitedPixels: 0,
    maxLateralFraction: 0,
    maxSampleCount: 0,
    tileRendererElapsedMsSum: 0,
    weightedMeanStrengthSum: 0,
  };
  for (const tile of completed) {
    const source = new Uint8Array(tile.rgb);
    for (let row = 0; row < tile.region.height; row++) {
      const sourceOffset = row * tile.region.width * 3;
      const targetOffset = ((tile.region.y + row) * size + tile.region.x) * 3;
      rgb.set(
        source.subarray(sourceOffset, sourceOffset + tile.region.width * 3),
        targetOffset,
      );
    }
    const result = tile.summary;
    addCounts(counts.stats, result.stats);
    const { chunks, worstRay, ...summedWork } = result.work;
    addCounts(counts.work, summedWork);
    counts.maxWork.chunks = Math.max(counts.maxWork.chunks, chunks);
    counts.maxWork.worstRay = Math.max(counts.maxWork.worstRay, worstRay);
    addCounts(counts.termination, result.termination);
    addCounts(counts.attribution, result.attributionCounts);
    counts.calls += result.calls;
    counts.unresolved += result.unresolved;
    counts.rearHits += result.rearHits;
    counts.frontThenGuard += result.frontThenGuard;
    counts.bentPixels += result.bending.bentPixels;
    counts.reversalStops += result.bending.reversalStops;
    counts.offsetLimitedPixels += result.bending.offsetLimitedPixels;
    counts.maxLateralFraction = Math.max(
      counts.maxLateralFraction,
      result.bending.maximumLateralFraction,
    );
    counts.maxSampleCount = Math.max(
      counts.maxSampleCount,
      result.sampleMaximum,
    );
    counts.tileRendererElapsedMsSum += result.stats.rendererMs;
    counts.weightedMeanStrengthSum +=
      result.bending.meanStrength * result.bending.pixels;
  }
  counts.terminationTotal = Object.values(counts.termination).reduce(
    (total, value) => total + value,
    0,
  );
  counts.meanStrength = counts.weightedMeanStrengthSum / (size * size);
  delete counts.weightedMeanStrengthSum;
  return { rgb, counts };
}

function assertComplete(size, counts) {
  const expected = size * size;
  if (counts.terminationTotal !== expected)
    throw new Error(
      `Termination total ${counts.terminationTotal} does not cover ${expected} rays`,
    );
  if (counts.unresolved !== 0 || counts.termination.unresolved !== 0)
    throw new Error(`Unresolved rays: ${counts.unresolved}`);
  if (counts.stats.exhausted !== 0)
    throw new Error(`Renderer exhausted ${counts.stats.exhausted} rays`);
  for (const reason of ["layerCap", "sampleCap", "chunkCap"])
    if (counts.termination[reason] !== 0)
      throw new Error(
        `${reason} terminated ${counts.termination[reason]} rays`,
      );
}

class WorkerPool {
  constructor(file, count) {
    this.workers = [];
    this.idle = [];
    this.pending = new Map();
    this.queued = [];
    this.failed = new Set();
    this.closing = false;
    for (let index = 0; index < count; index++) {
      const worker = new Worker(file, { type: "module" });
      worker.on("message", (message) => this.done(worker, message));
      worker.on("error", (error) => this.fail(worker, error));
      worker.on("exit", (code) => {
        if (!this.closing)
          this.fail(worker, new Error(`Worker exited with code ${code}`));
      });
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  dispatch(task) {
    return new Promise((resolve, reject) => {
      this.queued.push({ task, resolve, reject });
      this.pump();
    });
  }

  pump() {
    if (this.failed.size) return;
    while (this.idle.length && this.queued.length) {
      const worker = this.idle.pop();
      const item = this.queued.shift();
      this.pending.set(item.task.id, { ...item, worker });
      worker.postMessage(item.task);
    }
  }

  done(worker, message) {
    const item = this.pending.get(message.id);
    if (!item) return;
    this.pending.delete(message.id);
    this.idle.push(worker);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message);
    this.pump();
  }

  fail(worker, error) {
    if (this.failed.has(worker)) return;
    this.failed.add(worker);
    this.idle = this.idle.filter((candidate) => candidate !== worker);
    for (const [id, item] of this.pending) {
      if (item.worker === worker) {
        this.pending.delete(id);
        item.reject(error);
      }
    }
    for (const item of this.queued.splice(0)) item.reject(error);
  }

  async close() {
    this.closing = true;
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

function jobList(sizes, fixtureData) {
  const fixed = (bendOnset, transmit) => ({
    bendOnset,
    ...(transmit === undefined ? {} : { transmit }),
  });
  const jobs = [];
  for (const [mode, options] of [
    ["none", fixed("none")],
    ["weighted", fixed("weighted")],
  ])
    for (const key of ["menger3", "native4"])
      jobs.push({
        key: `${key}-still-${mode}`,
        fixtureKey: key,
        pose: fixtureData.stillPoses[key === "menger3" ? "menger" : "native4"],
        size: sizes.still,
        options,
        rear: true,
      });
  for (const [mode, options] of [
    ["hard", fixed("hard")],
    ["opaque", fixed("weighted", 0)],
  ])
    for (const key of ["menger3", "native4"])
      jobs.push({
        key: `${key}-still-${mode}`,
        fixtureKey: key,
        pose: fixtureData.stillPoses[key === "menger3" ? "menger" : "native4"],
        size: sizes.still,
        options,
        rear: true,
      });
  for (const key of ["analytic3", "analytic4"])
    for (const [mode, options, rear] of [
      ["none", fixed("none"), true],
      ["weighted", fixed("weighted"), true],
      ["opaque", fixed("weighted", 0), true],
      ["rear-absent", fixed("weighted"), false],
    ])
      jobs.push({
        key: `${key}-control-${mode}`,
        fixtureKey: key,
        size: sizes.control,
        options,
        rear,
      });
  for (const group of fixtureData.motionGroups)
    for (let index = 0; index < 3; index++)
      for (const [mode, options] of [
        ["none", fixed("none")],
        ["weighted", fixed("weighted")],
      ])
        jobs.push({
          key: `motion-${group.key}-${index}-${mode}`,
          fixtureKey: group.fixtureName === "MENGER 3D" ? "menger3" : "native4",
          pose: group.poses[index],
          size: sizes.motion,
          options,
          rear: true,
          motion: group.key,
        });
  return jobs;
}

async function loadFixtures() {
  // The shared source has extensionless TypeScript imports. Bundle it before
  // the main process imports it; workers use the same source through theirs.
  const module = await import(pathToFileURL(fixtureBundle).href);
  return {
    motionGroups: module.BEND_MOTION_GROUPS,
    stillPoses: module.BEND_STILL_POSES,
    referenceOptions: module.BEND_REFERENCE_OPTIONS,
  };
}

async function main() {
  if (args.help) {
    console.log(
      "node scripts/transmission-readable.mjs [--workers=8 --tileSize=64 --stillSize=512 --motionSize=256 --controlSize=256 --jobFilter=text]",
    );
    return;
  }
  const sizes = {
    still: positive(args.stillSize ?? 512, "stillSize"),
    motion: positive(args.motionSize ?? 256, "motionSize"),
    control: positive(args.controlSize ?? 256, "controlSize"),
  };
  const workers = positive(args.workers ?? 8, "workers");
  const tileSize = positive(args.tileSize ?? 64, "tileSize");
  await rm(workerBundle, { force: true });
  await rm(fixtureBundle, { force: true });
  mkdirSync(outDir, { recursive: true });
  const result = await build({
    entryPoints: [workerSource],
    outfile: workerBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    metafile: true,
    logLevel: "silent",
  });
  await build({
    entryPoints: [fixtureSource],
    outfile: fixtureBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  const provenance = await sourceProvenance(result.metafile);
  const fixtureData = await loadFixtures();
  const filter = args.jobFilter === undefined ? "" : String(args.jobFilter);
  const jobs = jobList(sizes, fixtureData).filter((job) =>
    job.key.includes(filter),
  );
  if (jobs.length === 0)
    throw new Error(
      `No readable jobs match ${filter || "the requested settings"}`,
    );
  const pool = new WorkerPool(workerBundle, workers);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceProvenance: provenance,
    settings: { workers, tileSize, sizes, jobFilter: filter || null },
    jobs: [],
    limitation:
      "Tiles schedule the shared CPU renderer and preserve full-image rays. tileRendererElapsedMsSum sums overlapping per-tile elapsed times; it is neither process CPU time nor wall-clock performance or a production frame-time measurement.",
  };
  try {
    for (const job of jobs) {
      const renderOptions = {
        ...fixtureData.referenceOptions,
        ...job.options,
        maxLayers: 4096,
        maxSamples: 4096,
        residualTolerance: 0,
        terminalRadiance: "proceduralFloor(R)",
      };
      const settings = {
        fixtureKey: job.fixtureKey,
        pose: job.pose ?? null,
        rear: job.rear,
        size: job.size,
        tileSize,
        renderOptions,
        sourceHash: provenance.sourceHash,
      };
      const cacheKey = hash(JSON.stringify(settings));
      const png = path.join(outDir, `${job.key}.png`);
      const summaryFile = path.join(outDir, `${job.key}.json`);
      const cachePng = path.join(cacheDir, `${cacheKey}.png`);
      const cacheSummary = path.join(cacheDir, `${cacheKey}.json`);
      let encoded;
      let rendered;
      let cacheStatus = "rendered";
      if (existsSync(cachePng) && existsSync(cacheSummary)) {
        const cached = JSON.parse(readFileSync(cacheSummary, "utf8"));
        const cachedPng = readFileSync(cachePng);
        if (
          cached.cacheKey === cacheKey &&
          cached.png?.sha256 === hash(cachedPng) &&
          cached.png?.naturalSize?.width === job.size &&
          cached.png?.naturalSize?.height === job.size
        ) {
          assertComplete(job.size, cached.counts);
          encoded = cachedPng;
          rendered = cached;
          cacheStatus = "reused";
        }
      }
      if (!rendered) {
        const complete = [];
        let id = 0;
        const work = tiles(job.size, tileSize).map((region) => ({
          id: id++,
          key: job.fixtureKey,
          pose: job.pose,
          rear: job.rear,
          size: job.size,
          region,
          options: job.options,
        }));
        await Promise.all(
          work.map(async (task) => {
            const tile = await pool.dispatch(task);
            complete.push(tile);
            console.error(
              `[transmission-readable] ${job.key} tile ${complete.length}/${work.length}`,
            );
          }),
        );
        const stitched = stitch(job.size, complete);
        assertComplete(job.size, stitched.counts);
        encoded = encodePng(job.size, job.size, stitched.rgb);
        rendered = {
          cacheKey,
          size: job.size,
          tileSize,
          renderOptions,
          tiles: work.length,
          counts: stitched.counts,
          png: {
            sha256: hash(encoded),
            naturalSize: { width: job.size, height: job.size },
          },
          timing: {
            tileRendererElapsedMsSum: stitched.counts.tileRendererElapsedMsSum,
            workers,
            limitation:
              "sum of overlapping per-tile renderer elapsed times; it is neither process CPU time nor wall time, parallel throughput, or a UI-frame estimate",
          },
        };
        atomicWrite(cachePng, encoded);
        atomicWrite(cacheSummary, `${JSON.stringify(rendered, null, 2)}\n`);
      }
      const summary = {
        key: job.key,
        cacheKey,
        fixtureKey: job.fixtureKey,
        pose: job.pose ?? null,
        rear: job.rear,
        options: job.options,
        size: rendered.size,
        tiles: rendered.tiles,
        counts: rendered.counts,
        pixelStitch: `full-image RGB stitched from shared-renderer ${tileSize}px regions`,
        renderOptions: rendered.renderOptions,
        image: {
          path: path.relative(root, png),
          sha256: rendered.png.sha256,
          naturalSize: rendered.png.naturalSize,
        },
        timing: rendered.timing,
        cache: { status: cacheStatus, path: path.relative(root, cacheSummary) },
      };
      atomicWrite(png, encoded);
      atomicWrite(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
      report.jobs.push(summary);
      console.error(`[transmission-readable] complete ${job.key}`);
    }
  } finally {
    await pool.close();
  }
  atomicWrite(
    path.join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(
    "[transmission-readable] fatal:",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
