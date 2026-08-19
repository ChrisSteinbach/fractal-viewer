#!/usr/bin/env node
/**
 * Generates the two app-icon rasters this project ships as
 * COMMITTED PNGs — src/app/public/icon-maskable-512.png and
 * src/app/public/apple-touch-icon.png — from the one hand-authored vector,
 * src/app/public/icon.svg. The repo shipped zero app PNGs before this; both
 * outputs exist because two platforms consume rasters icon.svg alone cannot
 * serve (Android's adaptive-icon masker needs a full-bleed, safe-zone-padded
 * silhouette; iOS's Add-to-Home-Screen doesn't render SVG touch icons at all
 * and falls back to a screenshot of the page without one). This script is
 * what makes the two PNGs a REPRODUCIBLE DERIVATION of icon.svg rather than
 * mystery binaries checked in by hand — re-run it and recommit its output
 * any time icon.svg's artwork changes.
 *
 * Rendering goes through the same headless-Chromium recipe scripts/*.verify.mjs
 * already uses (playwright-core's bundled Chromium — see e.g.
 * scripts/balloon-real-driver.verify.mjs). No WebGL/WebGPU is needed here,
 * just an ordinary <canvas> 2D raster of an SVG, so plain headless mode is
 * fine (unlike webgl-smoke.mjs's SwiftShader dance, which exists for a real
 * GL context).
 *
 * FINDING 1 — padded maskable icon. icon.svg's artwork (two Sierpinski-style
 * triangle groups) spans x/y 40..472 of its 512 viewBox; its farthest
 * vertices are the two bottom feet at (40,472) and (472,472), each
 * 216*sqrt(2) =~ 305.5px from the icon's center — well outside Android's
 * maskable safe zone, a circle of radius 0.4*512 = 204.8px centered on the
 * icon (https://web.dev/articles/maskable-icon). The actual bug the manifest
 * had was declaring "any maskable" on ONE entry: "any" and "maskable" want
 * DIFFERENT art (full-bleed vs padded), not just different margins. This
 * script's maskable output is a second, purpose-built raster: icon.svg's
 * artwork groups (the rounded-rect background excluded — a mask discards it
 * anyway) rescaled by SAFE_ZONE_SCALE about the icon's center, composited
 * over a full-bleed square of the icon's own background color (no rounded
 * corners — the mask supplies whatever shape it wants). SAFE_ZONE_SCALE=0.6
 * lands the farthest vertex at ~183.3px, ~21.5px (~10.5% of the safe
 * radius) inside the 204.8px line rather than right on it.
 *
 * FINDING 2 — apple-touch-icon. A 180x180 PNG of icon.svg's ORDINARY
 * (unpadded) artwork proportions — iOS applies its own rounded-rect mask,
 * not a circle, so this output needs no safe-zone padding. It does need
 * guaranteed opacity (iOS composites no transparency and shows black
 * through any hole), which icon.svg's rx=96 rounded rect alone doesn't
 * provide (the four corners outside the rounded rect are transparent) — so
 * this output adds a second, unrounded full-bleed rect of the same color
 * underneath the original rect+artwork, seamless because both are the same
 * fill.
 *
 * Usage: node scripts/icons.generate.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "src/app/public");
const ICON_SVG_PATH = path.join(PUBLIC_DIR, "icon.svg");
const MASKABLE_PNG_PATH = path.join(PUBLIC_DIR, "icon-maskable-512.png");
const APPLE_TOUCH_PNG_PATH = path.join(PUBLIC_DIR, "apple-touch-icon.png");

const MASKABLE_SIZE = 512;
const APPLE_TOUCH_SIZE = 180;
// See "FINDING 1" above for the derivation: the artwork's farthest vertex
// sits 305.5px from center at full scale, so scale <= 204.8/305.5 =~ 0.6705
// clears Android's safe-zone circle; 0.6 leaves ~10.5% clearance rather than
// landing right on the line.
const SAFE_ZONE_SCALE = 0.6;
// Self-check threshold (see assertSafeZoneMargins below) — kept loose of the
// ~24.7% bounding-box margin SAFE_ZONE_SCALE=0.6 actually produces (measured
// at the lift) so a deliberate future retune has room to move without
// tripping this script's own gate.
const MIN_SAFE_ZONE_MARGIN_FRACTION = 0.1;
const BACKGROUND_MATCH_THRESHOLD = 24; // per-channel; absorbs AA edge blending

/** Pulls icon.svg's background fill color and its artwork markup (the two
 * <g> groups after the background <rect>) apart, so the two outputs below
 * can recombine them differently instead of hand-duplicating the polygon
 * coordinates. Throws rather than guessing if icon.svg's shape ever stops
 * matching what this script assumes. */
async function extractIconParts() {
  const source = await readFile(ICON_SVG_PATH, "utf8");
  const bgMatch = source.match(/<rect\b[^>]*\bfill="([^"]+)"[^>]*\/>/);
  if (!bgMatch) {
    throw new Error(
      'icon.svg: could not find a self-closed background <rect fill="..."/> ' +
        "— this script's parsing assumes icon.svg's current shape; update it " +
        "alongside whatever changed.",
    );
  }
  const backgroundColor = bgMatch[1];
  const rectEnd = source.indexOf(bgMatch[0]) + bgMatch[0].length;
  const svgCloseIdx = source.lastIndexOf("</svg>");
  const artworkMarkup = source.slice(rectEnd, svgCloseIdx).trim();
  const groupCount = (artworkMarkup.match(/<g\b/g) || []).length;
  if (groupCount < 2) {
    throw new Error(
      `icon.svg: expected >=2 <g> artwork groups after the background rect, ` +
        `found ${groupCount} — this script's parsing assumes icon.svg's current shape.`,
    );
  }
  return { backgroundColor, artworkMarkup };
}

function maskableSvg({ backgroundColor, artworkMarkup }) {
  const c = MASKABLE_SIZE / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MASKABLE_SIZE} ${MASKABLE_SIZE}">
  <rect width="${MASKABLE_SIZE}" height="${MASKABLE_SIZE}" fill="${backgroundColor}" />
  <g transform="translate(${c} ${c}) scale(${SAFE_ZONE_SCALE}) translate(${-c} ${-c})">
    ${artworkMarkup}
  </g>
</svg>`;
}

function appleTouchSvg({ backgroundColor, artworkMarkup }) {
  // Full-bleed, unrounded backdrop UNDER the original rounded-rect +
  // artwork, same color so the seam is invisible — fills in the four
  // corners icon.svg's own rx=96 leaves transparent, without touching the
  // artwork's ordinary (unpadded) proportions.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${backgroundColor}" />
  <rect width="512" height="512" rx="96" fill="${backgroundColor}" />
  ${artworkMarkup}
</svg>`;
}

/** Renders `svgMarkup` (a complete <svg>...</svg> document sized to
 * `size`x`size`) to a PNG file via a headless page — the SVG element is
 * screenshotted directly, so the output's pixel dimensions are exactly
 * `size`x`size`. */
async function renderSvgToPng(browser, svgMarkup, size, outPath) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
  });
  try {
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;background:#000;}
      svg{display:block;width:${size}px;height:${size}px;}
    </style></head><body>${svgMarkup}</body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    const svgEl = await page.$("svg");
    const buffer = await svgEl.screenshot({ omitBackground: false });
    await writeFile(outPath, buffer);
    return buffer;
  } finally {
    await page.close();
  }
}

/** Loads a just-written PNG back into a canvas (in-browser, so PNG decoding
 * is Chromium's own rather than a hand-rolled parser) and reports: pixel
 * dimensions, the four corner alpha values (opacity check), and — when
 * `backgroundColor` is given — the bounding box of pixels that differ from
 * it (the maskable safe-zone geometry check). */
async function measurePng(browser, filePath, { backgroundColor } = {}) {
  const page = await browser.newPage();
  try {
    const buf = await readFile(filePath);
    const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    return await page.evaluate(
      async ({ dataUrl, backgroundColor, threshold }) => {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("image failed to decode"));
          img.src = dataUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );

        const corners = {
          topLeft: [0, 0],
          topRight: [width - 1, 0],
          bottomLeft: [0, height - 1],
          bottomRight: [width - 1, height - 1],
        };
        const cornerAlphas = Object.fromEntries(
          Object.entries(corners).map(([name, [x, y]]) => {
            const i = (y * width + x) * 4;
            return [name, data[i + 3]];
          }),
        );

        let bbox = null;
        if (backgroundColor) {
          const hex = backgroundColor.replace("#", "");
          const bg = [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ];
          let minX = width,
            maxX = -1,
            minY = height,
            maxY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              const dr = Math.abs(data[i] - bg[0]);
              const dg = Math.abs(data[i + 1] - bg[1]);
              const db = Math.abs(data[i + 2] - bg[2]);
              if (dr > threshold || dg > threshold || db > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          bbox = maxX >= minX ? { minX, maxX, minY, maxY } : null;
        }

        return { width, height, cornerAlphas, bbox };
      },
      { dataUrl, backgroundColor, threshold: BACKGROUND_MATCH_THRESHOLD },
    );
  } finally {
    await page.close();
  }
}

function assertOpaqueCorners(label, measured) {
  const bad = Object.entries(measured.cornerAlphas).filter(
    ([, a]) => a !== 255,
  );
  if (bad.length) {
    throw new Error(
      `${label}: non-opaque corner(s): ${bad.map(([n, a]) => `${n}=${a}`).join(", ")}`,
    );
  }
  console.error(`[icons.generate] ${label}: all 4 corners opaque (alpha=255)`);
}

function assertSize(label, measured, expected) {
  if (measured.width !== expected || measured.height !== expected) {
    throw new Error(
      `${label}: expected ${expected}x${expected}, got ${measured.width}x${measured.height}`,
    );
  }
  console.error(
    `[icons.generate] ${label}: ${measured.width}x${measured.height}`,
  );
}

function assertSafeZoneMargins(label, measured) {
  const { width, height, bbox } = measured;
  if (!bbox)
    throw new Error(`${label}: found no non-background artwork pixels`);
  const margins = {
    left: bbox.minX,
    right: width - 1 - bbox.maxX,
    top: bbox.minY,
    bottom: height - 1 - bbox.maxY,
  };
  const fractions = Object.fromEntries(
    Object.entries(margins).map(([side, px]) => [side, px / width]),
  );
  console.error(
    `[icons.generate] ${label}: artwork bbox x=[${bbox.minX},${bbox.maxX}] y=[${bbox.minY},${bbox.maxY}] ` +
      `margins px=${JSON.stringify(margins)} fractions=${JSON.stringify(
        Object.fromEntries(
          Object.entries(fractions).map(([k, v]) => [
            k,
            `${(v * 100).toFixed(1)}%`,
          ]),
        ),
      )}`,
  );
  const short = Object.entries(fractions).filter(
    ([, f]) => f < MIN_SAFE_ZONE_MARGIN_FRACTION,
  );
  if (short.length) {
    throw new Error(
      `${label}: margin(s) below the required ${MIN_SAFE_ZONE_MARGIN_FRACTION * 100}%: ` +
        short.map(([side, f]) => `${side}=${(f * 100).toFixed(1)}%`).join(", "),
    );
  }
}

async function main() {
  const parts = await extractIconParts();
  console.error(
    `[icons.generate] icon.svg background=${parts.backgroundColor}, ` +
      `${(parts.artworkMarkup.match(/<g\b/g) || []).length} artwork groups`,
  );

  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
  });
  try {
    await renderSvgToPng(
      browser,
      maskableSvg(parts),
      MASKABLE_SIZE,
      MASKABLE_PNG_PATH,
    );
    console.error(`[icons.generate] wrote ${MASKABLE_PNG_PATH}`);
    const maskableMeasured = await measurePng(browser, MASKABLE_PNG_PATH, {
      backgroundColor: parts.backgroundColor,
    });
    assertSize("maskable", maskableMeasured, MASKABLE_SIZE);
    assertOpaqueCorners("maskable", maskableMeasured);
    assertSafeZoneMargins("maskable", maskableMeasured);

    await renderSvgToPng(
      browser,
      appleTouchSvg(parts),
      APPLE_TOUCH_SIZE,
      APPLE_TOUCH_PNG_PATH,
    );
    console.error(`[icons.generate] wrote ${APPLE_TOUCH_PNG_PATH}`);
    const appleTouchMeasured = await measurePng(browser, APPLE_TOUCH_PNG_PATH);
    assertSize("apple-touch-icon", appleTouchMeasured, APPLE_TOUCH_SIZE);
    assertOpaqueCorners("apple-touch-icon", appleTouchMeasured);
  } finally {
    await browser.close();
  }
  console.error("[icons.generate] VERDICT: PASS");
}

main().catch((err) => {
  console.error("[icons.generate] fatal:", err);
  process.exitCode = 1;
});
