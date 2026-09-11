#!/usr/bin/env node
/**
 * Bounded counterfactual isolating the global swirl certificate's stride cost.
 * This intentionally UNSOUND instrument is never a candidate or a passing gate.
 * It retains the exact G-scaled DE, cutoff, primary epsilon (numeric floor
 * included), Balloons and geometry, and changes only primary march advance to
 * d * G * stepScale. Shadow/normal probes and hit-info remain unchanged.
 *
 * Reproduce with TWO isolated copies of the pre-pair source at
 * 45e35e448f35603ea4a83db8c7a7834b00ff21e6, each with node_modules available.
 * Build and preview the unmodified copy on 4175, then use the current gate:
 *   node scripts/surface-swirl.verify.mjs --url=https://localhost:4175 \
 *     --display=:0 --measure --outdir=scripts/out/surface-swirl-baseline
 * That census exits 2 deliberately. Apply the only permitted source changes
 * to the second src tree (the full input trees must first match byte-for-byte):
 *   node scripts/surface-swirl-stride-control.verify.mjs \
 *     --source=/tmp/swirl-global/src --control=/tmp/swirl-control/src \
 *     --prepare-control
 * Build/preview the second copy on 4176, then rerun that command without
 * --prepare-control. --records, --url, --display and --outdir override defaults.
 * THIS GATE IS EXEMPT FROM THE STALE-BUNDLE GUARD every preview-driving
 * gate carries (scripts/lib/dist-freshness.mjs): both origins it drives are
 * previews of OTHER checkouts, so this repo's own dist/ says nothing about
 * them and the guard could only ever false-refuse. The census step above
 * runs surface-swirl.verify.mjs against one of those foreign trees, which
 * IS guarded -- run that one leg with ALLOW_STALE_DIST=1.
 * The current XAUTHORITY must authorize the display; hardware is mandatory.
 *
 * Both runs replay the EXACT copied document, including camera and 4D pose.
 * The frozen production decoder/builders independently reconstruct raw and
 * visible bounds, complete final-lens coefficients, G, stepScale and Balloon
 * center/rho/R; deep equality is required before every capture. The instrument
 * verifies every source file is unchanged except the three exact advance
 * substitutions. Each ray census is saved before the next row begins.
 *
 * Measured 2026-09-08, AMD Radeon RX 7900 XTX, 960x540, eighth settle pass:
 *                    global-G exhausted -> unsound stride-only exhausted
 *   3D compute                  2,872 -> 5
 *   3D WebGL                    2,213 -> 4
 *   4D compute                    112 -> 0
 *   4D WebGL                      118 -> 0
 * G=1.9726619720458984 (3D), 1.9042534828186035 (4D), 518,400 rays each.
 * The certificate's stride tax dominates these failures; the residual 3D rays
 * show it is not their sole cause. Geometry/bounds/opening pose do not explain
 * this difference. Larger unsound steps are not evidence for a safe fix.
 *
 * Exit 2: diagnostic complete or sources prepared; NEVER a qualification pass.
 * Other nonzero exits are instrument/setup failures.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import {
  captureSettledSurface,
  launchSurfaceBrowser,
} from "./lib/surface-browser-runner.mjs";
const options = {
  source: null,
  control: null,
  records: "scripts/out/surface-swirl-baseline/results.json",
  url: "https://localhost:4176",
  display: ":0",
  outdir: "scripts/out/surface-swirl-stride-control",
  prepare: false,
};
for (const argument of process.argv.slice(2)) {
  if (argument === "--prepare-control") {
    options.prepare = true;
    continue;
  }
  const match = /^--(source|control|records|url|display|outdir)=(.+)$/.exec(
    argument,
  );
  if (!match) throw new Error(`Unknown option ${argument}`);
  options[match[1]] = match[2];
}
if (!options.source || !options.control) {
  throw new Error(
    "--source and --control must name the two frozen src directories",
  );
}
const source = resolve(options.source);
const control = resolve(options.control);
assert.notEqual(
  source,
  control,
  "the counterfactual must have its own source tree",
);
const outdir = options.outdir;
await mkdir(outdir, { recursive: true });
const patches = {
  "fractal/surface-de-gpu.ts": [
    "    t += d * params.stepScale;",
    '    t += d * params.stepScale${lens ? " / lensEpsScale" : ""};',
  ],
  "app/surface-material.ts": [
    "      t += d * uStepScale;",
    "#if SURFACE_FOLD_LENS\n      t += d * uStepScale / lensEpsScale;\n#else\n      t += d * uStepScale;\n#endif",
  ],
  "app/surface-material-4d.ts": [
    "  const rest = source\n    .slice(end)\n    .replace(",
    '  const rest = source\n    .slice(end)\n    .replace("t += d * uStepScale;", "t += d * uStepScale * uLensLipschitz;")\n    .replace(',
  ],
};
async function filePaths(directory, prefix = "") {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory())
      out.push(...(await filePaths(join(directory, entry.name), name)));
    else out.push(name);
  }
  return out.sort();
}
const files = await filePaths(source);
assert.deepEqual(await filePaths(control), files);
const diffs = [];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
for (const file of files) {
  const a = await readFile(join(source, file));
  const b = await readFile(join(control, file));
  const patch = patches[file];
  if (!patch || options.prepare)
    assert.equal(sha256(a), sha256(b), `${file} remains byte-identical`);
  if (patch) {
    const text = a.toString();
    assert.equal(
      text.split(patch[0]).length - 1,
      1,
      `${file}: exact single surgical anchor`,
    );
    const patched = text.replace(patch[0], patch[1]);
    if (!options.prepare) assert.equal(b.toString(), patched);
    diffs.push({
      file,
      before: patch[0],
      after: patch[1],
      baselineSha256: sha256(a),
      controlSha256: sha256(patched),
    });
  }
}
// Validate the ENTIRE copied tree before making any temporary source edit.
// The explicit mode only applies the three primary-advance substitutions.
if (options.prepare) {
  for (const file of Object.keys(patches)) {
    const text = await readFile(join(source, file), "utf8");
    const [before, after] = patches[file];
    await writeFile(join(control, file), text.replace(before, after));
  }
  await writeFile(join(outdir, "patches.json"), JSON.stringify(diffs, null, 2));
  console.log(
    "[global-stride-removed] UNSOUND diagnostic sources prepared; build and preview the separate control tree before measuring",
  );
  process.exit(2);
}
async function metadataBuilder(root) {
  const bundled = await build({
    stdin: {
      contents: `import { buildSurfaceDE } from ${JSON.stringify(join(root, "fractal/surface-de.ts"))};
import { buildSurfaceDE4 } from ${JSON.stringify(join(root, "fractal/surface-de-4d.ts"))};
import { buildBalloon, buildBalloon4 } from ${JSON.stringify(join(root, "fractal/balloon-de.ts"))};
import { decodeScene } from ${JSON.stringify(join(root, "app/persist.ts"))};
export function metadata(hash) {
  const doc = decodeScene(hash.slice(1));
  if (!doc) throw new Error('Production decoder refused fixture');
  const fourD = doc.transforms.some(t => t.w);
  const de = (fourD ? buildSurfaceDE4 : buildSurfaceDE)(doc.transforms, doc.finalTransform, doc.symmetry);
  return { camera: doc.camera, fourD: doc.fourD, boundingRadius: de.boundingRadius, boundCenter: de.boundCenter, visibleBoundingRadius: de.visibleBoundingRadius, lens: de.foldFinal, stepScale: de.stepScale, balloon: (fourD ? buildBalloon4 : buildBalloon)(de, doc.balloonRadius) };
}`,
      resolveDir: process.cwd(),
      sourcefile: "swirl-stride-control-metadata.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const file = resolve(
    outdir,
    root === source ? "baseline-metadata.mjs" : "control-metadata.mjs",
  );
  await writeFile(file, bundled.outputFiles[0].text);
  return (await import(file)).metadata;
}
const baselineMetadata = await metadataBuilder(source);
const controlMetadata = await metadataBuilder(control);
const allBaseline = JSON.parse(await readFile(options.records, "utf8"));
const baseline = allBaseline.filter((row) =>
  /-balloon-default-/.test(row.name),
);
assert.equal(baseline.length, 4);
const records = [];
const browser = await launchSurfaceBrowser(`x11:${options.display}`);
try {
  for (const row of baseline) {
    const scene = JSON.parse(
      Buffer.from(row.hash.slice(4), "base64url").toString(),
    );
    assert.ok(scene.camera);
    const metadata = baselineMetadata(row.hash);
    assert.deepEqual(
      controlMetadata(row.hash),
      metadata,
      `${row.name}: camera, ball, geometry and G unchanged`,
    );
    console.log("[global-stride-removed] " + row.name);
    const result = await captureSettledSurface(browser, {
      url: options.url,
      hash: row.hash,
      engine: row.engine,
      timeoutMs: 180000,
      release: true,
    });
    await writeFile(join(outdir, row.name + ".png"), result.png);
    const captured = {
      name: row.name,
      hash: row.hash,
      metadata,
      backend: result.backend,
      baselineCensus: row.census,
      controlCensus: result.census,
      elapsedMs: result.elapsedMs,
    };
    records.push(captured);
    await writeFile(
      join(outdir, "results.json"),
      JSON.stringify(
        {
          verdict: "UNSOUND COUNTERFACTUAL ONLY; not a qualification",
          patches: diffs,
          records,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        name: row.name,
        globalG: metadata.lens.swirlLipschitz,
        baseline: row.census.exhausted,
        control: result.census.exhausted,
      }),
    );
  }
} finally {
  await browser.close();
}
console.log(
  "[global-stride-removed] UNSOUND COUNTERFACTUAL ONLY; no qualification pass",
);
process.exitCode = 2;
