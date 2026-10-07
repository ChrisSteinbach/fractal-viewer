/**
 * Drive the built app in Points mode with a #v1= document and screenshot the
 * scene: the explorer-side view the 4D tuned preset needs (the hyper-Menger's
 * 48 maps exceed the surface tracer's cap, so the scratch cannot render it).
 * Usage: node scripts/drive-points.mjs <doc-payload-file> <out.png> [ms]
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [docFile, out, waitMs = "6000", mode = ""] = process.argv.slice(2);
const payload = (await readFile(docFile, "utf8")).trim();

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: false,
  args: [
    "--ozone-platform=x11",
    "--no-sandbox",
    "--enable-logging=stderr",
    "--v=1",
    "--window-position=-3000,-3000",
  ],
  env: process.env,
});
const page = await browser.newPage({
  ignoreHTTPSErrors: true,
  viewport: { width: 1100, height: 850 },
});
await page.addInitScript(() => {
  localStorage.setItem(
    "fractal-viewer:prefs",
    JSON.stringify({ autoMotion: false }),
  );
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`https://localhost:4173/#${payload}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
if (mode) {
  const idMap = {
    Points: "modePointsBtn",
    Flame: "modeFlameBtn",
    Solid: "modeSolidBtn",
    Surface: "modeSurfaceBtn",
  };
  const btn = await page.$(`#${idMap[mode] ?? ""}`);
  if (btn) {
    await btn.click();
  } else {
    console.log(`[warn] mode button "${mode}" not found`);
  }
}
await page.evaluate(() => {
  for (const id of ["panel", "hintCard", "statsCard", "legend"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
  for (const el of document.querySelectorAll("#container > div")) {
    el.style.display = "none";
  }
});
await page.waitForTimeout(Number(waitMs));
await page
  .waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return (
        el &&
        /\d/.test(el.textContent ?? "") &&
        !/generating/i.test(el.textContent ?? "")
      );
    },
    { timeout: 30000 },
  )
  .catch(() => console.log("[warn] pointCount never settled"));
await page.waitForTimeout(1500);
const el = await page.$("#container canvas");
if (!el) throw new Error("no #container canvas");
await el.screenshot({ path: out });
const count = await page.evaluate(
  () => document.getElementById("pointCount")?.textContent ?? "?",
);
console.log(`${out} — pointCount: ${count}`);
await browser.close();
