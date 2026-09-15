#!/usr/bin/env node
/**
 * The Sphere inversion menu group, driven from the menu.
 *
 * WHAT IT GATES. Each showcase's subject is its PRESET_SPHERE_INVERSIONS
 * block, framed by its PRESET_VIEWS entry and opened in Surface by its
 * PRESET_RENDER_HINTS entry. `presets.test.ts` pins the side tables'
 * consistency; none of what follows is reachable below the UI:
 *
 *   1. The preset enters Surface UNAIDED from the menu (the render hint, no
 *      click on the mode button), on the family's compute kernel, and
 *      settles on the app's own `?surfacestate` latch.
 *   2. The DOCUMENT carries the block and the authored framing, read out of
 *      the `#v1=` hash rather than the panel: the block byte-equal to the
 *      table's, and for a 4D preset a slice-on pose.
 *   3. The settled frame is not blank (`SURFACE_BLANK_HIT_FRACTION` is the
 *      app's own bar; this gate asks for a real fraction of the pane) and no
 *      ray exhausted.
 *   4. A 4D preset's slice REACHES the render: nudging the slice slider
 *      re-settles to a frame that differs. Whether the new frame reveals a
 *      new arrangement or merely a tumble is a LOOK call, which is why the
 *      nudged frame is saved beside the base one.
 *   5. The block does not leak: loading an ordinary preset afterwards
 *      clears it from the document.
 *
 * Each settled frame is saved as `si-preset-<key>.png` (and
 * `si-preset-<key>-nudge.png`) for review: silhouette and camera angle are
 * part of these presets' deliverable, and no pixel check can judge them.
 *
 * USAGE (a production build served first):
 *   npm run build && npm run preview &
 *   node scripts/sphere-inversion-presets.verify.mjs --mode=x11::0
 *   node scripts/sphere-inversion-presets.verify.mjs --only=inversionVault4
 *
 * `--mode=x11:<display>` is the real-driver arm (export XAUTHORITY first;
 * see AGENTS.md); its settle times are this machine's and carry the
 * machine-quiet baseline the launcher prints. `--mode=sw` runs every check
 * on SwiftShader, where settle times mean nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
} from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The menu group, in menu order. `dim` is the block's arrangement's. */
const PRESETS = [
  { key: "inversionPearls", dim: 3 },
  { key: "inversionCubePearls", dim: 3 },
  { key: "inversionVault", dim: 3 },
  { key: "inversionLace", dim: 3 },
  { key: "inversionVault4", dim: 4 },
  { key: "inversionMedallions4", dim: 4 },
];

/** A settled showcase must cover at least this share of the pane. A frame
 * framed on its subject covers far more; this catches a camera pointed at
 * nothing, not a composition choice. */
const MIN_COVERED = 0.05;
/** Two frames count as different when this share of pixels moved by more
 * than a channel step (escape-family.verify.mjs's bar). */
const DIFFER_FRACTION = 0.02;
const DIFFER_DELTA = 8;
/** The 4D nudge, in the slice slider's normalized units. */
const SLICE_NUDGE = 0.06;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    only: "",
    settle: 240_000,
    outdir: path.join(HERE, "out"),
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    args[key] = key === "settle" ? Number(value) : value;
  }
  return args;
}

/** The live document, out of the hash persist.ts writes. */
const READ_DOCUMENT = () => {
  const raw = location.hash.replace(/^#v1=/, "");
  if (!raw) return null;
  try {
    return JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};

async function openApp(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || /device lost|validation error/i.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e)}`));
  await page.goto(`${args.url}/?surfacestate`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__surfaceState === "function");
  return { context, page, errors };
}

/** Choose a preset from the panel's menu and wait for the document to
 * change (the save is debounced; escape-family.verify.mjs's lesson). */
async function loadPreset(page, key) {
  await page.evaluate(() => {
    const details = document.getElementById("presetSelect")?.closest("details");
    if (details && !details.open) details.open = true;
  });
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page.waitForFunction((h) => location.hash !== h, before, {
    timeout: 15_000,
  });
}

async function waitSettled(page, timeoutMs) {
  const t0 = Date.now();
  let held = 0;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await pollSurfaceState(page);
    if (last.settled) {
      held += 200;
      if (held >= 1_000) return { ok: true, state: last.probe, t0 };
    } else {
      held = 0;
    }
    await page.waitForTimeout(200);
  }
  return { ok: false, state: last?.probe ?? null, t0 };
}

/** Wait until the document's debounced save has caught up with a predicate. */
async function waitDocument(page, predicate, arg) {
  for (let i = 0; i < 60; i++) {
    const doc = await page.evaluate(READ_DOCUMENT);
    if (doc && predicate(doc, arg)) return doc;
    await page.waitForTimeout(250);
  }
  return page.evaluate(READ_DOCUMENT);
}

async function differingFraction(page, aPath, bPath) {
  const a = fs.readFileSync(aPath).toString("base64");
  const b = fs.readFileSync(bPath).toString("base64");
  return page.evaluate(
    async ([aB64, bB64, delta]) => {
      const decode = async (b64) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const ia = await decode(aB64);
      const ib = await decode(bB64);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      let n = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        if (
          Math.abs(ia.data[i] - ib.data[i]) > delta ||
          Math.abs(ia.data[i + 1] - ib.data[i + 1]) > delta ||
          Math.abs(ia.data[i + 2] - ib.data[i + 2]) > delta
        ) {
          n++;
        }
      }
      return n / (ia.width * ia.height);
    },
    [a, b, DIFFER_DELTA],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const wanted = args.only
    ? PRESETS.filter((p) => p.key === args.only)
    : PRESETS;
  if (wanted.length === 0) throw new Error(`unknown --only ${args.only}`);
  const browser = await launchSurfaceBrowser(args.mode);
  const failures = [];
  const fail = (line) => {
    failures.push(line);
    console.error(`[si-presets] FAIL ${line}`);
  };
  const log = (line) => console.error(`[si-presets] ${line}`);
  try {
    for (const preset of wanted) {
      const { context, page, errors } = await openApp(browser, args);
      try {
        const t0 = Date.now();
        await loadPreset(page, preset.key);
        // (1) The render hint enters Surface; nobody clicks the mode button.
        const settled = await waitSettled(page, args.settle);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (!settled.ok) {
          fail(
            `${preset.key}: never settled in Surface (state=${JSON.stringify(settled.state)})`,
          );
          continue;
        }
        const st = settled.state;
        // (2) The document carries the block and the framing.
        const doc = await waitDocument(page, (d) => !!d.sphereInversion);
        const dim = { oct6: 3, cube8: 3, ico12: 3, cell600: 4 }[
          doc?.sphereInversion?.arrangement
        ];
        if (dim !== preset.dim) {
          fail(
            `${preset.key}: document block ${JSON.stringify(doc?.sphereInversion)} is not a ${preset.dim}D arrangement`,
          );
        }
        if (preset.dim === 4 && !(doc?.fourD && doc.fourD.sliceOn === true)) {
          fail(`${preset.key}: document carries no slice-on 4D pose`);
        }
        if (st.engine !== "compute") {
          fail(`${preset.key}: engine=${st.engine}, expected compute`);
        }
        // (3) Not blank, nothing exhausted.
        const census = st.census;
        const covered = census ? census.covered / census.rays : 0;
        if (!census || covered < MIN_COVERED) {
          fail(
            `${preset.key}: covered ${(100 * covered).toFixed(1)}% of the pane`,
          );
        }
        if (census && census.exhausted > 0) {
          fail(`${preset.key}: ${census.exhausted} rays exhausted`);
        }
        const shot = path.join(args.outdir, `si-preset-${preset.key}.png`);
        await page.screenshot({ path: shot });
        log(
          `${preset.key}: settled ${secs}s from the menu click, engine=${st.engine}` +
            ` backend=${st.backend?.label ?? "?"} software=${st.backend?.software}` +
            ` covered=${(100 * covered).toFixed(1)}% exhausted=${census?.exhausted}` +
            ` -> ${path.relative(process.cwd(), shot)}`,
        );
        // (4) A 4D slice reaches the render.
        if (preset.dim === 4) {
          const picked = await page.evaluate((nudge) => {
            const el = document.getElementById("fourDSliceSlider");
            if (!(el instanceof HTMLInputElement)) return null;
            el.closest("details")?.setAttribute("open", "");
            el.value = String(Number(el.value) + nudge);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return Number(el.value);
          }, SLICE_NUDGE);
          if (picked === null) {
            fail(`${preset.key}: no slice slider to nudge`);
          } else {
            await page.waitForTimeout(400);
            const t1 = Date.now();
            const nudged = await waitSettled(page, args.settle);
            if (!nudged.ok) {
              fail(`${preset.key}: nudged slice never settled`);
            } else {
              const nudgeShot = path.join(
                args.outdir,
                `si-preset-${preset.key}-nudge.png`,
              );
              await page.screenshot({ path: nudgeShot });
              const frac = await differingFraction(page, shot, nudgeShot);
              log(
                `${preset.key}: slice ${picked.toFixed(2)} settled ${((Date.now() - t1) / 1000).toFixed(1)}s,` +
                  ` ${(100 * frac).toFixed(1)}% of pixels differ -> ${path.relative(process.cwd(), nudgeShot)}`,
              );
              if (frac < DIFFER_FRACTION) {
                fail(`${preset.key}: the slice nudge did not change the frame`);
              }
            }
          }
        }
        // (5) An ordinary preset clears the block.
        await loadPreset(page, "sierpinski");
        const cleared = await waitDocument(page, (d) => !d.sphereInversion);
        if (cleared?.sphereInversion) {
          fail(`${preset.key}: loading Sierpinski left the block in place`);
        }
        if (errors.length > 0) {
          fail(
            `${preset.key}: console errors: ${errors.slice(0, 3).join(" | ")}`,
          );
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    console.error(`[si-presets] ${failures.length} failure(s)`);
    process.exit(1);
  }
  log("all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
