#!/usr/bin/env node
/**
 * Offline visual review for the finite-cell dielectric experiment.
 *
 * This builder never renders. It accepts only an explicitly named, full-size
 * report whose source and PNG hashes still match the files on disk. Diagnostic
 * and calibration reports are deliberately refused so they cannot replace the
 * main review page.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const outputDir = join(root, "scripts/out");
const outputPath = join(outputDir, "transmission-dielectric-review.html");
const manifestPath = join(
  outputDir,
  "transmission-dielectric-review-manifest.json",
);
const builderPath = resolve(root, "scripts/transmission-dielectric-review.mjs");
const defaultReport =
  "scripts/out/transmission-dielectric-gpu/actual-1024x1024-all.json";
const ownerRecordPath = resolve(
  root,
  "scripts/transmission-dielectric-appearance-review.json",
);
const RESIDUAL_BOUND_BUDGET = 1 / 1024;
const reportArgument = process.argv.find((arg) => arg.startsWith("--report="));
const reportPath = reportArgument
  ? resolve(root, reportArgument.slice("--report=".length))
  : resolve(root, defaultReport);

const forbiddenReportName = /(diagnostic|smoke|calibration|pilot)/i;
if (forbiddenReportName.test(reportPath))
  throw new Error(
    `refusing diagnostic/calibration input as the main report: ${reportPath}`,
  );

const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const ownerRecord = readJson(ownerRecordPath);
if (
  ownerRecord?.status !== "OWNER_SELECTED_RESEARCH_APPEARANCE" ||
  typeof ownerRecord.owner !== "string" ||
  ownerRecord.owner.length === 0 ||
  !/^\d{4}-\d{2}-\d{2}$/.test(ownerRecord.date ?? "") ||
  typeof ownerRecord.quote !== "string" ||
  ownerRecord.quote.length === 0 ||
  ownerRecord.physicalRealismRequired !== false ||
  ownerRecord.productionApproved !== false ||
  !Array.isArray(ownerRecord.appearanceScope) ||
  ownerRecord.appearanceScope.length < 2 ||
  !ownerRecord.appearanceScope.some(
    (value) => typeof value === "string" && /finite.*3D.*Menger/i.test(value),
  ) ||
  !ownerRecord.appearanceScope.some(
    (value) =>
      typeof value === "string" &&
      /posed.*native.*4D.*hyper.?Menger/i.test(value),
  ) ||
  !/^[0-9a-f]{64}$/i.test(ownerRecord.sourceHash ?? "") ||
  !ownerRecord.mainPngSha256 ||
  Object.keys(ownerRecord.mainPngSha256).sort().join(",") !==
    "hyperMenger2,menger2" ||
  !Object.values(ownerRecord.mainPngSha256).every((value) =>
    /^[0-9a-f]{64}$/i.test(value),
  )
)
  throw new Error(
    `${ownerRecordPath} has an invalid owner-selection record schema`,
  );
const ownerSourceHash = ownerRecord.sourceHash;
const ownerMainPngHashes = Object.freeze(ownerRecord.mainPngSha256);
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const fmt = (value, digits = 3) =>
  finite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : value === undefined || value === null
      ? "—"
      : String(value);
const recordedPath = (value, label) => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} is missing an artifact path`);
  const file = resolve(root, value);
  if (!file.startsWith(`${root}/`) && file !== root)
    throw new Error(`${label} escapes the repository: ${value}`);
  return file;
};
const hrefFor = (file) => {
  const value = relative(outputDir, file).replaceAll("\\", "/");
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
};
const jsonText = (value) => JSON.stringify(value, null, 2);

function pngDimensions(file) {
  const data = readFileSync(file);
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error(`not a PNG: ${file}`);
  if (data.readUInt32BE(12) !== 0x49484452)
    throw new Error(`PNG has no IHDR: ${file}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function validateSourceProvenance(provenance, label) {
  if (!provenance || typeof provenance.files !== "object")
    throw new Error(`${label} is missing sourceProvenance.files`);
  const mismatches = [];
  for (const [name, expected] of Object.entries(provenance.files)) {
    const file = recordedPath(name, `${label} source ${name}`);
    if (!existsSync(file)) {
      mismatches.push(`${name}: missing`);
      continue;
    }
    if (hash(readFileSync(file)) !== expected)
      mismatches.push(`${name}: SHA-256 mismatch`);
  }
  if (mismatches.length)
    throw new Error(
      `${label} source provenance is stale:\n${mismatches.join("\n")}`,
    );
  if (typeof provenance.sourceHash !== "string")
    throw new Error(`${label} is missing sourceProvenance.sourceHash`);
  if (hash(JSON.stringify(provenance.files)) !== provenance.sourceHash)
    throw new Error(`${label} sourceHash does not match source file hashes`);
  return provenance;
}

function validateRunEnvironment(envelope, body) {
  const quiet = envelope.quiet ?? body.quiet;
  if (!quiet || quiet.contended !== false || quiet.unknownReason !== null)
    throw new Error(
      "GPU report must certify a quiet run with contended=false and unknownReason=null",
    );
  const renderer = envelope.renderer;
  if (
    typeof renderer !== "string" ||
    renderer.length === 0 ||
    /swiftshader|llvmpipe|software/i.test(renderer)
  )
    throw new Error("GPU report must identify a real non-software renderer");
  const adapter = body.browserAdapter ?? envelope.browserAdapter;
  if (!adapter || adapter.isFallbackAdapter !== false)
    throw new Error(
      "GPU report must certify browserAdapter.isFallbackAdapter=false",
    );
  const adapterText = [
    adapter.vendor,
    adapter.architecture,
    adapter.device,
    adapter.description,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  if (/swiftshader|llvmpipe|software/i.test(adapterText))
    throw new Error("GPU report browser adapter is software or fallback");
  return { quiet, renderer, adapter };
}

function validateMemory(row, key) {
  const memory = row.memory;
  if (!memory || typeof memory !== "object")
    throw new Error(`${key} is missing memory accounting`);
  if (
    !finite(memory.limitBytes) ||
    memory.limitBytes !== 128 * 1024 * 1024 ||
    !finite(memory.knownCrossProcessBytes) ||
    memory.knownCrossProcessBytes < 0 ||
    memory.knownCrossProcessBytes > memory.limitBytes ||
    memory.crossProcessLimitCheck !== true
  )
    throw new Error(
      `${key} must certify knownCrossProcessBytes <= 128 MiB with crossProcessLimitCheck=true`,
    );
  return memory;
}

function scanCaps(value, pathName = "completion", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathName}.${key}`;
    if (/cap/i.test(key)) {
      if (finite(child) && child !== 0) found.push(`${childPath}=${child}`);
      else if (child === true) found.push(`${childPath}=true`);
      else if (child && typeof child === "object")
        scanCaps(child, childPath, found);
    } else if (child && typeof child === "object") {
      scanCaps(child, childPath, found);
    }
  }
  return found;
}

function validateCompletion(row, total, key) {
  const completion = row.completion;
  if (!completion || typeof completion !== "object")
    throw new Error(`${key} is missing completion`);
  for (const field of ["total", "complete", "unresolved", "invalid"]) {
    if (!Number.isInteger(completion[field]) || completion[field] < 0)
      throw new Error(`${key} completion.${field} is missing or invalid`);
  }
  if (
    completion.total !== total ||
    completion.complete !== total ||
    completion.unresolved !== 0 ||
    completion.invalid !== 0
  )
    throw new Error(
      `${key} has incomplete or invalid rays: ${jsonText(completion)}`,
    );
  const samplesPerPixel = row.samplesPerPixel;
  if (!Number.isInteger(samplesPerPixel) || samplesPerPixel <= 0)
    throw new Error(`${key} must declare a positive integer samplesPerPixel`);
  const sampleTotal = completion.sampleTotal;
  const sampleComplete = completion.sampleComplete;
  const sampleUnresolved = completion.sampleUnresolved;
  const sampleInvalid = completion.sampleInvalid;
  if (
    !Number.isInteger(sampleTotal) ||
    sampleTotal !== total * samplesPerPixel ||
    !Number.isInteger(sampleComplete) ||
    sampleComplete !== sampleTotal ||
    !Number.isInteger(sampleUnresolved) ||
    sampleUnresolved !== 0 ||
    !Number.isInteger(sampleInvalid) ||
    sampleInvalid !== 0
  )
    throw new Error(
      `${key} has incomplete or invalid per-sample completion: ${jsonText({ samplesPerPixel, sampleTotal, sampleComplete, sampleUnresolved, sampleInvalid })}`,
    );
  const caps = scanCaps(completion);
  if (caps.length)
    throw new Error(`${key} has unresolved caps: ${caps.join(", ")}`);

  const residual = row.residual;
  if (!residual || typeof residual !== "object")
    throw new Error(`${key} residual metadata is missing`);
  for (const field of ["radianceBound", "errorBudget"]) {
    if (!finite(residual[field]) || residual[field] < 0)
      throw new Error(
        `${key} residual.${field} is missing, negative or non-finite`,
      );
  }
  if (
    "totalRadianceBound" in residual &&
    (!finite(residual.totalRadianceBound) || residual.totalRadianceBound < 0)
  )
    throw new Error(
      `${key} residual.totalRadianceBound is negative or non-finite`,
    );
  const replay = residual.replay;
  if (!replay || typeof replay !== "object")
    throw new Error(
      `${key} residual.replay must declare the per-pixel linearRGB replay bound`,
    );
  if (
    !finite(replay.maxPerPixelMaxChannelLinearRgbBound) ||
    replay.maxPerPixelMaxChannelLinearRgbBound < 0 ||
    replay.maxPerPixelMaxChannelLinearRgbBound > RESIDUAL_BOUND_BUDGET
  )
    throw new Error(
      `${key} residual.replay.maxPerPixelMaxChannelLinearRgbBound must be finite and <= 1/1024`,
    );
  if (replay.allSamplesComplete !== true || replay.capFree !== true)
    throw new Error(
      `${key} residual.replay must certify allSamplesComplete=true and capFree=true`,
    );
  for (const [field, expected] of [
    ["sampleTotal", sampleTotal],
    ["sampleComplete", sampleComplete],
    ["sampleUnresolved", sampleUnresolved],
    ["sampleInvalid", sampleInvalid],
    ["unresolvedPixels", completion.unresolved],
    ["invalidPixels", completion.invalid],
    ["capEvents", completion.capEvents ?? 0],
  ]) {
    if (replay[field] !== expected)
      throw new Error(
        `${key} residual.replay.${field} disagrees with completion`,
      );
  }
  if (residual.radianceBound !== replay.maxPerPixelMaxChannelLinearRgbBound)
    throw new Error(
      `${key} residual.radianceBound disagrees with the replay per-pixel bound`,
    );
  if (residual.errorBudget !== RESIDUAL_BOUND_BUDGET)
    throw new Error(`${key} residual.errorBudget must equal 1/1024`);
  const bounded =
    finite(residual.radianceBound) &&
    residual.radianceBound >= 0 &&
    finite(residual.errorBudget) &&
    residual.errorBudget >= 0 &&
    residual.radianceBound <= residual.errorBudget;
  return {
    exact: replay.maxPerPixelMaxChannelLinearRgbBound === 0,
    bounded,
    samplesPerPixel,
    sampleTotal,
    sampleComplete,
    residual: residual ?? null,
    replay,
  };
}

function validateImage(image, key, minSize) {
  if (!image || typeof image !== "object")
    throw new Error(`${key} is missing image metadata`);
  if (typeof image.path !== "string" || !/^[0-9a-f]{64}$/i.test(image.sha256))
    throw new Error(`${key} image path or SHA-256 is invalid`);
  const file = recordedPath(image.path, `${key} image`);
  if (!existsSync(file))
    throw new Error(`${key} image is missing: ${image.path}`);
  const actualHash = hash(readFileSync(file));
  if (actualHash !== image.sha256)
    throw new Error(`${key} image SHA-256 mismatch`);
  const actualSize = pngDimensions(file);
  if (
    actualSize.width !== image.naturalSize?.width ||
    actualSize.height !== image.naturalSize?.height
  )
    throw new Error(`${key} PNG IHDR differs from image.naturalSize`);
  if (actualSize.width < minSize || actualSize.height < minSize)
    throw new Error(`${key} image is below the ${minSize}px minimum`);
  return { file, size: actualSize };
}

function sceneMetadata(row, key) {
  const scene = row.scene ?? row.geometry ?? {};
  const dimension = scene.dimension ?? row.dimension;
  const depth = scene.depth ?? scene.iterations ?? row.depth;
  const construction = scene.construction ?? scene.family ?? row.construction;
  if (!Number.isInteger(dimension) || !Number.isInteger(depth))
    throw new Error(
      `${key} must declare integer scene dimension and finite depth`,
    );
  if (typeof construction !== "string" || construction.length === 0)
    throw new Error(`${key} must declare its geometry construction`);
  return { dimension, depth, construction };
}

function sceneKind(metadata, key) {
  const construction = metadata.construction.toLowerCase();
  if (
    metadata.dimension === 3 &&
    metadata.depth === 2 &&
    /menger/.test(construction)
  )
    return "menger2";
  if (
    metadata.dimension === 4 &&
    metadata.depth === 2 &&
    /hyper.?menger/.test(construction)
  )
    return "hyperMenger2";
  throw new Error(
    `${key} is not one of the required finite depth-2 Menger or new 4D hyper-Menger scenes; finer depth-3 full-tree renders remain unqualified and are not actual full-raster timings`,
  );
}

const envelope = readJson(reportPath);
const body = envelope.report ?? envelope;
const rows = Array.isArray(body.rows) ? body.rows : [];
if (!rows.length) throw new Error(`${reportPath} contains no rows`);
const provenance = validateSourceProvenance(
  envelope.sourceProvenance ?? body.sourceProvenance,
  "GPU report",
);
if (
  envelope.verdict?.status !== undefined &&
  envelope.verdict.status !== "RECORDED"
)
  throw new Error(`GPU report is ${envelope.verdict.status}`);
if (
  body.cancellationProbe?.requested === true &&
  body.cancellationProbe.passed !== true
)
  throw new Error("GPU report requested cancellation qualification but failed");
if (
  body.tileInvariant?.requested === true &&
  body.tileInvariant.passed !== true
)
  throw new Error("GPU report requested tile/window qualification but failed");
if (body.poseCheck?.requested === true && body.poseCheck.passed !== true)
  throw new Error("GPU report requested pose qualification but failed");
const environment = validateRunEnvironment(envelope, body);
const gpuControls = envelope.controls ?? body.controls;
if (
  !gpuControls ||
  gpuControls.passed !== true ||
  !Array.isArray(gpuControls.cases) ||
  gpuControls.cases.length === 0 ||
  !gpuControls.cases.every((entry) => entry?.passed === true) ||
  !Array.isArray(gpuControls.failures) ||
  gpuControls.failures.length !== 0
)
  throw new Error(
    "GPU report must include controls.passed=true with non-empty cases and no failures",
  );

const mainRows = rows.filter((row) => row.role === "main");
if (mainRows.length !== 2)
  throw new Error(
    `GPU report must mark exactly two role=main rows; found ${mainRows.length}`,
  );

const validated = [];
for (const row of mainRows) {
  const key = String(row.key ?? row.id ?? row.fixture ?? "main");
  if (row.mode !== "glass")
    throw new Error(`${key} main row must declare mode=glass`);
  const metadata = sceneMetadata(row, key);
  const kind = sceneKind(metadata, key);
  if (validated.some((item) => item.kind === kind))
    throw new Error(`duplicate main scene kind: ${kind}`);
  const width = row.width ?? row.image?.naturalSize?.width;
  const height = row.height ?? row.image?.naturalSize?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error(`${key} is missing integer render dimensions`);
  const total = width * height;
  validateMemory(row, key);
  const completion = validateCompletion(row, total, key);
  const image = validateImage(row.image, key, 1024);
  if (image.size.width !== width || image.size.height !== height)
    throw new Error(`${key} image dimensions disagree with row dimensions`);
  if (row.sourceHash && row.sourceHash !== provenance.sourceHash)
    throw new Error(`${key} sourceHash differs from the report sourceHash`);
  validated.push({ key, row, metadata, kind, completion, image });
}
if (!validated.some((item) => item.kind === "menger2"))
  throw new Error("missing finite depth-2 Menger 3D main row");
if (!validated.some((item) => item.kind === "hyperMenger2"))
  throw new Error("missing finite depth-2 posed hyper-Menger 4D main row");

function matchesOwnerSelection() {
  if (ownerRecord.sourceHash !== provenance.sourceHash) return false;
  for (const item of validated) {
    if (item.row.image.sha256 !== ownerMainPngHashes[item.kind]) return false;
  }
  return validated.length === Object.keys(ownerMainPngHashes).length;
}

const ownerSelectionApproved = matchesOwnerSelection();

const controls = rows
  .filter((row) => row.role === "opaque-control")
  .map((row) => {
    const key = String(row.key ?? row.id ?? row.fixture ?? "opaque-control");
    const metadata = sceneMetadata(row, key);
    const kind = sceneKind(metadata, key);
    if (row.mode !== "opaque")
      throw new Error(`${key} control row must declare mode=opaque`);
    const image = validateImage(row.image, key, 1024);
    const width = row.width ?? image.size.width;
    const height = row.height ?? image.size.height;
    if (width !== image.size.width || height !== image.size.height)
      throw new Error(`${key} control image dimensions disagree with row`);
    if (row.sourceHash && row.sourceHash !== provenance.sourceHash)
      throw new Error(`${key} sourceHash differs from the report sourceHash`);
    validateMemory(row, key);
    const completion = validateCompletion(row, width * height, key);
    return { key, row, metadata, kind, image, completion };
  });
if (controls.length !== 2)
  throw new Error(
    `GPU report must provide exactly two opaque controls, one per main scene; found ${controls.length}`,
  );
if (new Set(controls.map((control) => control.kind)).size !== 2)
  throw new Error("GPU opaque controls must cover both required scene kinds");
for (const control of controls) {
  const main = validated.find((item) => item.kind === control.kind);
  if (
    !main ||
    main.image.size.width !== control.image.size.width ||
    main.image.size.height !== control.image.size.height
  )
    throw new Error(
      `${control.key} opaque control must match its main scene dimensions`,
    );
}

const oldReview = join(outputDir, "transmission-revision-review.html");
const oldReviewHref = existsSync(oldReview) ? hrefFor(oldReview) : "";
const sceneTitle = {
  menger2: "Menger 3D — finite depth 2 · terminal grid 1/9 · 400 filled cells",
  hyperMenger2:
    "Posed hyper-Menger 4D — new construction, finite depth 2 · terminal grid 1/9 · 2304 filled cells (not public Mandelbox or Tesseract)",
};
const details = (item) => {
  const row = item.row;
  return `<details><summary>Timing, memory, completion and mathematical scope</summary><dl><dt>Completion</dt><dd>${esc(jsonText(row.completion))}</dd><dt>Residual</dt><dd>${esc(jsonText(row.residual ?? null))}</dd><dt>Timing</dt><dd>${esc(jsonText(row.timing ?? null))}</dd><dt>Memory</dt><dd>${esc(jsonText(row.memory ?? row.buffers ?? null))}</dd><dt>Math</dt><dd>${esc(jsonText(row.math ?? { dimension: item.metadata.dimension, depth: item.metadata.depth, construction: item.metadata.construction }))}</dd></dl><p class="small">Artifact: <a href="${hrefFor(item.image.file)}" target="_blank" rel="noreferrer">open original PNG</a>. Source hash: <code>${esc(provenance.sourceHash)}</code>.</p></details>`;
};
const mainCards = validated
  .map(
    (item) =>
      `<article class="scene"><h2>${esc(sceneTitle[item.kind])}</h2><p class="tag">New finite-solid dielectric experiment · ${item.completion.exact ? "exact ray/sample completion" : "bounded residual completion"}</p><a class="main-image" href="${hrefFor(item.image.file)}" target="_blank" rel="noreferrer"><img src="${hrefFor(item.image.file)}" width="${item.image.size.width}" height="${item.image.size.height}" alt="${esc(sceneTitle[item.kind])} dielectric render"></a><p class="caption">${fmt(item.image.size.width, 0)}×${fmt(item.image.size.height, 0)} natural PNG · click to open the original.</p>${details(item)}</article>`,
  )
  .join("\n");
const controlHtml = controls.length
  ? `<section><h2>Optional opaque geometry controls</h2><div class="controls">${controls
      .map(
        (control) =>
          `<details><summary>${esc(control.key)} · same-camera opaque control</summary><a href="${hrefFor(control.image.file)}" target="_blank" rel="noreferrer"><img src="${hrefFor(control.image.file)}" width="${control.image.size.width}" height="${control.image.size.height}" alt="${esc(control.key)} opaque geometry control"></a><p class="caption">${fmt(control.image.size.width, 0)}×${fmt(control.image.size.height, 0)} natural PNG · open original</p></details>`,
      )
      .join("\n")}</div></section>`
  : '<p class="small">No opaque controls were supplied in this report.</p>';

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
const reportVerdict = envelope.verdict ?? body.verdict ?? "not recorded";
const pageTitle = ownerSelectionApproved
  ? "Finite dielectric experiment — owner-selected, unqualified"
  : "Finite dielectric experiment — unreviewed";
const pageStatus = ownerSelectionApproved
  ? "OWNER-SELECTED RESEARCH APPEARANCE — UNQUALIFIED"
  : "UNREVIEWED NEW EXPERIMENT";
const statusDescription = ownerSelectionApproved
  ? "It records an owner appearance selection only and makes no production, performance or feasibility approval claim."
  : "It is visual evidence only and makes no production, performance or aesthetic approval claim.";
const ownerDecisionHtml = ownerSelectionApproved
  ? `<p class="decision"><strong>Owner appearance decision:</strong> ${esc(ownerRecord.owner)} selected this finite 3D and posed native 4D appearance on ${esc(ownerRecord.date)}: “${esc(ownerRecord.quote)}” Physical realism is not required for this selection; production approval remains absent.</p>`
  : "";
const html = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<style>
body{margin:24px auto;max-width:1160px;padding:0 18px;background:#101216;color:#e7eaf0;font:15px system-ui,sans-serif;line-height:1.45}h1,h2{color:#fff}.status{padding:16px;border:2px solid #d79a3c;background:#2b2112}.warning{padding:12px;border:1px solid #b95656;background:#30181c}.scenes{display:grid;grid-template-columns:minmax(0,1fr);gap:24px}.scene{min-width:0;padding:16px;border:1px solid #555d69;background:#171a20}.main-image{display:block;min-width:0}.main-image img{display:block;width:100%;height:auto;max-width:1024px;background:#050608}.tag,.caption,.small{color:#b8bec8;font-size:13px}.tag{color:#f0c276}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.controls details{min-width:0;padding:10px;border:1px solid #454b55;background:#171a20}.controls img{display:block;width:100%;height:auto;max-width:1024px}a{color:#9dccff}code,pre{overflow-wrap:anywhere;word-break:break-word}pre{white-space:pre-wrap;max-width:100%;box-sizing:border-box;overflow-x:hidden}dl{display:grid;grid-template-columns:120px minmax(0,1fr);gap:6px 12px}dt{font-weight:700}dd{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:800px){body{margin:14px auto;padding:0 12px}.scenes,.controls{grid-template-columns:1fr}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}}
</style>
<h1>Finite-cell dielectric experiment</h1>
<p class="status"><strong>${pageStatus}.</strong> This page contains one full-size dielectric image for each scene. ${statusDescription}</p>
${ownerDecisionHtml}
<p class="warning"><strong>Geometry scope:</strong> this candidate uses coarse finite depth-2 solids: the 3D Menger has terminal grid 1/9 with 400 filled cells, and the new posed 4D hyper-Menger has terminal grid 1/9 with 2304 filled cells. Finer depth-3 full-tree geometry remains unqualified here and was not timed as an actual full raster. The 4D scene is not the public Mandelbox or Tesseract fixture. See the <a href="../../docs/surface-dielectric-study.md">numeric and finite-geometry limits</a>. The previous layered transmission candidate was rejected for being indistinct/noisy; <a href="${oldReviewHref || "#"}">open the earlier rejected review</a>.</p>
<section class="scenes">${mainCards}</section>
${controlHtml}
<details><summary>Report and provenance</summary><p>Input report: <code>${esc(relative(root, reportPath))}</code><br>Recorded verdict: <code>${esc(jsonText(reportVerdict))}</code><br>Renderer: <code>${esc(environment.renderer)}</code><br>Quiet certified: <strong>yes</strong><br>Source tree dirty in the review scope: <strong>${sourceStatus !== ""}</strong>. Source files, PNG SHA-256 hashes, memory allocation plans, and the page-emitted GPU controls were checked before writing this page.</p><pre class="small">${esc(jsonText({ sourceHash: provenance.sourceHash, sourceFiles: Object.keys(provenance.files).sort(), report: relative(root, reportPath), environment, ownerSelection: { approved: ownerSelectionApproved, record: relative(root, ownerRecordPath), sourceHash: ownerRecord.sourceHash, mainPngSha256: ownerRecord.mainPngSha256 }, gpuControls: { passed: gpuControls.passed, count: gpuControls.cases.length, failures: gpuControls.failures ?? [] }, mainRows: validated.map((item) => ({ key: item.key, kind: item.kind, image: item.row.image, completion: item.row.completion, residual: item.row.residual ?? null, memory: item.row.memory })), controls: controls.map((item) => item.key) }))}</pre></details>
<p class="small">Generated offline by <code>transmission-dielectric-review.mjs</code>; no renderer or browser run was started by this builder.</p>`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, html);
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const artifactEntry = (file) => ({
  path: relative(root, file),
  bytes: readFileSync(file).length,
  sha256: hash(readFileSync(file)),
});
writeFileSync(
  manifestPath,
  `${jsonText(
    {
      status: ownerSelectionApproved
        ? "OWNER_SELECTED_RESEARCH_APPEARANCE_UNQUALIFIED"
        : "UNREVIEWED",
      verdict: ownerSelectionApproved
        ? "owner-selected appearance; no production, feasibility or performance-target approval"
        : "visual experiment only; no production approval or performance-target claim",
      generatedAt: new Date().toISOString(),
      repositoryRevision: revision,
      builder: artifactEntry(builderPath),
      report: artifactEntry(reportPath),
      sourceTreeClean: sourceStatus === "",
      scopedSourceStatus: sourceStatus,
      sourceProvenance: provenance,
      environment,
      ownerSelection: {
        approved: ownerSelectionApproved,
        record: artifactEntry(ownerRecordPath),
        recordData: ownerRecord,
        expectedSourceHash: ownerSourceHash,
        expectedMainPngSha256: ownerMainPngHashes,
      },
      gpuControls,
      requiredMainKinds: ["menger2", "hyperMenger2"],
      mainRows: validated.map((item) => ({
        key: item.key,
        kind: item.kind,
        dimension: item.metadata.dimension,
        depth: item.metadata.depth,
        construction: item.metadata.construction,
        image: artifactEntry(item.image.file),
        imageNaturalSize: item.image.size,
        completion: item.completion,
      })),
      opaqueControls: controls.map((item) => ({
        key: item.key,
        kind: item.kind,
        image: artifactEntry(item.image.file),
        imageNaturalSize: item.image.size,
        completion: item.completion,
      })),
      oldLayeredReview: existsSync(oldReview)
        ? relative(root, oldReview)
        : null,
    },
    null,
    2,
  )}\n`,
);
console.log(relative(root, outputPath));
console.log(relative(root, manifestPath));
