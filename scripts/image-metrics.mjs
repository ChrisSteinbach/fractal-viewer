/**
 * Shape-metrics probe for the twistedSponge work: loads images into canvases
 * and computes silhouette row-spans + a detail (edge-density) profile —
 * the same bright-span instrument the family doc's refusal table used, plus
 * a coarse multi-scale edge count to compare crust depth.
 *
 * Usage: node scripts/image-metrics.mjs <img1> [img2 ...]
 * Prints per image: bright spans at 10/25/50/75/90% row heights, fraction of
 * lit pixels, and edge density at two box-filter scales.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import path from "node:path";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node image-metrics.mjs <img>...");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("about:blank");

for (const file of files) {
  const b64 = (await readFile(file)).toString("base64");
  const metrics = await page
    .evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const W = img.width,
        H = img.height;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, W, H).data;
      const lum = new Float32Array(W * H);
      let lit = 0;
      for (let i = 0; i < W * H; i++) {
        const r = data[4 * i],
          gr = data[4 * i + 1],
          b = data[4 * i + 2],
          a = data[4 * i + 3];
        const v = (0.2126 * r + 0.7152 * gr + 0.0722 * b) * (a / 255);
        lum[i] = v;
        if (v > 24) lit++;
      }
      // Row spans: at row heights p, the span of lit pixels in that row.
      const spans = [];
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const y = Math.floor(p * H);
        let min = -1,
          max = -1;
        for (let x = 0; x < W; x++) {
          if (lum[y * W + x] > 24) {
            if (min < 0) min = x;
            max = x;
          }
        }
        spans.push({ p, span: max - min + 1 });
      }
      // Edge density: fraction of pixels whose luminance differs from the
      // neighbour 4px left by > 18 — coarse texture proxy. And at 12px for the
      // larger band scale.
      function edgeDensity(gap) {
        let n = 0,
          t = 0;
        for (let y = 0; y < H; y += 2) {
          for (let x = gap; x < W; x += 2) {
            const a = lum[y * W + x],
              b = lum[y * W + x - gap];
            if (a > 24 || b > 24) {
              t++;
              if (Math.abs(a - b) > 18) n++;
            }
          }
        }
        return t ? n / t : 0;
      }
      return {
        w: W,
        h: H,
        litFraction: lit / (W * H),
        spans,
        edge4: edgeDensity(4),
        edge12: edgeDensity(12),
      };
    }, b64)
    .catch((e) => ({ error: String(e) }));
  console.log(`${path.basename(file)}: ${JSON.stringify(metrics)}`);
}
await browser.close();
