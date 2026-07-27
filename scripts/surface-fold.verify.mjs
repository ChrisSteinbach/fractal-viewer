#!/usr/bin/env node
/**
 * fr-5rvk fold-render verifier: does a pure-fold system actually render in
 * Surface mode — through a deep-link hash (a 2-map pure-boxfold pair) and
 * through the plain UI path (the Mandelbox KIFS preset menu entry, whose
 * render hint auto-enters Surface mode)?
 *
 * Exists because the headless smoke recipe only ever exercises SwiftShader,
 * and the fold tracer's first cut compiled fine there while REAL Mesa/Iris
 * died in linkProgram (VALIDATE_STATUS false, empty info log, context
 * lost) — the shipped-but-invisible failure class this script closes.
 * `x11:<display>` is the only reliable route to the real driver on a Linux
 * box: headless Chromium falls back to SwiftShader regardless of ANGLE
 * flags.
 *
 * What it reports: the UNMASKED renderer string (so you know which driver
 * you actually measured), the Surface button's eligibility state, page
 * console errors (shader compile failures land there), a 1s-granularity
 * main-thread stall profile after entering the mode (compile + first-frame
 * cost), and a screenshot to eyeball.
 *
 * Usage (dev server already running):
 *   node scripts/surface-fold.verify.mjs --url=https://localhost:5174 \
 *     --mode=x11::0 --scenario=preset --wait=60000 --shot=/tmp/fold.png
 *
 *   --mode      x11:<display> = headed on that X display (REAL driver);
 *               gpu = headless (falls back to SwiftShader in practice);
 *               sw  = headless SwiftShader explicitly (the smoke recipe).
 *   --scenario  hash = boxfold-pair deep link; preset = Mandelbox KIFS
 *               via the preset menu; lens = affine 4-map base under a
 *               boxfold FINAL-transform lens (fr-g58b's archetype — the
 *               SURFACE_FOLD_LENS wrapper over the affine cores).
 */
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const BOXFOLD_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwiYXhpcyI6InkifSwiZ2xvd0JyaWdodG5lc3MiOjF9";

/** Sierpinski-shaped 4-map affine base under a boxfold FINAL lens
 * (weight 0.55, rotated/offset affine part) — fr-g58b's archetype. The
 * small weight puts `|p/w|` well past the fold planes, so the render
 * shows genuinely folded copies rather than the lens's affine part. */
const LENS_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJheGlzIjoieSJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiZmluYWxUcmFuc2Zvcm0iOnsicG9zaXRpb24iOlswLjE1LC0wLjEsMC4wNV0sInJvdGF0aW9uIjpbMC4yLDAuMywwLjFdLCJzY2FsZSI6WzAuOSwwLjksMC45XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjAuNTV9XX19";

function parseArgs(argv) {
  const args = {
    url: "https://localhost:5174",
    mode: "gpu",
    scenario: "hash",
    wait: 20_000,
    shot: "/tmp/fold-probe.png",
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    args[key] = key === "wait" ? Number(value) : value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env };
  let glArgs;
  if (args.mode.startsWith("x11:")) {
    // Headed on the user's live X display: the only reliable route to the
    // real Mesa/Iris driver on this box (headless falls back to SwiftShader
    // regardless of ANGLE flags).
    env.DISPLAY = args.mode.slice(4);
    glArgs = ["--use-gl=angle", "--use-angle=gl", "--no-sandbox"];
  } else if (args.mode === "gpu") {
    delete env.DISPLAY;
    glArgs = [
      "--headless=new",
      "--use-gl=angle",
      "--use-angle=gl",
      "--no-sandbox",
    ];
  } else {
    delete env.DISPLAY;
    glArgs = [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
    ];
  }
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env,
    args: glArgs,
  });
  const consoleTail = [];
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    page.on("console", (msg) => {
      const line = `[page:${msg.type()}] ${msg.text()}`;
      consoleTail.push(line);
      if (msg.type() === "error" || msg.type() === "warning") {
        console.error(line.slice(0, 2000));
      }
    });
    page.on("pageerror", (err) => {
      console.error(`[page:uncaught] ${err.stack ?? err.message}`);
    });

    const target =
      args.scenario === "hash"
        ? `${args.url}/${BOXFOLD_HASH}`
        : args.scenario === "lens"
          ? `${args.url}/${LENS_HASH}`
          : `${args.url}/`;
    console.error(`[probe] mode=${args.mode} scenario=${args.scenario}`);
    await page.goto(target, { waitUntil: "load", timeout: 30_000 });

    const webgl = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "(no webgl2)";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "(masked)";
    });
    console.error(`[probe] renderer: ${webgl}`);

    await page.waitForFunction(
      () =>
        Number(
          (document.getElementById("pointCount")?.textContent || "").replace(
            /[^\d]/g,
            "",
          ),
        ) > 0,
      undefined,
      { timeout: 30_000, polling: 100 },
    );
    console.error("[probe] cloud booted");

    if (args.scenario === "preset") {
      await page.evaluate(() => {
        const sel = document.getElementById("presetSelect");
        sel.value = "mandelboxKifs";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      console.error("[probe] selected Mandelbox KIFS from the preset menu");
    }

    // Give the (possibly morphing) load a moment, then report the Surface
    // button's state and press it if the preset hint has not already done so.
    await page.waitForTimeout(3_000);
    const btnState = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return {
        disabled: b?.disabled ?? null,
        pressed: b?.getAttribute("aria-pressed"),
        title: b?.title ?? "",
      };
    });
    console.error(`[probe] surface button: ${JSON.stringify(btnState)}`);
    if (btnState.disabled) {
      console.error("[probe] VERDICT: BUTTON DISABLED — eligibility gate");
      return;
    }
    const t0 = Date.now();
    if (btnState.pressed !== "true") {
      await page.evaluate(() => {
        document
          .getElementById("modeSurfaceBtn")
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      console.error("[probe] clicked Surface");
    } else {
      console.error("[probe] preset hint already entered Surface mode");
    }

    // Main-thread stall profile: 1s-budget pings until the wait budget runs
    // out. A missed ping = the thread was wedged that whole second.
    const deadline = Date.now() + args.wait;
    let stalls = 0;
    let pings = 0;
    while (Date.now() < deadline) {
      const pingStart = Date.now();
      try {
        await Promise.race([
          page.evaluate(() => performance.now()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("stall")), 1_000),
          ),
        ]);
        pings++;
        const spent = Date.now() - pingStart;
        if (spent < 500) await page.waitForTimeout(500 - spent);
      } catch {
        stalls++;
      }
    }
    console.error(
      `[probe] responsiveness after enter: ${pings} pings ok, ~${stalls}s stalled, total ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    await page.screenshot({ path: args.shot });
    console.error(`[probe] screenshot: ${args.shot}`);
    const errors = consoleTail.filter((l) => l.startsWith("[page:error]"));
    console.error(
      `[probe] console: ${consoleTail.length} messages, ${errors.length} errors`,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  process.exitCode = 1;
});
