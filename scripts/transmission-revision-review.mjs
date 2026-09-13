#!/usr/bin/env node
/**
 * Assemble the scalar, world-bend and resumable-device transmission evidence
 * into one offline review.  This is a display and provenance tool: it does not
 * rerun a renderer and it never turns missing evidence into a pass.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "scripts/out");
const reviewPath = join(out, "transmission-revision-review.html");
const manifestPath = join(out, "transmission-revision-review-manifest.json");

const sourceFiles = [
  "docs/surface-transmission.md",
  "docs/surface-transmission-revision.md",
  "scripts/de-preview.ts",
  "scripts/transmission-study.ts",
  "scripts/transmission-layer-field.ts",
  "scripts/transmission-layer-field.harness.ts",
  "scripts/transmission-bend-study.ts",
  "scripts/transmission-bend.harness.ts",
  "scripts/transmission-gpu-contract.ts",
  "scripts/transmission-gpu-resumable.page.ts",
  "scripts/transmission-gpu-resumable.mjs",
  "scripts/transmission-revision-review.mjs",
];

const reports = [
  "scripts/out/transmission-layer-field-report.json",
  "scripts/out/transmission-layer-noise-report.json",
  "scripts/out/transmission-bend-control-report.json",
  "scripts/out/transmission-bend-pilot-report.json",
  "scripts/out/transmission-bend-motion-report.json",
];
const gpuReports = {
  primary:
    "scripts/out/transmission-gpu-resumable/actual-256x144-k1-window36864-fullraster.json",
  control:
    "scripts/out/transmission-gpu-resumable/actual-256x144-k4-window256-control.json",
  calibration32:
    "scripts/out/transmission-gpu-resumable/calibration-32x18-k4-window256-allk-window.json",
  calibration64:
    "scripts/out/transmission-gpu-resumable/calibration-64x36-k4-window256-allk-window-refused.json",
  diagnostic64Brick:
    "scripts/out/transmission-gpu-resumable/diagnostic-64x36-brick-k1-full-window.json",
};

// Canonical names for the independent native 4D analytic disocclusion
// control.  The bend harness owns the measurements; this builder only reads
// and embeds them once both files exist.
const native4AnalyticControl = {
  image: "scripts/out/transmission-bend-native4-analytic-control.png",
  report: "scripts/out/transmission-bend-native4-analytic-control-report.json",
};

const stills = [
  "scripts/out/transmission-bend-control.png",
  "scripts/out/transmission-bend-menger3.png",
  "scripts/out/transmission-bend-menger3-none.png",
  "scripts/out/transmission-bend-menger3-weighted.png",
  "scripts/out/transmission-bend-menger3-hard.png",
  "scripts/out/transmission-bend-native4.png",
  "scripts/out/transmission-bend-native4-none.png",
  "scripts/out/transmission-bend-native4-weighted.png",
  "scripts/out/transmission-bend-native4-hard.png",
];

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const scriptJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const reportPath = (path) => join(root, path);
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(reportPath(path), "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
const dataUri = (path) =>
  `data:image/png;base64,${readFileSync(reportPath(path)).toString("base64")}`;
const link = (path, label = basename(path)) =>
  `<a href="${esc(relative(out, reportPath(path)))}">${esc(label)}</a>`;
const value = (object, key, fallback = "—") =>
  object && object[key] !== undefined ? object[key] : fallback;
const fmt = (item) =>
  item === null || item === undefined
    ? "—"
    : typeof item === "number"
      ? Number.isFinite(item)
        ? item.toLocaleString(undefined, { maximumFractionDigits: 6 })
        : String(item)
      : String(item);
const bytes = (item) => {
  if (typeof item !== "number" || !Number.isFinite(item)) return "—";
  return `${fmt(item)} B (${fmt(item / (1024 * 1024))} MiB)`;
};

const baseMissing = [
  ...sourceFiles,
  ...reports,
  ...Object.values(gpuReports),
  ...Object.values(native4AnalyticControl),
  ...stills,
].filter((path) => !existsSync(reportPath(path)));
if (baseMissing.length) {
  throw new Error(
    `Missing required transmission revision-review inputs:\n${baseMissing.join("\n")}`,
  );
}

const layerReport = readJson(reports[0]);
const noiseReport = readJson(reports[1]);
const bendControlReport = readJson(reports[2]);
const bendPilotReport = readJson(reports[3]);
const motionReport = readJson(reports[4]);
const gpuEnvelope = readJson(gpuReports.primary);
const gpuControlEnvelope = readJson(gpuReports.control);
const gpuCalibration32Envelope = readJson(gpuReports.calibration32);
const gpuCalibration64Envelope = readJson(gpuReports.calibration64);
const gpuDiagnostic64Envelope = readJson(gpuReports.diagnostic64Brick);
const native4AnalyticReport = readJson(native4AnalyticControl.report);
const motionGroups = motionReport.groups ?? motionReport.sequences;
if (!Array.isArray(motionGroups) || motionGroups.length !== 3) {
  throw new Error(
    "transmission-bend-motion-report.json must contain exactly three groups",
  );
}
const expectedMotionKeys = ["menger-camera", "native4-rotor", "native4-slice"];
const dynamicMotionStills = [];
for (const key of expectedMotionKeys) {
  const group = motionGroups.find((item) => item?.key === key);
  if (!group || !Array.isArray(group.frames) || group.frames.length !== 3) {
    throw new Error(
      `Motion report must contain ${key} with exactly three frames`,
    );
  }
  for (let index = 0; index < 3; index++) {
    const frame = group.frames[index];
    const frameName = String(frame.frame ?? index);
    for (const mode of ["none", "weighted"]) {
      dynamicMotionStills.push(
        `scripts/out/transmission-bend-motion-${key}-${frameName}-${mode}.png`,
      );
    }
  }
}
const missingMotion = dynamicMotionStills.filter(
  (path) => !existsSync(reportPath(path)),
);
if (missingMotion.length)
  throw new Error(
    `Missing required motion stills:\n${missingMotion.join("\n")}`,
  );

const artifactFiles = [
  ...reports,
  ...Object.values(gpuReports),
  ...Object.values(native4AnalyticControl),
  ...stills,
  ...dynamicMotionStills,
];
const image = (path, alt) =>
  `<img src="${dataUri(path)}" alt="${esc(alt)}" loading="lazy">`;

const layerRows = Array.isArray(layerReport) ? layerReport : [];
const noiseRows = Array.isArray(noiseReport) ? noiseReport : [];
const layerRange = layerRows.reduce(
  (max, row) => Math.max(max, Number(row.phaseThroughputRange) || 0),
  0,
);
const layerTable = layerRows
  .map(
    (row) =>
      `<tr><td>${esc(value(row, "dimension"))}</td><td>${fmt(value(row, "gap"))}</td><td>${fmt(value(row, "delta"))}</td><td>${fmt(value(row, "exactVariation"))}</td><td>${fmt(value(row, "phaseThroughputRange"))}</td></tr>`,
  )
  .join("");
const noiseTable = noiseRows
  .map(
    (row) =>
      `<tr><td>${fmt(value(row, "cycles"))}</td><td>${fmt(value(row, "variation"))}</td><td>${fmt(value(row, "throughput"))}</td></tr>`,
  )
  .join("");

const bendRows = Array.isArray(bendControlReport.rows)
  ? bendControlReport.rows
  : [];
const bendTable = bendRows
  .map(
    (row) =>
      `<tr><td>${esc(value(row, "label"))}</td><td>${fmt(value(row, "size"))}</td><td>${fmt(value(row, "unresolved"))}</td><td>${fmt(value(row, "totalVariation"))}</td><td>${fmt(row.termination?.domainComplete)}</td><td>${fmt(row.termination?.opaque)}</td></tr>`,
  )
  .join("");
const pilotRows = Array.isArray(bendPilotReport.rows)
  ? bendPilotReport.rows
  : [];
const pilotTable = pilotRows
  .map(
    (row) =>
      `<tr><td>${esc(value(row, "fixture"))}</td><td>${fmt(value(row, "size"))}</td><td>${fmt(value(row, "straightWeightedDelta"))}</td><td>${fmt(value(row, "weightedHardDelta"))}</td></tr>`,
  )
  .join("");
const reportBody = (envelope) => envelope.report ?? envelope;
const reportRows = (envelope) => {
  const body = reportBody(envelope);
  return Array.isArray(body.rows) ? body.rows : [];
};
const gpuReport = reportBody(gpuEnvelope);
const gpuRows = reportRows(gpuEnvelope);
const gpuControlRows = reportRows(gpuControlEnvelope);
const gpuDiagnosticRows = reportRows(gpuDiagnostic64Envelope);
const calibrationSummary = (envelope) => {
  const body = reportBody(envelope);
  const rows = reportRows(envelope);
  if (body.options?.checkWindowInvariant !== true)
    return { status: "omitted", detail: "checkWindowInvariant=false", rows };
  if (!Array.isArray(body.chunkInvariant) || !body.chunkInvariant.length)
    return { status: "omitted", detail: "no calibration rows", rows };
  const fixtureRows = body.chunkInvariant.map((row) => {
    const k = Array.isArray(row.kComparisons) ? row.kComparisons : [];
    const kPass =
      k.length === 0 ||
      k.every(
        (comparison) =>
          comparison.complete === true && comparison.samePerRay === true,
      );
    const transportPass =
      rows.find((candidate) => candidate.fixture === row.fixture)
        ?.cpuTransportOracle?.residual?.pass === true;
    const cpuRow = rows.find((candidate) => candidate.fixture === row.fixture);
    const transport = cpuRow?.cpuTransportOracle?.residual;
    return {
      fixture: row.fixture,
      status:
        row.complete === true &&
        row.samePerRay === true &&
        kPass &&
        transportPass
          ? "pass"
          : "fail",
      window: row.samePerRay === true && row.complete === true,
      k: k.length
        ? k.every((comparison) => comparison.samePerRay === true)
        : null,
      transport: transportPass,
      completion: cpuRow?.completion
        ? `${cpuRow.completion.complete}/${cpuRow.completion.total}`
        : "—",
      selectedRays: cpuRow?.cpuTransportOracle?.selectedRays ?? "—",
      maxResidual: transport?.max ?? "—",
      coordinateHashMismatches:
        cpuRow?.cpuTransportOracle?.coordinateHashMismatches ?? "—",
    };
  });
  return {
    status: fixtureRows.every((row) => row.status === "pass") ? "pass" : "fail",
    detail: fixtureRows,
    rows,
  };
};
const calibration32 = calibrationSummary(gpuCalibration32Envelope);
const calibration64 = calibrationSummary(gpuCalibration64Envelope);
const diagnosticBrickRow = gpuDiagnosticRows.find(
  (row) => row.fixture === "mandelbox-brick-4d-posed-filled-escape",
);
const diagnosticWitness =
  diagnosticBrickRow?.cpuTransportOracle?.worstTransportWitness;
const archiveProvenance = (envelope) => {
  const files = envelope.sourceProvenance?.files;
  return Array.isArray(files)
    ? `${Object.keys(files).length} SHA-256 source hashes`
    : files && typeof files === "object"
      ? `${Object.keys(files).length} SHA-256 source hashes`
      : "source hashes unavailable in archive";
};
const gpuProvenance = {
  renderer: gpuEnvelope.renderer,
  browserVersion: gpuEnvelope.browserVersion,
  adapter: gpuReport.browserAdapter,
  quiet: gpuEnvelope.quiet,
};
const gpuTable = gpuRows
  .map((row) => {
    const timing = row.gpuTimingMs ?? {};
    const completion = row.completion ?? {};
    const residual = row.cpuTransportOracle?.residual ?? {};
    const buffers = row.buffers ?? {};
    const rowTiming = row.timing ?? {};
    const nonOracleWall =
      typeof rowTiming.totalHarnessWallMs === "number" &&
      typeof rowTiming.cpuOracleWallMs === "number"
        ? rowTiming.totalHarnessWallMs - rowTiming.cpuOracleWallMs
        : undefined;
    const setupWall =
      typeof rowTiming.gridSetupMs === "number" &&
      typeof rowTiming.windowSetupMs === "number"
        ? rowTiming.gridSetupMs + rowTiming.windowSetupMs
        : undefined;
    return `<tr><td>${esc(value(row, "fixture"))}</td><td>${fmt(row.raster?.width)}×${fmt(row.raster?.height)}</td><td>${fmt(completion.complete)}/${fmt(completion.total)}</td><td>${fmt(timing.total)} ms</td><td>${fmt(nonOracleWall)} ms</td><td>${fmt(rowTiming.compilePipelinesMs)} / ${fmt(setupWall)} ms</td><td>${fmt(residual.pass)}</td><td>${bytes(buffers.peakDeclaredGpuBufferBytes)}</td></tr>`;
  })
  .join("");
const gpuCostRows = [
  ["primary k1/full-raster", gpuEnvelope, gpuRows],
  ["k4/window256 control", gpuControlEnvelope, gpuControlRows],
].flatMap(([label, envelope, rows]) => {
  const body = reportBody(envelope);
  return rows.map((row) => {
    const timing = row.gpuTimingMs ?? {};
    const rowTiming = row.timing ?? {};
    const nonOracleWall =
      typeof rowTiming.totalHarnessWallMs === "number" &&
      typeof rowTiming.cpuOracleWallMs === "number"
        ? rowTiming.totalHarnessWallMs - rowTiming.cpuOracleWallMs
        : undefined;
    return `<tr><td>${esc(label)}</td><td>${esc(value(row, "fixture"))}</td><td>${fmt(body.options?.k)} / ${fmt(body.options?.windowRays)}</td><td>${fmt(timing.total)} ms</td><td>${fmt(rowTiming.encodeSubmitTerminalMapMs)} ms</td><td>${fmt(nonOracleWall)} ms</td><td>${fmt(row.completion?.complete)}/${fmt(row.completion?.total)}</td></tr>`;
  });
});
const calibrationTable = (label, summary) => {
  const body = summary.detail;
  if (Array.isArray(body))
    return body
      .map(
        (row) =>
          `<tr><td>${esc(label)}</td><td>${esc(row.fixture)}</td><td>${esc(String(row.completion))}</td><td>${esc(row.status)}</td><td>${esc(String(row.window))}</td><td>${row.k === null ? "—" : esc(String(row.k))}</td><td>${esc(String(row.transport))}</td><td>${fmt(row.maxResidual)}</td><td>${fmt(row.coordinateHashMismatches)}</td></tr>`,
      )
      .join("");
  return `<tr><td>${esc(label)}</td><td>—</td><td>—</td><td>${esc(summary.status)}</td><td colspan="5">${esc(summary.detail)}</td></tr>`;
};
const primaryMenger = gpuRows.find((row) => row.fixture === "menger-3d");
const primaryMengerEncode = primaryMenger?.timing?.encodeSubmitTerminalMapMs;
const primaryPreviewNote =
  typeof primaryMengerEncode === "number" && primaryMengerEncode > 1000
    ? `The primary 256×144 Menger scalar run already spends ${fmt(primaryMengerEncode)} ms in encode/submit/terminal-map wall, exceeding the 1 s preview target before bending or shading.`
    : "The primary full-raster record does not establish the 1 s preview target before bending or shading.";

const motionData = motionGroups.map((group) => ({
  key: group.key,
  isolated: group.isolated,
  frames: group.frames.map((frame, index) => {
    const frameName = String(frame.frame ?? index);
    return {
      frame: frameName,
      pose: frame.pose,
      straight: dataUri(
        `scripts/out/transmission-bend-motion-${group.key}-${frameName}-none.png`,
      ),
      weighted: dataUri(
        `scripts/out/transmission-bend-motion-${group.key}-${frameName}-weighted.png`,
      ),
      delta: frame.straightWeightedDelta,
    };
  }),
}));
const gpuAdapterText = gpuProvenance.adapter
  ? JSON.stringify(gpuProvenance.adapter)
  : "—";
const gpuQuietText = gpuProvenance.quiet
  ? JSON.stringify(gpuProvenance.quiet)
  : "—";
const gpuRendererText = gpuProvenance.renderer ?? "—";
const gpuBrowserText = gpuProvenance.browserVersion ?? "—";
const diagnosticWitnessText = diagnosticWitness
  ? `global ray ${diagnosticWitness.globalRay}: CPU tau ${fmt(diagnosticWitness.cpuTau)}, GPU tau ${fmt(diagnosticWitness.gpuTau)}, CPU positive variation ${fmt(diagnosticWitness.cpuPositiveVariation)}, GPU positive variation ${fmt(diagnosticWitness.gpuPositiveVariation)}`
  : "worst transport witness unavailable";
const native4AnalyticText = JSON.stringify(native4AnalyticReport, null, 2);
const archiveProvenanceText = `primary/control/calibration: ${archiveProvenance(gpuEnvelope)}; diagnostic: ${archiveProvenance(gpuDiagnostic64Envelope)}`;

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transmission revision review — UNREVIEWED</title>
<style>
body{margin:24px auto;max-width:1500px;padding:0 18px;background:#101216;color:#e6e9ef;font:15px system-ui,sans-serif;line-height:1.45}h1,h2{color:#fff}.status{padding:14px;border:2px solid #e7ad45;background:#2b2212}.limits{padding:14px;border:2px solid #c95b5b;background:#30191d}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.triple{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.grid img,.pair img,.triple img{width:100%;height:auto;background:#050608}.control{max-width:700px}.control img{width:100%;image-rendering:pixelated}.triple img,.scrub img{image-rendering:pixelated}.card{padding:12px;border:1px solid #454b55;background:#171a20;margin:12px 0}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px 9px;border:1px solid #4b515a;text-align:left;vertical-align:top}th{background:#252a32}code{background:#222831;padding:2px 4px}a{color:#9dccff}.scrub{border:1px solid #454b55;padding:12px;margin:14px 0}.scrub-controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.scrub img{max-width:48%;width:48%;background:#050608}.scrub-views{display:flex;gap:12px}.small{color:#b8bec8;font-size:13px}.metric{font-variant-numeric:tabular-nums}
</style>
<h1>Transmission revision evidence</h1>
<p class="status"><strong>RESEARCH DIRECTION SELECTED · PRODUCTION UNQUALIFIED.</strong> Layered transparency, required bending and the targets below are selected. These revised images have not been approved for release.</p>
<div class="limits"><strong>Measured limits and scope:</strong> phase sensitivity remains in the sampled field; estimator noise adds positive variation; the bend is an artistic zero-thickness world-ray mapping; no production qualification is claimed; the GPU pilot measures continuation and scalar transport only and excludes bending, normals, Fresnel, shading and compositing.</div>

<h2>Owner target envelope</h2>
<p>Targets carried into this review are <strong>1 s at 256×144</strong>, <strong>10 s at 512×288</strong>, <strong>120 s at 1920×1080</strong>, and <strong>128 MiB additional state</strong>. They are target constraints, not measurements. GPU rows below report only fields present in the resumable pilot.</p>

<h2>Scalar clearance field</h2>
<p>The report records the smooth clearance signal and positive variation. The largest recorded phase-throughput range is <span class="metric">${fmt(layerRange)}</span>; this is evidence of sampling dependence, not a quality score.</p>
<details><summary>Exact gap, phase and noise measurements</summary>
<table><thead><tr><th>dimension</th><th>gap</th><th>delta</th><th>exact variation</th><th>phase throughput range</th></tr></thead><tbody>${layerTable}</tbody></table>
<p class="small">${link(reports[0], "scalar field report")} · ${link(reports[1], "noise report")}</p>
<table><thead><tr><th>noise cycles</th><th>variation</th><th>throughput</th></tr></thead><tbody>${noiseTable}</tbody></table>
</details>

<h2>World-ray bend controls</h2>
<p>${esc(value(bendControlReport, "model", "No model label in report."))}. Options and termination counts are taken from the report; they do not establish physical thickness or refraction.</p>
<figure class="control">${image("scripts/out/transmission-bend-control.png", "analytic bend control contact sheet")}<figcaption>Analytic 3D control contact sheet.</figcaption></figure>
<figure class="control">${image(native4AnalyticControl.image, "native 4D analytic disocclusion control")}<figcaption>Independent native 4D analytic disocclusion control.</figcaption></figure>
<details><summary>Native 4D analytic control record</summary><pre class="small">${esc(native4AnalyticText)}</pre></details>
<table><thead><tr><th>row</th><th>size</th><th>unresolved</th><th>total variation</th><th>domain complete</th><th>opaque</th></tr></thead><tbody>${bendTable}</tbody></table>
<p class="small">${link(reports[2], "bend control report")} · ${link(native4AnalyticControl.report, "native 4D analytic control report")}</p>

<h2>Menger 3D and posed 4D pilot stills</h2>
<p>The three columns are straight, weighted bend and hard onset. These are enlarged diagnostic rasters (32×32 and 48×48), not viewing-resolution appearance or motion qualification. Contact sheets are retained beside their individual stills so the raw artifact remains inspectable.</p>
<div class="card"><h3>Menger 3D</h3><div class="triple">${image("scripts/out/transmission-bend-menger3-none.png", "Menger 3D none")}${image("scripts/out/transmission-bend-menger3-weighted.png", "Menger 3D weighted")}${image("scripts/out/transmission-bend-menger3-hard.png", "Menger 3D hard")}</div><p>${image("scripts/out/transmission-bend-menger3.png", "Menger 3D contact sheet")}</p></div>
<div class="card"><h3>Native posed 4D</h3><div class="triple">${image("scripts/out/transmission-bend-native4-none.png", "native 4D none")}${image("scripts/out/transmission-bend-native4-weighted.png", "native 4D weighted")}${image("scripts/out/transmission-bend-native4-hard.png", "native 4D hard")}</div><p>${image("scripts/out/transmission-bend-native4.png", "native 4D contact sheet")}</p></div>
<table><thead><tr><th>fixture</th><th>size</th><th>straight/weighted delta</th><th>weighted/hard delta</th></tr></thead><tbody>${pilotTable}</tbody></table>
<p class="small">${link(reports[3], "bend pilot report")}</p>

<h2>Three-frame motion scrubber</h2>
<p>Each group changes the named camera, rotor or slice control while holding the reported optics fixed. The page embeds the paired stills; the raw report and PNGs remain hash-pinned in the manifest.</p>
<div id="scrubbers"></div>

<h2>Resumable GPU scalar pilot</h2>
<p>${esc(primaryPreviewNote)}</p>
<p>This primary table is the archived <code>actual-256x144-k1-window36864-fullraster.json</code> record. It is a transport and continuation record: bending and all shading work are excluded, and an absent field is shown as <code>—</code> rather than inferred. Device time is timestamp-query time; non-CPU-oracle wall is a derived harness wall interval and includes submission/readback overhead.</p>
<table><thead><tr><th>fixture</th><th>raster</th><th>complete/total</th><th>device ms</th><th>non-CPU-oracle wall</th><th>compile / grid+window setup</th><th>CPU residual pass</th><th>declared peak buffers</th></tr></thead><tbody>${gpuTable}</tbody></table>
<h3>K/window cost control</h3>
<table><thead><tr><th>archive</th><th>fixture</th><th>k / window rays</th><th>device ms</th><th>encode/submit/map wall</th><th>non-CPU-oracle wall</th><th>complete/total</th></tr></thead><tbody>${gpuCostRows.join("")}</tbody></table>
<p>${link(gpuReports.control, "k4/window256 control archive")}</p>
<h3>Exact calibration archives</h3>
<p>A selected-ray calibration cannot stand in for the full 64×36 result. The archived 64×36 record is shown even when it refuses, so a Brick failure remains visible.</p>
<table><thead><tr><th>archive</th><th>fixture</th><th>complete/total</th><th>status</th><th>window trace</th><th>all-k trace</th><th>CPU transport</th><th>max residual</th><th>hash mismatches</th></tr></thead><tbody>${calibrationTable("32×18 all-k/window", calibration32)}${calibrationTable("64×36 all-k/window refused", calibration64)}</tbody></table>
<p class="small">Calibration verdicts: 32×18 <strong>${esc(calibration32.status)}</strong>; 64×36 <strong>${esc(calibration64.status)}</strong>. CPU residuals cover the report's selected-ray scope; these archives use the full small raster, including the 64×36 Brick failure.</p>
<p class="small">${link(gpuReports.calibration32, "32×18 calibration")} · ${link(gpuReports.calibration64, "64×36 refused calibration")}</p>
<h3>64×36 Brick diagnostic</h3>
<p><strong>Worst witness:</strong> ${esc(diagnosticWitnessText)}. This diagnostic covers the full 64×36 Brick raster and preserves the estimator disagreement behind the refused calibration.</p>
<p class="small">${link(gpuReports.diagnostic64Brick, "64×36 Brick diagnostic archive")} · embedded archive provenance: ${esc(archiveProvenanceText)}</p>
<div class="card"><strong>Inherited run provenance:</strong><br>adapter <code>${esc(gpuAdapterText)}</code><br>browser <code>${esc(gpuBrowserText)}</code><br>renderer <code>${esc(gpuRendererText)}</code><br>quiet baseline <code>${esc(gpuQuietText)}</code></div>
<p class="small">${link(gpuReports.primary, "primary full-raster archive")} · mutable <code>report.json</code> is intentionally not used as primary evidence.</p>

<h2>Provenance</h2>
<p>Revision, scoped source-tree status, source hashes and artifact hashes are in ${link("scripts/out/transmission-revision-review-manifest.json", "the review manifest")}. The previous review remains available as ${link("scripts/out/transmission-review.html", "the prior review")}; this revision preserves it rather than replacing its verdict.</p>
<p class="small">Generated offline from existing JSON and PNG artifacts. No browser, GPU or renderer was run by this review script.</p>
<script>
const motion=${scriptJson(motionData)};
const host=document.querySelector('#scrubbers');
for(const group of motion){
  const section=document.createElement('section'); section.className='scrub card';
  section.innerHTML='<h3>'+group.key+'</h3><p class="small">isolated control: '+String(group.isolated??'—')+'</p><div class="scrub-controls"><label>frame <input type="range" min="0" max="'+(group.frames.length-1)+'" value="0"></label><output></output></div><div class="scrub-views"><figure><img alt="straight frame"><figcaption>straight</figcaption></figure><figure><img alt="weighted frame"><figcaption>weighted</figcaption></figure></div><pre class="small"></pre>';
  const range=section.querySelector('input'), output=section.querySelector('output'), imgs=section.querySelectorAll('img'), pre=section.querySelector('pre');
  const draw=()=>{const frame=group.frames[Number(range.value)]; output.textContent=String(frame.frame); imgs[0].src=frame.straight; imgs[1].src=frame.weighted; pre.textContent=JSON.stringify({pose:frame.pose,straightWeightedDelta:frame.delta},null,2)};
  range.addEventListener('input',draw); draw(); host.append(section);
}
</script>`;

mkdirSync(out, { recursive: true });
writeFileSync(reviewPath, html);
const hashEntry = (path) => {
  const bytesValue = readFileSync(reportPath(path));
  return {
    path,
    bytes: bytesValue.length,
    sha256: createHash("sha256").update(bytesValue).digest("hex"),
  };
};
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
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
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      status: "UNREVIEWED",
      verdict: "evidence assembly only; no production qualification",
      generatedAt: new Date().toISOString(),
      repositoryRevision: revision,
      sourceTreeClean: sourceStatus === "",
      scopedSourceStatus: sourceStatus,
      targets: {
        previewSeconds: 1,
        settleSeconds: 10,
        exportSeconds: 120,
        continuationStateMiB: 128,
        measuredHere: false,
      },
      review: hashEntry(relative(root, reviewPath)),
      sources: sourceFiles.map((path) => hashEntry(path)),
      artifacts: artifactFiles.map((path) => hashEntry(path)),
    },
    null,
    2,
  ),
);
console.log(relative(root, reviewPath));
console.log(relative(root, manifestPath));
