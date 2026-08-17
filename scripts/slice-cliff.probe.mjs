/**
 * fr-b8o5 REPRODUCTION PROBE — is an off-centre 4D w-slice really 20-40x
 * more expensive to settle than `w = 0`, and on which arm?
 *
 * The bead measured the cliff in the app on real Iris (kaleido4, fragment
 * arm, `?surfperf` evidence logging) but never isolated the mechanism, and a
 * CPU sweep of the same scenes through `scripts/de-preview.ts` does not
 * reproduce it at all. This probe is the smallest thing that can tell those
 * apart: one settle, timed, per (scene, arm, slice) cell, driven entirely
 * from the app's own UI and read off the fr-opgk `?surfacestate` latch —
 * `settled` means a COMPLETED full-quality frame for the CURRENT view, which
 * is the only signal that cannot freeze on a preview/settle mix.
 *
 * The slice is set through the 4D View section's `#fourDSliceSlider` with a
 * programmatic value + `input`/`change` (not ArrowRight), so a cell is ONE
 * pose rather than a burst of coalesced re-arms — the shape fr-b8o5's own
 * follow-up (fr-7to5) had to fix separately, and one this probe must not
 * re-enter.
 *
 * Each cell reloads the page, so no session state carries across: the bead's
 * "pose-intrinsic, not session state" claim is re-tested rather than
 * inherited. It also PARKS THE 4D TUMBLE before entering surface mode —
 * on by default, and a tumbling session re-arms every frame, so `settled`
 * never latches and every cell would read as a timeout measuring the
 * auto-motion instead of the pose.
 *
 * Usage (needs a real display and a served production build):
 *   npm run build && npm run preview &
 *   node scripts/slice-cliff.probe.mjs [url] [--display=:0] [--arm=gl|compute|both]
 *     [--slices=0,0.01,0.3] [--scenes=plain4,kaleido4] [--timeout=180]
 *     [--settle=1] [--live=1]
 *
 * Prints one line per cell: engine, first-frame ms, preview ms, settle ms,
 * and the ratio against that (scene, arm)'s own FIRST cell. Exit 0 always —
 * this is an instrument, not a gate.
 *
 * MEASURED (2026-08-17, real Iris Xe TGL GT2 through ANGLE/Mesa, 1024x640,
 * production build, identity rotor, one fresh session per cell, `--settle=1`):
 *
 *   plain4, slice 0 / .005 / .01 / .02 / .05 / .1 / .2 / .3 / .5, then slice
 *   0 AGAIN as a drift control:
 *     WebGL    12079 12130 11868 12202 11856 11520 11483 9111 9580 | 11954 ms
 *     compute   3034  3039  3188  2992  3127  3042  3114 2984 2979 |  2986 ms
 *
 * FLAT — and slightly CHEAPER off centre — on BOTH arms, with the repeated
 * `slice 0` cell landing within 1-2% of the opening one, so the sweep is not
 * drifting. An earlier run of the same sweep with the rotor left to tumble
 * 1.5s before parking read 11905...8734 (WebGL) and 3085...2853 (compute):
 * same shape, so this scene's cost is not strongly pose-dependent either.
 * THE 20-40x CLIFF DOES NOT REPRODUCE on this build. The bead's own figures
 * came from the strip planner's `surfacePreviewPxCostMs` evidence chain
 * BEFORE fr-7to5 taught it to adopt an orphaned job's fences; that bead's
 * closing note already records the same chain reading ~90x high on one
 * attributed job, which is the size of the effect the cliff was.
 *
 * WHAT THE PROBE DID FIND, and what fr-fniy should read: `kaleido4` — two
 * maps at kaleidoscope order 6 — is a different order of problem entirely,
 * and NOT a slice one. Its full-quality settle at `w0 = 0` on the WebGL arm
 * measured 444.0s with the rotor drifted 1.5s before parking; its preview
 * alone needed ~49s to cover the raster at that pose. That is fr-b72d's
 * measured superlinear order cost (x13.5 per query at order 6 on the CPU
 * oracle, matched on the GPU), not anything the slice slider does — the same
 * scene's cost is flat across the same slice sweep.
 *
 * AND AN INSTRUMENT GAP, for whoever picks fr-fniy up: the COMPUTE arm
 * cannot be measured on a kaleidoscope-4D scene at all from the outside.
 * `?surfacegl` forces WebGL and there is no force-COMPUTE counterpart, while
 * main.ts routes every order > 1 non-fold 4D session to the fragment tracer
 * regardless — so this probe's `--arm=compute` silently measures the
 * fragment arm again on such a scene (the printed `engine` column is what
 * says so).
 */
import process from "node:process";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const BASE = (
  args.find((a) => !a.startsWith("--")) ?? "https://localhost:4173"
).replace(/\/+$/, "");
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DISPLAY = flag("display", ":0");
const ARM = flag("arm", "both");
const SLICES = flag("slices", "0,0.01,0.05,0.3")
  .split(",")
  .map((s) => Number(s));
const SCENE_FILTER = flag("scenes", "plain4,kaleido4").split(",");
const TIMEOUT_MS = Number(flag("timeout", "180")) * 1000;
/** Off by default: the full-quality settle outruns any usable window on the
 * expensive poses this probe exists to find, so the PREVIEW's completion is
 * the cost the sweep reads. `--settle=1` waits for the real thing. */
const WAIT_SETTLE = flag("settle", "0") === "1";
/** `--live=1` reproduces the bead's OWN shape: settle at slice 0 first, then
 * move the slider on the LIVE session and time the re-settle. `--live=0`
 * (default) sets the pose BEFORE entering surface, so the cell measures a
 * fresh session at that pose and nothing else. */
const LIVE = flag("live", "0") === "1";
/** Milliseconds of ambient 4D TUMBLE to let run before parking it. 0 — the
 * default — pairs with `emulateMedia({reducedMotion: "reduce"})` so the
 * session boots with auto-motion OFF and the rotor still at its identity
 * default, which is what `scripts/surface-4d.verify.mjs` pins and what makes
 * two cells comparable. Anything above 0 deliberately DRIFTS the rotor
 * first: the pose picks which 3D hyperplane is cut, so this is the knob that
 * separates a slice-offset effect from a rotor effect. */
const TUMBLE_MS = Number(flag("tumble", "0"));

/** The two affine 4D scenes `scripts/surface-4d.verify.mjs` mints, verbatim —
 * `kaleido4` is the scene fr-b8o5 measured. */
const SCENES = {
  plain4:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNSwicm90YXRpb24iOnsieHciOjAuM319fSx7InBvc2l0aW9uIjpbLTAuMjUsMC40MywwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMjUsLTAuNDMsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MX0",
  kaleido4:
    "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6MC40LCJyb3RhdGlvbiI6eyJ4dyI6MC4zfX19LHsicG9zaXRpb24iOlstMC40LC0wLjIsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6LTAuNCwicm90YXRpb24iOnsieXciOjAuM319fV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjo2LCJwbGFuZSI6Inh6IiwidHdpc3QiOjF9LCJnbG93QnJpZ2h0bmVzcyI6MX0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cell(browser, scene, hash, arm, slice) {
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 640 },
    ignoreHTTPSErrors: true,
    // The 4D verify scripts' own pattern: reduced motion makes
    // `viewer-prefs.ts`'s never-chosen `autoMotion` boot OFF, so the rotor
    // stays at its identity default and the tumble never invalidates a
    // frame. Skipped when a cell deliberately wants the rotor drifted.
    ...(TUMBLE_MS > 0 ? {} : { reducedMotion: "reduce" }),
  });
  const page = await ctx.newPage();
  const query = arm === "gl" ? "?surfacestate&surfacegl" : "?surfacestate";
  const out = {
    scene,
    arm,
    slice,
    engine: null,
    firstFrameMs: null,
    previewMs: null,
    settleMs: null,
    note: "",
  };
  try {
    await page.goto(`${BASE}/${query}#${hash}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector("#modeSurfaceBtn", { timeout: 30000 });
    await sleep(1500 + TUMBLE_MS);
    // PARK THE 4D TUMBLE. Reduced motion above already boots it off, but a
    // `--tumble=N` cell has been drifting on purpose and must be stopped
    // here: a tumbling session re-arms every frame, so `settled` never
    // latches and the cell would time out measuring the auto-motion rather
    // than the pose.
    const parked = await page.evaluate(() => {
      const el = document.querySelector("#fourDTumbleToggle");
      if (!(el instanceof HTMLInputElement)) return false;
      if (el.checked) el.click();
      return el.checked === false;
    });
    if (!parked) out.note = "tumble not parked";
    await sleep(400);
    // The 4D View section is collapsed by default under surfaceLookSection's
    // auto-open, so reach the slider through the DOM rather than a click.
    const setSlice = (v) =>
      page.evaluate((x) => {
        const el = document.querySelector("#fourDSliceSlider");
        if (!(el instanceof HTMLInputElement)) return false;
        el.value = String(x);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, v);
    if (!LIVE && slice !== 0) {
      if (!(await setSlice(slice))) out.note = "no #fourDSliceSlider";
      await sleep(500);
    }
    let t0 = Date.now();
    await page.click("#modeSurfaceBtn");
    if (LIVE && slice !== 0) {
      // Settle the CENTRE slice first, then move the slider on the live
      // session and restart the clock — the bead's own protocol.
      const settleDeadline = Date.now() + TIMEOUT_MS;
      for (;;) {
        const st = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        if (st?.settled) break;
        if (Date.now() > settleDeadline) {
          out.note = `${out.note} PRESETTLE-TIMEOUT`.trim();
          break;
        }
        await sleep(150);
      }
      if (!(await setSlice(slice))) out.note = "no #fourDSliceSlider";
      // The slider write does not clear `settled` synchronously — main.ts
      // invalidates on its next tick — so wait for the latch to DROP before
      // timing the re-settle, or every live cell reads back the pre-settle.
      const clearDeadline = Date.now() + 5000;
      for (;;) {
        const st = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        if (!st?.settled) break;
        if (Date.now() > clearDeadline) {
          out.note = `${out.note} NO-INVALIDATION`.trim();
          break;
        }
        await sleep(50);
      }
      t0 = Date.now();
    }
    let first = null;
    let sawPreview = false;
    const deadline = t0 + TIMEOUT_MS;
    for (;;) {
      const st = await page.evaluate(() =>
        window.__surfaceState ? window.__surfaceState() : null,
      );
      if (st) {
        if (st.engine) out.engine = st.engine;
        if (st.firstFrame && first === null) {
          first = Date.now() - t0;
          out.firstFrameMs = first;
        }
        if (st.previewActive) sawPreview = true;
        // The preview's completion is reported beside the settle and is
        // what `--settle=0` stops at — useful on the poses whose FULL
        // settle outruns any usable window (kaleidoscope order 6), where a
        // preview still covers the whole raster once and prices it.
        if (sawPreview && !st.previewActive && out.previewMs === null) {
          out.previewMs = Date.now() - t0;
        }
        if (st.settled) {
          out.settleMs = Date.now() - t0;
          break;
        }
        if (out.previewMs !== null && !WAIT_SETTLE) break;
      }
      if (Date.now() > deadline) {
        out.note = `${out.note} TIMEOUT`.trim();
        break;
      }
      await sleep(150);
    }
  } catch (err) {
    out.note = `${out.note} ERR ${String(err).slice(0, 120)}`.trim();
  } finally {
    await ctx.close();
  }
  return out;
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: false,
  env: { ...process.env, DISPLAY },
  args: [
    "--ignore-certificate-errors",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
  ],
});

const arms = ARM === "both" ? ["gl", "compute"] : [ARM];
const rows = [];
for (const scene of SCENE_FILTER) {
  const hash = SCENES[scene];
  if (!hash) continue;
  for (const arm of arms) {
    let base = null;
    for (const [i, slice] of SLICES.entries()) {
      const r = await cell(browser, scene, hash, arm, slice);
      const cost = WAIT_SETTLE ? r.settleMs : r.previewMs;
      // Only the FIRST cell sets the baseline, by index rather than by
      // value: repeating an offset at the end of the sweep is the drift
      // control, and it has to read its own ratio against the opening cell
      // rather than re-baselining to itself.
      if (i === 0) base = cost;
      const ratio = base && cost ? (cost / base).toFixed(2) : "   -";
      rows.push(r);
      console.log(
        `${scene.padEnd(9)} ${arm.padEnd(8)} slice ${String(slice).padStart(5)}` +
          `  engine ${String(r.engine).padEnd(7)}` +
          `  first ${String(r.firstFrameMs ?? "-").padStart(6)}ms` +
          `  preview ${String(r.previewMs ?? "-").padStart(7)}ms` +
          `  settle ${String(r.settleMs ?? "-").padStart(7)}ms` +
          `  x ${String(ratio).padStart(6)}  ${r.note}`,
      );
    }
  }
}
await browser.close();
console.log(`\n${String(rows.length)} cells.`);
