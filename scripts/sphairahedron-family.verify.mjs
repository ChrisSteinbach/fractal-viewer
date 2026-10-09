#!/usr/bin/env node
/**
 * The sphairahedron family, driven from the menu — the escape-family gate's
 * pattern one subject family over, plus what the construction needed.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A UNIT TEST. The presets' vitest pins
 * prove the BLOCKS resolve and their spheres are the picker's; nothing below
 * the UI proves the sessions DRAW. Specifically:
 *
 *   1. Every preset in the Sphairahedron group enters Surface mode FROM THE
 *      MENU, unaided, and settles. A preset whose moduli sat outside its
 *      family's valid region would leave the Surface button dark, and
 *      nothing in the unit suite would say so.
 *   2. The Points walk LANDS for every finite preset (bounded budget,
 *      deterministic) and the By-Transform legend narrates the walk's FACE
 *      slots, not the placeholder transforms.
 *   3. The presets are DIFFERENT OBJECTS — pairwise pixel comparison within
 *      the family, the knob-reaches-the-DE check.
 *   4. WHICH ENGINE each session takes — compute is the family's preferred
 *      tracer, and the WGSL sphaira/sphaira4 cores are dead code if the
 *      sessions silently fall to WebGL. Meaningful only on a real driver
 *      (`--mode=x11:<display>`); SwiftShader answers "compute, software",
 *      which is true and useless.
 *   5. A BLOCK EDIT RESTARTS a live session (the construction is fixed at
 *      create — the kernel tables pack from it once) and the restarted
 *      session renders a DIFFERENT object.
 *   6. THE SETTLE COSTS the routing child deferred: each preset's
 *      session-level settle time, printed per row — the kernels' own
 *      agreement is `npm run bench:surface`'s; these rows are the doc's
 *      session-level figures.
 *
 * USAGE (build + `npm run preview` first — this measures a real build):
 *   npm run build && npm run preview &
 *   node scripts/sphairahedron-family.verify.mjs --mode=x11::0
 *   node scripts/sphairahedron-family.verify.mjs --mode=sw   # SwiftShader
 *   node scripts/sphairahedron-family.verify.mjs --only=sphairaOrb4
 *   node scripts/sphairahedron-family.verify.mjs --only=sphairaQuasisphere --query=surfacegl
 *
 * `--query=surfacegl` runs every leg on the WebGL SURFACE_SPHAIRA fallback
 * arm instead of compute (the arm is otherwise never exercised end to end;
 * the 4D preset refuses there — compute-only, and the refusal is its
 * verdict).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
// The toast recorder and its anti-vacuity check are the si gate lib's
// generic instruments (an init script recording every toast the page shows
// into `window.__toasts`) — imported, not copied, so the two family gates
// cannot drift apart on what "the user was told" means. READ_DOCUMENT is
// the one hash decoder.
import {
  READ_DOCUMENT,
  TOAST_RECORDER,
  recorderSeesCopyToast,
  waitDocument,
} from "./lib/sphere-inversion-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(HERE, "out", "sphairahedron-family");

/**
 * The Sphairahedron menu group, in menu order. Every entry is a FINITE
 * construction (the walk draws empty for the infinite families — the
 * disclosed fr-l0ma.7 gap — so an infinite preset would fail the Points
 * leg by design, not by defect).
 */
const PRESETS = [
  { key: "sphairaQuasisphere", family: "cube1", faces: 6 },
  { key: "sphairaCraters4", family: "cube4", faces: 6 },
  { key: "sphairaCraters9", family: "cube9", faces: 6 },
  { key: "sphairaOrb", family: "tetra333", faces: 4 },
  { key: "sphairaTerrain", family: "prism2", faces: 5 },
  // The 4D preset is COMPUTE-ONLY (the GLSL sphaira arm is 3D-only), so
  // under `--query=surfacegl` its dark Surface button is the preset's
  // VERDICT, not a failure.
  { key: "sphairaOrb4", family: "tetra4", faces: 4, computeOnly: true },
];

/** Two settled frames count as DIFFERENT objects when at least this fraction
 * of pixels differ by more than a channel step that survives dithering —
 * the escape-family gate's measured threshold, reused verbatim. */
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
    env.DISPLAY = mode.slice(4);
    return {
      env,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        // A service worker's own script fetch ignores a context's
        // ignoreHTTPSErrors in Chromium — the si launcher's addition — so
        // the toast phase's error asserts (and the isolation dance) need
        // the browser-level flag when serving over the self-signed cert.
        "--ignore-certificate-errors",
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
        "--ignore-certificate-errors",
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
  for (const [fn, arg] of args.initScripts ?? []) {
    await context.addInitScript(fn, arg);
  }
  const page = await context.newPage();
  const consoleLines = [];
  const errors = [];
  page.on("console", (m) => {
    consoleLines.push(m.text());
    if (m.type() === "error" || /device lost|validation error/i.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e)}`));
  const q = args.query ? `?surfacestate&${args.query}` : "?surfacestate";
  await page.goto(`${args.url}/${q}${args.hash ?? ""}`, { waitUntil: "load" });
  await settled(page, () =>
    page.waitForFunction(() => typeof window.__surfaceState === "function"),
  );
  await page
    .waitForFunction(() => window.crossOriginIsolated === true, undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await settled(page, () =>
    page.waitForFunction(() => typeof window.__surfaceState === "function"),
  );
  return { context, page, consoleLines, errors };
}

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

/** Choose a preset from the panel's menu — the path a user takes. */
async function loadPreset(page, key) {
  let shape = null;
  for (let i = 0; i < 20; i++) {
    shape = await settled(page, () =>
      page.evaluate(() => {
        const sel = document.getElementById("presetSelect");
        if (!sel) return { found: false, w: 0, h: 0 };
        const details = sel.closest("details");
        if (details && !details.open) details.open = true;
        const r = sel.getBoundingClientRect();
        return { found: true, w: r.width, h: r.height };
      }),
    );
    if (shape.found && shape.w > 0 && shape.h > 0) break;
    await page.waitForTimeout(250);
  }
  if (!shape?.found || shape.w === 0 || shape.h === 0) {
    throw new Error(`preset menu unreachable: ${JSON.stringify(shape)}`);
  }
  // `edit-session.ts` DEBOUNCES the save that writes the hash, so the
  // document changing is the only reliable landed signal.
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page
    .waitForFunction(
      (h) => location.hash !== h && location.hash !== "",
      before,
      { timeout: 15_000 },
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

/** Wait for the app's own settle latch, held for `dwell`. */
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

/** Wait for the explorer's Points cloud to land: `#pointCount` past the
 * boot placeholder, holding for two polls so the count is the LANDED
 * generation's, not a transient of the previous document's. */
async function waitCloudLanded(page, minPoints) {
  const deadline = Date.now() + 60_000;
  let last = "0 pts";
  while (Date.now() < deadline) {
    last = await page.evaluate(
      () => document.getElementById("pointCount")?.textContent ?? "",
    );
    const n = Number.parseFloat(last.replace(/[,\s]/g, ""));
    if (Number.isFinite(n) && n >= minPoints) return { ok: true, count: n };
    await page.waitForTimeout(250);
  }
  return { ok: false, count: last };
}

/** The By-Transform legend's chip count, read off the painted DOM
 * (`ui.ts`'s `paintLegend` tags swatches `legend-swatch`). */
async function legendChipCount(page) {
  return page.evaluate(() => {
    const strip = document.getElementById("legendSwatches");
    if (!strip) return -1;
    return strip.querySelectorAll(".legend-swatch").length;
  });
}

/** The page-console lines that explain a failure — a GLSL compile error
 * surfaces as "Surface render failed to build"/THREE.WebGLProgram noise,
 * and without printing it the gate only says the session never settled. */
function diagnosticConsoleLines(consoleLines) {
  return consoleLines.filter(
    (line) =>
      /^Surface/.test(line) ||
      /Shader Error|THREE\.WebGLProgram|failed to (build|compile)/.test(line),
  );
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

/** The `#v1=` document's sphairahedron block, read as the link carries it. */
const READ_SPHAIRA_BLOCK = () => {
  const raw = location.hash.replace(/^#v1=/, "");
  if (!raw) return { ok: false, reason: "no #v1= hash" };
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const doc = JSON.parse(atob(b64));
    return { ok: true, block: doc.sphairahedron ?? null };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  fs.mkdirSync(args.outdir, { recursive: true });
  const { env, args: launchArgs, headless } = launchOptions(args.mode);
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's engine/timing rows.",
    );
  }
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless,
    env,
    args: launchArgs,
  });
  const failures = [];
  const shots = new Map();
  const engines = new Map();
  const settleSecs = new Map();
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

    // --- 1, 2 & 6: every preset loads from the menu, the walk lands, the
    // session enters and settles, and the settle costs are measured.
    for (const preset of wanted) {
      const { context, page, consoleLines } = await openApp(browser, args);
      try {
        await loadPreset(page, preset.key);
        // The Points walk: a finite construction's cloud lands with a
        // real count, and the legend narrates the FACE slots.
        const cloud = await waitCloudLanded(page, 1000);
        if (!cloud.ok) {
          failures.push(
            `${preset.key}: the Points walk never landed a cloud (pointCount=${JSON.stringify(cloud.count)})`,
          );
          console.error(
            `[sphaira-family] ${preset.key}: NO CLOUD (${JSON.stringify(cloud.count)})`,
          );
        } else {
          const chips = await legendChipCount(page);
          console.error(
            `[sphaira-family] ${preset.key}: walk landed ${cloud.count} pts, ` +
              `legend chips ${chips} (face count ${preset.faces})`,
          );
          if (chips !== -1 && chips !== preset.faces) {
            failures.push(
              `${preset.key}: the By-Transform legend shows ${chips} chips, ` +
                `the walk colors by ${preset.faces} faces — the key does not narrate the cloud`,
            );
          }
        }
        const entry = await enterSurface(page);
        if (!entry.entered) {
          if (preset.computeOnly && args.query === "surfacegl") {
            console.error(
              `[sphaira-family] ${preset.key}: refused at the GL arm as intended (${entry.reason})`,
            );
          } else {
            failures.push(
              `${preset.key}: Surface button disabled — ${entry.reason}`,
            );
            console.error(
              `[sphaira-family] ${preset.key}: NOT ENTERED (${entry.reason})`,
            );
          }
          continue;
        }
        const t0 = Date.now();
        const result = await waitSettled(page, args);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (!result.ok) {
          failures.push(
            `${preset.key}: never settled in ${args.settle}ms (state=${JSON.stringify(result.state)})`,
          );
          console.error(
            `[sphaira-family] ${preset.key}: NOT SETTLED after ${secs}s`,
          );
          for (const line of diagnosticConsoleLines(consoleLines)) {
            console.error(`[sphaira-family]   console: ${line.slice(0, 300)}`);
          }
          continue;
        }
        const shot = path.join(args.outdir, `${preset.key}.png`);
        await page.locator("canvas").first().screenshot({ path: shot });
        shots.set(preset.key, shot);
        engines.set(preset.key, result.state.engine ?? "unknown");
        settleSecs.set(preset.key, secs);
        console.error(
          `[sphaira-family] ${preset.key}: settled in ${secs}s ` +
            `engine=${result.state.engine ?? "?"} -> ${path.basename(shot)}`,
        );
        for (const line of consoleLines) {
          if (line.startsWith("Surface compute settle")) {
            console.error(`[sphaira-family]   ${line}`);
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- 3: the family's presets are different objects
    if (shots.size >= 2) {
      const diffContext = await browser.newContext({
        ignoreHTTPSErrors: true,
      });
      const diffPage = await diffContext.newPage();
      await diffPage.goto("about:blank");
      const keys = [...shots.keys()];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const frac = await differingFraction(
            diffPage,
            shots.get(keys[i]),
            shots.get(keys[j]),
          );
          const ok = frac >= DIFFER_FRACTION;
          console.error(
            `[sphaira-family] ${keys[i]} vs ${keys[j]} — ` +
              `${(100 * frac).toFixed(2)}% of pixels differ ${ok ? "OK" : "TOO SIMILAR"}`,
          );
          if (!ok) {
            failures.push(
              `${keys[i]} and ${keys[j]} render the same object ` +
                `(${(100 * frac).toFixed(2)}% differing, need ${100 * DIFFER_FRACTION}%) — a knob is not reaching the estimator`,
            );
          }
        }
      }
      await diffContext.close();
    }

    // --- 5: a block edit restarts the session and moves the object
    // (only where the whole family ran; the restart needs the 3D preset's
    // region-scoped slider).
    if (wanted.some((p) => p.key === "sphairaQuasisphere")) {
      const { context, page, consoleLines } = await openApp(browser, args);
      try {
        await loadPreset(page, "sphairaQuasisphere");
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failures.push(`restart check: Surface disabled — ${entry.reason}`);
        } else {
          const settledOn = await waitSettled(page, args);
          if (!settledOn.ok) {
            failures.push("restart check: the first session never settled");
          } else {
            const onShot = path.join(args.outdir, "restart-before.png");
            await page.locator("canvas").first().screenshot({ path: onShot });
            // Open the Sphairahedron section and move the zA slider
            // within its region-scoped span (za ∈ (0.25, 0.75) at
            // zb = 1), then COMMIT it — the slider's release is what
            // restarts the session (construction fixed at create).
            await page.evaluate(() => {
              const slider = document.getElementById("sphairahedronZaSlider");
              const details = slider?.closest("details");
              let root = details;
              while (root?.parentElement) {
                const ancestor = root.parentElement.closest("details");
                if (!ancestor) break;
                root = ancestor;
                if (ancestor.open) break;
                ancestor.open = true;
              }
              if (details && !details.open) details.open = true;
              slider.value = "0.3";
              slider.dispatchEvent(new Event("input", { bubbles: true }));
              slider.dispatchEvent(new Event("change", { bubbles: true }));
            });
            const settledOff = await waitSettled(page, args);
            if (!settledOff.ok) {
              failures.push(
                "restart check: the session never re-settled after the block edit",
              );
              for (const line of diagnosticConsoleLines(consoleLines)) {
                console.error(
                  `[sphaira-family]   console: ${line.slice(0, 300)}`,
                );
              }
            } else {
              const offShot = path.join(args.outdir, "restart-after.png");
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
                `[sphaira-family] block edit: za 0.5 -> 0.3 — ` +
                  `${(100 * frac).toFixed(2)}% of pixels differ ${ok ? "OK" : "TOO SIMILAR"}`,
              );
              if (!ok) {
                failures.push(
                  `block edit: the restarted session renders the same picture ` +
                    `(${(100 * frac).toFixed(2)}% differing, need ${100 * DIFFER_FRACTION}%) — the edit is not reaching the construction`,
                );
              }
            }
          }
        }
      } finally {
        await context.close();
      }
    }

    // --- the block survives the share link, byte for byte, and an
    // out-of-region edit refuses at load. Both legs key on the
    // QUASISPHERE (cube1): the refusal leg patches cube moduli, which a
    // tetra family does not read (a field the family ignores is never a
    // refusal — the module contract), so it needs a cube document.
    if (wanted.some((p) => p.key === "sphairaQuasisphere")) {
      const { context, page } = await openApp(browser, args);
      try {
        await loadPreset(page, "sphairaQuasisphere");
        const read = async () => {
          let r = null;
          for (let i = 0; i < 40; i++) {
            r = await page.evaluate(READ_SPHAIRA_BLOCK);
            if (r.ok) return r;
            await page.waitForTimeout(250);
          }
          throw new Error(`cannot read the document: ${r?.reason}`);
        };
        const before = await read();
        if (!before.block) {
          failures.push(
            `${wanted[0].key}: the #v1= document carries no sphairahedron block`,
          );
        } else {
          const hashBefore = await page.evaluate(() => location.hash);
          await page.reload({ waitUntil: "load" });
          await page.waitForFunction(
            () => typeof window.__surfaceState === "function",
          );
          const hashAfter = await page.evaluate(() => location.hash);
          if (hashBefore !== hashAfter) {
            failures.push(
              "the share link is not a fixed point: the hash changed across a reload",
            );
          }
          const after = await read();
          if (JSON.stringify(after.block) !== JSON.stringify(before.block)) {
            failures.push(
              "the sphairahedron block did not survive the reload verbatim",
            );
          } else {
            console.error(
              `[sphaira-family] ${wanted[0].key}: link reload block-verbatim OK (family ${after.block.family})`,
            );
          }
          // --- the out-of-region refusal: an AUTHORED block past its
          // family's valid region must be REFUSED at load, never clamped —
          // the Surface button goes dark with a reason and the document
          // keeps the refused values byte for byte (the wiring contract's
          // verbatim-survival line, at the browser level). The past-cusp
          // pair (0.65, 1.3) is the study's documented out-of-region point.
          const crafted = await page.evaluate(() => {
            const raw = location.hash.replace(/^#v1=/, "");
            const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
            const doc = JSON.parse(json);
            doc.sphairahedron = {
              ...doc.sphairahedron,
              za: 0.65,
              zb: 1.3,
            };
            const out = btoa(JSON.stringify(doc))
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=/g, "");
            return `#v1=${out}`;
          });
          await page.goto("about:blank");
          await page.goto(`${args.url}/?surfacestate${crafted}`, {
            waitUntil: "load",
          });
          await page
            .waitForFunction(
              () => typeof window.__surfaceState === "function",
              undefined,
              { timeout: 20_000 },
            )
            .catch(() => {});
          const refused = await page.evaluate(READ_SPHAIRA_BLOCK);
          if (
            !refused.ok ||
            !refused.block ||
            refused.block.za !== 0.65 ||
            refused.block.zb !== 1.3
          ) {
            failures.push(
              `out-of-region block was not carried verbatim: ${JSON.stringify(refused.block ?? refused)}`,
            );
          } else {
            // The decode + eligibility refresh land a beat after boot
            // (the chokepoint runs behind the initial apply), so poll
            // for the refusal rather than sampling the button once.
            let btnState = null;
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline) {
              btnState = await page.evaluate(() => {
                const btn = document.getElementById("modeSurfaceBtn");
                return {
                  disabled: btn?.getAttribute("disabled") ?? null,
                  title: btn?.getAttribute("title") ?? "",
                };
              });
              if (btnState.disabled !== null) break;
              await page.waitForTimeout(500);
            }
            if (btnState.disabled === null) {
              failures.push(
                "an out-of-region block left the Surface button enabled — the resolver's refusal is not what fires",
              );
            } else {
              console.error(
                `[sphaira-family] out-of-region (0.65, 1.3): carried verbatim, Surface refused (${btnState.title || "no reason given"})`,
              );
              if (!btnState.title) {
                failures.push(
                  "the out-of-region refusal discloses no reason on the disabled button",
                );
              }
            }
          }
        }
      } finally {
        await context.close();
      }
    }
    // --- the Flame/Solid doors' refusal AFFORDANCE: the mode buttons are
    // SHARED across the subject families, and the composite refusal
    // (surface-eligibility.ts's subjectRenderModeRefusal — the same chain
    // switchRenderMode's door reads) is what disables them, written by ONE
    // setter per refresh. This phase is what was MISSING when the sphaira
    // family's own refusal setter fought the sphere-inversion one over the
    // shared buttons: the later sync's null note re-enabled what the earlier
    // refusal had disabled, the door held while the affordance lied, and the
    // rot sat for a week because only the si gate ran these legs. Two real
    // doors: the isolation handoff restoring a mode onto a block document
    // (the boot refuses, says why, stays in Points), and the history door
    // (undo restores the block under a live session — applyDecodedSnapshot
    // leaves for Points BEFORE the restored document refreshes the panel, so
    // the toast there is recorded, not required).
    const SPHAIRA_REFUSAL_TOAST =
      /Flame and Solid are unavailable for a sphairahedron scene/;
    if (wanted.some((p) => p.key === "sphairaQuasisphere")) {
      // Mint the block document: the quasisphere preset's own hash.
      let blockHash = null;
      {
        const { context, page } = await openApp(browser, args);
        try {
          await loadPreset(page, "sphairaQuasisphere");
          await waitDocument(page, (d) => !!d.sphairahedron);
          blockHash = await page.evaluate(() => location.hash);
        } finally {
          await context.close().catch(() => {});
        }
      }
      if (!blockHash) {
        failures.push("toast: could not mint a block document");
      }
      for (const mode of blockHash ? ["flame", "solid"] : []) {
        const button = mode === "flame" ? "#modeFlameBtn" : "#modeSolidBtn";
        // (a) THE HANDOFF DOOR: the isolation reload restores the mode
        // (isolation-handoff.ts) onto a document that carries a block.
        {
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
            const recorderLive = await recorderSeesCopyToast(app.page);
            console.error(
              `[sphaira-family] toast ${mode} handoff: mode=${seen.mode}` +
                ` toast=${seen.toasts.some((t) => SPHAIRA_REFUSAL_TOAST.test(t)) ? "yes" : "NO"}` +
                ` ${mode} button disabled=${seen.disabled} handoff consumed=${seen.handoffLeft === null}`,
            );
            if (!recorderLive)
              failures.push(
                `toast ${mode} handoff: the toast recorder is not recording`,
              );
            if (seen.handoffLeft !== null)
              failures.push(
                `toast ${mode} handoff: the app never consumed the handoff`,
              );
            if (seen.mode !== "points")
              failures.push(
                `toast ${mode} handoff: booted into ${seen.mode}, expected points`,
              );
            if (!seen.toasts.some((t) => SPHAIRA_REFUSAL_TOAST.test(t)))
              failures.push(
                `toast ${mode} handoff: no refusal toast (toasts shown: ${JSON.stringify(seen.toasts)})`,
              );
            if (seen.disabled !== true)
              failures.push(
                `toast ${mode} handoff: the ${mode} button stayed enabled`,
              );
            if (app.errors.length)
              failures.push(
                `toast ${mode} handoff: console errors: ${app.errors
                  .slice(0, 3)
                  .join(" | ")}`,
              );
          } catch (error) {
            failures.push(
              `toast ${mode} handoff: ${String(error).split("\n")[0]}`,
            );
          } finally {
            await app.context.close().catch(() => {});
          }
        }
        // (b) THE HISTORY DOOR: with the session live on an ordinary scene,
        // Undo brings the block back. The exit is gated in
        // applyDecodedSnapshot (every undo/redo/import leg), so by the time
        // the family's refusal runs there is no session to refuse — the
        // refusal toast is NOT required here, only the affordance: the
        // recomputed composite still sees the block and the button stays
        // dark. (The si gate's undo leg lost its recorder init script to an
        // editing accident in the tier=fast commit and could never pass its
        // own recorder check — this port carries the recorder from birth.)
        {
          const app = await openApp(browser, {
            url: args.url,
            initScripts: [[TOAST_RECORDER]],
          });
          const { page } = app;
          try {
            await loadPreset(page, "sphairaQuasisphere");
            await waitDocument(page, (d) => !!d.sphairahedron);
            await loadPreset(page, "sierpinski");
            const cleared = await waitDocument(page, (d) => !d.sphairahedron);
            if (cleared?.sphairahedron) {
              failures.push(
                "toast undo: loading sierpinski left the block in place",
              );
              continue;
            }
            await page.click(button);
            await page.waitForFunction(
              (m) => window.__surfaceState?.()?.mode === m,
              mode,
              { timeout: 15_000 },
            );
            let restored = false;
            for (let i = 0; i < 6 && !restored; i++) {
              await page.click("#undoBtn");
              await page.waitForTimeout(700);
              const doc = await page.evaluate(READ_DOCUMENT);
              if (doc?.sphairahedron) restored = true;
            }
            if (!restored) {
              failures.push("toast undo: undo never brought the block back");
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
            const disabled = await page.evaluate(
              (sel) => document.querySelector(sel)?.disabled ?? null,
              button,
            );
            const recorderLive = await recorderSeesCopyToast(page);
            console.error(
              `[sphaira-family] toast ${mode} undo: points=${landed}` +
                ` ${mode} button disabled=${disabled}`,
            );
            if (!recorderLive)
              failures.push(
                `toast ${mode} undo: the toast recorder is not recording`,
              );
            if (!landed)
              failures.push("toast undo: the app did not exit to Points");
            if (disabled !== true)
              failures.push(`toast undo: the ${mode} button stayed enabled`);
          } catch (error) {
            failures.push(
              `toast ${mode} undo: ${String(error).split("\n")[0]}`,
            );
          } finally {
            await app.context.close().catch(() => {});
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.error("\n[sphaira-family] engines and settle costs:");
  for (const preset of PRESETS) {
    if (!engines.has(preset.key)) continue;
    console.error(
      `[sphaira-family]   ${preset.key.padEnd(20)} engine=${engines.get(preset.key)} settle=${settleSecs.get(preset.key)}s`,
    );
  }
  if (failures.length > 0) {
    console.error(`\n[sphaira-family] FAIL (${failures.length}):`);
    for (const f of failures) console.error(`[sphaira-family]   - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.error("\n[sphaira-family] verdict=pass");
}

await main();
