#!/usr/bin/env node
/** Reproduce just the four full-size CPU references, reusing verified images. */
import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(
  root,
  "scripts/out/transmission-readable/report.json",
);
const workers =
  process.argv.find((arg) => arg.startsWith("--workers=")) ?? "--workers=2";
const keys = [
  "menger3-still-none",
  "native4-still-none",
  "menger3-still-weighted",
  "native4-still-weighted",
];
const jobs = [];
let envelope;
for (const key of keys) {
  const run = spawnSync(
    process.execPath,
    [
      "scripts/transmission-readable.mjs",
      workers,
      "--tileSize=64",
      "--stillSize=512",
      `--jobFilter=${key}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (run.error || run.status !== 0)
    throw new Error(
      `Reference ${key} failed: ${run.error ?? run.status ?? run.signal}`,
    );
  const current = JSON.parse(readFileSync(reportPath, "utf8"));
  if (
    envelope &&
    current.sourceProvenance.sourceHash !== envelope.sourceProvenance.sourceHash
  )
    throw new Error("Renderer inputs changed between primary reference images");
  if (current.jobs.length !== 1 || current.jobs[0].key !== key)
    throw new Error(`Reference run returned the wrong image for ${key}`);
  jobs.push(current.jobs[0]);
  envelope = current;
}
envelope.jobs = jobs;
envelope.settings = {
  scope: "four-primary-stills",
  sizes: { still: 512 },
  tileSize: 64,
  requestedWorkers: Number(workers.slice("--workers=".length)),
};
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`);
renameSync(temporary, reportPath);
const review = spawnSync(
  process.execPath,
  ["scripts/transmission-revision-review.mjs", "--stills-only"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (review.error || review.status !== 0)
  throw new Error(
    `Primary review failed: ${review.error ?? review.status ?? review.signal}`,
  );
