#!/usr/bin/env node
/** Assemble existing transmission evidence into one offline, hash-pinned review. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "scripts/out");
const reviewPath = join(out, "transmission-review.html");
const manifestPath = join(out, "transmission-review-manifest.json");
const worldNames = [
  "menger-3d",
  "mandelbox-3d",
  "pentatope-4d",
  "tesseract-4d",
  "16-cell-flake-4d",
  "mandelbox-4d",
];
const sources = [
  "docs/surface-transmission.md",
  "docs/surface-transmission-feasibility.md",
  "scripts/de-preview.ts",
  "scripts/finish-transmission.harness.ts",
  "scripts/transmission-study.ts",
  "scripts/transmission-gap.harness.ts",
  "scripts/transmission-gpu-contract.harness.ts",
  "scripts/transmission-invariant.harness.ts",
  "scripts/transmission-motion.harness.ts",
  "scripts/transmission-proxy.ts",
  "scripts/transmission-proxy-render.ts",
  "scripts/transmission-proxy.harness.ts",
  "scripts/transmission-proxy-visual.harness.ts",
  "scripts/transmission-gpu-contract.ts",
  "scripts/transmission-gpu-pilot.mjs",
  "scripts/transmission-gpu-pilot.page.ts",
  "scripts/transmission-review.mjs",
];
const artifacts = [
  "scripts/out/transmission-comparison.png",
  "scripts/out/transmission-report.json",
  "scripts/out/transmission-world-comparison.png",
  "scripts/out/transmission-world-report.json",
  "scripts/out/transmission-finite-comparison.png",
  "scripts/out/transmission-finite-report.json",
  "scripts/out/transmission-motion/index.html",
  "scripts/out/transmission-motion/report.json",
  "scripts/out/transmission-gpu-pilot/report.json",
  ...worldNames.flatMap((name) => [
    `scripts/out/transmission-world-${name}-straight.png`,
    `scripts/out/transmission-world-${name}-warped.png`,
  ]),
];
const motion = JSON.parse(
  readFileSync(join(out, "transmission-motion/report.json"), "utf8"),
);
for (const sequence of motion.sequences)
  for (const frame of sequence.frames)
    artifacts.push(
      `scripts/out/transmission-motion/${frame.straightFile}`,
      `scripts/out/transmission-motion/${frame.warpedFile}`,
    );
const missing = [...sources, ...artifacts].filter(
  (path) => !existsSync(join(root, path)),
);
if (missing.length)
  throw new Error(`Missing review inputs:\n${missing.join("\n")}`);

const legacy = JSON.parse(
  readFileSync(join(out, "transmission-report.json"), "utf8"),
);
const worldReport = JSON.parse(
  readFileSync(join(out, "transmission-world-report.json"), "utf8"),
);
const world = worldReport.filter((row) => row.mode === "WORLD BANDS");
const finite = JSON.parse(
  readFileSync(join(out, "transmission-finite-report.json"), "utf8"),
);
const sizes = (rows) =>
  [...new Set(rows.map((row) => row.size).filter(Number.isFinite))].join("/");
const scale = worldReport.find(
  (row) => row.matchedResolution,
)?.matchedResolution;
if (!scale) throw new Error("World report lacks matched-resolution evidence");
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const link = (path, label = basename(path)) =>
  `<a href="${esc(relative(out, join(root, path)))}">${esc(label)}</a>`;
const cards = worldNames
  .map(
    (name) => `<article><h3>${esc(name)}</h3><div class="pair">
      <figure><img src="transmission-world-${name}-straight.png"><figcaption>World bands</figcaption></figure>
      <figure><img src="transmission-world-${name}-warped.png"><figcaption>World bands + slab warp</figcaption></figure>
    </div></article>`,
  )
  .join("");
const rows = world
  .map(
    (row) =>
      `<tr><td>${esc(row.fixture)}</td><td>${esc(row.size)}</td><td>${(
        100 * row.coverage
      ).toFixed(1)}%</td><td>${esc(row.unresolved)}</td><td>${esc(
        row.warpFallbacks,
      )}</td></tr>`,
  )
  .join("");
const html = `<!doctype html><meta charset="utf-8"><title>Surface transmission review — UNREVIEWED</title>
<style>body{margin:24px auto;max-width:1500px;background:#101216;color:#e4e7ec;font:15px system-ui;line-height:1.45}h1,h2{color:#fff}.status{padding:14px;border:2px solid #e7ad45;background:#2b2212}.sheet{max-width:100%;height:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair img{width:100%;image-rendering:auto}figure{margin:0}article{margin:24px 0}table{border-collapse:collapse}th,td{padding:6px 12px;border:1px solid #555;text-align:left}iframe{width:100%;height:760px;border:1px solid #555}a{color:#8dc7ff}code{background:#222;padding:2px 4px}</style>
<h1>Surface transmission evidence review</h1><p class="status"><strong>UNREVIEWED.</strong> Direct generic integration is a no-go. This page records no owner approval and selects no production defaults or cosmetic score.</p>
<h2>Legacy pixel-scale study — ${esc(sizes(legacy))} px</h2><p>Six columns per fixture: opaque; current gamma-space fade 0.35; current fade 0.90; first-hit linear fade 0.90; pixel-scale repeated layers 0.90; repeated layers plus slab warp.</p><img class="sheet" src="transmission-comparison.png"><p>${link("scripts/out/transmission-report.json", "CPU legacy report")}</p>
<h2>World-band study — ${esc(sizes(world))} px</h2><p>Each pair uses the same fixture and raster. Straight layers isolate rear visibility; warp adds the optional image-space slab distortion.</p>${cards}
<table><thead><tr><th>Fixture</th><th>Size</th><th>coverage</th><th>unresolved</th><th>warp fallbacks</th></tr></thead><tbody>${rows}</tbody></table><p>${link("scripts/out/transmission-world-report.json", "CPU world report")}</p>
<h2>Scale comparison</h2><p>The full sheet includes the matched ${esc(scale.low)} px Menger render and a linear-light ${esc(scale.high)}→${esc(scale.low)} downsample, plus grid-phase, optical-normal-radius and zoom controls.</p><img class="sheet" src="transmission-world-comparison.png">
<h2>Finite optical proxy — ${esc(sizes(finite))} px</h2><p>Six columns: public object opaque; public sampled world bands over the floor; finite proxy opaque; exact finite runs over the floor; finite runs with thickness absorption over the floor; the same absorbed finite runs over a uniform field.</p><img class="sheet" src="transmission-finite-comparison.png"><p>${link("scripts/out/transmission-finite-report.json", "finite proxy report")}</p>
<h2>Isolated motion</h2><p>Menger camera, native Mandelbox 4D rotor, and native Mandelbox 4D slice change separately. Scrub straight and warped frames to inspect boiling, fallbacks and missing disocclusion.</p><iframe src="transmission-motion/index.html"></iframe><p>${link("scripts/out/transmission-motion/index.html", "open motion review")} · ${link("scripts/out/transmission-motion/report.json", "motion report")}</p>
<h2>Feasibility and provenance</h2><p>${link("scripts/out/transmission-gpu-pilot/report.json", "actual GPU pilot report and provenance")} · ${link("scripts/out/transmission-review-manifest.json", "SHA-256 review manifest")}</p>`;
mkdirSync(out, { recursive: true });
writeFileSync(reviewPath, html);
const hashEntry = (path) => {
  const bytes = readFileSync(join(root, path));
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      status: "UNREVIEWED",
      verdict: "direct generic integration no-go",
      generatedAt: new Date().toISOString(),
      repositoryRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      sourceTreeClean:
        execFileSync(
          "git",
          ["status", "--porcelain", "--", "src", "scripts", "docs"],
          { cwd: root, encoding: "utf8" },
        ).trim() === "",
      review: hashEntry(relative(root, reviewPath)),
      sources: sources.map(hashEntry),
      artifacts: artifacts.map(hashEntry),
    },
    null,
    2,
  ),
);
console.log(relative(root, reviewPath));
console.log(relative(root, manifestPath));
