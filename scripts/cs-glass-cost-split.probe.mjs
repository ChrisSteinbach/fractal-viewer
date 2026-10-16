#!/usr/bin/env node
/**
 * The curved solid's 4D/3D cost split, measured: for each Glass starter
 * whose document carries recursive maps beside its emitters, the SAME
 * document settles twice at the same sample count — once as glass on the
 * closed-solid backend (the menu load), once as the Classic control (the
 * copied link re-encoded with every transform's optics removed, the
 * estimator backend). The difference isolates the transport lane's share
 * of the session, and the Classic pair's ratio isolates the primary
 * march's own 4D/3D cost, so the canonical-pose search lever's ceiling is
 * visible before anyone builds it.
 *
 * Per-pass walls come off the `?surfacetrace` feed's `frame done` lines
 * (`scripts/lib/finite-glass-trace.mjs`), so the settle's fixed cost
 * (menu load, engine entry, compile) never hides the per-sample marginal.
 * Measures, gates nothing.
 *
 * OUTPUT (gitignored): `scripts/out/cs-glass-cost-results.json`.
 *
 * USAGE (a production build served first; the X cookie per AGENTS.md):
 *   npm run build && npm run preview &
 *   node scripts/cs-glass-cost-split.probe.mjs --mode=x11::0 --samples=8
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { REPO_ROOT } from "./lib/dist-freshness.mjs";
import { traceFrames } from "./lib/finite-glass-trace.mjs";
import {
  CLIPBOARD_STUB,
  copyLink,
  loadPreset,
  openApp,
  settleFromLink,
  waitSettled,
} from "./lib/sphere-inversion-gate.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  }),
);
const url = args.url ?? "https://localhost:4173";
const mode = args.mode ?? "x11::0";
const samples = Number(args.samples ?? 8);
const settleMs = Number(args.settle ?? 900_000);
const only = args.only ? args.only.split(",") : null;
const [w, h] = (args.viewport ?? "960x540").split("x").map(Number);
const outdir = path.join(HERE, "out");
const log = (line) => console.log(`[cs-cost] ${line}`);

/** The starters with recursive maps beside emitters, from the module. */
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

/** A link with every transform's optics removed (the gate's Classic). */
function classicLink(link) {
  const body = link.slice(link.indexOf("#") + 4);
  const doc = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  for (const t of doc.transforms ?? []) delete t.optics;
  const hash = Buffer.from(JSON.stringify(doc), "utf8").toString("base64url");
  return `${link.slice(0, link.indexOf("#"))}#v1=${hash}`;
}

/** Enter Surface after a menu load when the load did not (the gate's). */
async function enterSurface(page) {
  const inSurface = await page.evaluate(
    () => window.__surfaceState?.().mode === "surface",
  );
  if (!inSurface) await page.click("#modeSurfaceBtn");
}

/** Per-pass walls off the feed's `frame done` lines, in feed order. */
function passWalls(consoleLines, name) {
  fs.writeFileSync(
    path.join(outdir, `cs-cost-${name}.log`),
    consoleLines.join("\n"),
  );
  return traceFrames(consoleLines)
    .filter((f) => f.completed)
    .map((f) => f.wallMs ?? null);
}

const starters = await loadStarters();
const wanted = only ? starters.filter((s) => only.includes(s.id)) : starters;
if (wanted.length === 0) throw new Error(`unknown --only ${args.only ?? ""}`);
const browser = await launchSurfaceBrowser(mode);
const results = {
  startedAt: new Date().toISOString(),
  mode,
  samples,
  viewport: `${w}x${h}`,
  quiet: browser.gpuQuiet ?? null,
  starters: {},
};

for (const starter of wanted) {
  const key = starter.id;
  log(`${key}: menu load, glass settle...`);
  const app = await openApp(browser, {
    url,
    query: `surfacetrace&surfacesamples=${samples}`,
    contextOptions: { viewport: { width: w, height: h } },
    initScripts: [[CLIPBOARD_STUB]],
  });
  const { context, page, consoleLines } = app;
  try {
    const t0 = Date.now();
    await loadPreset(page, starter.value);
    await enterSurface(page);
    const settled = await waitSettled(page, settleMs);
    const glass = { settleMs: Date.now() - t0, settled: settled.ok };
    glass.passes = passWalls(consoleLines, "glass");
    const st = settled.state;
    glass.opticsBackend = st?.opticsBackend ?? null;
    glass.engine = st?.engine ?? null;
    glass.backend = st?.backend?.label ?? null;
    // The Classic control on the SAME engine: the estimator backend with
    // optics removed routes plain affine to WebGL by design, so the
    // classic leg forces compute (`?surfacecompute`) — the transport lane
    // is the only wire the optics removal takes away, and glass − classic
    // then isolates it.
    const link = await copyLink(page);
    if (!link) throw new Error("no link");
    await context.close().catch(() => {});
    log(`${key}: Classic settle (optics removed, compute forced)...`);
    const reload = await settleFromLink(
      browser,
      { url, settle: settleMs },
      classicLink(link),
      `surfacetrace&surfacesamples=${samples}&surfacecompute`,
      { viewport: { width: w, height: h } },
    );
    const classic = { settleMs: reload.ms, settled: reload.settled.ok };
    classic.passes = passWalls(reload.consoleLines, "classic");
    const cst = reload.settled.state ?? {};
    classic.opticsBackend = cst.opticsBackend ?? null;
    classic.engine = cst.engine ?? null;
    classic.backend = cst.backend?.label ?? null;
    results.starters[key] = { dim: starter.dim, glass, classic };
    log(
      `${key}: glass ${glass.settleMs}ms (${glass.opticsBackend}), classic ${classic.settleMs}ms (${classic.opticsBackend}), passes ${JSON.stringify(glass.passes)} / ${JSON.stringify(classic.passes)}`,
    );
  } catch (error) {
    results.starters[key] = {
      dim: starter.dim,
      error: String(error).split("\n")[0],
    };
    log(`${key}: FAIL ${results.starters[key].error}`);
  } finally {
    await context.close().catch(() => {});
  }
}

fs.mkdirSync(outdir, { recursive: true });
const out = path.join(outdir, "cs-glass-cost-results.json");
fs.writeFileSync(out, `${JSON.stringify(results, null, 1)}\n`);
log(`wrote ${out}`);
await browser.close().catch(() => {});
