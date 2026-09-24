#!/usr/bin/env node
/**
 * The general curved solid's built-app gate: the Glass starters whose
 * subject is an ordinary IFS stamping curved emitters over a finite depth
 * band (`condensation-solid.ts`), driven from the menu of a production build
 * on a REAL adapter, in both dimensions. The sibling of
 * `scripts/sphere-inversion-glass.verify.mjs`, sharing its browser
 * vocabulary (`scripts/lib/sphere-inversion-gate.mjs`) so "settled", "the
 * document" and "byte-identical" mean one thing in both.
 *
 * The starters are read from `surface-transmission-starters.ts` itself: every
 * starter whose document carries recursive maps beside its emitters is this
 * gate's subject, so a new one joins without being listed.
 *
 * PER STARTER (phase `starters`):
 *
 *   1. Chosen FROM THE MENU, it enters Surface and holds the
 *      `?surfacestate` settle latch.
 *   2. The session is glass on the closed-solid backend: engine compute (the
 *      curved solid is compute-only), a real adapter on `x11:`,
 *      opticsBackend "closedSolid".
 *   3. The census covers a real share of the pane with no exhausted ray, and
 *      the final settle's `?surfacetrace` feed accounts for every glass hit
 *      with a resolved share at or above `--min-resolved`.
 *   4. The document read out of the `#v1=` hash carries every transform's
 *      optics and the finite band; a 4D starter also carries ZERO slab
 *      thickness and the slice on w = 0 (the canonical pose).
 *   5. The Copy link string boots a fresh context whose settled frame is
 *      byte-identical to the menu's, and the link that session copies is
 *      the same document.
 *   6. Save PNG at `--scale`: the whole-image export, the identity
 *      reference for the tiled leg.
 *   7. THE BENDING CONTROL: the same document with every transform's optics
 *      removed (the link, re-encoded) settles an opaque frame on the
 *      estimator backend; the glass frame differs from it over at least
 *      `--min-bent` of the pane.
 *
 * TILED (phase `tiled`): the same export under `?surfacemaxrays=N` traces in
 * more bands and is BYTE-IDENTICAL to leg 6's.
 *
 * OUTPUT (gitignored): `scripts/out/cs-glass-<id>*.png`,
 * `cs-glass-sheet.png`, `cs-glass-results.json`.
 *
 * USAGE (a production build served first; the X cookie per AGENTS.md):
 *   npm run build && npm run preview &
 *   node scripts/curved-solid-glass.verify.mjs --mode=x11::0
 *
 * Exit 0 = pass, 1 = a check failed, 2 = the checking side broke.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { guardFreshDist, REPO_ROOT } from "./lib/dist-freshness.mjs";
import { traceFrames } from "./lib/finite-glass-trace.mjs";
import {
  CLIPBOARD_STUB,
  captureScene,
  compareFrames,
  contactSheet,
  copyLink,
  decodeDocumentHash,
  differingFraction,
  imageContent,
  loadPreset,
  openApp,
  sameJson,
  savePng,
  settleFromLink,
  waitDocument,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIN_COVERED = 0.05;
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
    // The measured floor at 1 spp on the RX 7900 XTX: 90.0% (beads, both
    // dimensions) and 89.9% (rings), against the CPU look sheet's
    // 97.6-100% at 160 px. The gap is open work (fr-pd1p), so the bar sits
    // below the measured floor rather than at the look sheet's figure.
    "min-resolved": 0.85,
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

const log = (line) => console.error(`[cs-glass] ${line}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** The curved-solid starters, from the checkout's own module: each
 * starter's id, dimension and document, kept when its transforms carry
 * recursive maps beside emitters. */
async function loadStarters() {
  const result = await build({
    stdin: {
      contents: `import { SURFACE_TRANSMISSION_STARTERS, createSurfaceTransmissionStarter, surfaceTransmissionStarterValue } from "./src/app/surface-transmission-starters.ts";
export default SURFACE_TRANSMISSION_STARTERS.map((entry) => {
  const snap = createSurfaceTransmissionStarter(entry.id);
  return {
    id: entry.id,
    value: surfaceTransmissionStarterValue(entry.id),
    dim: snap.fourD ? 4 : 3,
    maps: snap.transforms.filter((t) => !t.emitter).length,
    emitters: snap.transforms.filter((t) => t.emitter).length,
    band: snap.condensationDepthBand ?? null,
  };
});`,
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const all = (
    await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    )
  ).default;
  return all.filter((s) => s.maps > 0 && s.emitters > 0);
}

/** The final settle's transport record (the sphere-inversion gate's). */
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
    if (t.resolved + t.unresolved + t.invalid !== frame.hit)
      errors.push(`sample ${i}: tally does not account for every glass hit`);
  }
  const traced = resolved + unresolved + invalid;
  return {
    samples: final.length,
    resolved,
    unresolved,
    invalid,
    resolvedShare: traced > 0 ? resolved / traced : 0,
    errors,
  };
}

/** A link with every transform's optics removed: the Classic control. */
function classicLink(link) {
  const doc = decodeDocumentHash(link);
  if (!doc || !Array.isArray(doc.transforms)) return null;
  for (const t of doc.transforms) delete t.optics;
  const hash = Buffer.from(JSON.stringify(doc), "utf8").toString("base64url");
  return `${link.slice(0, link.indexOf("#"))}#v1=${hash}`;
}

/** Enter Surface after a menu load when the load did not. */
async function enterSurface(page) {
  const inSurface = await page.evaluate(
    () => window.__surfaceState?.().mode === "surface",
  );
  if (!inSurface) await page.click("#modeSurfaceBtn");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const out = (name) => path.join(args.outdir, name);
  const phases = new Set(args.phases.split(",").filter(Boolean));
  const STARTERS = await loadStarters();
  const only = args.only ? args.only.split(",") : null;
  const wanted = only ? STARTERS.filter((s) => only.includes(s.id)) : STARTERS;
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
    viewport: args.viewport,
    samples: args.samples,
    scale: Number(args.scale),
    quiet: browser.gpuQuiet ?? null,
    starters: {},
    tiled: {},
  };
  const dims = new Set(STARTERS.map((s) => s.dim));
  if (!(dims.has(3) && dims.has(4)))
    fail(
      `the curved-solid starters cover dimensions ${[...dims]}, not 3 and 4`,
    );
  const diffContext = await browser.newContext();
  const diffPage = await diffContext.newPage();
  await diffPage.goto("about:blank");
  const exports = new Map();
  const sheet = [];

  try {
    if (phases.has("starters")) {
      for (const starter of wanted) {
        const key = starter.id;
        const r = (results.starters[key] = { dim: starter.dim });
        const app = await openApp(browser, {
          url: args.url,
          query,
          contextOptions,
          initScripts: [[CLIPBOARD_STUB]],
        });
        const { context, page, errors, consoleLines } = app;
        let link = null;
        let frameFile = null;
        try {
          // (1) from the menu to the settle latch.
          const t0 = Date.now();
          await loadPreset(page, starter.value);
          await enterSurface(page);
          const settled = await waitSettled(page, args.settle);
          r.settleMs = Date.now() - t0;
          if (!settled.ok) {
            fail(`${key}: never settled (${JSON.stringify(settled.state)})`);
            continue;
          }
          // (2) glass on the closed-solid backend, on a real adapter.
          const st = settled.state;
          r.engine = st.engine;
          r.opticsBackend = st.opticsBackend;
          r.backend = st.backend;
          if (st.engine !== "compute")
            fail(`${key}: engine=${st.engine}, expected compute`);
          if (st.opticsBackend !== "closedSolid")
            fail(`${key}: opticsBackend=${st.opticsBackend}, not closedSolid`);
          if (args.mode.startsWith("x11:") && st.backend?.software !== false)
            fail(`${key}: backend ${JSON.stringify(st.backend)} is software`);
          // (3) coverage, exhaustion and the transport split.
          const covered = st.census ? st.census.covered / st.census.rays : 0;
          r.covered = covered;
          if (covered < MIN_COVERED)
            fail(`${key}: covered ${(100 * covered).toFixed(1)}% of the pane`);
          if (!st.census || st.census.exhausted > 0)
            fail(`${key}: ${st.census?.exhausted ?? "?"} rays exhausted`);
          const transport = finalTransport(consoleLines, args.samples);
          r.transport = transport;
          for (const e of transport.errors) fail(`${key}: ${e}`);
          if (transport.resolvedShare < args["min-resolved"])
            fail(
              `${key}: resolved ${(100 * transport.resolvedShare).toFixed(1)}% of glass hits, below ${100 * args["min-resolved"]}%`,
            );
          frameFile = out(`cs-glass-${key}.png`);
          await captureScene(page, frameFile);
          sheet.push({ label: `${key} (menu)`, file: frameFile });
          log(
            `${key}: settled ${secs(r.settleMs)}, engine=${st.engine} optics=${st.opticsBackend}` +
              ` backend=${st.backend?.label} software=${st.backend?.software}` +
              ` covered=${(100 * covered).toFixed(1)}% resolved=${transport.resolved}` +
              ` unresolved=${transport.unresolved} invalid=${transport.invalid}` +
              ` (${(100 * transport.resolvedShare).toFixed(2)}%)`,
          );

          // (4) the document.
          const doc = await waitDocument(
            page,
            (d) => Array.isArray(d.transforms) && d.transforms.length > 0,
          );
          r.band = doc?.condensationDepthBand ?? null;
          if (!sameJson(r.band, starter.band))
            fail(
              `${key}: document band ${JSON.stringify(r.band)} != starter ${JSON.stringify(starter.band)}`,
            );
          const glassless = (doc?.transforms ?? []).filter((t) => !t.optics);
          if (glassless.length)
            fail(`${key}: ${glassless.length} transform(s) author no optics`);
          if (starter.dim === 4) {
            const fourD = doc?.fourD ?? null;
            r.fourD = fourD;
            if ((fourD?.sliceThickness ?? NaN) !== 0)
              fail(`${key}: slab thickness ${fourD?.sliceThickness}, not 0`);
            if ((fourD?.sliceW ?? NaN) !== 0)
              fail(`${key}: slice at w=${fourD?.sliceW}, not the canonical 0`);
          }

          // (5a) the share link.
          link = await copyLink(page);
          if (!link) fail(`${key}: Copy link produced no link`);

          // (6) the whole-image export.
          const png = await savePng(
            page,
            consoleLines,
            args.scale,
            args.exportTimeout,
          );
          const exportFile = out(`cs-glass-${key}-export.png`);
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
          };
          log(
            `${key}: export ${content.width}x${content.height} in ${secs(png.ms)}, ${png.tileCount} tile(s)`,
          );
          const scale = Number(args.scale);
          if (
            content.width !== args.size.width * scale ||
            content.height !== args.size.height * scale
          )
            fail(`${key}: export is ${content.width}x${content.height}`);
          if (
            content.distinctColors < EXPORT_MIN_COLORS ||
            content.lumaStd < EXPORT_MIN_LUMA_STD
          )
            fail(`${key}: export looks blank (${JSON.stringify(content)})`);
          if (errors.length)
            fail(`${key}: console errors: ${errors.slice(0, 3).join(" | ")}`);
        } catch (error) {
          fail(`${key}: ${String(error).split("\n")[0]}`);
        } finally {
          await context.close().catch(() => {});
        }

        // (5b) the link reproduces the frame, and is a fixed point.
        if (link && frameFile) {
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
              const reloadFile = out(`cs-glass-${key}-reload.png`);
              await captureScene(reload.page, reloadFile);
              sheet.push({ label: `${key} (link reload)`, file: reloadFile });
              const cmp = await compareFrames(diffPage, frameFile, reloadFile);
              const next = await copyLink(reload.page);
              r.reload = {
                maxDiff: cmp.maxDiff,
                linkStable:
                  next !== null &&
                  sameJson(decodeDocumentHash(next), decodeDocumentHash(link)),
              };
              log(
                `${key}: link reload vs menu max ${cmp.maxDiff}, link stable=${r.reload.linkStable}`,
              );
              if (cmp.sizeMismatch || cmp.maxDiff !== 0)
                fail(`${key}: the share link does not reproduce the frame`);
              if (!r.reload.linkStable)
                fail(`${key}: the reloaded session copies a different link`);
            }
          } finally {
            await reload.context.close().catch(() => {});
          }

          // (7) the bending control: the same document, no optics.
          const classic = classicLink(link);
          const opaque = classic
            ? await settleFromLink(
                browser,
                settleArgs,
                classic,
                query,
                contextOptions,
              )
            : null;
          try {
            if (!opaque?.settled.ok) {
              fail(`${key}: the Classic control never settled`);
            } else {
              r.classicOpticsBackend = opaque.settled.state.opticsBackend;
              if (r.classicOpticsBackend === "closedSolid")
                fail(`${key}: the Classic control kept the glass backend`);
              const classicFile = out(`cs-glass-${key}-classic.png`);
              await captureScene(opaque.page, classicFile);
              sheet.push({ label: `${key} (Classic)`, file: classicFile });
              r.bent = await differingFraction(
                diffPage,
                frameFile,
                classicFile,
              );
              log(
                `${key}: glass differs from Classic over ${(100 * r.bent).toFixed(1)}% of the pane`,
              );
              if (r.bent < args["min-bent"])
                fail(
                  `${key}: glass differs from Classic over only ${(100 * r.bent).toFixed(2)}%`,
                );
            }
          } finally {
            await opaque?.context.close().catch(() => {});
          }
        }
      }
    }

    if (phases.has("tiled")) {
      for (const starter of wanted) {
        const key = starter.id;
        const r = (results.tiled[key] = {});
        const app = await openApp(browser, {
          url: args.url,
          query: `${query}&surfacemaxrays=${args.maxrays}`,
          contextOptions,
        });
        try {
          await loadPreset(app.page, starter.value);
          await enterSurface(app.page);
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
          const file = out(`cs-glass-${key}-export-tiled.png`);
          fs.writeFileSync(file, png.bytes);
          sheet.push({ label: `${key} tiled (${png.tileCount})`, file });
          const base = exports.get(key);
          r.tiles = png.tileCount;
          if (!(png.tileCount > 1 && png.tileLines === png.tileCount))
            fail(`tiled ${key}: ${png.tileCount} band(s), did not tile`);
          if (!base) {
            fail(`tiled ${key}: no whole export (run the starters phase)`);
          } else {
            const cmp = await compareFrames(diffPage, base.file, file);
            r.maxDiff = cmp.maxDiff;
            log(
              `tiled ${key}: ${png.tileCount} bands in ${secs(png.ms)}, vs whole max ${cmp.maxDiff}`,
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
      fs.writeFileSync(out("cs-glass-sheet.png"), bytes);
    }
  } finally {
    results.failures = failures;
    fs.writeFileSync(
      out("cs-glass-results.json"),
      JSON.stringify(results, null, 2),
    );
    await browser.close();
  }
  log(
    failures.length
      ? `FAIL: ${failures.length} check(s) failed`
      : "PASS: every curved-solid glass leg holds",
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
