#!/usr/bin/env node
/**
 * Export-tiling gate: does a TILED compute capture reproduce the
 * untiled one, pixel for pixel?
 *
 * THE BUG THIS EXISTS TO CATCH. `SurfaceComputeRenderer` allocates six
 * per-ray buffers for a whole frame (36 B/ray since the march status
 * side-channel replaced the whole-states readback, 44 across five before
 * it; the ray state alone is 16 B), and a capture's rays scale with
 * exportScale SQUARED — a 4x export of a 1920x1057 pane is 32.5M rays, a
 * 520 MB ray-state buffer inside a ~1.2 GB frame. Devices refuse that, and
 * WebGPU does not throw for it:
 * `createBuffer` returns an INVALID buffer plus a validation error, and
 * the first REJECTION comes from a staging `mapAsync` several awaits later
 * — which is exactly how the bug reached a user, as a failed Save-PNG and
 * a console line ("Mapping WebGPU buffer failed: Invalid buffer") naming
 * nothing that caused it. So a capture now traces full-width horizontal
 * BANDS under the device's own ceiling and assembles them.
 *
 * Why a GATE and not a one-off check: a band is not simply "the same frame,
 * cropped". Three things have to be re-derived per band, and each fails
 * silently-but-visibly if it drifts:
 *   - the RAYS (a sub-frustum via camera.setViewOffset — get the sign of
 *     the offset wrong and the bands stack in the wrong order, or mirror);
 *   - the trace EPS (a band's pixels are the full image's pixels, so its
 *     cone footprint is the full image's, not its own raster's);
 *   - the BACKDROP STOPS (every tracer spreads its two stops over its OWN
 *     rasterHeight, so a band handed the whole image's stops repeats the
 *     whole gradient — nine bright-to-dark ramps down one export).
 * Every one of those reads as a stripe pattern in a PNG nobody looks at
 * until it is shared. Comparing against the untiled render of the same
 * pinned camera catches all three at once.
 *
 * TWO ARMS, one pinned scene (a 2-map pure-boxfold pair — compute-shaped,
 * so the session runs the WebGPU tracer, and cheap enough to settle under
 * SwiftShader; the hash carries an explicit `camera`, which is what makes
 * the render reproducible run to run):
 *   A. no flag           -> the export fits one frame: ONE tile.
 *   B. ?surfacemaxrays=N -> the same export under a pretended device
 *                           ceiling: MANY tiles, same pixels.
 * The flag stands in for a device limit precisely so this gate can run on
 * a cheap 1x export; on a real device the banding only starts at 2-4x,
 * which is minutes of tracing per arm.
 *
 * Also asserted, because a green diff would otherwise be vacuous: both
 * arms really ran the WebGPU compute tracer (a box without an adapter
 * would compare two WebGL exports and prove nothing), arm A really used
 * one tile, arm B really used several, and only arm B's live pane fitted
 * itself under the ceiling (`fitSurfaceComputeRaster`, the other half of
 * what the ceiling drives).
 *
 * MEASURED (headless SwiftShader, 900x560, 9 bands), shipped code against
 * two deliberate mutations of the band derivation:
 *   shipped                        mean 0.0020/255, 0.006% of px off >8
 *   whole-image stops per band     mean 7.3220/255, 53.0% — nine ramps
 *   flipped setViewOffset y        mean 68.3603/255, 89.1% — mirrored
 * i.e. the gate separates correct from broken by 3600x and 34000x on the
 * mean. The residual 0.006% is the march-start dither's per-raster hash
 * phase along silhouettes, and it is the same with and without the floor.
 * A run costs ~6 minutes on that box (two settles, two exports).
 *
 * Usage: node scripts/surface-export-tile.verify.mjs [--url=...]
 *          [--display=:0] [--maxrays=60000] [--out=/tmp]
 * (url defaults to https://localhost:4173 — `npm run build && npm run
 * preview` first. --display runs headed against a real X display / real
 * driver instead of headless SwiftShader; --out keeps both exports as
 * PNGs to eyeball, which is how a failing diff gets read.)
 */
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const BASE = (args.url ?? "https://localhost:4173").replace(/\/+$/, "");
const DISPLAY = args.display;
/** Pretended per-frame ray ceiling for arm B. 60k rays over a 900px-wide
 * export is a 66-row band, so the 560-row export tiles into 9. */
const MAX_RAYS = Number(args.maxrays ?? 60_000);

/** The boxfold PAIR (surface-fold.verify.mjs's BOXFOLD_HASH: two
 * single-variation boxfold maps, `deHasFolds` true, eligibility
 * "eligible") with three things pinned on top:
 *   - an explicit CAMERA, because auto-framing seeds from a
 *     `Math.random()` cloud and drifts ~0.3% per load, which
 *     would swamp the diff this gate exists to read;
 *   - the RINGS color source, so the comparison covers a LUT-sampled
 *     palette rather than flat per-slot colors;
 *   - the GROUND PLANE, which is what makes the frame worth
 *     comparing at all. This attractor is a sparse dust — ~1500 of
 *     504k pixels hit it — and a diff over a frame that is 99.7%
 *     backdrop barely moves when the geometry does: the flipped-band
 *     mutation below measured 0.79% of pixels off without the floor,
 *     against a 0.5% bound. The floor fills the lower frame with
 *     analytically-shaded, view-dependent pixels for almost no trace
 *     cost, and any band-projection error slides its horizon.
 */
const SCENE =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoicmluZ3MiLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJheGlzIjoieSJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMTcyNiwtMC4wNjU1LDAuMjQ1XSwicmFkaXVzIjowLjYyLCJ0aGV0YSI6MC43ODU0LCJwaGkiOjEuMDU2fSwiZ3JvdW5kUGxhbmUiOnRydWV9";

/** Bounds on the two slow waits. Generous against what this pose measures
 * under SwiftShader (settle 111s untiled / 18s under the pretended
 * ceiling, export ~100s an arm): a real timeout means the box is unusually
 * slow, not that the gate needs a longer bound. */
const SETTLE_TIMEOUT_MS = 300_000;
const SETTLE_POLL_MS = 2_000;
const EXPORT_TIMEOUT_MS = 300_000;

/** Tiling is a pixel-exact operation everywhere except the march-start
 * DITHER, which hashes the pixel's coordinates in ITS OWN raster — so a
 * band's noise phase differs from the whole image's, and a thin scatter of
 * pixels resolves a hair differently along silhouettes. These bounds admit
 * that and nothing structural: a wrong sub-frustum sign, a band-height eps
 * or a repeated gradient all move a large FRACTION of the frame, orders of
 * magnitude past this. */
const MEAN_DIFF_MAX = 0.5;
const OVER8_FRACTION_MAX = 0.005;

const failures = [];
function check(ok, label) {
  console.error(`[export-tile] ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

/** Open a <details class="panel-section"> if it is closed — savePngBtn is
 * unclickable inside a collapsed one, and re-clicking an open summary
 * would toggle it shut (capture-export.verify.mjs's openPanelSection). */
async function openPanelSection(page, sectionId) {
  const isOpen = await page.$eval(`#${sectionId}`, (el) => el.open);
  if (!isOpen) {
    await page.click(`#${sectionId} summary`);
    await page.waitForTimeout(150);
  }
}

/** One arm: load the pinned scene, enter Surface, settle, Save PNG.
 * Resolves the PNG bytes plus what the run disclosed about itself. */
async function runArm(ctx, label, maxRays) {
  const page = await ctx.newPage();
  const tiles = [];
  let computeActive = false;
  let fitted = false;
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("WebGPU compute tracer active")) computeActive = true;
    // The live pane's own fit under the same device ray ceiling — a
    // capture tiles, a live frame cannot, so it traces smaller and blits
    // up, disclosing itself once per session.
    if (/^Surface compute: tracing \d+x\d+ for a/.test(t)) fitted = true;
    const tile = /Surface compute export tile (\d+)\/(\d+)/.exec(t);
    if (tile) tiles.push(Number(tile[2]));
  });
  page.on("pageerror", (e) => {
    check(false, `${label}: page error ${e.message}`);
  });
  const query =
    maxRays === null
      ? "surfacestate"
      : `surfacestate&surfacemaxrays=${String(maxRays)}`;
  await page.goto(`${BASE}/?${query}${SCENE}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__surfaceState !== undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);

  await page.click("#modeSurfaceBtn");
  const t0 = Date.now();
  let settled = false;
  while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
    await page.waitForTimeout(SETTLE_POLL_MS);
    settled = await page.evaluate(
      () => window.__surfaceState?.().settled === true,
    );
    if (settled) break;
  }
  check(
    settled,
    `${label}: settled (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  check(computeActive, `${label}: ran the WebGPU compute tracer`);

  await openPanelSection(page, "captureSection");
  const dl = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS });
  const c0 = Date.now();
  await page.click("#savePngBtn");
  let bytes = null;
  try {
    const download = await dl;
    const file = await download.path();
    bytes = await readFile(file);
  } catch (err) {
    check(false, `${label}: Save PNG produced a download (${err.message})`);
  }
  check(
    bytes !== null,
    `${label}: exported (${((Date.now() - c0) / 1000).toFixed(1)}s, ` +
      `${bytes === null ? "no file" : `${(bytes.length / 1024).toFixed(0)}KB`})`,
  );
  await page.close();
  return {
    bytes,
    fitted,
    tiles: tiles.length === 0 ? 0 : tiles[0],
    tileLines: tiles.length,
  };
}

/** Decode two PNGs in the browser (no image dependency in this repo) and
 * report how far apart they are. */
async function comparePngs(page, a, b) {
  return page.evaluate(
    async ([aB64, bB64]) => {
      const decode = async (b64) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const bitmap = await createImageBitmap(
          new Blob([buf], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const x = await decode(aB64);
      const y = await decode(bB64);
      if (x.width !== y.width || y.height !== x.height) {
        return {
          width: x.width,
          height: x.height,
          other: `${y.width}x${y.height}`,
        };
      }
      let sum = 0;
      let max = 0;
      let over8 = 0;
      const px = x.width * x.height;
      for (let i = 0; i < px; i++) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i * 4 + c] - y.data[i * 4 + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > max) max = worst;
        if (worst > 8) over8++;
      }
      return {
        width: x.width,
        height: x.height,
        meanDiff: sum / (px * 3),
        maxDiff: max,
        over8: over8 / px,
      };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

async function main() {
  const launchArgs = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (DISPLAY) launchArgs.push("--no-sandbox");
  else {
    launchArgs.push(
      "--headless=new",
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
    );
  }
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new above: the combination that keeps a GPU process
    args: launchArgs,
    ...(DISPLAY ? { env: { ...process.env, DISPLAY } } : {}),
  });
  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 900, height: 560 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    const untiled = await runArm(ctx, "untiled", null);
    const tiled = await runArm(ctx, "tiled", MAX_RAYS);
    if (args.out !== undefined && untiled.bytes && tiled.bytes) {
      await writeFile(`${args.out}/export-untiled.png`, untiled.bytes);
      await writeFile(`${args.out}/export-tiled.png`, tiled.bytes);
      console.error(
        `[export-tile] wrote ${args.out}/export-{untiled,tiled}.png`,
      );
    }
    check(untiled.tiles === 1, `untiled: one tile (saw ${untiled.tiles})`);
    check(
      tiled.tiles > 1 && tiled.tileLines === tiled.tiles,
      `tiled: ${tiled.tiles} bands, all ${tiled.tileLines} traced`,
    );
    // The live pane's fit under the same ceiling: the arm with a ceiling
    // discloses it, the arm without never fits anything.
    check(tiled.fitted, "tiled: the live pane fitted under the ceiling");
    check(!untiled.fitted, "untiled: the live pane traced its full raster");
    if (untiled.bytes && tiled.bytes) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?surfacegl`, { waitUntil: "load" });
      const diff = await comparePngs(page, untiled.bytes, tiled.bytes);
      await page.close();
      if (diff.other) {
        check(
          false,
          `same export size (${diff.width}x${diff.height} vs ${diff.other})`,
        );
      } else {
        console.error(
          `[export-tile] diff ${diff.width}x${diff.height}: mean ` +
            `${diff.meanDiff.toFixed(4)}/255, max ${String(diff.maxDiff)}, ` +
            `${(diff.over8 * 100).toFixed(3)}% of pixels off by >8`,
        );
        check(
          diff.meanDiff < MEAN_DIFF_MAX,
          `mean channel diff ${diff.meanDiff.toFixed(4)} < ${String(MEAN_DIFF_MAX)}`,
        );
        check(
          diff.over8 < OVER8_FRACTION_MAX,
          `pixels off by >8: ${(diff.over8 * 100).toFixed(3)}% < ` +
            `${String(OVER8_FRACTION_MAX * 100)}%`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  console.error(
    failures.length === 0
      ? "[export-tile] PASS"
      : `[export-tile] FAIL (${String(failures.length)}): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
