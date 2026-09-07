#!/usr/bin/env node
/** Read-only GitHub timing evidence. Usage: node scripts/gpu-ci-metrics.mjs RUN_ID.
 * Durations are elapsed runner allocation, not rounded billable minutes. */
import { execFileSync } from "node:child_process";
const runId = process.argv[2];
if (!/^\d+$/.test(runId ?? ""))
  throw new Error("Pass a numeric Actions run ID");
const api = (path, ...args) =>
  JSON.parse(
    execFileSync("gh", ["api", path, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const repo = "repos/ChrisSteinbach/fractal-viewer";
const run = api(`${repo}/actions/runs/${runId}`);
const jobs = [];
for (let page = 1; ; page++) {
  const result = api(
    `${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
  );
  jobs.push(...result.jobs);
  if (jobs.length >= result.total_count || result.jobs.length === 0) break;
}
if (run.status !== "completed")
  throw new Error("Wait for the run to complete before measuring");
const seconds = (start, end) => (Date.parse(end) - Date.parse(start)) / 1000;
const rows = jobs.map((job) => ({
  name: job.name,
  conclusion: job.conclusion,
  seconds:
    job.conclusion === "skipped"
      ? 0
      : seconds(job.started_at, job.completed_at),
  benchSeconds: job.steps
    .filter((step) => /GPU flame agreement/.test(step.name))
    .reduce(
      (sum, step) => sum + seconds(step.started_at, step.completed_at),
      0,
    ),
}));
console.log(
  JSON.stringify(
    {
      url: run.html_url,
      sha: run.head_sha,
      conclusion: run.conclusion,
      wallSeconds: seconds(run.created_at, run.updated_at),
      runnerMinutes: rows.reduce((sum, row) => sum + row.seconds, 0) / 60,
      benchMinutes: rows.reduce((sum, row) => sum + row.benchSeconds, 0) / 60,
      jobs: rows,
    },
    null,
    2,
  ),
);
