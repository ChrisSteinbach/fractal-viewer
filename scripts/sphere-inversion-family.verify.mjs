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
 *   refusal  Under `?surfacegl` every COMPUTE-ONLY preset refuses Surface
 *            entry, with its own compute-only note on the Surface button.
 *            Compute-only is the app's per-construction answer
 *            (`sphereInversionComputeOnlySubject`, read by `loadSiPresets`),
 *            not the dimension: the 4D pair ("native 4D sphere-inversion
 *            scenes") and a 3D preset past the fragment arm's generator
 *            block ("sphere-inversion scenes with more than 29
 *            generators") take the same door, and each note must name its
 *            own subject.
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
 *   node scripts/sphere-inversion-family.verify.mjs --mode=x11::0 [--force] [--tier=fast]
 *   node scripts/sphere-inversion-family.verify.mjs --mode=sw
 *   node scripts/sphere-inversion-family.verify.mjs --phases=toast,refusal
 *
 * `--mode=sw` runs the SwiftShader subset: menu entry, engine and document
 * per preset (no settle, frames or exports: a software settle of the
 * 600-cell takes far too long to gate on), plus `toast` and `refusal`.
 *
 * THE FAST TIER (`--tier=fast`, scripts/lib/fast-tier.mjs,
 * docs/gate-velocity.md): the development loop runs the presets and gl
 * phases under the app's own `?surfacemaxrays` device-ceiling stand-in
 * (the live pane FITS under the cap and blits up to an unchanged 1600x900
 * canvas — the page, the panel and every DOM interaction stay exactly the
 * full tier's) with `?surfacesamples=1` on every page INCLUDING the link
 * hops (the hop frames must share the menu frame's raster for the
 * byte-for-byte compares — the override governs the settle on both
 * engines), and pins the export scale to 1 (the export content checks are
 * relative; the export bands under the same cap). The frame-pure
 * contracts — census share, pairwise distinct, link fixed points, the gl
 * leg's IoU — are tier-free ratios or same-tier compares. THE TILED PHASE
 * IS A FULL-RESERVATION LEG and is SKIPPED at fast: the export-scale tile
 * byte-exactness it asserts is the named full-res leg (the untiled export
 * guarantees its device-ceiling tiling only at export scale), disclosed
 * in the output rather than quietly absent. THE GL LEG JOINS IT: the
 * cross-engine IoU needs both engines at one raster and the ray cap is a
 * compute-only knob, so a fast pair would measure the raster difference,
 * not the engines — skipped, disclosed. THE PILOT: one
 * full-resolution sample — the first preset re-rendered with no tier
 * params after the presets phase, asserting the same frame-pure
 * predicates its fast pass asserted, and its full-tier frame recorded
 * under its full-tier cache key (the store's env field separates the
 * tiers) so the cache's fast-vs-full correspondence is re-anchored each
 * fast run. A divergence fails the run with the predicates named. Every
 * verdict line carries `tier=<label>`; a green fast line is never
 * mistakable for a full-quality pass. MEASURED (AMD RX 7900 XTX, real
 * driver x11::0, 2026-10-02): presets+gl+tiled cold 2m0.6s at fast against
 * the recorded full-tier presets cold 9m51s (~5x, with tiled and gl
 * reserved to full); settles 1.5-2.7s, hops 1.8-2.7s, exports 1.6-3.0s
 * banded; the pilot's full-tier sample (7.0s settle) agreed and refreshed
 * the full-tier entry. The fast tier's first run also paid the env-key
 * lesson (fast frames recorded under full-tier keys until the tier params
 * rode the key's env — docs/gate-velocity.md's THE ENV-KEY RULE).
 *
 * THE FRAME CACHE (wired 2026-10-02, scripts/lib/frame-cache-gate.mjs,
 * docs/gate-velocity.md): the presets/tiled/gl phases' FRAME-PURE products
 * are memoized under exact keys — the settled menu frame, its Save-PNG
 * export (the scale rides the raster field), the tiled export
 * (`surfacemaxrays` rides env), and the WebGL arm's frame — each a pure
 * function of (bundle, settled document, engine, viewport, device, env).
 * The key's document is read from a STABILIZED hash (preset writes, then
 * the boot auto-fit's camera write) BEFORE the settle, because a hit skips
 * the settle and the key must name the settled document either way. A hit
 * replays the recorded bytes AND the probe-derived metadata that bytes
 * cannot re-derive (engine routing, ray census, tile counts — the same
 * predicates re-run over recorded evidence), while everything live stays
 * live: the menu/boot interactions, the document checks, the LINK HOPS'
 * settle waits (their byte-for-byte claims are fresh-hop-vs-recorded-menu
 * comparisons, never cached-vs-cached, so a link's fixed-point property is
 * re-verified on every run), the toast/refusal phases wholesale, and the
 * machine-quiet certification. Every entry is put-GATED on its scenario's
 * checks passing, so a failed scenario never replays as a pass — a
 * same-build rerun skips the passing presets and re-renders exactly the
 * failed ones. `--force` never looks up; a store error degrades the run to
 * uncached and is noted, never fatal. MEASURED (AMD RX 7900 XTX, real
 * driver x11::0, 2026-10-02): `--phases=presets` 9m51s cold (`--force`) ->
 * 3m31s warm (2.8x) — the warm wall is the 20 live link hops; one-preset
 * smoke with tiled+gl legs 47.8s -> 21.2s, the gl leg's IoU recomputed
 * identically (1.0000) from cached bytes.
 *
 * Exit 0 = pass, 1 = a check failed, 2 = the checking side broke.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import {
  parseTierArg,
  tierCorrespondence,
  tierExportScale,
  tierLabel,
  tierUrlParams,
} from "./lib/fast-tier.mjs";
import {
  createFrameCache,
  gateKeyFields,
  readDeviceSignature,
} from "./lib/frame-cache-gate.mjs";
import {
  CLIPBOARD_STUB,
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
  openPanelSection,
  sameJson,
  savePng,
  settleFromLink,
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
/** The gl leg's backdrop-premise bound. The per-row channel-delta mask
 * classifies a pixel covered when it departs from its row's first-column
 * sample — a premise only a frame with true backdrop admits. Past this
 * census-covered fraction (the two engines' own ray counts agree the frame
 * is nearly all geometry — measured: inversionVault reads 95.89% on both
 * engines) almost every row's edge sample sits ON the subject, so the
 * mask's absolute covered fraction no longer measures coverage: subject
 * pixels matching the local geometry read as backdrop (the vault's mask
 * read 90.32% against the censuses' 95.89%, a 5.6% gap over the 2%
 * tolerance, while the two engines agreed at IoU 0.9997). The rule waives
 * the mask-vs-census check BY NAME for such frames and gates the censuses
 * against each other plus the mask IoU instead; below the bound the
 * mask-vs-census check stays exactly as it was (the shipped presets at
 * ~22% and ~40% coverage still calibrate the mask). */
const BACKDROP_PREMISE_MAX_COVERED = 0.9;
/** The WebGL arm against compute (the GLSL arm's recorded bar). */
const GL_MIN_IOU = 0.99;
const BLANK_TOAST = /rendered almost nothing/i;
const REFUSAL_TOAST =
  /Flame and Solid are unavailable for a sphere-inversion scene/;
/** The Surface button's compute-only note for one subject phrase. */
const computeOnlyNote = (subject) =>
  `${subject} render on WebGPU compute, which is unavailable here`;

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
    force: false,
    tier: "full",
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (key === "force") args.force = value !== "false";
    else if (key === "tier") args.tier = parseTierArg([raw]);
    else args[key] = typeof args[key] === "number" ? Number(value) : value;
  }
  return args;
}

const log = (line) => console.error(`[si-family] ${line}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** One link hop: boot `link` fresh, settle, capture the frame as
 * `si-qual-<key>-reload[2].png`, and copy the link the reloaded session
 * builds. `query` rides the boot URL (the fast tier's samples pin — the
 * hop frame must share the menu frame's raster). Resolves null (after
 * failing) when the hop cannot settle. */
async function settleLinkHop(browser, args, link, preset, hop, query = "") {
  const reload = await settleFromLink(browser, args, link, query);
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
  const fast = args.tier === "fast";
  const sw = args.mode === "sw";
  // The tier's URL params and export scale (scripts/lib/fast-tier.mjs):
  // one antialiasing pass plus the ray cap at fast — the app's own
  // page-load overrides, so the settle AND the Save-PNG both trace them —
  // and scale 1 for the export. The viewport is deliberately UNCHANGED:
  // the canvas geometry, panel layout and every DOM interaction stay
  // exactly the full tier's (a half-size viewport was measured and
  // rejected — the app's panel collapses behind its ☰ toggle below its
  // 640px breakpoint), and the tier's cache entries are separated by the
  // env field instead.
  const exportScale = tierExportScale(args.tier, Number(args.scale));
  // The tier's URL params on every page load, INCLUDING the link hops (the
  // hop frames must share the menu frame's raster for the byte-for-byte
  // compares).
  const tierQuery = new URLSearchParams(tierUrlParams(args.tier)).toString();
  const withTierQuery = (q) =>
    tierQuery ? (q ? `${q}&${tierQuery}` : tierQuery) : q;
  await guardFreshDist({ url: args.url });
  // The frame cache (docs/gate-velocity.md), wired to the four FRAME-PURE
  // products of the presets/tiled/gl phases: the settled menu frame, its
  // Save-PNG export, the tiled export, and the WebGL arm's frame. Each is a
  // pure function of (bundle, settled document, engine, viewport, device,
  // export scale / URL flags), so a same-key rerun replays the recorded
  // bytes and the probe-derived metadata that bytes cannot re-derive
  // (engine routing, ray census, tile counts — recorded at put time, and
  // every entry is put-GATED on its scenario's checks passing, so a failed
  // scenario never replays). What stays live on every path: the menu/boot
  // interactions, the settled-latch waits of the LINK HOPS (lifecycle, and
  // their byte-for-byte claims are fresh-hop-vs-recorded-menu comparisons,
  // never cached-vs-cached), the document checks, the toast/refusal phases
  // wholesale, and the machine-quiet certification. The export scale rides
  // the raster field; `surfacemaxrays`/`surfacegl` ride env.
  // `--force` never looks up; a store error degrades to uncached.
  const cache = createFrameCache({
    gate: "sphere-inversion-family",
    force: args.force,
    log,
  });
  const bundleHash = await cache.bundleHash(
    path.join(HERE, "..", "dist", "app"),
  );
  fs.mkdirSync(args.outdir, { recursive: true });
  const out = (name) => path.join(args.outdir, name);
  const phases = new Set(args.phases.split(",").filter(Boolean));
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
    tier: args.tier,
    scale: exportScale,
    viewport: "1600x900",
    quiet: browser.gpuQuiet ?? null,
    presets: {},
    tiled: {},
    gl: {},
    toast: {},
    refusal: {},
  };
  log(
    `tier=${tierLabel(args.tier)} viewport=1600x900 exportScale=${exportScale} ` +
      (fast
        ? `samples=1 maxrays=${tierUrlParams("fast").surfacemaxrays} `
        : "") +
      `phases=${[...phases].join(",")}` +
      (fast
        ? " (the tiled and gl legs are full-res reservations and are skipped)"
        : ""),
  );
  // Diff/decoder page: the app's isolation headers refuse the blob decode.
  const diffContext = await browser.newContext();
  const diffPage = await diffContext.newPage();
  await diffPage.goto("about:blank");
  // The key's device field asks the BROWSER which adapter it renders with —
  // on a page at the app's origin, because WebGPU is only exposed on a
  // secure context and the diff page's about:blank is not one (and the app
  // origin refuses the blob decode the diff page exists for, so they cannot
  // be one page). Memoized per engine; the throwaway app boot is harmless.
  let probeApp = null;
  const deviceSigs = new Map();
  const deviceFor = async (wanted) => {
    if (!deviceSigs.has(wanted)) {
      probeApp ??= await openApp(browser, { url: args.url });
      deviceSigs.set(wanted, await readDeviceSignature(probeApp.page, wanted));
    }
    return deviceSigs.get(wanted);
  };
  /** The nine key fields for one frame family. `document` is the settled
   * document's hash string; the export scale rides `raster`, the URL flags
   * (including the fast tier's overrides) ride `env`. */
  const fieldsForFrame = async (documentHash, engine, env, raster = {}) =>
    cache.disabled || bundleHash === null
      ? null
      : gateKeyFields({
          bundle: bundleHash,
          document: documentHash,
          engine,
          viewport: { width: 1600, height: 900, scale: 1 },
          device: await deviceFor(engine),
          env,
          raster,
        });
  /** The menu-loaded document's hash, STABLE: the preset writes land, then
   * the boot auto-fit writes the camera — the settled document the frame
   * was rendered from is the one the key must name, and reading it before
   * the settle (which a hit skips) needs the writes to have landed. Poll
   * until the hash repeats, bounded. */
  const stableDocumentHash = async (page) => {
    let hash = await page.evaluate(() => location.hash);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const next = await page.evaluate(() => location.hash);
      if (next === hash) return hash;
      hash = next;
    }
    return hash;
  };
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
        const app = await openApp(browser, {
          url: args.url,
          query: withTierQuery(""),
        });
        const { context, page, errors, consoleLines } = app;
        await context.addInitScript(CLIPBOARD_STUB);
        await page.evaluate(CLIPBOARD_STUB);
        try {
          const t0 = Date.now();
          await loadPreset(page, preset.key);
          // (5) the document carries the block — read BEFORE the settle and
          // on both paths (sw included), because a frame-cache hit skips
          // the settle and the key's document must be the settled document
          // either way. The hash is waited stable (preset writes, then the
          // boot auto-fit's camera write) before it keys anything.
          const doc = await waitDocument(
            page,
            (d) => !!d.sphereInversion && !!d.camera,
          );
          const docHash = await stableDocumentHash(page);
          r.blockMatches = sameJson(doc?.sphereInversion, preset.block);
          if (!r.blockMatches)
            fail(
              `${preset.key}: document block ${JSON.stringify(doc?.sphereInversion)} != table ${JSON.stringify(preset.block)}`,
            );
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
            log(
              `${preset.key}: entered engine=${r.engine} block=${r.blockMatches ? "ok" : "MISMATCH"}`,
            );
            if (errors.length)
              fail(
                `${preset.key}: console errors: ${errors.slice(0, 3).join(" | ")}`,
              );
            continue;
          }
          const failsBefore = failures.length;
          // (1) settle on the latch, (2) engine, (3) not blank — the
          // settle itself is the hit's skip; the probe-derived facts it
          // would read replay from the recorded verdict (entries are put
          // only when these checks passed on the same key, so the replay
          // re-runs the same predicates over recorded evidence).
          const fields = await fieldsForFrame(docHash, "compute", {
            surfacestate: "1",
            // The tier's params ride the key's env: the fast raster IS part
            // of what the frame is a function of, and a fast frame recorded
            // under a full-tier key would replay as a full-tier hit (the
            // silent-key bug class the force-frame memo key shipped this
            // lesson for). At full the tier params are {} and the key is
            // byte-identical to the recorded full-tier keys.
            ...tierUrlParams(args.tier),
          });
          const hit = fields ? await cache.lookup(fields, preset.key) : null;
          const cachedVerdict =
            hit?.entry.verdict &&
            typeof hit.entry.verdict.engine === "string" &&
            hit.entry.verdict.census &&
            // toastText returns null when no toast is showing — the normal
            // case — so the recorded absence is null, not a string.
            (typeof hit.entry.verdict.toastAtSettle === "string" ||
              hit.entry.verdict.toastAtSettle === null)
              ? hit.entry.verdict
              : null;
          let st;
          let toast;
          if (cachedVerdict) {
            r.settleMs = null;
            r.cachedSettle = true;
            st = {
              engine: cachedVerdict.engine,
              backend: cachedVerdict.backend,
              census: cachedVerdict.census,
            };
            toast = cachedVerdict.toastAtSettle;
          } else {
            const settled = await waitSettled(page, args.settle);
            r.settleMs = Date.now() - t0;
            if (!settled.ok) {
              fail(
                `${preset.key}: never settled (state=${JSON.stringify(settled.state)})`,
              );
              continue;
            }
            st = settled.state;
            toast = await toastText(page);
          }
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
          r.toastAtSettle = toast;
          if (toast && BLANK_TOAST.test(toast))
            fail(
              `${preset.key}: raised the blank-frame toast (${JSON.stringify(toast)})`,
            );
          // The menu frame: rendered and captured on a miss, replayed from
          // the recorded bytes on a hit — downstream comparisons read the
          // same file either way.
          const frameFile = out(`si-qual-${preset.key}.png`);
          if (cachedVerdict) {
            fs.writeFileSync(frameFile, hit.png);
          } else {
            const frameBytes = await captureScene(page, frameFile);
            // Put-gated: only a scenario whose checks all passed and whose
            // document matched records its frame, so a failed preset never
            // replays as a pass.
            if (fields && failures.length === failsBefore && r.blockMatches) {
              await cache.record(fields, {
                scenario: preset.key,
                png: frameBytes,
                verdict: {
                  engine: r.engine,
                  backend: r.backend,
                  census: r.census,
                  toastAtSettle: toast,
                },
                wallMs: r.settleMs,
              });
            }
          }
          frames.set(preset.key, frameFile);
          sheet.push({ label: `${preset.key} (menu)`, file: frameFile });
          log(
            `${preset.key}: settled ${r.cachedSettle ? "(cached)" : secs(r.settleMs)} from the menu, ` +
              `tier=${tierLabel(args.tier)} engine=${r.engine}` +
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

          // (7) Save PNG at the requested scale — the export's bytes are frame-pure
          // under the same key family (the scale rides the raster field), so
          // a hit replays them and recomputes the content checks from bytes;
          // the tile count is a session observable, recorded at put and
          // replayed as metadata.
          const exportFields = await fieldsForFrame(
            docHash,
            "compute",
            {
              surfacestate: "1",
              // The export bands under the same cap, so the tier rides the
              // key's env here too.
              ...tierUrlParams(args.tier),
            },
            { exportScale },
          );
          const exportHit = exportFields
            ? await cache.lookup(exportFields, `${preset.key}@export`)
            : null;
          const cachedExport =
            exportHit?.entry.verdict &&
            Number.isFinite(exportHit.entry.verdict.tileCount) &&
            Number.isFinite(exportHit.entry.verdict.tileLines)
              ? exportHit
              : null;
          const failsBeforeExport = failures.length;
          let png;
          if (cachedExport) {
            png = {
              bytes: exportHit.png,
              ms: exportHit.entry.verdict.ms ?? 0,
              tileCount: exportHit.entry.verdict.tileCount,
              tileLines: exportHit.entry.verdict.tileLines,
            };
            r.exportCached = true;
          } else {
            png = await savePng(
              page,
              consoleLines,
              String(exportScale),
              args.exportTimeout,
            );
          }
          const exportFile = out(`si-qual-${preset.key}-export.png`);
          fs.writeFileSync(exportFile, png.bytes);
          exports.set(preset.key, exportFile);
          sheet.push({
            label: `${preset.key} export ${exportScale}x`,
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
            `${preset.key}: export ${content.width}x${content.height} in ${cachedExport ? "(cached)" : secs(png.ms)},` +
              ` ${png.tileCount} tile(s), ${content.distinctColors} colours, luma sd ${content.lumaStd.toFixed(1)}`,
          );
          const expectW = 1600 * exportScale;
          const expectH = 900 * exportScale;
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
          if (
            exportFields &&
            !cachedExport &&
            failures.length === failsBeforeExport
          ) {
            await cache.record(exportFields, {
              scenario: `${preset.key}@export`,
              png: png.bytes,
              verdict: {
                ms: png.ms,
                tileCount: png.tileCount,
                tileLines: png.tileLines,
              },
              wallMs: png.ms,
            });
          }
          if (errors.length)
            fail(
              `${preset.key}: console errors: ${errors.slice(0, 3).join(" | ")}`,
            );
          await context.close();

          // (6b) the link boots a fresh context; its frame is compared with
          // the menu's, and the link it copies boots a second one, which must
          // reproduce the first byte for byte (a link is a fixed point).
          if (link) {
            const hop1 = await settleLinkHop(
              browser,
              args,
              link,
              preset,
              1,
              tierQuery,
            );
            const hop2 =
              hop1?.link && hop1.frameFile
                ? await settleLinkHop(
                    browser,
                    args,
                    hop1.link,
                    preset,
                    2,
                    tierQuery,
                  )
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

    // ------------------------------------------------- THE PILOT (fast runs)
    // One full-resolution sample — the FIRST preset, re-rendered at the
    // shared viewport with the default samples — asserting the same
    // frame-pure predicates its fast pass asserted. This is the run's
    // fast-vs-full correspondence (scripts/lib/fast-tier.mjs): a divergence
    // fails the run with the predicates named. The sample's frame is
    // recorded under its FULL-tier cache key when its checks pass — the
    // key's viewport/env fields separate the tiers' entries, so this
    // refresh is the store's fast-vs-full anchor. A full run has no pilot;
    // the sw subset settles nothing and has none either.
    if (phases.has("presets") && fast && !sw) {
      const pilot = wanted[0];
      const fastRecord = results.presets[pilot.key] ?? null;
      const fastCensus = fastRecord?.census ?? null;
      const fastPredicates = {
        blockMatches: fastRecord?.blockMatches === true,
        engineOk: fastRecord?.engine === "compute",
        coveredOk: fastCensus
          ? fastCensus.covered / fastCensus.rays >= MIN_COVERED
          : false,
        exhaustedOk: !!fastCensus && fastCensus.exhausted === 0,
        blankOk: !(
          fastRecord?.toastAtSettle &&
          BLANK_TOAST.test(fastRecord.toastAtSettle)
        ),
      };
      results.pilot = { key: pilot.key, tier: "full" };
      const app = await openApp(browser, { url: args.url });
      try {
        const t0 = Date.now();
        await loadPreset(app.page, pilot.key);
        const doc = await waitDocument(
          app.page,
          (d) => !!d.sphereInversion && !!d.camera,
        );
        const pilotHash = await stableDocumentHash(app.page);
        const settled = await waitSettled(app.page, args.settle);
        results.pilot.ms = Date.now() - t0;
        if (!settled.ok) {
          fail(`pilot ${pilot.key}: the full-tier sample never settled`);
        }
        const st = settled.state ?? {};
        const covered = st.census ? st.census.covered / st.census.rays : 0;
        const toast = await toastText(app.page);
        const pilotPredicates = {
          blockMatches: sameJson(doc?.sphereInversion, pilot.block),
          engineOk: st.engine === "compute",
          coveredOk: covered >= MIN_COVERED,
          exhaustedOk: !!st.census && st.census.exhausted === 0,
          blankOk: !(toast && BLANK_TOAST.test(toast)),
        };
        results.pilot.predicates = pilotPredicates;
        const corr = tierCorrespondence(fastPredicates, pilotPredicates);
        results.pilot.correspondence = corr;
        if (!pilotPredicates.engineOk)
          fail(
            `pilot ${pilot.key}: engine=${String(st.engine)}, expected compute`,
          );
        if (!pilotPredicates.coveredOk)
          fail(
            `pilot ${pilot.key}: covered ${(100 * covered).toFixed(1)}% of the pane at full tier`,
          );
        if (!pilotPredicates.exhaustedOk)
          fail(
            `pilot ${pilot.key}: ${st.census?.exhausted ?? "?"} rays exhausted at full tier`,
          );
        if (!pilotPredicates.blankOk)
          fail(`pilot ${pilot.key}: raised the blank-frame toast at full tier`);
        if (!corr.agree)
          fail(
            `pilot ${pilot.key}: the fast and full tiers disagree on ${corr.diverged.join(", ")} — the fast tier no longer tracks the full one`,
          );
        const pilotOk = settled.ok && corr.agree;
        const pilotFile = out(`si-qual-${pilot.key}-pilot-full.png`);
        if (pilotOk) {
          const png = await captureScene(app.page, pilotFile);
          sheet.push({
            label: `${pilot.key} (pilot, full tier)`,
            file: pilotFile,
          });
          // The full-tier entry: recorded under the key a full run's
          // presets phase would derive (no tier URL params — the default
          // samples and the device's own raster cap), put-gated on this
          // sample's checks passing.
          const pilotFields = await fieldsForFrame(pilotHash, "compute", {
            surfacestate: "1",
          });
          if (pilotFields) {
            await cache.record(pilotFields, {
              scenario: `${pilot.key}@pilot-full`,
              png,
              verdict: {
                engine: st.engine,
                backend: st.backend,
                census: st.census
                  ? {
                      rays: st.census.rays,
                      covered: st.census.covered,
                      miss: st.census.miss,
                      exhausted: st.census.exhausted,
                    }
                  : null,
                toastAtSettle: toast,
              },
              wallMs: results.pilot.ms,
            });
          }
        }
        log(
          `pilot ${pilot.key}: tier=fast vs tier=full ` +
            `${corr.agree ? "agree" : `DIVERGED ${corr.diverged.join(",")}`}, ` +
            `settled ${secs(results.pilot.ms)}, covered ${(100 * covered || 0).toFixed(1)}%` +
            ` exhausted=${st.census?.exhausted ?? "?"} engine=${String(st.engine)}`,
        );
      } catch (error) {
        fail(`pilot ${pilot.key}: ${String(error).split("\n")[0]}`);
      } finally {
        await app.context.close().catch(() => {});
      }
    }

    // --------------------------------------------------------- tiled export
    if (phases.has("tiled")) {
      if (fast) {
        // THE FULL-RESERVATION LEG: the export-scale tile byte-exactness
        // this phase asserts is one of the legs reserved for the full pass
        // (the untiled export only guarantees its device-ceiling tiling at
        // export scale). A fast run discloses the skip rather than
        // quietly running a reduced form of it; the full run owns the
        // contract.
        results.tiled.skipped =
          "--tier=fast: export-scale tile byte-exactness is a full-res leg; the full run owns it";
        log(`tiled: SKIPPED (${results.tiled.skipped})`);
      }
      for (const key of fast ? [] : args.tiled.split(",").filter(Boolean)) {
        const r = (results.tiled[key] = {});
        const app = await openApp(browser, {
          url: args.url,
          query: withTierQuery(`surfacemaxrays=${args.maxrays}`),
        });
        try {
          await loadPreset(app.page, key);
          // The document must be stable before it keys anything (same
          // reason as the presets phase); the forced ceiling rides env.
          await waitDocument(
            app.page,
            (d) => !!d.sphereInversion && !!d.camera,
          );
          const tiledHash = await stableDocumentHash(app.page);
          const tiledFields = await fieldsForFrame(
            tiledHash,
            "compute",
            { surfacestate: "1", surfacemaxrays: String(args.maxrays) },
            { exportScale },
          );
          const tiledHit = tiledFields
            ? await cache.lookup(tiledFields, `${key}@tiled`)
            : null;
          const cachedTiled =
            tiledHit?.entry.verdict &&
            Number.isFinite(tiledHit.entry.verdict.tileCount) &&
            Number.isFinite(tiledHit.entry.verdict.tileLines)
              ? tiledHit
              : null;
          const failsBeforeTiled = failures.length;
          let png;
          if (cachedTiled) {
            png = {
              bytes: tiledHit.png,
              ms: tiledHit.entry.verdict.ms ?? 0,
              tileCount: tiledHit.entry.verdict.tileCount,
              tileLines: tiledHit.entry.verdict.tileLines,
            };
            r.cached = true;
          } else {
            const settled = await waitSettled(app.page, args.settle);
            if (!settled.ok) {
              fail(`tiled ${key}: never settled under surfacemaxrays`);
              continue;
            }
            png = await savePng(
              app.page,
              app.consoleLines,
              String(exportScale),
              args.exportTimeout,
            );
          }
          const file = out(`si-qual-${key}-export-tiled.png`);
          fs.writeFileSync(file, png.bytes);
          sheet.push({
            label: `${key} export ${exportScale}x tiled (${png.tileCount})`,
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
          // Put-gated on the phase's own checks (tile assertions and the
          // untiled-identity compare included), so a failed tiled leg
          // re-renders on the next run.
          if (
            tiledFields &&
            !cachedTiled &&
            failures.length === failsBeforeTiled
          ) {
            await cache.record(tiledFields, {
              scenario: `${key}@tiled`,
              png: png.bytes,
              verdict: {
                ms: png.ms,
                tileCount: png.tileCount,
                tileLines: png.tileLines,
              },
              wallMs: png.ms,
            });
          }
        } catch (error) {
          fail(`tiled ${key}: ${String(error).split("\n")[0]}`);
        } finally {
          await app.context.close().catch(() => {});
        }
      }
    }

    // ---------------------------------------------------- WebGL vs compute
    if (phases.has("gl")) {
      if (fast) {
        // THE SECOND FULL-RESERVATION LEG: the cross-engine IoU needs BOTH
        // engines at one raster, and the ray cap is a compute-only knob —
        // the WebGL arm has no raster cap to pin the same fast raster — so
        // a fast pair is a capped-compute-vs-uncapped-webgl compare, which
        // measures the raster difference, not the engines (measured: IoU
        // 0.969/0.977 at fast against the recorded full-tier 0.9997/1.0000).
        // Disclosed, skipped; the full run owns the contract.
        results.gl.skipped =
          "--tier=fast: the cross-engine IoU needs both engines at one raster and the ray cap is compute-only";
        log(`gl: SKIPPED (${results.gl.skipped})`);
      }
      for (const key of fast ? [] : args.gl.split(",").filter(Boolean)) {
        const r = (results.gl[key] = {
          previewExhaustion:
            "unreadable: the WebGL arm decodes its ray census off the settle target only",
        });
        const app = await openApp(browser, {
          url: args.url,
          query: "surfacegl",
        });
        try {
          await loadPreset(app.page, key);
          await waitDocument(
            app.page,
            (d) => !!d.sphereInversion && !!d.camera,
          );
          const glHash = await stableDocumentHash(app.page);
          const glFields = await fieldsForFrame(glHash, "webgl", {
            surfacestate: "1",
            surfacegl: "1",
          });
          const glHit = glFields
            ? await cache.lookup(glFields, `${key}@gl`)
            : null;
          const cachedGl =
            glHit?.entry.verdict &&
            glHit.entry.verdict.engine === "webgl" &&
            glHit.entry.verdict.census
              ? glHit.entry.verdict
              : null;
          const failsBeforeGl = failures.length;
          if (cachedGl) {
            r.settleMs = null;
            r.cached = true;
            r.engine = cachedGl.engine;
            r.backend = cachedGl.backend;
            r.census = cachedGl.census;
          } else {
            const t0 = Date.now();
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
          }
          if (r.engine !== "webgl")
            fail(`gl ${key}: engine=${r.engine}, expected webgl`);
          const file = out(`si-qual-${key}-glsl.png`);
          let glFrameBytes = null;
          if (cachedGl) {
            fs.writeFileSync(file, glHit.png);
          } else {
            glFrameBytes = await captureScene(app.page, file);
          }
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
            // THE BACKDROP PREMISE: the per-row channel-delta mask reads the
            // vertical backdrop ramp off each row's first column, so a
            // pixel counts as covered when it departs from that row's edge
            // sample. The premise only a frame with true backdrop can
            // admit: past BACKDROP_PREMISE_MAX_COVERED covered fraction (both
            // engines' own ray censuses agree the frame is nearly all
            // geometry) the mask's absolute fraction is no longer a
            // coverage measurement — an interior camera whose frame is
            // ~96% subject leaves every row's edge sample ON the subject,
            // and subject pixels matching the local geometry color read as
            // backdrop (measured: the vault's mask read 90.32% against both
            // engines' 95.89%). The rule waives the mask-vs-census check BY
            // NAME, gates the two engines' censuses against each other
            // instead, and keeps the IoU (the masks still measure the two
            // engines' silhouette agreement against each other); the mask
            // numbers stay in the record as informational.
            const backdropPremise =
              (censusA ?? 1) <= BACKDROP_PREMISE_MAX_COVERED &&
              (censusB ?? 1) <= BACKDROP_PREMISE_MAX_COVERED;
            if (!backdropPremise)
              r.backdropPremiseWaived =
                `census coverage ${(100 * (censusA ?? NaN)).toFixed(2)}% compute /` +
                ` ${(100 * (censusB ?? NaN)).toFixed(2)}% webgl exceeds` +
                ` ${(100 * BACKDROP_PREMISE_MAX_COVERED).toFixed(0)}% — the per-row backdrop mask cannot calibrate a nearly fully covered frame;` +
                ` the engines' censuses and the IoU carry the check`;
            log(
              `gl ${key}: settled ${r.cached ? "(cached)" : secs(r.settleMs)} on ${r.backend?.label}, tier=${tierLabel(args.tier)}, IoU ${cov.iou?.toFixed(4)}` +
                ` (covered ${(100 * cov.coveredA).toFixed(2)}% compute / ${(100 * cov.coveredB).toFixed(2)}% webgl),` +
                ` mean diff on covered ${cov.meanDiffCovered?.toFixed(3)}/255,` +
                ` census covered ${(100 * (censusA ?? NaN)).toFixed(2)}% compute / ${(100 * (censusB ?? NaN)).toFixed(2)}% webgl` +
                (backdropPremise
                  ? ""
                  : ` [backdrop premise waived: ${r.backdropPremiseWaived}]`),
            );
            r.censusCoveredCompute = censusA;
            r.censusCoveredWebgl = censusB;
            if (censusA === null || censusB === null)
              fail(
                `gl ${key}: a settled census is missing — nothing to agree on`,
              );
            else if (!backdropPremise) {
              // The named high-coverage rule: census-vs-census agreement
              // plus the mask IoU; the mask's own covered fractions are
              // informational at this coverage.
              if (Math.abs(censusA - censusB) > MASK_CENSUS_TOLERANCE)
                fail(
                  `gl ${key}: the engines' censuses disagree (${censusA} vs ${censusB}) — the backdrop mask cannot calibrate a nearly fully covered frame`,
                );
              else if (!cov.backdropOk)
                fail(
                  `gl ${key}: backdrop premise failed (edge rows ${cov.edgeRowsBad}) — IoU unmeasured`,
                );
              else if (!(cov.iou >= GL_MIN_IOU))
                fail(`gl ${key}: coverage IoU ${cov.iou} < ${GL_MIN_IOU}`);
            } else if (
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
          // Put-gated on the phase's own checks (engine, mask-vs-census
          // agreement and the IoU bar included), so a failed gl leg
          // re-renders on the next run.
          if (glFields && !cachedGl && failures.length === failsBeforeGl) {
            await cache.record(glFields, {
              scenario: `${key}@gl`,
              png: glFrameBytes,
              verdict: {
                engine: r.engine,
                backend: r.backend,
                census: r.census,
              },
              wallMs: r.settleMs,
            });
          }
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
            query: "surfacegl",
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

    // --------------------------------- compute-only refusal (WebGL forced)
    if (phases.has("refusal")) {
      const computeOnly = SI_PRESETS.filter((p) => p.computeOnly);
      // The capacity door is the leg's reason to exist beyond the 4D pair:
      // without a 3D subject it would pass while gating nothing new.
      if (!computeOnly.some((p) => p.dim === 3) && !only)
        fail(
          "refusal: no 3D preset is compute-only, so the fragment arm's capacity refusal is ungated",
        );
      for (const preset of computeOnly) {
        const r = (results.refusal[preset.key] = {
          subject: preset.computeOnly,
        });
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
          if (!state.title.includes(computeOnlyNote(preset.computeOnly)))
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
    if (probeApp) await probeApp.context.close().catch(() => {});
    await diffContext.close().catch(() => {});
    await cache.prune();
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
  log(
    `verdict=${failures.length > 0 ? "fail" : "pass"} tier=${tierLabel(args.tier)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
