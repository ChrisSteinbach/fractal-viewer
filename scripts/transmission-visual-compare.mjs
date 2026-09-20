#!/usr/bin/env node
/**
 * The closed-solid visual re-read's comparison instrument (the abutting
 * bead's part b): reads the built-app study-pose captures
 * (finite-glass.verify.mjs --poses=study) beside the approved
 * staged-authoritative references, computes each image's near-black
 * fraction and mean luminance in a browser canvas (no PNG decoder), and
 * writes side-by-side strips for the owner's eye.
 *
 *   node scripts/transmission-visual-compare.mjs \
 *     --captures=scripts/out/transmission-reread \
 *     --references=scripts/out/transmission-dielectric-gpu
 *
 * Exit 0 always — this is a JUDGEMENT instrument, not a gate: the
 * near-black fraction is the speckle class's measure (unresolved rays
 * render BLACK, never background), and the owner reads the strips.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const argOf = (key, fallback) => {
  const i = args.indexOf(key);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const captures = argOf("captures", "scripts/out/transmission-reread");
const references = argOf(
  "references",
  "scripts/out/transmission-dielectric-gpu",
);

const PAIRS = [
  {
    label: "menger3",
    app: "finite-glass-menger3-canonical.png",
    reference: "staged-authoritative-menger3-256x144.png",
  },
  {
    label: "hyper4",
    app: "finite-glass-hyper4-canonical-canonical.png",
    reference: "staged-authoritative-hyper4-256x144.png",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = [];
  for (const pair of PAIRS) {
    const appPath = join(captures, pair.app);
    const refPath = join(references, pair.reference);
    if (!existsSync(appPath) || !existsSync(refPath)) {
      console.log(
        `${pair.label}: MISSING INPUT (${!existsSync(appPath) ? appPath : refPath})`,
      );
      rows.push({ label: pair.label, missing: true });
      continue;
    }
    const appB64 = readFileSync(appPath).toString("base64");
    const refB64 = readFileSync(refPath).toString("base64");

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const stats = await page.evaluate(
      async ({ appB64, refB64 }) => {
        const measure = (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          const sync = img.decode();
          return sync.then(() => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let black = 0;
            let lum = 0;
            const n = canvas.width * canvas.height;
            for (let i = 0; i < n; i++) {
              const r = data[i * 4];
              const g = data[i * 4 + 1];
              const b = data[i * 4 + 2];
              const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
              lum += l;
              if (l < 8) black += 1;
            }
            return {
              width: canvas.width,
              height: canvas.height,
              nearBlackFraction: black / n,
              meanLuminance: lum / n / 255,
            };
          });
        };
        return {
          app: await measure(appB64),
          reference: await measure(refB64),
        };
      },
      { appB64, refB64 },
    );
    await browser.close();

    rows.push({
      label: pair.label,
      app: pair.app,
      reference: pair.reference,
      ...stats,
    });
    console.log(
      `${pair.label}: app ${stats.app.width}x${stats.app.height}` +
        ` nearBlack=${stats.app.nearBlackFraction.toFixed(4)}` +
        ` meanLum=${stats.app.meanLuminance.toFixed(4)}` +
        ` | reference ${stats.reference.width}x${stats.reference.height}` +
        ` nearBlack=${stats.reference.nearBlackFraction.toFixed(4)}` +
        ` meanLum=${stats.reference.meanLuminance.toFixed(4)}`,
    );
  }

  mkdirSync(captures, { recursive: true });
  writeFileSync(
    join(captures, "visual-compare.json"),
    JSON.stringify(rows, null, 2),
  );
  console.log(`rows written: ${join(captures, "visual-compare.json")}`);
  await sleep(10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
