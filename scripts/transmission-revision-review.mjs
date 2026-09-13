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
const allowThumbnailMain = process.argv.includes("--allow-thumbnail-main");
const stillsOnly = process.argv.includes("--stills-only");
const reviewStem = allowThumbnailMain
  ? "transmission-revision-smoke"
  : "transmission-revision-review";
const reviewPath = join(out, `${reviewStem}.html`);
const manifestPath = join(out, `${reviewStem}-manifest.json`);
const MIN_MAIN_STILL_DIMENSION = 512;
const MIN_MOTION_STILL_DIMENSION = 256;
const MIN_CONTROL_STILL_DIMENSION = 256;
const readableDir = "scripts/out/transmission-readable";
const readableReportPath = `${readableDir}/report.json`;

const baseSourceFiles = [
  "docs/surface-transmission.md",
  "docs/surface-transmission-revision.md",
  "scripts/de-preview.ts",
  "scripts/transmission-study.ts",
  "scripts/transmission-layer-field.ts",
  "scripts/transmission-layer-field.harness.ts",
  "scripts/transmission-bend-study.ts",
  "scripts/transmission-bend.harness.ts",
  "scripts/transmission-primary-review.mjs",
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
const reportBodyOf = (envelope) => envelope?.report ?? envelope;
const dataUri = (path) =>
  `data:image/png;base64,${readFileSync(reportPath(path)).toString("base64")}`;
const pngDimensions = (path) => {
  const bytes = readFileSync(reportPath(path));
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature)
    throw new Error(`Expected PNG input: ${path}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
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
  ...baseSourceFiles,
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

if (!existsSync(reportPath(readableReportPath)))
  throw new Error(
    `Missing required readable transmission package report: ${readableReportPath}`,
  );
const readableReportEnvelope = readJson(readableReportPath);
const readableReport = reportBodyOf(readableReportEnvelope);
const readableJobs = readableReport.jobs;
if (!Array.isArray(readableJobs))
  throw new Error(`${readableReportPath} must contain a jobs array`);
const primaryModes = stillsOnly
  ? ["none", "weighted"]
  : ["none", "weighted", "hard", "opaque"];
const expectedReadableJobKeys = [
  ...["menger3", "native4"].flatMap((scene) =>
    primaryModes.map((mode) => `${scene}-still-${mode}`),
  ),
  ...(stillsOnly ? [] : ["analytic3", "analytic4"]).flatMap((scene) =>
    ["none", "weighted", "opaque", "rear-absent"].map(
      (mode) => `${scene}-control-${mode}`,
    ),
  ),
  ...(stillsOnly
    ? []
    : ["menger-camera", "native4-rotor", "native4-slice"]
  ).flatMap((key) =>
    [0, 1, 2].flatMap((frame) =>
      ["none", "weighted"].map((mode) => `motion-${key}-${frame}-${mode}`),
    ),
  ),
];
const jobsByKey = new Map(readableJobs.map((job) => [job.key, job]));
if (
  readableJobs.length !== expectedReadableJobKeys.length ||
  jobsByKey.size !== expectedReadableJobKeys.length ||
  expectedReadableJobKeys.some((key) => !jobsByKey.has(key))
)
  throw new Error(
    `Readable package must contain exactly the ${expectedReadableJobKeys.length} expected jobs`,
  );
const readableJobReports = [];
for (const key of expectedReadableJobKeys) {
  const job = jobsByKey.get(key);
  if (job.image?.path !== `${readableDir}/${key}.png`)
    throw new Error(`Readable job ${key} has an unexpected PNG path`);
  const summaryPath = `${readableDir}/${key}.json`;
  if (JSON.stringify(readJson(summaryPath)) !== JSON.stringify(job))
    throw new Error(`Readable job ${key} differs from its saved image summary`);
  readableJobReports.push(summaryPath);
  const counts = job.counts;
  const termination = counts?.termination;
  if (
    !Number.isInteger(job.size) ||
    job.size < 1 ||
    counts?.terminationTotal !== job.size * job.size ||
    termination?.domainComplete +
      termination?.opaque +
      termination?.noIntersection !==
      job.size * job.size ||
    counts?.unresolved !== 0 ||
    counts?.stats?.exhausted !== 0 ||
    ["unresolved", "residual", "layerCap", "sampleCap", "chunkCap"].some(
      (reason) => termination?.[reason] !== 0,
    )
  )
    throw new Error(`Readable job ${key} does not complete every ray`);
}
const jobOutputPath = (job) => job.image.path;
const jobAsset = (key) => jobOutputPath(jobsByKey.get(key));
const readableProvenanceFiles = readableReportEnvelope.sourceProvenance?.files;
if (!readableProvenanceFiles || typeof readableProvenanceFiles !== "object")
  throw new Error(`${readableReportPath} is missing sourceProvenance.files`);
const readableSourceFiles = Object.keys(readableProvenanceFiles);
for (const source of [
  "scripts/transmission-bend-fixtures.ts",
  "scripts/transmission-readable.worker.ts",
  "scripts/transmission-readable.mjs",
  "scripts/transmission-bend-tiles.harness.ts",
])
  if (!readableSourceFiles.includes(source))
    throw new Error(`Readable source provenance is missing ${source}`);
for (const [source, declaredHash] of Object.entries(readableProvenanceFiles)) {
  const actualHash = createHash("sha256")
    .update(readFileSync(reportPath(source)))
    .digest("hex");
  if (actualHash !== declaredHash)
    throw new Error(`Readable package source provenance is stale: ${source}`);
}
const sourceHash = createHash("sha256")
  .update(JSON.stringify(readableProvenanceFiles))
  .digest("hex");
if (sourceHash !== readableReportEnvelope.sourceProvenance.sourceHash)
  throw new Error(
    "Readable source hash does not match the declared file hashes",
  );
const sourceFiles = [...new Set([...baseSourceFiles, ...readableSourceFiles])];
const readableMain = Object.fromEntries(
  ["menger3", "native4"].map((scene) => [
    scene,
    Object.fromEntries(
      primaryModes.map((mode) => [mode, jobAsset(`${scene}-still-${mode}`)]),
    ),
  ]),
);
const readableAnalytic = Object.fromEntries(
  (stillsOnly ? [] : ["analytic3", "analytic4"]).map((scene) => [
    scene,
    Object.fromEntries(
      ["none", "weighted", "opaque", "rearAbsent"].map((mode) => [
        mode,
        jobAsset(
          `${scene}-control-${mode === "rearAbsent" ? "rear-absent" : mode}`,
        ),
      ]),
    ),
  ]),
);
const readableMotion = Object.fromEntries(
  (stillsOnly ? [] : ["menger-camera", "native4-rotor", "native4-slice"]).map(
    (key) => [
      key,
      [0, 1, 2].map((frame) =>
        Object.fromEntries(
          ["none", "weighted"].map((mode) => [
            mode,
            jobAsset(`motion-${key}-${frame}-${mode}`),
          ]),
        ),
      ),
    ],
  ),
);
const readableRequiredPngs = expectedReadableJobKeys.map(jobAsset);

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

const readableMissing = readableRequiredPngs.filter(
  (path, index, all) =>
    !existsSync(reportPath(path)) || all.indexOf(path) !== index,
);
if (readableMissing.length)
  throw new Error(
    `Readable package is missing required PNG inputs or contains duplicate paths:\n${readableMissing.join("\n")}`,
  );
const readableMotionPaths = Object.values(readableMotion).flatMap((frames) =>
  frames.flatMap((modes) => Object.values(modes)),
);

const mainStillPaths = Object.values(readableMain).flatMap((modes) =>
  Object.values(modes),
);
const controlStillPaths = Object.values(readableAnalytic).flatMap((modes) =>
  Object.values(modes),
);
const allStaticPngs = [
  ...stills,
  native4AnalyticControl.image,
  ...readableRequiredPngs,
];
const stillDimensions = Object.fromEntries(
  allStaticPngs.map((path) => [path, pngDimensions(path)]),
);
const motionDimensions = Object.fromEntries(
  [...dynamicMotionStills, ...readableMotionPaths].map((path) => [
    path,
    pngDimensions(path),
  ]),
);
for (const key of expectedReadableJobKeys) {
  const job = jobsByKey.get(key);
  const actual = pngDimensions(job.image.path);
  if (
    actual.width !== job.size ||
    actual.height !== job.size ||
    actual.width !== job.image.naturalSize?.width ||
    actual.height !== job.image.naturalSize?.height
  )
    throw new Error(`Readable PNG dimensions disagree with job ${key}`);
  const actualHash = createHash("sha256")
    .update(readFileSync(reportPath(job.image.path)))
    .digest("hex");
  if (actualHash !== job.image.sha256)
    throw new Error(`Readable PNG hash disagrees with job ${key}`);
}
const undersizedMainStills = mainStillPaths.filter((path) => {
  const size = stillDimensions[path];
  return Math.min(size.width, size.height) < MIN_MAIN_STILL_DIMENSION;
});
const undersizedMotionStills = readableMotionPaths.filter((path) => {
  const size = motionDimensions[path];
  return Math.min(size.width, size.height) < MIN_MOTION_STILL_DIMENSION;
});
const undersizedControlStills = controlStillPaths.filter((path) => {
  const size = stillDimensions[path];
  return Math.min(size.width, size.height) < MIN_CONTROL_STILL_DIMENSION;
});
if (undersizedMainStills.length && !allowThumbnailMain) {
  throw new Error(
    `Readable main comparison stills must be at least ${MIN_MAIN_STILL_DIMENSION}px (got: ${undersizedMainStills.join(", ")}). Regenerate high-resolution evidence or pass --allow-thumbnail-main for an explicitly diagnostic-only review.`,
  );
}
if (
  (undersizedMotionStills.length || undersizedControlStills.length) &&
  !allowThumbnailMain
)
  throw new Error(
    `Readable motion/control stills are below required viewing dimensions (motion ${MIN_MOTION_STILL_DIMENSION}px, controls ${MIN_CONTROL_STILL_DIMENSION}px): ${[...undersizedMotionStills, ...undersizedControlStills].join(", ")}. Pass --allow-thumbnail-main only for diagnostic review.`,
  );

const artifactFiles = [
  ...reports,
  ...Object.values(gpuReports),
  ...Object.values(native4AnalyticControl),
  ...stills,
  ...dynamicMotionStills,
  readableReportPath,
  ...readableJobReports,
  ...readableRequiredPngs,
];
const image = (path, alt) =>
  `<img src="${dataUri(path)}" alt="${esc(alt)}" loading="lazy">`;
const imageHref = (path) => esc(relative(out, reportPath(path)));
const sizeLabel = (path) => {
  const size = stillDimensions[path];
  return `${size.width}×${size.height}`;
};
const linkedImage = (path, alt) =>
  `<a href="${imageHref(path)}" target="_blank" rel="noreferrer">${image(path, alt)}</a>`;
const visualStatus = undersizedMainStills.length
  ? `Diagnostic thumbnail override enabled for ${undersizedMainStills.length} main stills; these images are not a viewing-resolution comparison.`
  : `Main comparison stills meet the ${MIN_MAIN_STILL_DIMENSION}px minimum dimension.`;

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

const motionData = (stillsOnly ? [] : motionGroups).map((group) => ({
  key: group.key,
  isolated: group.isolated,
  frames: group.frames.map((frame, index) => {
    const frameName = String(frame.frame ?? index);
    const readableFrames = readableMotion[group.key];
    const readableFrame = readableFrames[index];
    return {
      frame: frameName,
      pose: jobsByKey.get(`motion-${group.key}-${index}-none`).pose,
      straight: dataUri(readableFrame.none),
      weighted: dataUri(readableFrame.weighted),
      straightSize: motionDimensions[readableFrame.none],
      weightedSize: motionDimensions[readableFrame.weighted],
      straightPath: relative(out, reportPath(readableFrame.none)),
      weightedPath: relative(out, reportPath(readableFrame.weighted)),
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
const readableReportText = JSON.stringify(readableReport, null, 2);

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transmission revision review — UNREVIEWED</title>
<style>
body{margin:24px auto;max-width:1500px;padding:0 18px;background:#101216;color:#e6e9ef;font:15px system-ui,sans-serif;line-height:1.45}h1,h2{color:#fff}.status{padding:14px;border:2px solid #e7ad45;background:#2b2212}.limits{padding:14px;border:2px solid #c95b5b;background:#30191d}.hero-grid{display:grid;grid-template-columns:1fr;gap:20px;max-width:1082px}.hero-card{padding:14px;border:1px solid #59616e;background:#171a20}.hero-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.hero-figure,.secondary-figure{margin:0}.hero-figure img,.secondary-figure img{display:block;width:auto;max-width:100%;height:auto;background:#050608}.hero-figure figcaption,.secondary-figure figcaption{margin-top:7px;color:#cbd1da}.hero-card details{margin-top:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.triple{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.grid img,.pair img,.triple img{width:auto;max-width:100%;height:auto;background:#050608}.control{max-width:700px}.control img{display:block;width:auto;max-width:100%;height:auto}.card{padding:12px;border:1px solid #454b55;background:#171a20;margin:12px 0}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px 9px;border:1px solid #4b515a;text-align:left;vertical-align:top}th{background:#252a32}code{background:#222831;padding:2px 4px}a{color:#9dccff}.scrub{border:1px solid #454b55;padding:12px;margin:14px 0}.scrub-controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.scrub img{display:block;width:auto;max-width:100%;height:auto;background:#050608}.scrub-views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.scrub-views figure{margin:0}.small{color:#b8bec8;font-size:13px}.metric{font-variant-numeric:tabular-nums}@media(max-width:800px){.hero-grid{grid-template-columns:1fr}.hero-pair,.scrub-views,.grid{grid-template-columns:1fr}.hero-figure img,.secondary-figure img{width:100%}}
</style>
<h1>Layered transparency and bending</h1>
<p class="status"><strong>RESEARCH DIRECTION SELECTED · PRODUCTION UNQUALIFIED.</strong> Layered transparency, required bending and the targets below are selected. These revised images have not been approved for release.</p>
<h2>Primary appearance comparison</h2>
<p class="status">${esc(visualStatus)} Click a still to open the original PNG. Both views use the same geometry and experimental optical settings.</p>
<div class="hero-grid">
<article class="hero-card"><h3>Menger 3D</h3><div class="hero-pair"><figure class="hero-figure">${linkedImage(readableMain.menger3.none, "Menger 3D straight")}<figcaption>Straight layers · ${sizeLabel(readableMain.menger3.none)}</figcaption></figure><figure class="hero-figure">${linkedImage(readableMain.menger3.weighted, "Menger 3D weighted bend")}<figcaption>Weighted world bend · ${sizeLabel(readableMain.menger3.weighted)}</figcaption></figure></div></article>
<article class="hero-card"><h3>Native posed 4D</h3><div class="hero-pair"><figure class="hero-figure">${linkedImage(readableMain.native4.none, "native 4D straight")}<figcaption>Straight layers · ${sizeLabel(readableMain.native4.none)}</figcaption></figure><figure class="hero-figure">${linkedImage(readableMain.native4.weighted, "native 4D weighted bend")}<figcaption>Weighted world bend · ${sizeLabel(readableMain.native4.weighted)}</figcaption></figure></div></article>
</div>

${
  stillsOnly
    ? ""
    : `<h2>Secondary onset controls</h2>
<p>Hard onset applies the full shift at the first layer. The opaque view shows the geometry without transmission.</p>
<div class="grid"><figure class="secondary-figure">${linkedImage(readableMain.menger3.hard, "Menger 3D hard onset")}<figcaption>Menger 3D hard onset · ${sizeLabel(readableMain.menger3.hard)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableMain.menger3.opaque, "Menger 3D opaque control")}<figcaption>Menger 3D opaque control · ${sizeLabel(readableMain.menger3.opaque)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableMain.native4.hard, "native 4D hard onset")}<figcaption>Native 4D hard onset · ${sizeLabel(readableMain.native4.hard)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableMain.native4.opaque, "native 4D opaque control")}<figcaption>Native 4D opaque control · ${sizeLabel(readableMain.native4.opaque)}</figcaption></figure></div>
<details><summary>Independent analytic controls</summary><p>The red rear object makes changes in visibility easier to see. Compare straight and bent views, then check the opaque front and removed rear object.</p><div class="grid"><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic3.none, "analytic 3D no bend")}<figcaption>Analytic 3D · straight · ${sizeLabel(readableAnalytic.analytic3.none)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic3.weighted, "analytic 3D weighted")}<figcaption>Analytic 3D · weighted · ${sizeLabel(readableAnalytic.analytic3.weighted)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic3.opaque, "analytic 3D opaque")}<figcaption>Analytic 3D · opaque · ${sizeLabel(readableAnalytic.analytic3.opaque)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic3.rearAbsent, "analytic 3D rear absent")}<figcaption>Analytic 3D · rear absent · ${sizeLabel(readableAnalytic.analytic3.rearAbsent)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic4.none, "analytic 4D no bend")}<figcaption>Analytic 4D · straight · ${sizeLabel(readableAnalytic.analytic4.none)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic4.weighted, "analytic 4D weighted")}<figcaption>Analytic 4D · weighted · ${sizeLabel(readableAnalytic.analytic4.weighted)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic4.opaque, "analytic 4D opaque")}<figcaption>Analytic 4D · opaque · ${sizeLabel(readableAnalytic.analytic4.opaque)}</figcaption></figure><figure class="secondary-figure">${linkedImage(readableAnalytic.analytic4.rearAbsent, "analytic 4D rear absent")}<figcaption>Analytic 4D · rear absent · ${sizeLabel(readableAnalytic.analytic4.rearAbsent)}</figcaption></figure></div></details>
`
}
<details><summary>Readable package metadata and raw report</summary><p class="small">Primary stills, motion pairs and analytic controls are loaded from <code>${esc(readableReportPath)}</code>. The report is embedded verbatim below; generated dimensions are checked before this page is written.</p><pre class="small">${esc(readableReportText)}</pre></details>

${
  stillsOnly
    ? '<p>The larger motion and secondary CPU batch was stopped. These four full-size reference stills are the current appearance comparison; GPU image generation is being investigated separately.</p><div id="scrubbers"></div>'
    : `<h2>Three-frame motion scrubber</h2>
<p>Drag a slider or use the arrow keys to compare three nearby views. Each sequence changes only the camera, 4D rotation or 4D slice. Click a frame to open its original PNG.</p>
<div id="scrubbers"></div>

`
}
<details class="numeric"><summary>Earlier diagnostic images and numerical controls</summary>
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

<table><thead><tr><th>fixture</th><th>size</th><th>straight/weighted delta</th><th>weighted/hard delta</th></tr></thead><tbody>${pilotTable}</tbody></table>
<p class="small">${link(reports[3], "bend pilot report")}</p>
</details>
<details class="numeric"><summary>Performance targets, GPU evidence and remaining limitations</summary>
<div class="limits"><strong>Measured limits and scope:</strong> phase sensitivity remains in the sampled field; estimator noise adds positive variation; the bend is an artistic zero-thickness world-ray mapping; no production qualification is claimed; the GPU pilot measures continuation and scalar transport only and excludes bending, normals, Fresnel, shading and compositing.</div>

<h2>Owner target envelope</h2>
<p>Targets carried into this review are <strong>1 s at 256×144</strong>, <strong>10 s at 512×288</strong>, <strong>120 s at 1920×1080</strong>, and <strong>128 MiB additional state</strong>. They are target constraints, not measurements. GPU rows below report only fields present in the resumable pilot.</p>


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
</details>

<h2>Provenance</h2>
<p>Revision, scoped source-tree status, source hashes and artifact hashes are in ${link(relative(root, manifestPath), "the review manifest")}. The previous review remains available as ${link("scripts/out/transmission-review.html", "the prior review")}; this revision preserves it rather than replacing its verdict.</p>
<p class="small">Generated offline from existing JSON and PNG artifacts. No browser, GPU or renderer was run by this review script.</p>
<script>
const motion=${scriptJson(motionData)};
const host=document.querySelector('#scrubbers');
for(const group of motion){
  const section=document.createElement('section'); section.className='scrub card';
  section.innerHTML='<h3>'+group.key+'</h3><p class="small">isolated control: '+String(group.isolated??'—')+'</p><div class="scrub-controls"><label>frame <input type="range" min="0" max="'+(group.frames.length-1)+'" value="0"></label><output></output></div><div class="scrub-views"><figure><a target="_blank" rel="noreferrer"><img alt="straight frame"></a><figcaption></figcaption></figure><figure><a target="_blank" rel="noreferrer"><img alt="weighted frame"></a><figcaption></figcaption></figure></div><pre class="small"></pre>';
  const range=section.querySelector('input'), output=section.querySelector('output'), imgs=section.querySelectorAll('img'), links=section.querySelectorAll('.scrub-views a'), captions=section.querySelectorAll('figcaption'), pre=section.querySelector('pre');
  const draw=()=>{const frame=group.frames[Number(range.value)]; output.textContent=String(frame.frame); imgs[0].src=frame.straight; imgs[1].src=frame.weighted; links[0].href=frame.straightPath; links[1].href=frame.weightedPath; captions[0].textContent='Straight layers · '+frame.straightSize.width+'×'+frame.straightSize.height; captions[1].textContent='Weighted world bend · '+frame.weightedSize.width+'×'+frame.weightedSize.height; pre.textContent=JSON.stringify({pose:frame.pose},null,2)};
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
      visualReview: {
        minimumMainStillDimension: MIN_MAIN_STILL_DIMENSION,
        minimumMotionStillDimension: MIN_MOTION_STILL_DIMENSION,
        minimumControlStillDimension: MIN_CONTROL_STILL_DIMENSION,
        undersizedMainStills,
        undersizedMotionStills,
        undersizedControlStills,
        thumbnailOverride: allowThumbnailMain,
        primaryPackage: readableReportPath,
        primaryScenes: ["menger3", "native4"],
        primaryModes,
        stillsOnly,
        analyticControls: stillsOnly ? [] : ["analytic3", "analytic4"],
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
