/**
 * Contact-sheet builder for the twistedSponge comparison (fr-dpie): composes
 * reference + candidate renders into labeled side-by-side sheets under
 * scripts/out/. Usage: node scripts/make-sheet.mjs <out.png> <img> "<label>"
 * [<img> "<label>" ...]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import path from "node:path";

const argv = process.argv.slice(2);
const out = argv[0];
const items = [];
for (let i = 1; i < argv.length; i += 2)
  items.push({ file: argv[i], label: argv[i + 1] ?? "" });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto("about:blank");

const cols = Math.min(3, items.length);
const cell = 460;
const rows = Math.ceil(items.length / cols);
const html = `<body style="margin:0;background:#111;font:12px monospace;color:#eee"><div id="grid" style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px;padding:8px"></div></body>`;
await page.setContent(html);
const imgs = [];
for (const it of items) {
  const b64 = (await readFile(it.file)).toString("base64");
  const h = await page.evaluate(
    async ({ b64, label, cell }) => {
      const box = document.createElement("div");
      box.style.cssText = "text-align:center";
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      img.style.cssText = `width:${cell - 8}px;image-rendering:auto;display:block;background:#000`;
      const cap = document.createElement("div");
      cap.textContent = label;
      box.appendChild(img);
      box.appendChild(cap);
      document.getElementById("grid").appendChild(box);
      return true;
    },
    { b64, label: it.label, cell },
  );
  imgs.push(h);
}
await page.setViewportSize({
  width: cols * (cell + 8) + 8,
  height: rows * (cell + 34) + 8,
});
await new Promise((r) => setTimeout(r, 300));
const buf = await page.screenshot({ fullPage: true });
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(`sheet: ${out}`);
await browser.close();
