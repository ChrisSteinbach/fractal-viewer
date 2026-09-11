#!/usr/bin/env node
/** EXPERIMENT-ONLY: builds the honest crop sheet for the participating
 * medium's god-ray visual test -- each composition's mist frame beside its
 * no-mist control, cropped 1:1 (no resampling) to the region that actually
 * shows the claimed effect. Uses a headless `playwright-core` page as a
 * canvas host (this repo ships no image library); no WebGPU/app content is
 * involved, just `drawImage`/`fillText` over local PNGs loaded as
 * `file://` URLs.
 *
 * Usage: node scripts/medium-shafts-crop-sheet.mjs
 * Reads from scripts/out/medium-shafts/final/, writes
 * scripts/out/medium-shafts/crop-sheet.png.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { readFile } from "node:fs/promises";

const dir = "scripts/out/medium-shafts/final";
const outPath = "scripts/out/medium-shafts/crop-sheet.png";

// [label, mist file, nomist file, crop {x,y,w,h} in the source 1920x1057 image]
const ROWS = [
  [
    "wedge (single off-axis light, warm)",
    "final-wedge.png",
    "final-wedge-nomist.png",
    { x: 480, y: 330, w: 980, h: 660 },
  ],
  [
    "wedge2 (two off-axis lights, warm+blue -- see the separate blue beam)",
    "final-wedge2.png",
    "final-wedge2-nomist.png",
    { x: 380, y: 250, w: 1120, h: 620 },
  ],
  [
    "backlit (single hole, tucked niche -- glow, not a shaft)",
    "final-backlit.png",
    "final-backlit-nomist.png",
    { x: 380, y: 260, w: 700, h: 650 },
  ],
];

const LABEL_H = 28;
const GAP = 12;
const PAD = 16;

async function fileDataUrl(p) {
  const bytes = await readFile(p);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const rowsWithData = await Promise.all(
  ROWS.map(async ([label, mist, nomist, crop]) => [
    label,
    await fileDataUrl(path.join(dir, mist)),
    await fileDataUrl(path.join(dir, nomist)),
    crop,
  ]),
);

const totalW = PAD * 2 + Math.max(...ROWS.map((r) => r[3].w)) * 2 + GAP;
const totalH =
  PAD * 2 + ROWS.reduce((sum, r) => sum + r[3].h + LABEL_H + GAP, 0) - GAP;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: totalW, height: totalH },
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0"><canvas id="c" width="${totalW}" height="${totalH}"></canvas></body></html>`,
  );
  await page.evaluate(
    async ({ rows, totalW, totalH, LABEL_H, GAP, PAD }) => {
      const canvas = document.getElementById("c");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, totalW, totalH);
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      let y = PAD;
      for (const [label, mistSrc, nomistSrc, crop] of rows) {
        const [mistImg, nomistImg] = await Promise.all([
          load(mistSrc),
          load(nomistSrc),
        ]);
        ctx.fillStyle = "#e8e8e8";
        ctx.font = "16px sans-serif";
        ctx.fillText(
          `${label} -- crop ${crop.w}x${crop.h} at (${crop.x},${crop.y})`,
          PAD,
          y + 18,
        );
        const imgY = y + LABEL_H;
        ctx.fillStyle = "#cfe8ff";
        ctx.font = "13px sans-serif";
        ctx.fillText("MIST", PAD + 4, imgY + 16);
        ctx.drawImage(
          mistImg,
          crop.x,
          crop.y,
          crop.w,
          crop.h,
          PAD,
          imgY,
          crop.w,
          crop.h,
        );
        ctx.fillText("NO MIST (control)", PAD + crop.w + GAP + 4, imgY + 16);
        ctx.drawImage(
          nomistImg,
          crop.x,
          crop.y,
          crop.w,
          crop.h,
          PAD + crop.w + GAP,
          imgY,
          crop.w,
          crop.h,
        );
        ctx.strokeStyle = "#555";
        ctx.strokeRect(PAD, imgY, crop.w, crop.h);
        ctx.strokeRect(PAD + crop.w + GAP, imgY, crop.w, crop.h);
        y = imgY + crop.h + GAP;
      }
    },
    { rows: rowsWithData, totalW, totalH, LABEL_H, GAP, PAD },
  );
  const bytes = await page.locator("#c").screenshot();
  await import("node:fs/promises").then((fs) => fs.writeFile(outPath, bytes));
  console.log(`wrote ${outPath} (${totalW}x${totalH})`);
} finally {
  await browser.close();
}
