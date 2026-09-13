#!/usr/bin/env node
/**
 * Offline visual review for the four 512x512 GPU transmission stills.
 * It reads an archived report and never reruns the renderer or changes an
 * artifact.  A report is accepted only when its source and image/trace hashes
 * still describe the files currently on disk.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const outputDir = join(root, "scripts/out");
const outputPath = join(outputDir, "transmission-gpu-review.html");
const manifestPath = join(outputDir, "transmission-gpu-review-manifest.json");
const builderPath = resolve(root, "scripts/transmission-gpu-review.mjs");
const defaultReport =
  "scripts/out/transmission-bend-gpu/actual-512x512-all.json";
const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
const reportPath = reportArg
  ? resolve(root, reportArg.slice("--report=".length))
  : resolve(root, defaultReport);

const expectedKeys = [
  "menger3:none",
  "menger3:weighted",
  "native4:none",
  "native4:weighted",
];
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fmt = (value, digits = 3) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : value === undefined || value === null
      ? "—"
      : String(value);
const bytes = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${fmt(value)} B (${fmt(value / (1024 * 1024), 2)} MiB)`
    : "—";
const recordedPath = (value) => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Report contains an empty artifact path");
  return value.startsWith("/") ? value : resolve(root, value);
};
const linkPath = (path) => esc(relative(outputDir, path).replaceAll("\\", "/"));
const dataUri = (path, mime) =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const pngDimensions = (path) => {
  const data = readFileSync(path);
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error(`Not a PNG: ${path}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};
const report = readJson(reportPath);
const body = report.report ?? report;
const rows = Array.isArray(body.rows) ? body.rows : [];
const sourceProvenance = report.sourceProvenance ?? body.sourceProvenance;
if (!sourceProvenance || !sourceProvenance.files)
  throw new Error("GPU report is missing sourceProvenance.files");

const sourceMismatches = [];
for (const [source, declared] of Object.entries(sourceProvenance.files)) {
  const path = recordedPath(source);
  if (!existsSync(path)) {
    sourceMismatches.push(`${source}: missing`);
    continue;
  }
  const actual = hash(readFileSync(path));
  if (actual !== declared) sourceMismatches.push(`${source}: hash mismatch`);
}
if (sourceMismatches.length)
  throw new Error(
    `GPU report source provenance is stale:\n${sourceMismatches.join("\n")}`,
  );
if (sourceProvenance.sourceHash) {
  const actual = hash(JSON.stringify(sourceProvenance.files));
  if (actual !== sourceProvenance.sourceHash)
    throw new Error("GPU report sourceHash does not match source file hashes");
}

const runs = Array.isArray(report.runs) ? report.runs : [];
const runByKey = new Map();
for (const run of runs) {
  const key = `${run.options?.fixture}:${run.options?.mode}`;
  if (runByKey.has(key))
    throw new Error(`Duplicate GPU run provenance: ${key}`);
  if (!expectedKeys.includes(key))
    throw new Error(`Unexpected GPU run provenance: ${key}`);
  if (run.sourceProvenance?.sourceHash !== sourceProvenance.sourceHash)
    throw new Error(`${key} run sourceHash does not match aggregate report`);
  if (
    !run.quiet ||
    run.quiet.contended !== false ||
    run.quiet.unknownReason !== null
  )
    throw new Error(`${key} run quiet baseline is not positively certified`);
  if (typeof run.renderer !== "string" || !run.renderer)
    throw new Error(`${key} run renderer provenance is missing`);
  if (typeof run.browserVersion !== "string" || !run.browserVersion)
    throw new Error(`${key} run browser provenance is missing`);
  for (const [source, declared] of Object.entries(
    run.sourceProvenance?.files ?? {},
  )) {
    const path = recordedPath(source);
    if (!existsSync(path) || hash(readFileSync(path)) !== declared)
      throw new Error(`${key} run source provenance is stale: ${source}`);
  }
  runByKey.set(key, run);
}
if (runs.length !== expectedKeys.length)
  throw new Error(
    "GPU report must retain one current run provenance record per row",
  );

const rowByKey = new Map();
for (const row of rows) {
  const key = `${row.fixture}:${row.mode}`;
  if (rowByKey.has(key)) throw new Error(`Duplicate GPU row: ${key}`);
  rowByKey.set(key, row);
}
const missingRows = expectedKeys.filter((key) => !rowByKey.has(key));
const extraRows = [...rowByKey.keys()].filter(
  (key) => !expectedKeys.includes(key),
);
if (
  missingRows.length ||
  extraRows.length ||
  rows.length !== expectedKeys.length
)
  throw new Error(
    `GPU report must contain exactly ${expectedKeys.join(", ")}; missing=${missingRows.join(", ") || "—"}; extra=${extraRows.join(", ") || "—"}`,
  );

const cpuAgreement = (row) => {
  const comparison = row.cpuComparison;
  if (!comparison)
    return { status: "unavailable", reason: "no CPU comparison" };
  const reasons = [];
  const requiredNumbers = [
    "eventMismatchCount",
    "sampleMismatchCount",
    "statusMismatchCount",
  ];
  for (const field of requiredNumbers) {
    if (
      typeof comparison[field] !== "number" ||
      !Number.isFinite(comparison[field]) ||
      comparison[field] < 0
    )
      reasons.push(`${field} missing/non-finite`);
  }
  if (comparison.terminationAggregateMatches !== true)
    reasons.push("termination aggregate mismatch");
  if (comparison.eventMismatchCount !== 0)
    reasons.push(`${comparison.eventMismatchCount} event mismatches`);
  if (comparison.sampleMismatchCount !== 0)
    reasons.push(`${comparison.sampleMismatchCount} sample mismatches`);
  if (comparison.statusMismatchCount !== 0)
    reasons.push(`${comparison.statusMismatchCount} status mismatches`);
  for (const [name, residual, tolerance] of [
    ["tau", comparison.tauResidual, comparison.tolerances?.tau],
    [
      "variation",
      comparison.variationResidual,
      comparison.tolerances?.variation,
    ],
    ["strength", comparison.strengthResidual, comparison.tolerances?.strength],
    ["RGB", comparison.rgbResidual, comparison.tolerances?.rgb],
  ])
    if (
      !residual ||
      ["max", "mean", "p50", "p95"].some(
        (field) =>
          typeof residual[field] !== "number" ||
          !Number.isFinite(residual[field]) ||
          residual[field] < 0,
      ) ||
      typeof tolerance !== "number" ||
      !Number.isFinite(tolerance) ||
      tolerance < 0
    ) {
      reasons.push(`${name} residual/tolerance missing or non-finite`);
    } else if (residual.max > tolerance) {
      reasons.push(`${name} residual ${residual.max} > ${tolerance}`);
    }
  const kInvariant = comparison.kInvariant;
  if (!kInvariant || kInvariant.complete !== true)
    reasons.push("K-invariance incomplete");
  if (kInvariant?.sameImage !== true) reasons.push("K images differ");
  if (kInvariant?.sameWork !== true) reasons.push("K work differs");
  const kFields = [
    "eventCounts",
    "samples",
    "status",
    "reason",
    "tau",
    "variation",
    "strength",
  ];
  for (const field of kFields)
    if (kInvariant?.samePerRay?.[field] !== true)
      reasons.push(`K per-ray ${field} is not proven equal`);
  if (
    !Array.isArray(kInvariant?.compared) ||
    kInvariant.compared.length < 2 ||
    kInvariant.compared.some((value) => !Number.isInteger(value) || value < 1)
  )
    reasons.push("K comparison set missing/invalid");
  return reasons.length
    ? { status: "refused", reason: reasons.join("; ") }
    : { status: "pass", reason: "within recorded bounded comparison" };
};
const artifactMismatches = [];
const validatedRows = expectedKeys.map((key) => {
  const row = rowByKey.get(key);
  const run = runByKey.get(key);
  const finiteNonnegative = (value, label) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error(`${key} ${label} is missing/non-finite/negative`);
  };
  if (
    !Number.isInteger(row.width) ||
    !Number.isInteger(row.height) ||
    row.width < 512 ||
    row.height < 512
  )
    throw new Error(`${key} is below the required 512x512 visual size`);
  const total = row.width * row.height;
  const completion = row.completion ?? {};
  const reasons = completion.reasons ?? {};
  for (const field of ["total", "complete", "invalid", "unresolved"])
    if (!Number.isInteger(completion[field]) || completion[field] < 0)
      throw new Error(`${key} completion.${field} is missing/invalid`);
  const requiredReasonFields = [
    "domainComplete",
    "opaque",
    "noIntersection",
    "invalid",
    "unresolved",
    "sampleCap",
    "layerCap",
    "schedulerCap",
  ];
  for (const field of requiredReasonFields)
    if (!Number.isInteger(reasons[field]) || reasons[field] < 0)
      throw new Error(`${key} completion.reasons.${field} is missing/invalid`);
  const reasonSum = Object.values(reasons).reduce((sum, value) => {
    finiteNonnegative(value, "completion reason");
    return sum + value;
  }, 0);
  const badReasons = [
    "invalid",
    "unresolved",
    "sampleCap",
    "layerCap",
    "schedulerCap",
  ].filter((reason) => reasons[reason] !== 0);
  badReasons.push(
    ...Object.keys(reasons).filter(
      (reason) => /cap$/i.test(reason) && reasons[reason] !== 0,
    ),
  );
  if (
    completion.total !== total ||
    completion.complete !== total ||
    completion.invalid !== 0 ||
    completion.unresolved !== 0 ||
    reasonSum !== total ||
    badReasons.length
  )
    throw new Error(
      `${key} is incomplete or capped: ${JSON.stringify({ completion, badReasons })}`,
    );
  const image = row.image ?? {};
  const trace = row.trace ?? {};
  const buffers = row.buffers ?? {};
  const timing = row.timing ?? {};
  const work = row.work ?? {};
  for (const field of ["declaredGpuBytes", "stateBytesPerRay"])
    finiteNonnegative(buffers[field], `buffers.${field}`);
  if (buffers.declaredGpuBytes <= 0)
    throw new Error(`${key} declared GPU bytes must be positive`);
  if (buffers.declaredGpuBytes > 128 * 1024 * 1024)
    throw new Error(`${key} declared GPU bytes exceed 128 MiB`);
  for (const field of [
    "pageRenderWallMs",
    "bendStepAndEncodeGpuMs",
    "gpuMaxPassMs",
  ])
    finiteNonnegative(timing[field], `timing.${field}`);
  if (!Number.isInteger(timing.gpuPasses) || timing.gpuPasses < 1)
    throw new Error(`${key} timing.gpuPasses is missing/invalid`);
  for (const field of ["primaryFieldQueries", "opticalNormalQueries"])
    finiteNonnegative(work[field], `work.${field}`);
  if (typeof image.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(image.sha256))
    throw new Error(`${key} image SHA-256 is missing/invalid`);
  if (typeof trace.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(trace.sha256))
    throw new Error(`${key} trace SHA-256 is missing/invalid`);
  const imagePath = recordedPath(image.path);
  const tracePath = recordedPath(trace.path);
  if (!existsSync(imagePath) || !existsSync(tracePath))
    throw new Error(`${key} image/trace artifact is missing`);
  const actualImageHash = hash(readFileSync(imagePath));
  const actualTraceHash = hash(readFileSync(tracePath));
  if (actualImageHash !== image.sha256)
    artifactMismatches.push(`${key} PNG SHA-256 mismatch`);
  if (actualTraceHash !== trace.sha256)
    artifactMismatches.push(`${key} trace SHA-256 mismatch`);
  const actualDimensions = pngDimensions(imagePath);
  if (
    actualDimensions.width !== image.naturalSize?.width ||
    actualDimensions.height !== image.naturalSize?.height ||
    actualDimensions.width !== row.width ||
    actualDimensions.height !== row.height
  )
    artifactMismatches.push(`${key} PNG IHDR/report dimension mismatch`);
  return {
    key,
    row,
    run,
    imagePath,
    tracePath,
    dimensions: actualDimensions,
    cpu: cpuAgreement(row),
  };
});
if (artifactMismatches.length)
  throw new Error(
    `GPU artifact validation failed:\n${artifactMismatches.join("\n")}`,
  );

const cpuRefHtml = `<details><summary>CPU reference comparison</summary><p>The GPU rows carry only their recorded bounded CPU-oracle comparison. Use the existing <a href="${linkPath(join(outputDir, "transmission-revision-review.html"))}">CPU review</a> for separately validated CPU appearance evidence.</p></details>`;

const renderRowCard = ({
  key,
  row,
  run,
  imagePath,
  tracePath,
  dimensions,
  cpu,
}) => {
  const timing = row.timing ?? {};
  const buffers = row.buffers ?? {};
  const modeLabel = row.mode === "none" ? "Straight" : "Bending";
  const kPass =
    row.cpuComparison?.kInvariant?.complete === true &&
    row.cpuComparison.kInvariant.sameImage === true &&
    row.cpuComparison.kInvariant.sameWork === true &&
    [
      "eventCounts",
      "samples",
      "status",
      "reason",
      "tau",
      "variation",
      "strength",
    ].every(
      (field) => row.cpuComparison.kInvariant.samePerRay?.[field] === true,
    );
  const cpuLabel =
    cpu.status === "refused"
      ? `REFUSED (${row.cpuComparison?.size ?? "unknown"}×${row.cpuComparison?.size ?? "?"} CPU oracle): ${cpu.reason}${kPass ? "; K invariance pass" : "; K invariance not proven"}`
      : cpu.status === "pass"
        ? `CPU agreement pass (${row.cpuComparison?.size ?? "unknown"}×${row.cpuComparison?.size ?? "?"} CPU oracle; bounded scope)`
        : `UNAVAILABLE (${row.cpuComparison?.size ?? "unknown"}×${row.cpuComparison?.size ?? "?"} CPU oracle): ${cpu.reason}`;
  return `<article class="row"><h3>${esc(modeLabel)}</h3><a href="${linkPath(imagePath)}" target="_blank" rel="noreferrer"><img src="${dataUri(imagePath, "image/png")}" alt="${esc(row.fixture)} ${esc(modeLabel)} GPU transmission still"></a><p class="caption">${fmt(dimensions.width, 0)}×${fmt(dimensions.height, 0)} · click the image for the original PNG</p><p class="cpu ${cpu.status !== "pass" ? "refused" : ""}">${esc(cpuLabel)}</p><table><tbody><tr><th>Completion</th><td>${fmt(row.completion?.complete, 0)}/${fmt(row.completion?.total, 0)}; invalid ${fmt(row.completion?.invalid, 0)}; unresolved ${fmt(row.completion?.unresolved, 0)}</td></tr><tr><th>Timing</th><td>pageRenderWallMs ${fmt(timing.pageRenderWallMs)} · device ${fmt(timing.bendStepAndEncodeGpuMs)} ms <span class="small">(bend-step + encode timestamps only)</span></td></tr><tr><th>Work</th><td>${fmt(row.work?.primaryFieldQueries, 0)} field queries · ${fmt(row.work?.opticalNormalQueries, 0)} optical-normal queries</td></tr><tr><th>Declared buffers</th><td>${bytes(buffers.declaredGpuBytes)}; state ${fmt(buffers.stateBytesPerRay, 0)} B/ray</td></tr></tbody></table><details><summary>Scope, math, trace and run provenance</summary><p class="small">Estimator depth ${fmt(row.estimatorDepth, 0)} · sample delta ${fmt(row.sampleDelta, 9)} · coordinate rule: ${esc(row.coordinates ?? "—")}</p><p class="small">${esc(row.limitation ?? "No row limitation recorded.")}</p><p class="small">Trace: <a href="${linkPath(tracePath)}">open original trace</a></p><p class="small">Renderer: ${esc(run?.renderer ?? "—")} · browser ${esc(run?.browserVersion ?? "—")} · quiet baseline certified with contended=false and unknownReason=null.</p></details></article>`;
};
const sceneNames = { menger3: "Menger 3D", native4: "Native 4D" };
const rowCards = ["menger3", "native4"]
  .map((fixture) => {
    const pair = validatedRows.filter(({ row }) => row.fixture === fixture);
    return `<article class="scene"><h3>${sceneNames[fixture]}</h3><div class="pair">${pair.map(renderRowCard).join("\n")}</div></article>`;
  })
  .join("\n");

const sourceStatus = execFileSync(
  "git",
  [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)scripts/out/**",
    ":(exclude)tracker/**",
    ":(exclude).beads/**",
  ],
  { cwd: root, encoding: "utf8" },
).trim();
const renderer = report.renderer ?? "—";
const adapter = report.report?.browserAdapter ?? body.browserAdapter ?? "—";
const quiet = report.quiet ?? "—";
const reportVerdict = report.verdict ?? body.verdict ?? "not recorded";
const reportVerdictText =
  reportVerdict && typeof reportVerdict === "object"
    ? JSON.stringify(reportVerdict)
    : String(reportVerdict);
const cpuSizes = [
  ...new Set(
    validatedRows.map(({ row }) => row.cpuComparison?.size).filter(Boolean),
  ),
].join(", ");
const refusalCount = validatedRows.filter(
  ({ cpu }) => cpu.status !== "pass",
).length;
const html = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPU transmission 512px visual review — UNREVIEWED</title>
<style>
body{margin:24px auto;max-width:1128px;padding:0 18px;background:#101216;color:#e6e9ef;font:15px system-ui,sans-serif;line-height:1.45}h1,h2,h3{color:#fff}.status{padding:14px;border:2px solid #e7ad45;background:#2b2212}.limits{padding:14px;border:2px solid #c95b5b;background:#30191d}.scene{min-width:0;padding:14px;border:1px solid #59616e;background:#171a20;margin:18px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:22px;min-width:0}.row{min-width:0;padding:12px;border:1px solid #454b55;background:#12151a}.row img{display:block;width:100%;height:auto;background:#050608}.caption,.small{color:#b8bec8;font-size:13px}.cpu{padding:8px;border-left:4px solid #65b78b;background:#13251c}.cpu.refused{border-color:#e7ad45;background:#2b2212}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px 8px;border:1px solid #4b515a;text-align:left;vertical-align:top}th{background:#252a32}a{color:#9dccff}code,pre{overflow-wrap:anywhere;word-break:break-word}code{background:#222831;padding:2px 4px}pre{white-space:pre-wrap}@media(max-width:760px){.pair{grid-template-columns:1fr}}
</style>
<h1>GPU transmission 512px visual review</h1>
<p class="status"><strong>UNREVIEWED EXPERIMENT.</strong> These four GPU images are appearance evidence for the sampled transmission candidate. They do not approve production integration, establish a performance target, or remove the visible phase/noise limits.</p>
<p class="limits"><strong>Scope:</strong> device timestamps cover only bend-step and encode passes. Wall time includes host scheduling and other harness work. CPU agreement is a separate bounded comparison and may be refused; GPU rendering here does not prove the CPU model, bending quality, temporal stability, memory target, or production frame-loop behavior.</p>
<h2>512px straight/weighted comparison</h2>
<p>Exactly four complete rows are required: Menger 3D and native posed 4D, each straight and weighted. Every image is shown at its natural aspect ratio and links to the recorded original PNG.</p>
<section class="rows">${rowCards}</section>
<h2>Measured provenance</h2>
<p>All four GPU rows complete their 512×512 transport raster. CPU agreement is limited to the recorded ${esc(cpuSizes || "unknown")} diagnostic raster and is refused/unavailable for <strong>${refusalCount}/4</strong> rows. Grain and phase sensitivity remain visible research limits.</p>
${cpuRefHtml}
<details><summary>Source, verdict, renderer and scope details</summary><p>Input report: <a href="${esc(linkPath(reportPath))}">${esc(relative(root, reportPath))}</a><br>Recorded report verdict: <code>${esc(reportVerdictText)}</code><br>Current scoped source tree dirty: <strong>${sourceStatus !== ""}</strong><br>Renderer: <code>${esc(renderer)}</code><br>Adapter: <code>${esc(JSON.stringify(adapter))}</code><br>Quiet baseline: <code>${esc(JSON.stringify(quiet))}</code><br>Report source hashes, PNG hashes, trace hashes and IHDR dimensions were validated before this page was written.</p><pre class="small">${esc(JSON.stringify({ report: relative(root, reportPath), sourceHash: sourceProvenance.sourceHash, verdict: report.verdict ?? body.verdict, fullCPUprovenance: report.fullCPUprovenance ?? body.fullCPUprovenance, memoryScope: report.memoryScope ?? body.memoryScope, rows: validatedRows.map(({ key, row }) => ({ key, image: row.image, trace: row.trace })) }, null, 2))}</pre></details>
<p class="small">Generated offline. No GPU, browser, renderer or large CPU run was started by this review script.</p>`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, html);
const artifactPaths = validatedRows.flatMap(({ imagePath, tracePath }) => [
  imagePath,
  tracePath,
]);
const manifestEntry = (path) => ({
  path: relative(root, path),
  bytes: readFileSync(path).length,
  sha256: hash(readFileSync(path)),
});
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      status: "UNREVIEWED",
      verdict:
        "visual evidence only; no production approval or performance-target claim",
      generatedAt: new Date().toISOString(),
      report: manifestEntry(reportPath),
      builder: manifestEntry(builderPath),
      repositoryRevision: revision,
      sourceTreeClean: sourceStatus === "",
      scopedSourceStatus: sourceStatus,
      sourceProvenance,
      runs: runs.map((run) => ({
        key: `${run.options.fixture}:${run.options.mode}`,
        generatedAt: run.generatedAt,
        renderer: run.renderer,
        browserVersion: run.browserVersion,
        quiet: run.quiet,
        sourceHash: run.sourceProvenance?.sourceHash,
        verdict: run.verdict,
      })),
      requiredRows: expectedKeys,
      artifacts: artifactPaths.map(manifestEntry),
      browser: { renderer, adapter, quiet },
      memoryScope:
        "declared GPU buffer fields only; driver, compiler, query-set and full host allocations remain outside certification",
      timingScope:
        "row timing device field covers bend-step and encode passes; wall field includes harness scheduling and other host work",
      cpuAgreementRefusedRows: refusalCount,
    },
    null,
    2,
  )}\n`,
);
console.log(relative(root, outputPath));
console.log(relative(root, manifestPath));
