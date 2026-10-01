#!/usr/bin/env node
/**
 * SELECT POPUP capture: the one instrument that sees what a native dropdown
 * popup actually PAINTS, because it captures the popup's own X window on a
 * real display — the thing no headless run and no computed style can see.
 *
 * WHY IT EXISTS. Chrome paints the native select popup's body with the
 * SELECT's own background-color, composited over the popup's canvas. When
 * `#panel select` shipped a translucent background (`--surface-2`, 6%
 * white), a Chrome that no longer let `color-scheme: dark` carry the popup
 * painted that translucent tint over the popup's WHITE canvas: a white
 * popup with the app's light-grey text (`#e9ebf2`) — practically
 * unreadable, reported in the field 2026-10-01 while every computed-style
 * gate stayed green. The fix froze the select's composite into the OPAQUE
 * `--surface-2-solid` token, and the panel-contrast gate now FAILS any
 * visible select whose computed background-color is not opaque (with an
 * opaque background, the popup paints exactly what that gate's
 * effective-background fallback already measures). This script is the
 * end-to-end check on the popup itself: open the preset dropdown, capture
 * the popup's X window, and measure how much of it is near-white.
 *
 * MEASURED (this machine, real display, production build):
 *   broken (--surface-2 translucent): mean gray 0.93, near-white 88.1%
 *   fixed   (--surface-2-solid):      mean gray 0.21, near-white  0.57%
 * The verdict threshold sits far from both: >= 25% near-white fails.
 *
 * It needs a HEADED Chromium on a real X display (a native popup is an X
 * window; there is nothing to capture headless), so it runs where the
 * other --display=:0 gates run, with the same environment:
 *
 *   npm run build && npm run preview &
 *   export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
 *   export DISPLAY=:0
 *   node scripts/select-popup-capture.mjs
 *
 * Requires ImageMagick (convert) and xwininfo on PATH. Exit codes:
 * 0 popup body dark (verdict passed); 1 popup body light (the reported
 * defect — a select background lost its opacity in a way the computed
 * gates missed); 2 CHECKING-side failure (browser/app/capture failed).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = flag("url", "https://localhost:4173").replace(/\/+$/, "");
const OUT_DIR = path.resolve(
  __dirname,
  "..",
  flag("outdir", ".playwright-mcp"),
);
/** Between the measured 88.1% (broken) and 0.57% (fixed). */
const NEAR_WHITE_FAIL_PERCENT = 25;

function die(code, message) {
  console.error(`[select-popup-capture] ${message}`);
  process.exit(code);
}

await mkdir(OUT_DIR, { recursive: true });
const SHOT = path.join(
  OUT_DIR,
  flag("out", "select-popup.png").replace(/^\//, ""),
);

try {
  execSync("xwininfo -root -tree", { stdio: "ignore" });
} catch {
  die(
    2,
    "xwininfo unavailable — install x11-apps (needed to find the popup's X window)",
  );
}
try {
  execSync("convert -version", { stdio: "ignore" });
} catch {
  die(
    2,
    "ImageMagick's convert unavailable (needed to capture and measure the popup)",
  );
}

const browser = await chromium.launch({
  headless: false,
  args: [
    "--window-position=40,40",
    "--window-size=1360,900",
    "--ozone-platform=x11",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 820 },
  ignoreHTTPSErrors: true,
});
try {
  await page.goto(`${BASE}`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );

  /* The preset select is the app's representative dropdown: one shared rule
   * themes every select, so what its popup paints is what they all paint. */
  await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    if (!sel) throw new Error("no #presetSelect");
    sel.closest("details").open = true;
    sel.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(300);
  const styles = await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    const cs = getComputedStyle(sel);
    return {
      colorScheme: cs.colorScheme,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
    };
  });
  console.log(`[select-popup-capture] computed: ${JSON.stringify(styles)}`);

  /* The popup is its own override-redirect X window, unnamed, created per
   * open. It is mapped the whole time the mouse button is held and can be
   * dismissed by the very next event, so the capture happens WHILE HELD.
   * The open must START from a known-closed popup: with one already open,
   * the next mousedown is a TOGGLE and closes it (measured). */
  const bigUnnamedIds = () =>
    execSync("xwininfo -root -tree", { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(0x[0-9a-f]+)/i.test(l) && l.includes("(has no name)"))
      /* The geometry is the ONLY `WxH+X+Y` in the line; matching any
       * `\d+x\d+` reads the window id's own hex digits instead. */
      .map((l) => ({
        id: l.match(/^(0x[0-9a-f]+)/i)?.[1],
        size: l.match(/(\d+)x(\d+)\+\d+\+\d+/),
      }))
      .filter(
        (c) =>
          !!c.id &&
          !!c.size &&
          Number(c.size[1]) >= 100 &&
          Number(c.size[2]) >= 100,
      )
      .map((c) => c.id);
  const viewable = (id) =>
    execSync(`xwininfo -id ${id}`, { encoding: "utf8" }).includes(
      "Map State: IsViewable",
    );

  const box = await page.locator("#presetSelect").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  let popupId;
  for (let attempt = 0; attempt < 5 && !popupId; attempt += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (bigUnnamedIds().find(viewable)) continue; // a stale popup survived
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(500);
    popupId = bigUnnamedIds().find(viewable);
    if (!popupId) await page.mouse.up();
  }
  if (!popupId) {
    die(2, "no viewable popup X window — was the dropdown actually opened?");
  }
  console.log(`[select-popup-capture] popup window ${popupId}`);

  execSync(`import -window ${popupId} ${SHOT}`, { stdio: "inherit" });

  /* Release away from the popup and close, so a stray selection never
   * fires (the release must not land on a row). */
  await page.mouse.move(cx - 500, cy - 300, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  const nearWhitePercent = Number(
    execSync(
      `convert ${SHOT} -colorspace gray -threshold 90% -format "%[fx:mean*100]" info:`,
      { encoding: "utf8" },
    ).trim(),
  );
  console.log(
    `[select-popup-capture] near-white fraction: ${nearWhitePercent.toFixed(2)}% (fails at >= ${String(NEAR_WHITE_FAIL_PERCENT)}%)`,
  );
  if (nearWhitePercent >= NEAR_WHITE_FAIL_PERCENT) {
    console.error(
      `[select-popup-capture] VERDICT: FAIL — the popup painted light (${SHOT}); a select's background-color lost its opacity`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[select-popup-capture] VERDICT: PASS — popup body is dark (${SHOT})`,
    );
  }
} catch (error) {
  try {
    await writeFile(
      path.join(OUT_DIR, "select-popup-state.txt"),
      String(error),
    );
  } catch {}
  die(
    2,
    `CHECKING-side failure (not a verdict about the app): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
} finally {
  await browser.close();
}
