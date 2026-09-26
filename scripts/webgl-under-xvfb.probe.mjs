#!/usr/bin/env node
/**
 * WEBGL-UNDER-XVFB probe: what WebGL context can Firefox actually create
 * on this display source, asked BEFORE a gate burns minutes on a boot that
 * can never come up. Driven by CI's panel-contrast job ("GL stack record"
 * step) under the exact env its Firefox leg launches with, and useful by
 * hand for any display-source question (`xvfb-run -a` locally, `:0` on a
 * real host, etc.).
 *
 * One run, three questions, one launch per prefs variant:
 *  - BLANK: a detached canvas on about:blank, the app's exact call order
 *    (`getContext("webgl") ?? getContext("experimental-webgl")`) — the
 *    level browsers expose with nothing page-specific in the way.
 *  - APP (per variant): navigate to --url, evaluate the app's own probe
 *    verbatim, then attach + draw + composite a WebGL canvas and read it
 *    back, and wait up to 30s for `#pointCount` > 0 (did the app boot?).
 *  - VARIANTS: the gate's prefs, then the two compositor-fallbacks
 *    (basic compositor, no GPU process) — whichever boots the app names
 *    the pref the Firefox leg's launch must carry.
 *
 * Exit 0 when at least one variant boots the app; exit 2 (CHECKING-side)
 * otherwise, so a broken GL stack fails the run before the panel gate
 * with a self-explanatory log. Never a verdict about the app.
 *
 * Env is inherited — CI passes LIBGL_ALWAYS_SOFTWARE=1 MOZ_X11_EGL=1
 * through xvfb-run.
 *
 * Usage: node scripts/webgl-under-xvfb.probe.mjs [--url=https://localhost:4173]
 */
import { firefox } from "playwright-core";

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const BASE = flag("url", "https://localhost:4173").replace(/\/+$/, "");

const GATE_PREFS = {
  "gfx.webrender.software": true,
  "webgl.force-enabled": true,
};
const VARIANTS = [
  ["gate-prefs", GATE_PREFS],
  ["basic-compositor", { ...GATE_PREFS, "layers.acceleration.disabled": true }],
  ["no-gpu-process", { ...GATE_PREFS, "layers.gpu-process.enabled": false }],
  // The gate's launch verbatim, `env` passed explicitly the way
  // launchEngine does: the one mechanical difference between a probe
  // stage and the gate itself.
  ["gate-launch-clone", GATE_PREFS, { passEnv: true }],
];

/** The app's exact webglAvailable() body, verbatim (main.ts). */
const APP_PROBE = () => {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    return Boolean(window.WebGLRenderingContext && gl);
  } catch {
    return false;
  }
};

const lines = [];
let anyBoot = false;

// BLANK: one launch, the gate's prefs, the app's call order on a detached
// canvas — the floor every page-level question compares against.
{
  const browser = await firefox.launch({
    executablePath: firefox.executablePath(),
    headless: false,
    firefoxUserPrefs: GATE_PREFS,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const unmasked = await page.evaluate(() => {
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl");
        if (!gl) return "webgl: context=null";
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return `webgl: ${
          info
            ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
            : String(gl.getParameter(gl.RENDERER))
        }`;
      } catch (error) {
        return `webgl: context=null (${String(error)})`;
      }
    });
    lines.push(`blank-page            ${unmasked}`);
  } finally {
    await browser.close();
  }
}

// APP: one launch per prefs variant against the real page.
for (const [name, prefs, opts] of VARIANTS) {
  const browser = await firefox.launch({
    executablePath: firefox.executablePath(),
    headless: false,
    firefoxUserPrefs: prefs,
    ...(opts?.passEnv ? { env: { ...process.env } } : {}),
  });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 393, height: 727 },
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
    const state = await page.evaluate(
      async ([appProbeSource]) => {
        const appOk = new Function(`return (${appProbeSource})()`)();
        let composite = "composite: not attempted (no context)";
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          document.body.appendChild(canvas);
          const gl = canvas.getContext("webgl");
          if (gl) {
            gl.clearColor(0.25, 0.5, 0.75, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const px = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            composite = `composite+readback: [${[...px].join(",")}]`;
          }
        } catch (error) {
          composite = `composite: threw (${String(error)})`;
        }
        const isolated = window.crossOriginIsolated ?? false;
        return { appOk, composite, isolated };
      },
      [APP_PROBE.toString()],
    );
    let booted = false;
    try {
      await page.waitForFunction(
        () =>
          Number(
            (document.getElementById("pointCount")?.textContent ?? "").replace(
              /[^\d]/g,
              "",
            ),
          ) > 0,
        undefined,
        { timeout: 30_000, polling: 250 },
      );
      booted = true;
    } catch {
      booted = false;
    }
    anyBoot = anyBoot || booted;
    lines.push(
      `app/${name.padEnd(17)} appProbe=${String(state.appOk)} ${state.composite} isolated=${String(state.isolated)} booted=${String(booted)}`,
    );
  } catch (error) {
    lines.push(
      `app/${name.padEnd(17)} launch/nav failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await browser.close();
  }
}

for (const line of lines) console.log(`[webgl-under-xvfb] ${line}`);
if (!anyBoot) {
  console.error(
    "[webgl-under-xvfb] CHECKING-SIDE FAILURE: no prefs variant boots the app under this display source — the panel gate would fail here too",
  );
  process.exit(2);
}
console.log("[webgl-under-xvfb] a variant boots the app: see app/ lines above");
