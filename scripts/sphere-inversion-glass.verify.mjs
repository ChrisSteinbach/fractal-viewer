#!/usr/bin/env node
/**
 * The curved-glass starters' built-app gate: the sphere-inversion family's
 * Glass material, driven from the menu of a production build on a REAL
 * adapter, in both dimensions.
 *
 * `scripts/sphere-inversion-family.verify.mjs` qualifies the family's opaque
 * showcases; this is its sibling for the Glass group's sphere-inversion
 * starters (`glassPearls`, `glassPearls4`), sharing its browser vocabulary
 * (`scripts/lib/sphere-inversion-gate.mjs`) so "loaded from the menu",
 * "settled" and "byte-identical" mean one thing in both. The starters are
 * read from `presets.ts` (`loadSiPresets({ glass: true })`), never listed.
 *
 * PER STARTER (phase `starters`):
 *
 *   1. Chosen FROM THE MENU, it enters Surface unaided and holds the
 *      `?surfacestate` settle latch.
 *   2. The session is glass: engine compute, a real adapter
 *      (software=false on `x11:`), opticsBackend "sphereInversion".
 *   3. The settled census covers a real share of the pane with no exhausted
 *      ray, and the final settle's `?surfacetrace` feed has every antialias
 *      sample complete with resolved optical work. The resolved / unresolved
 *      / invalid split is RECORDED, and the resolved share must reach
 *      `--min-resolved`: this backend's residue is the transport's path cap
 *      and traversal refusals (the family doc's agreement section), which
 *      the envelope work measures, so a share rather than zero is the bar.
 *   4. The document read out of the `#v1=` hash carries the starter's block
 *      field for field (materials included); a 4D starter also carries its
 *      posed rotor and ZERO slab thickness, the one pose condition the
 *      glass backend needs.
 *   5. The Copy link string boots a fresh context whose settled frame is
 *      byte-identical to the menu's, and the link THAT session copies is the
 *      same document (a link is a fixed point).
 *   6. Save PNG at `--scale`: the whole-image export, recorded as the
 *      identity reference for the tiled leg.
 *   6b. 4D ONLY, POSES: the slab-thickness slider is unavailable with its
 *      reason (the family's one pose refusal), and scrubbing the slice
 *      mid-session keeps the glass backend, settles a different object and
 *      keeps the resolved share.
 *   7. THE BENDING CONTROL: the Material row switched to Classic in the same
 *      session settles an opaque frame at the same pose; the glass frame
 *      must differ from it over at least `--min-bent` of the pane. What
 *      differs is the object's interior (refracted floor, Fresnel rims, Beer
 *      tint) — the opaque control's pixels are the shaded seed orbit.
 *
 * TILED (phase `tiled`, every starter): the same export under
 * `?surfacemaxrays=N` traces in more bands than leg 6 used, and is
 * BYTE-IDENTICAL to it. Export identity is the standing capture rule, and
 * the glass transport's per-band lane is the one piece of the capture path
 * this backend adds.
 *
 * COST: a glass settle at the app's default 8 antialias passes is minutes
 * (the family doc's routing section), so the gate supplies
 * `?surfacesamples=--samples` (default 1) to every leg. The identity legs
 * compare like with like at whatever count is given, and the count is
 * recorded. `--samples=8` reproduces the shipped settle.
 *
 * OUTPUT (gitignored): `scripts/out/si-glass-<key>.png` (menu frame),
 * `-reload.png`, `-classic.png`, `-export.png`, `-export-tiled.png`,
 * `si-glass-sheet.png` and `si-glass-results.json`.
 *
 * USAGE (a production build served first; the X cookie per AGENTS.md):
 *   npm run build && npm run preview &
 *   node scripts/sphere-inversion-glass.verify.mjs --mode=x11::0
 *
 * Exit 0 = pass, 1 = a check failed, 2 = the checking side broke.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { traceFrames } from "./lib/finite-glass-trace.mjs";
import {
  CLIPBOARD_STUB,
  READ_MENU_GROUP,
  captureScene,
  compareFrames,
  contactSheet,
  copyLink,
  decodeDocumentHash,
  differingFraction,
  imageContent,
  loadPreset,
  loadSiPresets,
  openApp,
  sameJson,
  savePng,
  settleFromLink,
  waitDocument,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Covered share of the pane a starter must reach (the family gate's). */
const MIN_COVERED = 0.05;
/** An export with content (the family gate's bars). */
const EXPORT_MIN_COLORS = 64;
const EXPORT_MIN_LUMA_STD = 4;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    only: "",
    phases: "starters,tiled",
    viewport: "960x540",
    samples: 1,
    settle: 900_000,
    exportTimeout: 1_800_000,
    scale: "1",
    maxrays: 200_000,
    "min-resolved": 0.9,
    "min-bent": 0.05,
    outdir: path.join(HERE, "out"),
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    args[key] = typeof args[key] === "number" ? Number(value) : value;
  }
  const [w, h] = args.viewport.split("x").map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`bad --viewport ${args.viewport}`);
  args.size = { width: w, height: h };
  if (!(Number.isInteger(args.samples) && args.samples >= 1))
    throw new Error(`bad --samples ${args.samples}`);
  return args;
}

const log = (line) => console.error(`[si-glass] ${line}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** The final settle's transport record, off the `?surfacetrace` feed: the
 * frames sharing the last frame's token, one per antialias sample. */
function finalTransport(consoleLines, samples) {
  const frames = traceFrames(consoleLines);
  const last = frames.at(-1);
  const final = last ? frames.filter((f) => f.token === last.token) : [];
  const errors = [];
  if (final.length !== samples)
    errors.push(`final settle has ${final.length}/${samples} samples`);
  let resolved = 0;
  let unresolved = 0;
  let invalid = 0;
  let hits = 0;
  for (const [i, frame] of final.entries()) {
    if (!frame.completed || frame.truncated)
      errors.push(`sample ${i}: incomplete or truncated`);
    if (frame.tallies.length !== 1) {
      errors.push(`sample ${i}: ${frame.tallies.length} transport tallies`);
      continue;
    }
    const t = frame.tallies[0];
    resolved += t.resolved;
    unresolved += t.unresolved;
    invalid += t.invalid;
    hits += frame.hit;
    if (t.resolved + t.unresolved + t.invalid !== frame.hit)
      errors.push(`sample ${i}: tally does not account for every glass hit`);
  }
  const traced = resolved + unresolved + invalid;
  return {
    samples: final.length,
    hits,
    resolved,
    unresolved,
    invalid,
    resolvedShare: traced > 0 ? resolved / traced : 0,
    wallMs: final.reduce((s, f) => s + (f.wallMs ?? 0), 0),
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const out = (name) => path.join(args.outdir, name);
  const phases = new Set(args.phases.split(",").filter(Boolean));
  const STARTERS = await loadSiPresets({ glass: true });
  const only = args.only ? args.only.split(",") : null;
  const wanted = only ? STARTERS.filter((p) => only.includes(p.key)) : STARTERS;
  if (wanted.length === 0) throw new Error(`unknown --only ${args.only}`);
  const contextOptions = { viewport: args.size };
  const query = `surfacetrace&surfacesamples=${args.samples}`;
  const settleArgs = { url: args.url, settle: args.settle };

  const browser = await launchSurfaceBrowser(args.mode);
  const failures = [];
  const fail = (line) => {
    failures.push(line);
    log(`FAIL ${line}`);
  };
  const results = {
    startedAt: new Date().toISOString(),
    mode: args.mode,
    url: args.url,
    viewport: args.viewport,
    samples: args.samples,
    scale: Number(args.scale),
    quiet: browser.gpuQuiet ?? null,
    starters: {},
    tiled: {},
  };
  const diffContext = await browser.newContext();
  const diffPage = await diffContext.newPage();
  await diffPage.goto("about:blank");
  // Both dimensions, or the gate says so: a 3D-only landing is not done.
  const dims = new Set(STARTERS.map((p) => p.dim));
  if (!(dims.has(3) && dims.has(4)))
    fail(`the glass starters cover dimensions ${[...dims]}, not 3 and 4`);
  // The table's glass starters must all be in the Glass menu group.
  {
    const app = await openApp(browser, { url: args.url, contextOptions });
    try {
      const menu = await app.page.evaluate(READ_MENU_GROUP, "glass");
      results.menuGroup = menu;
      const missing = STARTERS.filter((p) => !menu?.includes(p.key));
      if (missing.length)
        fail(
          `the Glass menu group ${JSON.stringify(menu)} lacks ${missing.map((p) => p.key)}`,
        );
      else log(`Glass menu group holds ${STARTERS.map((p) => p.key)}`);
    } finally {
      await app.context.close().catch(() => {});
    }
  }
  const exports = new Map();
  const sheet = [];

  try {
    if (phases.has("starters")) {
      for (const starter of wanted) {
        const key = starter.key;
        const r = (results.starters[key] = { dim: starter.dim });
        const app = await openApp(browser, {
          url: args.url,
          query,
          contextOptions,
          initScripts: [[CLIPBOARD_STUB]],
        });
        const { context, page, errors, consoleLines } = app;
        try {
          // (1) from the menu to the settle latch.
          const t0 = Date.now();
          await loadPreset(page, key);
          const settled = await waitSettled(page, args.settle);
          r.settleMs = Date.now() - t0;
          if (!settled.ok) {
            fail(`${key}: never settled (${JSON.stringify(settled.state)})`);
            continue;
          }
          // (2) a glass session on a real adapter.
          const st = settled.state;
          r.engine = st.engine;
          r.opticsBackend = st.opticsBackend;
          r.backend = st.backend;
          if (st.engine !== "compute")
            fail(`${key}: engine=${st.engine}, expected compute`);
          if (st.opticsBackend !== "sphereInversion")
            fail(`${key}: opticsBackend=${st.opticsBackend}, not glass`);
          if (args.mode.startsWith("x11:") && st.backend?.software !== false)
            fail(`${key}: backend ${JSON.stringify(st.backend)} is software`);
          // (3) coverage, exhaustion and the transport split.
          r.census = st.census
            ? {
                rays: st.census.rays,
                covered: st.census.covered,
                miss: st.census.miss,
                exhausted: st.census.exhausted,
              }
            : null;
          const covered = st.census ? st.census.covered / st.census.rays : 0;
          if (covered < MIN_COVERED)
            fail(`${key}: covered ${(100 * covered).toFixed(1)}% of the pane`);
          if (!st.census || st.census.exhausted > 0)
            fail(`${key}: ${st.census?.exhausted ?? "?"} rays exhausted`);
          const transport = finalTransport(consoleLines, args.samples);
          r.transport = transport;
          for (const e of transport.errors) fail(`${key}: ${e}`);
          if (transport.resolved <= 0) fail(`${key}: no resolved optical work`);
          if (transport.resolvedShare < args["min-resolved"])
            fail(
              `${key}: resolved ${(100 * transport.resolvedShare).toFixed(1)}% of glass hits, below ${100 * args["min-resolved"]}%`,
            );
          const frameFile = out(`si-glass-${key}.png`);
          await captureScene(page, frameFile);
          // The glass frame at the session's CURRENT pose, which the Classic
          // control is compared against (the 4D pose leg moves it).
          let glassFrame = frameFile;
          sheet.push({ label: `${key} (menu)`, file: frameFile });
          log(
            `${key}: settled ${secs(r.settleMs)}, engine=${st.engine} optics=${st.opticsBackend}` +
              ` backend=${st.backend?.label} software=${st.backend?.software}` +
              ` covered=${(100 * covered).toFixed(1)}% transport resolved=${transport.resolved}` +
              ` unresolved=${transport.unresolved} invalid=${transport.invalid}` +
              ` (${(100 * transport.resolvedShare).toFixed(2)}%)`,
          );

          // (4) the document.
          const doc = await waitDocument(page, (d) => !!d.sphereInversion);
          r.blockMatches = sameJson(doc?.sphereInversion, starter.block);
          if (!r.blockMatches)
            fail(
              `${key}: document block ${JSON.stringify(doc?.sphereInversion)} != table ${JSON.stringify(starter.block)}`,
            );
          if (starter.dim === 4) {
            // The pose rides the document's 4D block: the rotor pair, the
            // world slice and the slab thickness.
            const fourD = doc?.fourD ?? null;
            r.fourD = fourD;
            if ((fourD?.sliceThickness ?? NaN) !== 0)
              fail(
                `${key}: slab thickness ${fourD?.sliceThickness}, expected 0`,
              );
            const identity = (v) =>
              Array.isArray(v) &&
              v[0] === 1 &&
              v.slice(1).every((x) => x === 0);
            if (!fourD || (identity(fourD.p) && identity(fourD.q)))
              fail(`${key}: the document carries no posed rotor`);
          }

          // (5a) the share link.
          const link = await copyLink(page);
          if (!link) fail(`${key}: Copy link produced no link`);
          else if (
            !sameJson(decodeDocumentHash(link)?.sphereInversion, starter.block)
          )
            fail(`${key}: the copied link's block does not match the table`);

          // (6) the whole-image export.
          const png = await savePng(
            page,
            consoleLines,
            args.scale,
            args.exportTimeout,
          );
          const exportFile = out(`si-glass-${key}-export.png`);
          fs.writeFileSync(exportFile, png.bytes);
          exports.set(key, { file: exportFile, tiles: png.tileCount });
          sheet.push({
            label: `${key} export ${args.scale}x`,
            file: exportFile,
          });
          const content = await imageContent(diffPage, png.bytes);
          r.export = {
            ms: png.ms,
            width: content.width,
            height: content.height,
            tiles: png.tileCount,
            distinctColors: content.distinctColors,
            lumaStd: content.lumaStd,
          };
          log(
            `${key}: export ${content.width}x${content.height} in ${secs(png.ms)}, ${png.tileCount} tile(s)`,
          );
          const scale = Number(args.scale);
          if (
            content.width !== args.size.width * scale ||
            content.height !== args.size.height * scale
          )
            fail(
              `${key}: export is ${content.width}x${content.height}, expected ${args.size.width * scale}x${args.size.height * scale}`,
            );
          if (
            content.distinctColors < EXPORT_MIN_COLORS ||
            content.lumaStd < EXPORT_MIN_LUMA_STD
          )
            fail(`${key}: export looks blank (${JSON.stringify(content)})`);

          // (6b) 4D POSES: the glass backend has no pose admission (the
          // field lifts the displayed point through the live rotor/slice on
          // every query), so scrubbing the slice mid-session must keep the
          // session glass and settle a DIFFERENT object with the same
          // resolved share. The slab is the one refusal: the thickness
          // slider must be unavailable, with its reason, not silently live.
          if (starter.dim === 4) {
            const pose = await page.evaluate(() => {
              const slider = document.getElementById("fourDSliceSlider");
              const thick = document.getElementById(
                "fourDSliceThicknessSlider",
              );
              const note = document.getElementById(
                "fourDSliceThicknessUnavailableNote",
              );
              return {
                slice: slider ? Number(slider.value) : null,
                thicknessDisabled: thick ? thick.disabled : null,
                thicknessNote: note?.classList.contains("hidden")
                  ? ""
                  : (note?.textContent ?? "").trim(),
              };
            });
            r.pose = { entry: pose };
            if (pose.thicknessDisabled !== true || !pose.thicknessNote)
              fail(
                `${key}: slab thickness is not refused with a reason (${JSON.stringify(pose)})`,
              );
            const next =
              pose.slice === null ? 0.4 : pose.slice > 0 ? -0.3 : 0.3;
            const from = consoleLines.length;
            await page.evaluate((value) => {
              const slider = document.getElementById("fourDSliceSlider");
              const details = slider?.closest("details");
              if (details && !details.open) details.open = true;
              slider.value = String(value);
              slider.dispatchEvent(new Event("input", { bubbles: true }));
              slider.dispatchEvent(new Event("change", { bubbles: true }));
            }, next);
            // The slice is a live view edit: it invalidates the settled
            // frame at once, so the latch dropping is the edit landing.
            await page.waitForFunction(
              () => window.__surfaceState?.().settled === false,
              undefined,
              { timeout: 15_000, polling: 50 },
            );
            const moved = await waitSettled(page, args.settle);
            if (!moved.ok) {
              fail(`${key}: the scrubbed slice never settled`);
            } else {
              const t = finalTransport(consoleLines.slice(from), args.samples);
              const poseFile = out(`si-glass-${key}-pose.png`);
              await captureScene(page, poseFile);
              sheet.push({ label: `${key} (slice ${next})`, file: poseFile });
              glassFrame = poseFile;
              const moveFrac = await differingFraction(
                diffPage,
                frameFile,
                poseFile,
              );
              r.pose.scrubbed = {
                slice: next,
                opticsBackend: moved.state.opticsBackend,
                resolved: t.resolved,
                unresolved: t.unresolved,
                invalid: t.invalid,
                resolvedShare: t.resolvedShare,
                differsFromEntry: moveFrac,
              };
              log(
                `${key}: slice ${pose.slice} -> ${next}: optics=${moved.state.opticsBackend}` +
                  ` resolved ${(100 * t.resolvedShare).toFixed(2)}%, differs ${(100 * moveFrac).toFixed(1)}%`,
              );
              for (const e of t.errors) fail(`${key} scrubbed: ${e}`);
              if (moved.state.opticsBackend !== "sphereInversion")
                fail(`${key}: the scrubbed slice left the glass backend`);
              if (t.resolvedShare < args["min-resolved"])
                fail(
                  `${key}: the scrubbed slice resolved ${(100 * t.resolvedShare).toFixed(1)}%`,
                );
              if (moveFrac < 0.02)
                fail(`${key}: scrubbing the slice did not move the object`);
            }
          }

          // (7) the bending control: Classic at the same pose.
          const glassHash = await page.evaluate(() => location.hash);
          await page.evaluate(() => {
            const sel = document.getElementById("sphereInversionMaterial");
            const details = sel?.closest("details");
            if (details && !details.open) details.open = true;
          });
          await page.selectOption("#sphereInversionMaterial", "classic");
          await page.waitForFunction((h) => location.hash !== h, glassHash, {
            timeout: 15_000,
          });
          const opaque = await waitSettled(page, args.settle);
          if (!opaque.ok) {
            fail(`${key}: the Classic control never settled`);
          } else {
            r.classicOpticsBackend = opaque.state.opticsBackend;
            if (opaque.state.opticsBackend === "sphereInversion")
              fail(`${key}: Classic kept the glass backend`);
            const classicFile = out(`si-glass-${key}-classic.png`);
            await captureScene(page, classicFile);
            sheet.push({ label: `${key} (Classic)`, file: classicFile });
            r.bent = await differingFraction(diffPage, glassFrame, classicFile);
            log(
              `${key}: glass differs from Classic over ${(100 * r.bent).toFixed(1)}% of the pane`,
            );
            if (r.bent < args["min-bent"])
              fail(
                `${key}: glass differs from Classic over only ${(100 * r.bent).toFixed(2)}% of the pane`,
              );
          }
          if (errors.length)
            fail(`${key}: console errors: ${errors.slice(0, 3).join(" | ")}`);
          await context.close();

          // (5b) the link reproduces the frame, and is a fixed point.
          if (link) {
            const reload = await settleFromLink(
              browser,
              settleArgs,
              link,
              query,
              contextOptions,
            );
            try {
              if (!reload.settled.ok) {
                fail(`${key}: the share link never settled`);
              } else {
                const reloadFile = out(`si-glass-${key}-reload.png`);
                await captureScene(reload.page, reloadFile);
                sheet.push({ label: `${key} (link reload)`, file: reloadFile });
                const cmp = await compareFrames(
                  diffPage,
                  frameFile,
                  reloadFile,
                );
                const next = await copyLink(reload.page);
                r.reload = {
                  ms: reload.ms,
                  opticsBackend: reload.settled.state.opticsBackend,
                  maxDiff: cmp.maxDiff,
                  meanDiff: cmp.meanDiff,
                  linkStable:
                    next !== null &&
                    sameJson(
                      decodeDocumentHash(next),
                      decodeDocumentHash(link),
                    ),
                };
                log(
                  `${key}: link reload settled ${secs(reload.ms)}, vs menu max ${cmp.maxDiff}, link stable=${r.reload.linkStable}`,
                );
                if (cmp.sizeMismatch || cmp.maxDiff !== 0)
                  fail(`${key}: the share link does not reproduce the frame`);
                if (!r.reload.linkStable)
                  fail(`${key}: the reloaded session copies a different link`);
                if (reload.errors.length)
                  fail(
                    `${key} reload: console errors: ${reload.errors.slice(0, 3).join(" | ")}`,
                  );
              }
            } finally {
              await reload.context.close().catch(() => {});
            }
          }
        } catch (error) {
          fail(`${key}: ${String(error).split("\n")[0]}`);
        } finally {
          await context.close().catch(() => {});
        }
      }
    }

    if (phases.has("tiled")) {
      for (const starter of wanted) {
        const key = starter.key;
        const r = (results.tiled[key] = {});
        const app = await openApp(browser, {
          url: args.url,
          query: `${query}&surfacemaxrays=${args.maxrays}`,
          contextOptions,
        });
        try {
          await loadPreset(app.page, key);
          const settled = await waitSettled(app.page, args.settle);
          if (!settled.ok) {
            fail(`tiled ${key}: never settled under surfacemaxrays`);
            continue;
          }
          const png = await savePng(
            app.page,
            app.consoleLines,
            args.scale,
            args.exportTimeout,
          );
          const file = out(`si-glass-${key}-export-tiled.png`);
          fs.writeFileSync(file, png.bytes);
          sheet.push({
            label: `${key} export tiled (${png.tileCount})`,
            file,
          });
          const base = exports.get(key);
          r.ms = png.ms;
          r.tiles = png.tileCount;
          r.untiledTiles = base?.tiles ?? null;
          if (!(png.tileCount > 1 && png.tileLines === png.tileCount))
            fail(`tiled ${key}: ${png.tileCount} band(s) — did not tile`);
          if (r.untiledTiles !== null && !(png.tileCount > r.untiledTiles))
            fail(
              `tiled ${key}: ${png.tileCount} bands is not finer than the whole export's ${r.untiledTiles}`,
            );
          if (!base) {
            fail(`tiled ${key}: no whole export (run the starters phase)`);
          } else {
            const cmp = await compareFrames(diffPage, base.file, file);
            r.maxDiff = cmp.maxDiff;
            r.meanDiff = cmp.meanDiff;
            log(
              `tiled ${key}: ${png.tileCount} bands in ${secs(png.ms)}, vs whole max ${cmp.maxDiff} mean ${cmp.meanDiff?.toFixed(4)}`,
            );
            if (cmp.sizeMismatch || cmp.maxDiff !== 0)
              fail(`tiled ${key}: the tiled export differs from the whole one`);
          }
          if (app.errors.length)
            fail(
              `tiled ${key}: console errors: ${app.errors.slice(0, 3).join(" | ")}`,
            );
        } catch (error) {
          fail(`tiled ${key}: ${String(error).split("\n")[0]}`);
        } finally {
          await app.context.close().catch(() => {});
        }
      }
    }

    if (sheet.length) {
      const bytes = await contactSheet(diffPage, sheet, { columns: 3 });
      fs.writeFileSync(out("si-glass-sheet.png"), bytes);
    }
  } finally {
    results.failures = failures;
    fs.writeFileSync(
      out("si-glass-results.json"),
      JSON.stringify(results, null, 2),
    );
    await browser.close();
  }
  log(
    failures.length
      ? `FAIL: ${failures.length} check(s) failed`
      : "PASS: every glass leg holds",
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
