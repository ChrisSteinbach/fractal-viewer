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
  differingFraction,
  loadSiPresets,
  loadPreset,
  openApp,
  sameJson,
  waitDocument,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The menu group, in table order, read from `presets.ts`. */
const PRESETS = await loadSiPresets();

/** A settled showcase must cover at least this share of the pane. A frame
 * framed on its subject covers far more; this catches a camera pointed at
 * nothing, not a composition choice. */
const MIN_COVERED = 0.05;
/** Two frames count as different when this share of pixels moved by more
 * than a channel step (escape-family.verify.mjs's bar). */
const DIFFER_FRACTION = 0.02;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const only = args.only ? args.only.split(",") : null;
  const wanted = only ? PRESETS.filter((p) => only.includes(p.key)) : PRESETS;
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
      const { context, page, errors } = await openApp(browser, {
        url: args.url,
      });
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
        if (!sameJson(doc?.sphereInversion, preset.block)) {
          fail(
            `${preset.key}: document block ${JSON.stringify(doc?.sphereInversion)} is not the table's ${JSON.stringify(preset.block)}`,
          );
        }
        // The view lands with the cloud, AFTER the load's own debounced save,
        // so the hash can predate it (as it predates every preset's
        // auto-fit): read the 4D pose off the live slice controls instead.
        if (preset.dim === 4) {
          const slice = await page.evaluate(() => ({
            on: document.getElementById("fourDSliceToggle")?.checked ?? null,
            value: Number(
              document.getElementById("fourDSliceSlider")?.value ?? NaN,
            ),
          }));
          if (slice.on !== true || !(Math.abs(slice.value) > 0)) {
            fail(
              `${preset.key}: the authored slice did not land (${JSON.stringify(slice)})`,
            );
          }
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
              // Decoded on a blank page: the app's own isolation headers
              // refuse the data: fetch the decoder uses.
              const diffPage = await context.newPage();
              await diffPage.goto("about:blank");
              const frac = await differingFraction(diffPage, shot, nudgeShot);
              await diffPage.close();
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
