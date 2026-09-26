#!/usr/bin/env node
/**
 * WEBGL-UNDER-XVFB probe: what WebGL context can Firefox actually create
 * on this display source, asked BEFORE a gate burns minutes on a boot that
 * can never come up. Driven by CI's panel-contrast job ("GL stack record"
 * step) under the exact env its Firefox leg launches with, and useful by
 * hand for any display-source question (`xvfb-run -a` locally, `:0` on a
 * real host, etc.).
 *
 * Prints one line per context: webgl1 / webgl2 — context ok, the
 * UNMASKED_RENDERER_WEBGL string when the debug extension offers one, or
 * `context=null` when creation failed. Exit 0 when webgl1 came up (the
 * app's own webglAvailable() gate asks for exactly that); exit 2
 * (CHECKING-side) when it did not, so a broken GL stack fails the run
 * before the panel gate with a self-explanatory log.
 *
 * Env is inherited — CI passes LIBGL_ALWAYS_SOFTWARE=1 MOZ_X11_EGL=1
 * through xvfb-run; the launch prefs mirror panel-contrast.verify.mjs's
 * Firefox launch (software WebRender, webgl.force-enabled past the
 * blocklist).
 *
 * Usage: node scripts/webgl-under-xvfb.probe.mjs
 */
import { firefox } from "playwright-core";

const browser = await firefox.launch({
  executablePath: firefox.executablePath(),
  headless: false,
  firefoxUserPrefs: {
    "gfx.webrender.software": true,
    "webgl.force-enabled": true,
  },
});

const rows = [];
let webgl1Ok = false;
try {
  const context = await browser.newContext({
    viewport: { width: 393, height: 727 },
  });
  const page = await context.newPage();
  rows.push(
    await page.evaluate(async () => {
      const unmasked = (gl) => {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return info
          ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
          : String(gl.getParameter(gl.RENDERER));
      };
      const probe = (kind) => {
        try {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext(kind);
          return gl ? `${kind}: ${unmasked(gl)}` : `${kind}: context=null`;
        } catch (error) {
          return `${kind}: context=null (${String(error)})`;
        }
      };
      return [probe("webgl2"), probe("webgl")];
    }),
  );
  webgl1Ok = rows
    .flat()
    .some((row) => row.startsWith("webgl: ") && !row.includes("context=null"));
} finally {
  await browser.close();
}

for (const row of rows.flat()) console.log(`[webgl-under-xvfb] ${row}`);
if (!webgl1Ok) {
  console.error(
    "[webgl-under-xvfb] CHECKING-SIDE FAILURE: no webgl1 context under this display source — the app's own webglAvailable() gate would refuse to boot",
  );
  process.exit(2);
}
