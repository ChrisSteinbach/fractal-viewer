#!/usr/bin/env node
/**
 * The sphere-inversion family's built-app qualification gate.
 *
 * `scripts/sphere-inversion-presets.verify.mjs` asks whether each showcase
 * lands as authored. This gate asks whether the FAMILY holds up in the app a
 * user gets: every route, share path, export path and refusal the family
 * ships, driven from the menu of a production build. It shares its browser
 * vocabulary with the presets gate (`scripts/lib/sphere-inversion-gate.mjs`),
 * so "loaded from the menu", "settled" and "differs" mean one thing in both.
 *
 * PER PRESET of the Sphere inversion menu group (phase `presets`):
 *
 *   1. Chosen FROM THE MENU, it enters Surface unaided (the render hint) and
 *      holds the `?surfacestate` settle latch.
 *   2. The engine taken is compute (on `x11:` a real adapter: software=false).
 *   3. The settled census covers a real share of the pane with no exhausted
 *      ray, and the blank-frame toast is absent.
 *   4. The six settled frames are pairwise DISTINCT objects.
 *   5. The document read out of the `#v1=` hash carries the preset's block,
 *      equal field for field to `presets.ts`'s table.
 *   6. The link Copy link builds (the button's own string, recorded by a
 *      clipboard stub so the desktop clipboard is untouched) boots a FRESH
 *      context whose settled frame is byte-identical to the menu's, in both
 *      dimensions. The reloaded session's own link is the same document and
 *      boots a second context byte-identical to the first: a link is a fixed
 *      point. (4D links drifted until the pose carried a WORLD slice
 *      hyperplane: a slice normalized against the landed cloud resolved
 *      differently per run, because the cloud is seeded afresh. There is no
 *      tolerance here now — a drift fails.)
 *   7. Save PNG at `--scale` completes; the image is the canvas size times
 *      the scale and has content. It is not compared with the pane: a
 *      capture zeroes the panel's right inset (scene.ts), so the export is
 *      centred where the pane is not.
 *
 * FAMILY LEGS:
 *
 *   tiled    For `--tiled` presets (one 3D, one 4D by default), the same
 *            export under `?surfacemaxrays=N` traces in several bands and is
 *            byte-identical to the untiled export of leg 7, in more bands
 *            than that export used (which may already tile at the device's
 *            own ceiling).
 *   gl       For `--gl` presets (3D), `?surfacegl` loads the preset from the
 *            menu on the WebGL arm: coverage IoU against the compute frame
 *            (a per-row backdrop mask at delta 16, which must agree with
 *            each engine's own census) and the mean colour difference on
 *            jointly covered pixels.
 *            WebGL PREVIEW exhaustion is recorded as unreadable: `scene.ts`
 *            decodes a census off the SETTLE target only
 *            (`measureSurfaceRayCensus`), and no preview path publishes one.
 *   toast    Flame (then Solid) meets a sphere-inversion block through the
 *            two doors a user can reach. HANDOFF: the isolation reload's
 *            restored render mode (`isolation-handoff.ts`, seeded in
 *            sessionStorage) boots onto a block document; the app stays in
 *            Points with the refusal toast
 *            (`sphereInversionRenderModeRefusal`) and the button disabled.
 *            UNDO: with the session live on an ordinary scene, Undo brings
 *            the block back and the app is in Points with the button
 *            disabled. No toast is required there: `applyDecodedSnapshot`
 *            leaves for Points before the restored document refreshes the
 *            panel, so there is no live session left to refuse; the toasts
 *            shown are recorded.
 *   refusal  Under `?surfacegl` a 4D preset refuses Surface entry, with the
 *            compute-only note on the Surface button.
 *
 * The teardown sweep is `scripts/surface-teardown.verify.mjs --document=`,
 * run separately (Firefox, dev server); this gate writes the documents it
 * needs as `si-qual-doc-<key>.json`.
 *
 * OUTPUT (gitignored): `scripts/out/si-qual-<key>.png` (menu frame),
 * `-reload.png`, `-export.png`, `-export-tiled.png`, `-glsl.png`,
 * `si-qual-sheet.png` (contact sheet) and `si-qual-results.json`.
 *
 * USAGE (a production build served first):
 *   npm run build && npm run preview &
 *   node scripts/sphere-inversion-family.verify.mjs --mode=x11::0
 *   node scripts/sphere-inversion-family.verify.mjs --mode=sw
 *   node scripts/sphere-inversion-family.verify.mjs --phases=toast,refusal
 *
 * `--mode=sw` runs the SwiftShader subset: menu entry, engine and document
 * per preset (no settle, frames or exports: a software settle of the
 * 600-cell takes far too long to gate on), plus `toast` and `refusal`.
 *
 * Exit 0 = pass, 1 = a check failed, 2 = the checking side broke.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import {
  READ_DOCUMENT,
  READ_MENU_GROUP,
  loadSiPresets,
  captureScene,
  compareFrames,
  contactSheet,
  coverageAgreement,
  decodeDocumentHash,
  differingFraction,
  imageContent,
  loadPreset,
  openApp,
  sameJson,
  TOAST_RECORDER,
  toastText,
  waitDocument,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Covered share of the pane a showcase must reach (the presets gate's). */
const MIN_COVERED = 0.05;
/** Object-difference bar (escape-family.verify.mjs's). */
const DIFFER_FRACTION = 0.02;
/** An export with content: coarse colours and luminance spread well above a
 * flat or gradient-only image (a bare dark backdrop scores ~10 colours). */
const EXPORT_MIN_COLORS = 64;
const EXPORT_MIN_LUMA_STD = 4;
/** The coverage mask's channel delta. MEASURED: the dark backdrop drifts a
 * few levels along a row, so delta 6 counted 45.8% of the pearls pane
 * covered against a census of 22.0%; delta 16 counts 22.3%. */
const COVER_DELTA = 16;
/** The mask must agree with the engine's own census to this absolute share,
 * or the IoU is measuring something else. */
const MASK_CENSUS_TOLERANCE = 0.02;
/** The WebGL arm against compute (the GLSL arm's recorded bar). */
const GL_MIN_IOU = 0.99;
const BLANK_TOAST = /rendered almost nothing/i;
const REFUSAL_TOAST =
  /Flame and Sampled Solid are unavailable for a sphere-inversion scene/;
const COMPUTE_ONLY_NOTE =
  /native 4D sphere-inversion scenes render on WebGPU compute/;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    only: "",
    phases: "presets,tiled,gl,toast,refusal",
    settle: 300_000,
    exportTimeout: 1_800_000,
    scale: "2",
    maxrays: 600_000,
    tiled: "inversionPearls,inversionMedallions4",
    gl: "inversionPearls,inversionCubePearls",
    outdir: path.join(HERE, "out"),
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    args[key] = typeof args[key] === "number" ? Number(value) : value;
  }
  return args;
}

const log = (line) => console.error(`[si-family] ${line}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** Record the Copy link button's string instead of writing the desktop
 * clipboard (a headed run shares `:0`'s clipboard with the user). */
const CLIPBOARD_STUB = () => {
  const record = async (text) => {
    window.__copiedLink = String(text);
  };
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: record,
        readText: async () => window.__copiedLink ?? "",
      },
    });
  } catch {
    /* the app then reports "Couldn't copy the link", which the leg catches */
  }
};

async function openPanelSection(page, id) {
  await page.evaluate((sectionId) => {
    const el = document.getElementById(sectionId);
    if (el && !el.open) el.open = true;
  }, id);
}

/** Save PNG at `scale`; resolves the bytes, the wall time and the tile
 * count the capture disclosed. */
async function savePng(page, consoleLines, scale, timeoutMs) {
  await openPanelSection(page, "captureSection");
  await page.selectOption("#exportScale", String(scale));
  const from = consoleLines.length;
  const download = page.waitForEvent("download", { timeout: timeoutMs });
  const t0 = Date.now();
  await page.click("#savePngBtn");
  const file = await (await download).path();
  const bytes = fs.readFileSync(file);
  const tiles = consoleLines
    .slice(from)
    .map((l) => /Surface compute export tile (\d+)\/(\d+)/.exec(l))
    .filter(Boolean);
  return {
    bytes,
    ms: Date.now() - t0,
    tileCount: tiles.length === 0 ? 0 : Number(tiles[0][2]),
    tileLines: tiles.length,
  };
}

/** Boot a document from a link in a fresh context and settle it. */
async function settleFromLink(browser, args, link, query = "") {
  const hash = link.slice(link.indexOf("#"));
  const app = await openApp(browser, {
    url: args.url,
    query,
    hash,
    initScripts: [[CLIPBOARD_STUB]],
  });
  const { page } = app;
  await page.waitForFunction(
    () => {
      const b = document.getElementById("modeSurfaceBtn");
      return b && !b.disabled;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );
  const t0 = Date.now();
  await page.click("#modeSurfaceBtn");
  const settled = await waitSettled(page, args.settle);
  return { ...app, settled, ms: Date.now() - t0 };
}

/** One link hop: boot `link` fresh, settle, capture the frame as
 * `si-qual-<key>-reload[2].png`, and copy the link the reloaded session
 * builds. Resolves null (after failing) when the hop cannot settle. */
async function settleLinkHop(browser, args, link, preset, hop) {
  const reload = await settleFromLink(browser, args, link);
  try {
    if (!reload.settled.ok) {
      failHook(`${preset.key}: link hop ${hop} never settled`);
      return null;
    }
    const suffix = hop === 1 ? "reload" : "reload2";
    const frameFile = path.join(
      args.outdir,
      `si-qual-${preset.key}-${suffix}.png`,
    );
    await captureScene(reload.page, frameFile);
    await reload.page.evaluate(() => {
      const el = document.getElementById("shareSection");
      if (el && !el.open) el.open = true;
      window.__copiedLink = undefined;
    });
    await reload.page.click("#copyLinkBtn");
    const next = await reload.page
      .waitForFunction(() => window.__copiedLink ?? null, undefined, {
        timeout: 10_000,
      })
      .then((h) => h.jsonValue())
      .catch(() => null);
    if (reload.errors.length)
      failHook(
        `${preset.key} link hop ${hop}: console errors: ${reload.errors.slice(0, 3).join(" | ")}`,
      );
    return {
      frameFile,
      ms: reload.ms,
      engine: reload.settled.state.engine,
      link: next,
      docEqualsParent:
        next !== null &&
        sameJson(decodeDocumentHash(next), decodeDocumentHash(link)),
    };
  } finally {
    await reload.context.close().catch(() => {});
  }
}

/** Set by main(): the gate's failure sink, for helpers outside it. */
let failHook = (line) => {
  throw new Error(line);
};

/** The recorder's anti-vacuity: Copy link always flashes a toast, so a
 * history that misses it proves nothing about a missing refusal. */
async function recorderSeesCopyToast(page) {
  await page.evaluate(() => {
    const el = document.getElementById("shareSection");
    if (el && !el.open) el.open = true;
  });
  const before = await page.evaluate(() => (window.__toasts ?? []).length);
  await page.click("#copyLinkBtn");
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__toasts ?? []);
  return after.slice(before).some((t) => /link/i.test(t));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const out = (name) => path.join(args.outdir, name);
  const phases = new Set(args.phases.split(",").filter(Boolean));
  const sw = args.mode === "sw";
  if (sw) {
    phases.delete("tiled");
    phases.delete("gl");
  }
  const SI_PRESETS = await loadSiPresets();
  const only = args.only ? args.only.split(",") : null;
  const wanted = only
    ? SI_PRESETS.filter((p) => only.includes(p.key))
    : SI_PRESETS;
  if (wanted.length === 0) throw new Error(`unknown --only ${args.only}`);

  const browser = await launchSurfaceBrowser(args.mode);
  const failures = [];
  const fail = (line) => {
    failures.push(line);
    log(`FAIL ${line}`);
  };
  failHook = fail;
  const results = {
    startedAt: new Date().toISOString(),
    mode: args.mode,
    url: args.url,
    scale: Number(args.scale),
    viewport: "1600x900",
    quiet: browser.gpuQuiet ?? null,
    presets: {},
    tiled: {},
    gl: {},
    toast: {},
    refusal: {},
  };
  // Diff/decoder page: the app's isolation headers refuse the blob decode.
  const diffContext = await browser.newContext();
  const diffPage = await diffContext.newPage();
  await diffPage.goto("about:blank");
  // The menu group must be the table: a preset added to one and not the
  // other would be silently skipped by every leg below.
  {
    const app = await openApp(browser, { url: args.url });
    try {
      const menu = await app.page.evaluate(READ_MENU_GROUP);
      results.menuGroup = menu;
      const keys = SI_PRESETS.map((p) => p.key);
      if (!sameJson(menu, keys))
        fail(
          `the Sphere inversion menu group ${JSON.stringify(menu)} is not the table ${JSON.stringify(keys)}`,
        );
      else log(`menu group = table: ${keys.join(", ")}`);
    } finally {
      await app.context.close().catch(() => {});
    }
  }
  const frames = new Map();
  const exports = new Map();
  const sheet = [];

  try {
    // ------------------------------------------------ per preset, 1-3, 5-7
    if (phases.has("presets")) {
      for (const preset of wanted) {
        const r = (results.presets[preset.key] = { dim: preset.dim });
        const app = await openApp(browser, { url: args.url });
        const { context, page, errors, consoleLines } = app;
        await context.addInitScript(CLIPBOARD_STUB);
        await page.evaluate(CLIPBOARD_STUB);
        try {
          const t0 = Date.now();
          await loadPreset(page, preset.key);
          if (sw) {
            // The SwiftShader subset: entry and engine, no settle.
            const entered = await page
              .waitForFunction(
                () => {
                  const s = window.__surfaceState?.();
                  // The probe reads "webgl" while the compute renderer
                  // is still being created (it is null until then), so the
                  // engine is only an answer once the first frame is up.
                  return s && s.mode === "surface" && s.firstFrame ? s : null;
                },
                undefined,
                { timeout: 300_000, polling: 250 },
              )
              .then((h) => h.jsonValue())
              .catch(() => null);
            r.engine = entered?.engine ?? null;
            r.backend = entered?.backend ?? null;
            if (!entered)
              fail(`${preset.key}: never entered Surface from the menu`);
            else if (entered.engine !== "compute")
              fail(`${preset.key}: engine=${entered.engine}, expected compute`);
          } else {
            // (1) settle on the latch, (2) engine, (3) not blank.
            const settled = await waitSettled(page, args.settle);
            r.settleMs = Date.now() - t0;
            if (!settled.ok) {
              fail(
                `${preset.key}: never settled (state=${JSON.stringify(settled.state)})`,
              );
              continue;
            }
            const st = settled.state;
            r.engine = st.engine;
            r.backend = st.backend;
            r.census = st.census
              ? {
                  rays: st.census.rays,
                  covered: st.census.covered,
                  miss: st.census.miss,
                  exhausted: st.census.exhausted,
                }
              : null;
            if (st.engine !== "compute")
              fail(`${preset.key}: engine=${st.engine}, expected compute`);
            if (args.mode.startsWith("x11:") && st.backend?.software !== false)
              fail(
                `${preset.key}: backend ${JSON.stringify(st.backend)} is not a real adapter`,
              );
            const covered = st.census ? st.census.covered / st.census.rays : 0;
            if (covered < MIN_COVERED)
              fail(
                `${preset.key}: covered ${(100 * covered).toFixed(1)}% of the pane`,
              );
            if (!st.census || st.census.exhausted > 0)
              fail(
                `${preset.key}: ${st.census?.exhausted ?? "?"} rays exhausted`,
              );
            const toast = await toastText(page);
            r.toastAtSettle = toast;
            if (toast && BLANK_TOAST.test(toast))
              fail(
                `${preset.key}: raised the blank-frame toast (${JSON.stringify(toast)})`,
              );
          }
          // (5) the document carries the block.
          const doc = await waitDocument(page, (d) => !!d.sphereInversion);
          r.blockMatches = sameJson(doc?.sphereInversion, preset.block);
          if (!r.blockMatches)
            fail(
              `${preset.key}: document block ${JSON.stringify(doc?.sphereInversion)} != table ${JSON.stringify(preset.block)}`,
            );
          if (sw) {
            log(
              `${preset.key}: entered engine=${r.engine} block=${r.blockMatches ? "ok" : "MISMATCH"}`,
            );
            if (errors.length)
              fail(
                `${preset.key}: console errors: ${errors.slice(0, 3).join(" | ")}`,
              );
            continue;
          }
          const frameFile = out(`si-qual-${preset.key}.png`);
          await captureScene(page, frameFile);
          frames.set(preset.key, frameFile);
          sheet.push({ label: `${preset.key} (menu)`, file: frameFile });
          log(
            `${preset.key}: settled ${secs(r.settleMs)} from the menu, engine=${r.engine}` +
              ` backend=${r.backend?.label} software=${r.backend?.software}` +
              ` covered=${((100 * r.census.covered) / r.census.rays).toFixed(1)}% exhausted=${r.census.exhausted}`,
          );

          // (6a) the share link, as Copy link builds it.
          await openPanelSection(page, "shareSection");
          await page.evaluate(() => {
            window.__copiedLink = undefined;
          });
          await page.click("#copyLinkBtn");
          const link = await page
            .waitForFunction(() => window.__copiedLink ?? null, undefined, {
              timeout: 10_000,
            })
            .then((h) => h.jsonValue())
            .catch(() => null);
          if (!link) {
            fail(`${preset.key}: Copy link produced no link`);
          } else {
            const linkDoc = decodeDocumentHash(link);
            r.linkBytes = link.length;
            if (!sameJson(linkDoc?.sphereInversion, preset.block))
              fail(
                `${preset.key}: the copied link's block does not match the table`,
              );
            fs.writeFileSync(
              out(`si-qual-doc-${preset.key}.json`),
              JSON.stringify(linkDoc),
            );
          }

          // (7) Save PNG at the requested scale.
          const png = await savePng(
            page,
            consoleLines,
            args.scale,
            args.exportTimeout,
          );
          const exportFile = out(`si-qual-${preset.key}-export.png`);
          fs.writeFileSync(exportFile, png.bytes);
          exports.set(preset.key, exportFile);
          sheet.push({
            label: `${preset.key} export ${args.scale}x`,
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
            bytes: png.bytes.length,
          };
          log(
            `${preset.key}: export ${content.width}x${content.height} in ${secs(png.ms)},` +
              ` ${png.tileCount} tile(s), ${content.distinctColors} colours, luma sd ${content.lumaStd.toFixed(1)}`,
          );
          const expectW = 1600 * Number(args.scale);
          const expectH = 900 * Number(args.scale);
          if (content.width !== expectW || content.height !== expectH)
            fail(
              `${preset.key}: export is ${content.width}x${content.height}, expected ${expectW}x${expectH}`,
            );
          if (
            content.distinctColors < EXPORT_MIN_COLORS ||
            content.lumaStd < EXPORT_MIN_LUMA_STD
          )
            fail(
              `${preset.key}: export looks blank (${JSON.stringify(content)})`,
            );
          if (errors.length)
            fail(
              `${preset.key}: console errors: ${errors.slice(0, 3).join(" | ")}`,
            );
          await context.close();

          // (6b) the link boots a fresh context; its frame is compared with
          // the menu's, and the link it copies boots a second one, which must
          // reproduce the first byte for byte (a link is a fixed point).
          if (link) {
            const hop1 = await settleLinkHop(browser, args, link, preset, 1);
            const hop2 =
              hop1?.link && hop1.frameFile
                ? await settleLinkHop(browser, args, hop1.link, preset, 2)
                : null;
            if (hop1?.frameFile) {
              sheet.push({
                label: `${preset.key} (link reload)`,
                file: hop1.frameFile,
              });
              const cmp = await compareFrames(
                diffPage,
                frameFile,
                hop1.frameFile,
              );
              r.reload = {
                ms: hop1.ms,
                engine: hop1.engine,
                meanDiff: cmp.meanDiff,
                maxDiff: cmp.maxDiff,
                over8: cmp.over8,
              };
              log(
                `${preset.key}: link reload settled ${secs(hop1.ms)}, vs menu frame` +
                  ` mean ${cmp.meanDiff?.toFixed(4)}/255 max ${cmp.maxDiff} over8 ${((cmp.over8 ?? 0) * 100).toFixed(3)}%`,
              );
              if (cmp.sizeMismatch || cmp.maxDiff !== 0)
                fail(
                  `${preset.key}: the share link does not reproduce the frame byte for byte`,
                );
            }
            if (hop1?.frameFile && hop2?.frameFile) {
              const cmp2 = await compareFrames(
                diffPage,
                hop1.frameFile,
                hop2.frameFile,
              );
              r.reload2 = {
                ms: hop2.ms,
                linkStable: hop2.docEqualsParent,
                meanDiff: cmp2.meanDiff,
                maxDiff: cmp2.maxDiff,
              };
              log(
                `${preset.key}: second link hop settled ${secs(hop2.ms)}, link unchanged=${hop1.docEqualsParent}` +
                  ` vs first reload max ${cmp2.maxDiff}`,
              );
              if (!hop1.docEqualsParent)
                fail(
                  `${preset.key}: a reloaded link copies a different document`,
                );
              if (cmp2.sizeMismatch || cmp2.maxDiff !== 0)
                fail(
                  `${preset.key}: reloading the reloaded link does not reproduce its frame byte for byte`,
                );
            } else if (hop1?.frameFile) {
              fail(`${preset.key}: the second link hop did not settle`);
            }
          }
        } catch (error) {
          fail(`${preset.key}: ${String(error).split("\n")[0]}`);
        } finally {
          await context.close().catch(() => {});
        }
      }

      // (4) pairwise distinct objects.
      const keys = [...frames.keys()];
      results.distinct = [];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const frac = await differingFraction(
            diffPage,
            frames.get(keys[i]),
            frames.get(keys[j]),
          );
          results.distinct.push({ a: keys[i], b: keys[j], frac });
          if (frac < DIFFER_FRACTION)
            fail(
              `${keys[i]} and ${keys[j]} render the same picture (${(100 * frac).toFixed(2)}%)`,
            );
        }
      }
      if (results.distinct.length) {
        const min = results.distinct.reduce((a, b) =>
          b.frac < a.frac ? b : a,
        );
        log(
          `distinct: ${results.distinct.length} pairs, least-different ${min.a} vs ${min.b} ${(100 * min.frac).toFixed(1)}%`,
        );
      }
    }

    // --------------------------------------------------------- tiled export
    if (phases.has("tiled")) {
      for (const key of args.tiled.split(",").filter(Boolean)) {
        const r = (results.tiled[key] = {});
        const app = await openApp(browser, {
          url: args.url,
          query: `surfacemaxrays=${args.maxrays}`,
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
          const file = out(`si-qual-${key}-export-tiled.png`);
          fs.writeFileSync(file, png.bytes);
          sheet.push({
            label: `${key} export ${args.scale}x tiled (${png.tileCount})`,
            file,
          });
          r.ms = png.ms;
          r.tiles = png.tileCount;
          r.tileLines = png.tileLines;
          r.untiledTiles = results.presets[key]?.export?.tiles ?? null;
          if (!(png.tileCount > 1 && png.tileLines === png.tileCount))
            fail(
              `tiled ${key}: ${png.tileCount} band(s), ${png.tileLines} traced — the capture did not tile`,
            );
          // The untiled export may already tile at the device's own ceiling
          // (the Iris splits a 2x 1600x900 export in two); the forced
          // ceiling must cut it finer.
          if (r.untiledTiles !== null && !(png.tileCount > r.untiledTiles))
            fail(
              `tiled ${key}: ${png.tileCount} bands is not finer than the untiled export's ${r.untiledTiles}`,
            );
          const base = exports.get(key);
          if (!base) {
            fail(
              `tiled ${key}: no untiled export to compare (run the presets phase)`,
            );
          } else {
            const cmp = await compareFrames(diffPage, base, file);
            r.meanDiff = cmp.meanDiff;
            r.maxDiff = cmp.maxDiff;
            log(
              `tiled ${key}: ${png.tileCount} bands in ${secs(png.ms)}, vs untiled mean ${cmp.meanDiff?.toFixed(4)}/255 max ${cmp.maxDiff}`,
            );
            if (cmp.sizeMismatch || cmp.maxDiff !== 0)
              fail(
                `tiled ${key}: the tiled export differs from the untiled one`,
              );
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

    // ---------------------------------------------------- WebGL vs compute
    if (phases.has("gl")) {
      for (const key of args.gl.split(",").filter(Boolean)) {
        const r = (results.gl[key] = {
          previewExhaustion:
            "unreadable: the WebGL arm decodes its ray census off the settle target only",
        });
        const app = await openApp(browser, {
          url: args.url,
          query: "surfacegl",
        });
        try {
          const t0 = Date.now();
          await loadPreset(app.page, key);
          const settled = await waitSettled(app.page, args.settle);
          r.settleMs = Date.now() - t0;
          if (!settled.ok) {
            fail(`gl ${key}: never settled on WebGL`);
            continue;
          }
          r.engine = settled.state.engine;
          r.backend = settled.state.backend;
          r.census = settled.state.census
            ? {
                rays: settled.state.census.rays,
                covered: settled.state.census.covered,
                exhausted: settled.state.census.exhausted,
              }
            : null;
          if (r.engine !== "webgl")
            fail(`gl ${key}: engine=${r.engine}, expected webgl`);
          const file = out(`si-qual-${key}-glsl.png`);
          await captureScene(app.page, file);
          sheet.push({ label: `${key} (?surfacegl)`, file });
          const base = frames.get(key);
          if (!base) {
            fail(
              `gl ${key}: no compute frame to compare (run the presets phase)`,
            );
          } else {
            const cov = await coverageAgreement(
              diffPage,
              base,
              file,
              COVER_DELTA,
            );
            const computeCensus = results.presets[key]?.census;
            const censusA = computeCensus
              ? computeCensus.covered / computeCensus.rays
              : null;
            const censusB = r.census ? r.census.covered / r.census.rays : null;
            Object.assign(r, cov);
            log(
              `gl ${key}: settled ${secs(r.settleMs)} on ${r.backend?.label}, IoU ${cov.iou?.toFixed(4)}` +
                ` (covered ${(100 * cov.coveredA).toFixed(2)}% compute / ${(100 * cov.coveredB).toFixed(2)}% webgl),` +
                ` mean diff on covered ${cov.meanDiffCovered?.toFixed(3)}/255,` +
                ` census covered ${(100 * (censusA ?? NaN)).toFixed(2)}% compute / ${(100 * (censusB ?? NaN)).toFixed(2)}% webgl`,
            );
            r.censusCoveredCompute = censusA;
            r.censusCoveredWebgl = censusB;
            if (
              censusA === null ||
              censusB === null ||
              Math.abs(cov.coveredA - censusA) > MASK_CENSUS_TOLERANCE ||
              Math.abs(cov.coveredB - censusB) > MASK_CENSUS_TOLERANCE
            )
              fail(
                `gl ${key}: coverage mask (${cov.coveredA}, ${cov.coveredB}) disagrees with the census (${censusA}, ${censusB}) — IoU unmeasured`,
              );
            else if (!cov.backdropOk)
              fail(
                `gl ${key}: backdrop premise failed (edge rows ${cov.edgeRowsBad}) — IoU unmeasured`,
              );
            else if (!(cov.iou >= GL_MIN_IOU))
              fail(`gl ${key}: coverage IoU ${cov.iou} < ${GL_MIN_IOU}`);
          }
          if (app.errors.length)
            fail(
              `gl ${key}: console errors: ${app.errors.slice(0, 3).join(" | ")}`,
            );
        } catch (error) {
          fail(`gl ${key}: ${String(error).split("\n")[0]}`);
        } finally {
          await app.context.close().catch(() => {});
        }
      }
    }

    // ------------------------------- Flame/Solid refusal, two real doors
    if (phases.has("toast")) {
      // A block document to arrive with: the pearls preset's own hash.
      let blockHash = null;
      {
        const app = await openApp(browser, { url: args.url });
        try {
          await loadPreset(app.page, "inversionPearls");
          const doc = await waitDocument(app.page, (d) => !!d.sphereInversion);
          if (doc?.sphereInversion) {
            blockHash = await app.page.evaluate(() => location.hash);
          }
        } finally {
          await app.context.close().catch(() => {});
        }
      }
      if (!blockHash) fail("toast: could not mint a block document");
      for (const mode of blockHash ? ["flame", "solid"] : []) {
        const button = mode === "flame" ? "#modeFlameBtn" : "#modeSolidBtn";
        // (a) THE HANDOFF DOOR: the isolation reload restores Flame/Solid
        // (isolation-handoff.ts) onto a document that carries a block. The
        // boot's switchRenderMode refuses, says why, and stays in Points.
        {
          const r = (results.toast[`${mode}-handoff`] = {});
          const app = await openApp(browser, {
            url: args.url,
            hash: blockHash,
            initScripts: [
              [TOAST_RECORDER],
              [
                (m) =>
                  sessionStorage.setItem(
                    "fractal-viewer:isolation-handoff",
                    JSON.stringify({ renderMode: m }),
                  ),
                mode,
              ],
            ],
          });
          try {
            await app.page.waitForFunction(
              () =>
                Number(
                  (
                    document.getElementById("pointCount")?.textContent ?? ""
                  ).replace(/[^\d]/g, ""),
                ) > 0,
              undefined,
              { timeout: 60_000, polling: 200 },
            );
            await app.page.waitForTimeout(2_500);
            const seen = await app.page.evaluate(
              (sel) => ({
                mode: window.__surfaceState().mode,
                toasts: window.__toasts ?? [],
                disabled: document.querySelector(sel)?.disabled ?? null,
                handoffLeft: sessionStorage.getItem(
                  "fractal-viewer:isolation-handoff",
                ),
              }),
              button,
            );
            Object.assign(r, seen);
            r.recorderLive = await recorderSeesCopyToast(app.page);
            if (!r.recorderLive)
              fail(
                `toast ${mode} handoff: the toast recorder is not recording`,
              );
            const toast = seen.toasts.find((t) => REFUSAL_TOAST.test(t));
            log(
              `toast ${mode} handoff: mode=${seen.mode} toast=${toast ? "yes" : "NO"}` +
                ` ${mode} button disabled=${seen.disabled} handoff consumed=${seen.handoffLeft === null}`,
            );
            if (seen.handoffLeft !== null)
              fail(`toast ${mode} handoff: the app never consumed the handoff`);
            if (seen.mode !== "points")
              fail(
                `toast ${mode} handoff: booted into ${seen.mode}, expected points`,
              );
            if (!toast)
              fail(
                `toast ${mode} handoff: no refusal toast (toasts shown: ${JSON.stringify(seen.toasts)})`,
              );
            if (seen.disabled !== true)
              fail(`toast ${mode} handoff: the ${mode} button stayed enabled`);
            if (app.errors.length)
              fail(
                `toast ${mode} handoff: console errors: ${app.errors.slice(0, 3).join(" | ")}`,
              );
          } catch (error) {
            fail(`toast ${mode} handoff: ${String(error).split("\n")[0]}`);
          } finally {
            await app.context.close().catch(() => {});
          }
        }
        // (b) THE HISTORY DOOR: with the session live on an ordinary scene,
        // Undo brings the block back. applyDecodedSnapshot leaves for Points
        // BEFORE the restored document refreshes the panel (every undo, redo,
        // gallery load, import and timeline leg does), so the exit is gated
        // and the refusal toast is recorded, not required: by the time the
        // family's refusal runs there is no Flame/Solid session to refuse.
        {
          const r = (results.toast[`${mode}-undo`] = {});
          const app = await openApp(browser, {
            url: args.url,
            initScripts: [[TOAST_RECORDER]],
          });
          const { page } = app;
          try {
            await loadPreset(page, "inversionPearls");
            await waitDocument(page, (d) => !!d.sphereInversion);
            await loadPreset(page, "sierpinski");
            const cleared = await waitDocument(page, (d) => !d.sphereInversion);
            if (cleared?.sphereInversion) {
              fail(
                `toast ${mode} undo: loading Sierpinski left the block in place`,
              );
              continue;
            }
            await page.click(button);
            await page.waitForFunction(
              (m) => window.__surfaceState?.()?.mode === m,
              mode,
              { timeout: 15_000 },
            );
            await page.evaluate(() => {
              window.__toasts = [];
            });
            let restored = null;
            for (let i = 0; i < 6 && !restored; i++) {
              await page.click("#undoBtn");
              await page.waitForTimeout(700);
              const doc = await page.evaluate(READ_DOCUMENT);
              if (doc?.sphereInversion) {
                restored = doc;
                r.undos = i + 1;
              }
            }
            if (!restored) {
              fail(`toast ${mode} undo: undo never brought the block back`);
              continue;
            }
            const landed = await page
              .waitForFunction(
                () => window.__surfaceState?.()?.mode === "points",
                undefined,
                { timeout: 10_000 },
              )
              .then(() => true)
              .catch(() => false);
            await page.waitForTimeout(2_500);
            const toasts = await page.evaluate(() => window.__toasts ?? []);
            const disabled = await page.evaluate(
              (sel) => document.querySelector(sel)?.disabled ?? null,
              button,
            );
            r.recorderLive = await recorderSeesCopyToast(page);
            if (!r.recorderLive)
              fail(`toast ${mode} undo: the toast recorder is not recording`);
            Object.assign(r, {
              landedInPoints: landed,
              toasts,
              buttonDisabled: disabled,
            });
            log(
              `toast ${mode} undo: block restored after ${r.undos} undo(s), points=${landed}` +
                ` ${mode} button disabled=${disabled} toasts=${JSON.stringify(toasts)}`,
            );
            if (!landed)
              fail(`toast ${mode} undo: the app did not exit to Points`);
            if (disabled !== true)
              fail(`toast ${mode} undo: the ${mode} button stayed enabled`);
            if (app.errors.length)
              fail(
                `toast ${mode} undo: console errors: ${app.errors.slice(0, 3).join(" | ")}`,
              );
          } catch (error) {
            fail(`toast ${mode} undo: ${String(error).split("\n")[0]}`);
          } finally {
            await app.context.close().catch(() => {});
          }
        }
      }
    }

    // ------------------------------------- 4D compute-only refusal (WebGL)
    if (phases.has("refusal")) {
      for (const preset of SI_PRESETS.filter((p) => p.dim === 4)) {
        const r = (results.refusal[preset.key] = {});
        const app = await openApp(browser, {
          url: args.url,
          query: "surfacegl",
        });
        const { page } = app;
        try {
          await loadPreset(page, preset.key);
          const doc = await waitDocument(page, (d) => !!d.sphereInversion);
          await page.waitForTimeout(3_000);
          const state = await page.evaluate(() => {
            const b = document.getElementById("modeSurfaceBtn");
            const el = document.getElementById("toast");
            return {
              mode: window.__surfaceState().mode,
              disabled: b?.disabled ?? null,
              title: b?.title ?? "",
              toast:
                el && !el.classList.contains("hidden") ? el.textContent : null,
            };
          });
          Object.assign(r, state, { blockPresent: !!doc?.sphereInversion });
          log(
            `refusal ${preset.key}: mode=${state.mode} surface disabled=${state.disabled} note=${JSON.stringify(state.title.slice(0, 120))} toast=${JSON.stringify(state.toast)}`,
          );
          if (!doc?.sphereInversion)
            fail(`refusal ${preset.key}: the block never landed`);
          if (state.mode === "surface")
            fail(`refusal ${preset.key}: entered Surface under ?surfacegl`);
          if (state.disabled !== true)
            fail(
              `refusal ${preset.key}: Surface button enabled under ?surfacegl`,
            );
          if (!COMPUTE_ONLY_NOTE.test(state.title))
            fail(
              `refusal ${preset.key}: the compute-only note is missing (${JSON.stringify(state.title)})`,
            );
          if (app.errors.length)
            fail(
              `refusal ${preset.key}: console errors: ${app.errors.slice(0, 3).join(" | ")}`,
            );
        } catch (error) {
          fail(`refusal ${preset.key}: ${String(error).split("\n")[0]}`);
        } finally {
          await app.context.close().catch(() => {});
        }
      }
    }

    if (sheet.length > 0) {
      const bytes = await contactSheet(diffPage, sheet, {
        columns: 3,
        cellW: 480,
      });
      fs.writeFileSync(out("si-qual-sheet.png"), bytes);
      log(`contact sheet -> ${out("si-qual-sheet.png")}`);
    }
  } finally {
    await diffContext.close().catch(() => {});
    await browser.close();
    results.failures = failures;
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      out("si-qual-results.json"),
      JSON.stringify(results, null, 1),
    );
  }
  if (failures.length > 0) {
    log(`${failures.length} failure(s):`);
    for (const f of failures) log(`  - ${f}`);
    process.exit(1);
  }
  log("verdict=pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
