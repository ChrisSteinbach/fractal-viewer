#!/usr/bin/env node
/**
 * The curved-glass starters' FIRST PREVIEWS in the built app, frame by
 * frame: which raster each preview frame traced (the preview governor's
 * rung), how many samples, its wall, whether the 2 s preview budget
 * truncated it, and its transport's replay passes — from the menu to the
 * settle latch. It answers one question the renderer-only envelope leg
 * cannot: what the governor does with a glass preview whose floor is the
 * longest serial trace rather than its pixel count ("Cold frames" in
 * docs/sphere-inversion-family.md). Measures, gates nothing.
 *
 *   npm run build && npm run preview &
 *   node scripts/si-glass-preview-rungs.probe.mjs --mode=x11::0 [--only=glassPearls]
 */
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";
import {
  loadPreset,
  loadSiPresets,
  openApp,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  }),
);
const url = args.url ?? "https://localhost:4173";
const mode = args.mode ?? "sw";
const settleMs = Number(args.settle ?? 300_000);
const log = (line) => console.log(`[si-rungs] ${line}`);

const starters = (await loadSiPresets({ glass: true })).filter(
  (p) => !args.only || args.only.split(",").includes(p.key),
);
const browser = await launchSurfaceBrowser(mode);
try {
  for (const starter of starters) {
    const app = await openApp(browser, { url, query: "surfacetrace" });
    const lines = [];
    app.page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("[surfacetrace]")) lines.push([Date.now(), t]);
    });
    try {
      const t0 = Date.now();
      await loadPreset(app.page, starter.key);
      const settled = await waitSettled(app.page, settleMs);
      log(`${starter.key}: settled=${settled.ok} after ${Date.now() - t0} ms`);
      // One row per frame: its start line (raster, samples, budget) and
      // its done line (truncation), with the transport's passes between.
      let frame = null;
      for (const [at, t] of lines) {
        const start =
          /frame start sample=(\d+) samples=(\d+) .*rays=(\d+) .*budgetMs=(\S+)/.exec(
            t,
          );
        if (start) {
          frame = {
            at: at - t0,
            sample: start[1],
            samples: start[2],
            rays: start[3],
            budget: start[4],
            passes: "-",
          };
          continue;
        }
        const passes =
          /transport done final resolved=\d+ unresolved=\d+ .*passes=(\d+)/.exec(
            t,
          );
        if (passes && frame) frame.passes = passes[1];
        const cut = /budget truncated \((.+?)\)(?: tail=(\w+))?/.exec(t);
        if (cut && frame)
          frame.cut = `${cut[1]}${cut[2] ? ` tail=${cut[2]}` : ""}`;
        if (/tail yielded/.test(t) && frame) frame.cut = "tail yielded";
        const done = /frame done .*truncated=(\w+)/.exec(t);
        if (done && frame) {
          log(
            `  +${String(frame.at).padStart(6)} ms  rays=${frame.rays.padStart(7)}  sample ${frame.sample}/${frame.samples}  budget=${frame.budget}  wall=${at - t0 - frame.at} ms  truncated=${done[1]}${frame.cut ? ` (${frame.cut})` : ""}  passes=${frame.passes}`,
          );
          frame = null;
        }
      }
    } finally {
      await app.context.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
