#!/usr/bin/env node
/**
 * The escape-time menu group, driven from the menu.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A UNIT TEST. The Mandelbulb's routing
 * shipped with nine Escape-time presets, and its own closing note said the
 * in-app check was never done because "verify the presets load" was
 * too vague to act on. Everything it actually needed to know is DOM glue and
 * GPU behaviour, which this project verifies by running the app:
 *
 *   1. Every preset in the Escape-time group enters Surface mode FROM THE
 *      MENU, unaided, and settles. A preset whose system its own gate refuses
 *      would leave the Surface button dark, and nothing below the UI would
 *      say so — `presets.test.ts` pins the side tables' consistency, not the
 *      routing that reads them.
 *   2. The three Mandelbulbs are three OBJECTS, not three views of one. Their
 *      knobs are the pre-power offset and a rotation, and that routing's
 *      own standard was "if two match, a knob is not reaching the DE".
 *   3. PRESET_FINALS and PRESET_SYMMETRIES do not LEAK, in either direction.
 *      Both tables are ABSENT-MEANS-CLEAR, and both are load-bearing: a lens
 *      left over from a previous preset silently re-poses the arriving
 *      attractor, and for these presets takes the render mode away outright
 *      (analyzeBulbSystem refuses any symmetry order above 1, and both
 *      forward gates refuse a final transform). The reverse leak — a preset
 *      that carries a lens failing to install it — renders juliaSnowflake as
 *      a plain juliaIsland, silently.
 *   4. WHICH ENGINE each session takes. The bulb was wired into the
 *      compute renderer; if bulb sessions in fact fall to the WebGL
 *      SURFACE_BULB arm, the bench-verified `core:"bulb"` WGSL kernel is dead
 *      code and nobody would know from a green test suite.
 *
 * It also covers the two fixes that landed beside it: a chain's trap now
 * reaching its palette is why the fold-chain shots are compared for colour
 * spread, and the empty-set notice (an empty set says so) has its own
 * scenario.
 *
 * THAT LAST SCENARIO IS ALSO THE TRACE-ALPHA COVERAGE FLAG'S GATE, and it
 * needs `--query=surfacegl` to be one. The notice originally fired off the
 * WebGPU settle's own per-ray status tally, so a session that fell back to
 * the WebGL fragment tracer — no adapter, `?surfacegl`, a lost device —
 * rendered an empty set in silence, which is the original complaint
 * surviving inside its own fix. The WebGL arm counts the COVERAGE flag its
 * tracer writes into alpha instead (scene.ts's `surfaceCoveredFraction`).
 * MEASURED on SwiftShader at
 * the fix: `--mode=sw --query=surfacegl` fails exactly this check on the
 * pre-fix build ("no toast explaining the blank frame (got null)") and passes
 * on the fixed one, with the fourteen shipped presets still raising no toast at
 * all — which is the check that matters more, since a signal that fires on
 * good input is worse than the silence it replaced.
 *
 * USAGE (build + `npm run preview` first — this measures a real build):
 *   npm run build && npm run preview &
 *   node scripts/escape-family.verify.mjs --mode=x11::0
 *   node scripts/escape-family.verify.mjs --mode=sw          # SwiftShader
 *   node scripts/escape-family.verify.mjs --only=mandelbulbClassic
 *
 * `--url` also accepts a DEPLOYED origin (`--url=https://fractal-4d.com`),
 * which is the only way to check what users actually get — the isolation
 * reload a live origin performs is handled, and `npm run preview` never
 * performs it.
 *
 * `--mode=x11:<display>` is a HEADED window on a live X display, which is the
 * only route to the real driver here and therefore the only arm on which the
 * engine question (4) has a meaningful answer — SwiftShader answers "compute,
 * software", which is true and useless. `--mode=sw` stays available so the
 * routing and leak checks can run without a display.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(HERE, "out", "escape-family");

/**
 * The Escape-time menu group, in menu order, plus what each one is for.
 * `group` is what the pairwise-difference check compares within: three
 * members of a group that render the same image mean a knob is not reaching
 * the DE, which is the failure the routing work asked about.
 */
const PRESETS = [
  { key: "mandelboxClassic", group: "mandelbox" },
  { key: "mandelboxRings", group: "mandelbox" },
  { key: "mandelboxCube", group: "mandelbox" },
  // The shape-trap preset: the SAME map as mandelboxClassic, so its
  // membership in the mandelbox group is itself a check — if it renders
  // the same picture as the classic, the trap channel (a color source, a
  // side table, two engines' shading) is not reaching the render.
  { key: "mandelboxPeace", group: "mandelbox" },
  { key: "foldChain", group: "chain" },
  { key: "foldChainBoulder", group: "chain" },
  { key: "foldChainFlower", group: "chain" },
  // Same foldChain word as the base row, with PRESET_TRAPS installing a
  // gear as marched geometry. Group membership makes a dead geometry wire
  // fail the ordinary pairwise object comparison too.
  { key: "foldChainGear", group: "chain" },
  { key: "mandelbulbClassic", group: "bulb" },
  { key: "mandelbulbOffset", group: "bulb" },
  { key: "mandelbulbRotated", group: "bulb" },
  { key: "hybridChainCube", group: "hybrid" },
  { key: "hybridChainCraters", group: "hybrid" },
  { key: "hybridChainQuaternion", group: "hybrid" },
];

/** The flame presets that carry a plot-time lens (PRESET_FINALS), used by the
 * leak check. `juliaIsland` is the same system WITHOUT one — it is what a
 * leaked-away lens would make the other two look like. */
const LENS_PRESETS = ["juliaSnowflake", "juliaPinwheel"];

/**
 * Whether the live DOCUMENT carries a final transform, read out of the
 * `#v1=` hash `persist.ts` writes on every edit.
 *
 * Deliberately NOT a DOM probe. The panel row is shared now, but disclosure
 * open state and the active final-transform selection remain view concerns;
 * they are not proof of the stored document. The hash is the document itself,
 * and it is what a shared link carries.
 */
const READ_FINAL_TRANSFORM = () => {
  const raw = location.hash.replace(/^#v1=/, "");
  if (!raw) return { ok: false, reason: "no #v1= hash" };
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const doc = JSON.parse(atob(b64));
    return { ok: true, hasFinal: doc.finalTransform != null };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
};

/** Two settled frames count as DIFFERENT objects when at least this fraction
 * of pixels differ by more than a channel step that survives dithering. Set
 * from the measurement rather than from taste: MEASURED on the real driver,
 * every pair inside every group differs on 6.2-9.5% of pixels, while two runs
 * of the SAME pinned scene differ on 0% of them (the settle latch's own
 * determinism verdict). 2% sits with a wide margin on both sides — it is a
 * check for a
 * knob that does NOTHING, not a pixel-diff regression gate. */
const DIFFER_FRACTION = 0.02;
const DIFFER_DELTA = 8;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    only: "",
    settle: 240_000,
    dwell: 1_500,
    outdir: DEFAULT_OUT_DIR,
    query: "",
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    if (key === "settle" || key === "dwell") args[key] = Number(value);
    else args[key] = value;
  }
  return args;
}

function launchOptions(mode) {
  const env = { ...process.env };
  if (mode.startsWith("x11:")) {
    // surface-repro.verify.mjs's idiom: a headed window on a live X display
    // is the only route to the real driver, and WebGPU reaches it through
    // Vulkan. Deliberately NO SwiftShader/ANGLE flags.
    env.DISPLAY = mode.slice(4);
    return {
      env,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
      headless: false,
    };
  }
  if (mode === "sw") {
    delete env.DISPLAY;
    return {
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
      headless: true,
    };
  }
  throw new Error(`unknown --mode ${mode} (expected x11:<display> or sw)`);
}

/** Load the app fresh, with the settle latch published. */
async function openApp(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 640 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  const q = args.query ? `?surfacestate&${args.query}` : "?surfacestate";
  await page.goto(`${args.url}/${q}`, { waitUntil: "load" });
  await settled(page, () =>
    page.waitForFunction(() => typeof window.__surfaceState === "function"),
  );
  // A LIVE origin reloads once for cross-origin isolation (see
  // register-sw.ts): the first visit registers the service worker, then the
  // page reloads to come back under COOP/COEP. `npm run preview` serves those
  // headers already, so this never fires there — but pointing --url at the
  // deployed site does, and every evaluate racing that reload dies with
  // "Execution context was destroyed". Wait it out ONCE here, so the checks
  // below can assume a stable document.
  await page
    .waitForFunction(() => window.crossOriginIsolated === true, undefined, {
      timeout: 15_000,
    })
    .catch(() => {
      // Not every deployment is isolated, and the app runs either way — the
      // point was only to be past the reload if one was coming.
    });
  await settled(page, () =>
    page.waitForFunction(() => typeof window.__surfaceState === "function"),
  );
  return { context, page, consoleLines };
}

/**
 * Run `fn`, retrying once if the page navigated out from under it.
 *
 * Playwright rejects an in-flight evaluate with "Execution context was
 * destroyed" when that happens, and a navigation here is EXPECTED rather than
 * a fault — see the isolation reload above. Retrying once is enough: the
 * reload happens at most once per page.
 */
async function settled(page, fn) {
  try {
    return await fn();
  } catch (error) {
    if (
      !/Execution context was destroyed|frame was detached/i.test(String(error))
    ) {
      throw error;
    }
    await page.waitForLoadState("load").catch(() => {});
    return fn();
  }
}

/** Choose a preset from the panel's menu — the path a user takes, and the one
 * that runs main.ts's onPreset handler with its side tables. */
async function loadPreset(page, key) {
  // Presets is a shared Workflow section. Open its accordion explicitly,
  // but deliberately do NOT return to Points: consecutive Surface-authored
  // presets are the regression this helper now pins. main.ts must perform the
  // replacement's Points morph and re-enter the arriving preset on its own.
  let shape = null;
  for (let i = 0; i < 20; i++) {
    shape = await settled(page, () =>
      page.evaluate(() => {
        const sel = document.getElementById("presetSelect");
        if (!sel) return { found: false, w: 0, h: 0 };
        const details = sel.closest("details");
        if (details && !details.open) details.open = true;
        const r = sel.getBoundingClientRect();
        return {
          found: true,
          w: r.width,
          h: r.height,
        };
      }),
    );
    if (shape.found && shape.w > 0 && shape.h > 0) break;
    await page.waitForTimeout(250);
  }
  if (!shape?.found || shape.w === 0 || shape.h === 0) {
    throw new Error(`preset menu unreachable: ${JSON.stringify(shape)}`);
  }
  // `persist.ts` rewrites the `#v1=` hash on every edit, but `edit-session.ts`
  // DEBOUNCES that save — so "the document changed" is the only reliable
  // signal that the load has actually landed, and reading the hash sooner
  // returns the PREVIOUS preset's document. (Learned the hard way: a check
  // that polled for merely a valid hash reported a lens leak that was really
  // the last preset's own lens, still written.)
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page
    .waitForFunction(
      (h) => location.hash !== h && location.hash !== "",
      before,
      {
        timeout: 15_000,
      },
    )
    .catch(() => {
      throw new Error(
        `preset ${key}: the document never changed after loading`,
      );
    });
}

/** Enter Surface mode from the mode button, refusing to pretend a disabled
 * button is a pass — a dark button is precisely the reported symptom. */
async function enterSurface(page) {
  const disabled = await page.getAttribute("#modeSurfaceBtn", "disabled");
  const title = await page.getAttribute("#modeSurfaceBtn", "title");
  if (disabled !== null) return { entered: false, reason: title ?? "disabled" };
  await page.click("#modeSurfaceBtn");
  return { entered: true, reason: null };
}

/** Wait for the app's own settle latch, held for `dwell` — see
 * surface-repro.verify.mjs's module doc for why a pixel-stability poll is not
 * an answer here. */
async function waitSettled(page, args) {
  const deadline = Date.now() + args.settle;
  let held = 0;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__surfaceState());
    const ok =
      last &&
      last.mode === "surface" &&
      last.firstFrame &&
      last.settled &&
      !last.previewActive &&
      !last.settleActive &&
      !last.settlePending;
    if (ok) {
      held += 150;
      if (held >= args.dwell) return { ok: true, state: last };
    } else {
      held = 0;
    }
    await page.waitForTimeout(150);
  }
  return { ok: false, state: last };
}

/** Fraction of pixels differing by more than DIFFER_DELTA on any channel. */
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
  fs.mkdirSync(args.outdir, { recursive: true });
  const { env, args: launchArgs, headless } = launchOptions(args.mode);
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless,
    env,
    args: launchArgs,
  });
  const failures = [];
  const shots = new Map();
  const engines = new Map();
  try {
    const wanted =
      args.only === "none"
        ? []
        : args.only
          ? PRESETS.filter((p) => p.key === args.only)
          : PRESETS;
    if (wanted.length === 0 && args.only !== "none") {
      throw new Error(`unknown --only ${args.only}`);
    }

    // --- 1 & 4: every preset enters from the menu, settles, on some engine
    for (const preset of wanted) {
      const { context, page, consoleLines } = await openApp(browser, args);
      try {
        await loadPreset(page, preset.key);
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(
            `${preset.key}: Surface button disabled — ${entry.reason}`,
          );
          console.error(
            `[escape-family] ${preset.key}: NOT ENTERED (${entry.reason})`,
          );
          continue;
        }
        const t0 = Date.now();
        const settled = await waitSettled(page, args);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (!settled.ok) {
          failures.push(
            `${preset.key}: never settled in ${args.settle}ms (state=${JSON.stringify(settled.state)})`,
          );
          console.error(
            `[escape-family] ${preset.key}: NOT SETTLED after ${secs}s`,
          );
          continue;
        }
        // The blank-frame notice's second cut: a shipped preset must NEVER
        // raise that notice. Its FIRST cut did — it asked a VOLUME probe
        // whether anything would render, and mandelboxRings is a dust with
        // no measurable volume and ~38k surface hits, so the app cried wolf
        // over one of its own presets. This gate had every other check and
        // not this one: it verified the notice fires on a deliberately
        // empty system, and never that it stays quiet on a good one.
        const toast = await page.evaluate(() => {
          const el = document.getElementById("toast");
          return el && !el.classList.contains("hidden") ? el.textContent : null;
        });
        if (toast && /rendered almost nothing|looks empty/i.test(toast)) {
          failures.push(
            `${preset.key}: raised the blank-frame notice on a preset that renders — ${JSON.stringify(toast)}`,
          );
          console.error(`[escape-family] ${preset.key}: FALSE BLANK NOTICE`);
        }
        const shot = path.join(args.outdir, `${preset.key}.png`);
        await page.locator("canvas").first().screenshot({ path: shot });
        shots.set(preset.key, shot);
        engines.set(preset.key, settled.state.engine ?? "unknown");
        console.error(
          `[escape-family] ${preset.key}: settled in ${secs}s ` +
            `engine=${settled.state.engine ?? "?"} -> ${path.basename(shot)}`,
        );
        for (const line of consoleLines) {
          if (line.startsWith("Surface compute settle")) {
            console.error(`[escape-family]   ${line}`);
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- 2: within each group, every pair is a different object
    const diffContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const diffPage = await diffContext.newPage();
    await diffPage.goto("about:blank");
    const groups = new Map();
    for (const p of wanted) {
      if (!shots.has(p.key)) continue;
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p.key);
    }
    for (const [group, keys] of groups) {
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const frac = await differingFraction(
            diffPage,
            shots.get(keys[i]),
            shots.get(keys[j]),
          );
          const ok = frac >= DIFFER_FRACTION;
          console.error(
            `[escape-family] ${group}: ${keys[i]} vs ${keys[j]} — ` +
              `${(100 * frac).toFixed(2)}% of pixels differ ${ok ? "OK" : "TOO SIMILAR"}`,
          );
          if (!ok) {
            failures.push(
              `${keys[i]} and ${keys[j]} render the same object ` +
                `(${(100 * frac).toFixed(2)}% differing, need ${100 * DIFFER_FRACTION}%) — a knob is not reaching the DE`,
            );
          }
        }
      }
    }
    await diffContext.close();

    // --- 3: the side tables install and clear, both directions
    {
      const { context, page } = await openApp(browser, args);
      try {
        // Polled: `edit-session.ts` DEBOUNCES the save that writes the hash,
        // so the document lands a beat after the menu change.
        const hasLens = async () => {
          let r = null;
          for (let i = 0; i < 40; i++) {
            r = await page.evaluate(READ_FINAL_TRANSFORM);
            if (r.ok) return r.hasFinal;
            await page.waitForTimeout(250);
          }
          throw new Error(`cannot read the document: ${r?.reason}`);
        };
        for (const key of LENS_PRESETS) {
          await loadPreset(page, key);
          if (!(await hasLens())) {
            failures.push(
              `${key} did not install its plot-time lens — it is rendering as a plain juliaIsland`,
            );
          } else {
            console.error(`[escape-family] ${key}: lens installed OK`);
          }
        }
        // ...and a preset that carries none must CLEAR it, or the arriving
        // system is silently re-posed — and for the forward-orbit presets the
        // Surface button goes dark, since both gates refuse a final.
        await loadPreset(page, "mandelbulbClassic");
        if (await hasLens()) {
          failures.push(
            "mandelbulbClassic did not clear the previous preset's lens (PRESET_FINALS leak)",
          );
        } else {
          console.error("[escape-family] mandelbulbClassic: lens cleared OK");
        }
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(
            `mandelbulbClassic after a lens preset: Surface button disabled — ${entry.reason}`,
          );
        } else {
          console.error(
            "[escape-family] mandelbulbClassic after a lens preset: Surface still reachable OK",
          );
        }
      } finally {
        await context.close();
      }
    }

    // --- a system whose escape-time set is empty says so
    {
      const { context, page } = await openApp(browser, args);
      try {
        await loadPreset(page, "mandelboxClassic");
        // The same map with a big pre-scale: every orbit leaves the bailout
        // ball on its first pass, so nothing is left to hit and the mode
        // would otherwise render a backdrop gradient with no explanation.
        // Built by editing the document the preset just wrote, rather than
        // by driving sliders, so the scenario is exactly the scale and
        // nothing else.
        //
        // EIGHT, not four, and the difference is the whole blank-frame lesson.
        // Measured ray hit rates for this map at the entry pose: scale 1
        // 79.1%, scale 2 28.4%, scale 4 0.024%, scale 8 0.000%. Volume fill
        // is 0.0000% for ALL of 2, 4 and 8 — which is why the first cut,
        // asking a volume probe, would have called a system that fills a
        // QUARTER OF THE FRAME empty. Scale 4 is nearly blank but renders
        // ~150 pixels of a 655k-ray frame, and the notice deliberately does
        // not fire on "nearly": its copy says every ray missed, so it fires
        // only when every ray missed.
        await page.evaluate(() => {
          const raw = location.hash.replace(/^#v1=/, "");
          const doc = JSON.parse(
            atob(raw.replace(/-/g, "+").replace(/_/g, "/")),
          );
          doc.transforms[0].scale = [8, 8, 8];
          const b64 = btoa(JSON.stringify(doc))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          location.hash = `v1=${b64}`;
        });
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(
          () => typeof window.__surfaceState === "function",
        );
        const entry = await enterSurface(page);
        if (!entry.entered) {
          // Also acceptable in principle — but it is not what ships, and a
          // silent change of channel is worth failing on.
          failures.push(
            `empty-set system: Surface refused instead of reporting — ${entry.reason}`,
          );
        } else {
          const toast = await page
            .waitForFunction(
              () => {
                const el = document.getElementById("toast");
                return el && !el.classList.contains("hidden")
                  ? el.textContent
                  : null;
              },
              undefined,
              { timeout: 20_000 },
            )
            .then((h) => h.jsonValue())
            .catch(() => null);
          if (!toast || !/rendered almost nothing/i.test(toast)) {
            failures.push(
              `empty-set system: no toast explaining the blank frame (got ${JSON.stringify(toast)})`,
            );
          } else {
            console.error(`[escape-family] empty set reported OK: "${toast}"`);
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- the shape trap reaches the render: trap-on vs trap-off differ
    // The knob-reaches-the-render check the trap channel owes: load the
    // trap preset FROM THE MENU (its PRESET_TRAPS entry installs the
    // block and lands the color source on the channel), settle, then turn
    // the trap OFF through its own panel select and settle again. The two
    // settled frames must differ — same map, same pose, so the only thing
    // between them is the channel. (Off resolves the "shapeTrap" source
    // to by-transform — the pinned fallback — so a dead channel renders
    // the SAME picture twice and fails here.)
    if (wanted.some((p) => p.key === "mandelboxPeace")) {
      const { context, page } = await openApp(browser, args);
      try {
        await loadPreset(page, "mandelboxPeace");
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(`shape-trap check: Surface disabled — ${entry.reason}`);
        } else {
          const settledOn = await waitSettled(page, args);
          if (!settledOn.ok) {
            failures.push("shape-trap check: trap-on session never settled");
          } else {
            const onShot = path.join(args.outdir, "trap-on.png");
            await page.locator("canvas").first().screenshot({ path: onShot });
            // Turn the trap off through the panel's own select — the row
            // lives in the Surface Shape trap accordion section, so open it the
            // way loadPreset opens the preset menu's.
            await page.evaluate(() => {
              const sel = document.getElementById("surfaceTrapShape");
              const details = sel?.closest("details");
              if (details && !details.open) details.open = true;
            });
            await page.selectOption("#surfaceTrapShape", "");
            const settledOff = await waitSettled(page, args);
            if (!settledOff.ok) {
              failures.push("shape-trap check: trap-off session never settled");
            } else {
              const offShot = path.join(args.outdir, "trap-off.png");
              await page
                .locator("canvas")
                .first()
                .screenshot({ path: offShot });
              const diffContext2 = await browser.newContext({
                ignoreHTTPSErrors: true,
              });
              const diffPage2 = await diffContext2.newPage();
              await diffPage2.goto("about:blank");
              const frac = await differingFraction(diffPage2, onShot, offShot);
              await diffContext2.close();
              const ok = frac >= DIFFER_FRACTION;
              console.error(
                `[escape-family] shape trap: on vs off — ` +
                  `${(100 * frac).toFixed(2)}% of pixels differ ${ok ? "OK" : "TOO SIMILAR"}`,
              );
              if (!ok) {
                failures.push(
                  `shape trap: trap-on and trap-off render the same picture ` +
                    `(${(100 * frac).toFixed(2)}% differing, need ${100 * DIFFER_FRACTION}%) — the channel is not reaching the render`,
                );
              }
            }
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- trap GEOMETRY reaches marching: geometry-on vs geometry-off differ
    // Fold Chain Gear authors the same transform word as Fold Chain, with the
    // gear block's geometry bit as the only topology change. Load it through
    // the menu, settle the production object, then clear that bit through its
    // own control without removing the color-capable trap. If the CPU/WGSL/
    // GLSL distance wire is stale, both settled frames are identical.
    if (wanted.some((p) => p.key === "foldChainGear")) {
      const { context, page } = await openApp(browser, args);
      try {
        await loadPreset(page, "foldChainGear");
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(
            `shape-trap geometry check: Surface disabled — ${entry.reason}`,
          );
        } else {
          const settledOn = await waitSettled(page, args);
          if (!settledOn.ok) {
            failures.push(
              "shape-trap geometry check: geometry-on session never settled",
            );
          } else {
            const authored = await page.isChecked(
              "#surfaceTrapGeometryCheckbox",
            );
            if (!authored) {
              failures.push(
                "shape-trap geometry check: Fold Chain Gear did not install geometry",
              );
            }
            const onShot = path.join(args.outdir, "trap-geometry-on.png");
            await page.locator("canvas").first().screenshot({ path: onShot });
            await page.evaluate(() => {
              const checkbox = document.getElementById(
                "surfaceTrapGeometryCheckbox",
              );
              const details = checkbox?.closest("details");
              if (details && !details.open) details.open = true;
            });
            await page.uncheck("#surfaceTrapGeometryCheckbox");
            const settledOff = await waitSettled(page, args);
            if (!settledOff.ok) {
              failures.push(
                "shape-trap geometry check: geometry-off session never settled",
              );
            } else {
              const offShot = path.join(args.outdir, "trap-geometry-off.png");
              await page
                .locator("canvas")
                .first()
                .screenshot({ path: offShot });
              const diffContext2 = await browser.newContext({
                ignoreHTTPSErrors: true,
              });
              const diffPage2 = await diffContext2.newPage();
              await diffPage2.goto("about:blank");
              const frac = await differingFraction(diffPage2, onShot, offShot);
              await diffContext2.close();
              const ok = frac >= DIFFER_FRACTION;
              console.error(
                `[escape-family] shape-trap geometry: on vs off — ` +
                  `${(100 * frac).toFixed(2)}% of pixels differ ${ok ? "OK" : "TOO SIMILAR"}`,
              );
              if (!ok) {
                failures.push(
                  `shape-trap geometry: on and off render the same object ` +
                    `(${(100 * frac).toFixed(2)}% differing, need ${100 * DIFFER_FRACTION}%) — geometry is not reaching the distance estimator`,
                );
              }
            }
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- the settle really does supersample, and says so
    if (wanted.length > 0) {
      const { context, page } = await openApp(browser, args);
      try {
        await loadPreset(page, "mandelboxClassic");
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(
            `supersampling check: Surface disabled — ${entry.reason}`,
          );
        } else {
          const label = await page
            .waitForFunction(
              () => {
                const el = document.getElementById("surfaceProgress");
                const t =
                  el && !el.classList.contains("hidden") ? el.textContent : "";
                return t && /antialiasing pass \d+\/\d+/.test(t) ? t : null;
              },
              undefined,
              { timeout: 120_000 },
            )
            .then((h) => h.jsonValue())
            .catch(() => null);
          if (!label) {
            failures.push(
              "the settle never reported an antialiasing pass — supersampling is not running, or the row is not disclosing it",
            );
          } else {
            console.error(
              `[escape-family] supersampling disclosed OK: "${label.trim()}"`,
            );
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.error("\n[escape-family] engines:");
  for (const [key, engine] of engines) {
    console.error(`[escape-family]   ${key.padEnd(20)} ${engine}`);
  }
  if (failures.length > 0) {
    console.error(`\n[escape-family] FAIL (${failures.length}):`);
    for (const f of failures) console.error(`[escape-family]   - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.error("\n[escape-family] verdict=pass");
}

await main();
