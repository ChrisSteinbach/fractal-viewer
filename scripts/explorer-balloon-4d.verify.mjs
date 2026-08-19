#!/usr/bin/env node
/**
 * fr-5666 AND fr-j85n's real-WebGL gate.
 *
 * fr-5666: the 4D Points explorer must project, then invert, its balloon echo.
 * fr-j85n: the echo's authored tint pair (`balloonTint` +
 * `balloonTintStrength`) must reach that 4D echo's PIXELS, be the exact
 * identity at strength 0, move nothing but the echo, and ride the shared
 * `#v1=` link. Drives the persisted UI path so a shader/link failure or the
 * boot-time "enabled before a bounding sphere exists" zero-uniform bug cannot
 * pass as a merely present checkbox.
 *
 * THE TINT/4D PHASE IS THE DIMENSIONAL-PARITY CHECK. fr-j85n's mix sits AFTER
 * the 3D/4D branch, on the `sourceColor` both paths produce, inside ONE
 * material whose `uFourDActive` is a uniform branch rather than a second
 * program — so the 4D half is free BY CONSTRUCTION. The bead demands that be
 * VERIFIED, NOT ASSUMED, and this is where the verification lives: the script
 * drives Pentatope (a 4D system) through Points, parks the tumble and enables
 * the echo, so a tint that never reached the 4D path leaves the frame
 * untouched and the phase fails.
 *
 * TWO MEASUREMENT RULES THE fr-j85n PHASES ADD, both of them things this
 * script got wrong before and both of them measured, not argued:
 *
 * 1. COMPARE THE SCENE, NOT THE PANEL. `#container canvas` fills the viewport
 *    and `#panel` is painted ON TOP of it, so an ELEMENT screenshot contains
 *    the control panel. Enabling the echo grows the panel (the Balloon size
 *    row + Inflate button appear) and MEASURED 27.6-31.0% of the panel's own
 *    pixels change from that relayout alone — which is the whole of the
 *    echo-on/off row below (viewport-only, that row measures EXACTLY 0.0000%,
 *    max 0). The tint's own colour swatch and "100%" label live in that panel
 *    too, so a full-frame identity claim would be measuring the picker rather
 *    than the render. Every fr-j85n phase therefore diffs the SCENE REGION —
 *    the canvas left of `#panel`, derived from the live DOM rather than
 *    hardcoded — through the same `imageDiff` the pinned row uses.
 *
 * 2. PUT THE ECHO ON SCREEN FIRST. At the document's own balloon radius
 *    (1.60x) the inversion's nearest image sits outside the auto-framed view:
 *    MEASURED, radius 1.6 -> 2.5 moves 0.0000% of scene pixels and echo on/off
 *    moves 0.0000% with max 0. The echo IS drawing — radius 0.2 -> 0.5 moves
 *    20.7% and 0.5 -> 1.0 moves 22.8% — so the fr-j85n phases first drive the
 *    Balloon size slider to TINT_PHASE_RADIUS, where the echo is in frame, and
 *    assert that it is (the precondition phase) before asking whether the tint
 *    reached it. Without that a green tint phase would prove nothing.
 *
 * THE CONSEQUENCE, stated plainly so nobody trusts the wrong row: the
 * echo-on/off FULL-FRAME row does NOT carry fr-5666's claim and never did.
 * A shader that rendered literally nothing would still produce ~10%, because
 * that is the panel. What carries "the 4D echo actually draws" now is the
 * PRECONDITION phase — scene region, radius 0.50x, echo on vs off, ~20% — and
 * what carries "the tint reaches the 4D echo" is the parity phase above it.
 * The full-frame row is KEPT, unmoved (same two frames, same comparison, same
 * bar), as the historical figure fr-5666 recorded, and re-pinning it is filed
 * as fr-23oa rather than done here: fr-j85n is a colour bead and re-aiming
 * another bead's gate is that bead's decision. fr-23oa also notes what neither
 * row settles — "does it draw" does not distinguish PROJECT-THEN-INVERT from
 * invert-then-project, which is fr-5666's actual subject.
 *
 * One confirmatory symptom, since it is this bead's own doing: fr-j85n added a
 * Tint row to the same gated-on-balloonEcho group, so ticking the checkbox now
 * grows the panel by one MORE row — and the full-frame figure moved with it
 * (10.255% -> 10.349%). A number that responds to adding a UI row is not
 * measuring a render.
 *
 * Every image comparison happens INSIDE ONE post-reload page. A pose-less
 * document auto-frames from a `Math.random()`-seeded cloud, so a cross-reload
 * pixel diff is not a sound instrument here.
 *
 * MEASURED (SwiftShader, 960x720, pentatope, scene region 636x720). The two
 * echo-bearing rows move a few tenths of a percent between runs — a pose-less
 * document seeds its cloud from `Math.random()` — so they are recorded as what
 * a passing run measured, not as pins:
 *   echo on/off, full frame (fr-5666)   fr-5666's own record is 10.255%
 *                                       changed, meanAbs 3.285, max 234; the
 *                                       fr-j85n session re-measured 10.349%,
 *                                       3.179, 234 — reproduced, not edited to
 *                                       match, and see rule 1 for what it is
 *                                       actually measuring (the PANEL relayout)
 *   echo on/off, scene only @1.60x       0.000% changed, meanAbs 0, max 0
 *                                       — the same two frames, echo excluded
 *                                         from the view by its own radius
 *   echo in frame @0.50x (precondition)  20.442% changed, meanAbs 0.968, max 73
 *                                       (a second run: 19.778%, 0.948, 61)
 *   tint/4D parity @0.50x (fr-j85n)      37.768% changed, meanAbs 1.482, max 82
 *                                       (a second run: 36.039%, 1.433, 70)
 *   strength 0 identity                   0.000% changed, meanAbs 0, max 0
 *   echo-off inert                        0.000% changed, meanAbs 0, max 0
 *   tint persisted                       #00ff88 / 0.42 read back off the hash
 *
 * Usage:
 *   node scripts/explorer-balloon-4d.verify.mjs [--url=https://localhost:5173]
 *
 * Without --url, starts `npm run dev` and tears it down. Chromium is the
 * Playwright-bundled build on the same SwiftShader recipe as webgl-smoke.mjs.
 */
import { spawn } from "node:child_process";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESET = "pentatope";
const VIEWPORT = { width: 960, height: 720 };
const START_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_CHANGED_FRACTION = 0.001;
// fr-j85n's drive values. TINT_HEX is deliberately far from anything the
// pentatope cloud's own per-transform palette produces, so a tinted echo
// cannot coincide with the untinted one by accident. PERSIST_TINT_STRENGTH is
// deliberately NEITHER endpoint: a 0/1 round trip would survive a wire that
// carried the pair as a flag, where 0.42 only survives one that carries the
// number.
const TINT_HEX = "#00ff88";
const PERSIST_TINT_STRENGTH = 0.42;
// The Balloon size the fr-j85n phases run at (see rule 2 in the header): the
// document's own 1.60x puts the inversion's nearest image outside the
// auto-framed view, where a tint has nothing on screen to colour. 0.50x is
// measured well inside it and is still the app's own slider, driven the way a
// user drives it.
const TINT_PHASE_RADIUS = 0.5;
// A phase whose whole claim is that NOTHING moved has no "changed from
// baseline" edge to wait on, so it waits out the render the uniform push
// scheduled — and the resolution governor's ~2s restore-to-full park — before
// demanding a byte-identical settle. See quietCanvas.
const QUIET_MS = 2_500;

function args(argv) {
  const out = { url: null, timeout: DEFAULT_TIMEOUT_MS };
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument: ${raw}`);
    if (match[1] === "url" && match[2]) {
      out.url = match[2].replace(/\/+$/, "");
    } else if (match[1] === "timeout" && match[2]) {
      out.timeout = Number(match[2]);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return out;
}

async function spawnDev() {
  // Vite 7 can suppress its banner when stdout is a pipe. Pick an ephemeral
  // process-scoped high port explicitly rather than depending on parsing it.
  const port = 41_000 + (process.pid % 20_000);
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(port), "--strictPort"],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(`[dev] ${text}`);
    });
  }
  return { child, url: `https://localhost:${port}` };
}

function stopDev(child) {
  if (!child?.pid || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

function waitForHttps(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 3_000 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline)
          reject(new Error(`No response from ${url}`));
        else setTimeout(attempt, 250);
      });
      req.on("timeout", () => req.destroy());
    };
    attempt();
  });
}

async function waitForPoints(page, timeout) {
  await page.waitForFunction(
    () => {
      const text = document.getElementById("pointCount")?.textContent ?? "";
      return Number(text.replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout, polling: 100 },
  );
}

async function canvasShot(page) {
  return page.locator("#container canvas").first().screenshot({ type: "png" });
}

/** Wait for a render-on-demand canvas to change from `baseline` (if given),
 * then produce two byte-identical screenshots.
 *
 * The give-up message names WHICH of the two waits ran out — a canvas frozen
 * at the baseline (the push never reached the renderer) and one still moving
 * (something is animating over the phase) are opposite bugs, and a bare
 * "did not change and settle" makes them look alike. */
async function stableCanvas(page, timeout, baseline = null) {
  const deadline = Date.now() + timeout;
  let previous = null;
  let changed = baseline === null;
  let equalRuns = 0;
  let polls = 0;
  let flips = 0;
  while (Date.now() < deadline) {
    const shot = await canvasShot(page);
    polls++;
    if (previous && !previous.equals(shot)) flips++;
    if (!changed && !shot.equals(baseline)) changed = true;
    if (changed && previous?.equals(shot)) {
      equalRuns++;
      if (equalRuns >= 2) return shot;
    } else {
      equalRuns = 0;
    }
    previous = shot;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `canvas did not change and settle before timeout (changed=${changed} polls=${polls} flips=${flips} atBaseline=${Boolean(baseline && previous?.equals(baseline))})`,
  );
}

/** stableCanvas for a phase that asserts NOTHING moved: no baseline to change
 * away from, so wait out the scheduled render (QUIET_MS) and then demand the
 * same two byte-identical screenshots every other capture here demands. */
async function quietCanvas(page, timeout) {
  await page.waitForTimeout(QUIET_MS);
  return stableCanvas(page, timeout);
}

/**
 * Mean/changed/max difference between two canvas screenshots.
 *
 * `region` picks WHAT is compared. `"frame"` is the whole element screenshot —
 * what the fr-5666 row has always compared, kept exactly. `"scene"` is the
 * canvas LEFT OF `#panel`, derived from the live DOM here rather than
 * hardcoded: the panel is painted over the canvas, so an element screenshot
 * carries it, and the panel moves for reasons that have nothing to do with the
 * render (rows appearing, a colour swatch changing). Every fr-j85n phase asks
 * about the RENDER, so every fr-j85n phase passes `"scene"`. One routine, one
 * definition of "changed", one place to read the arithmetic.
 */
async function imageDiff(page, onPng, offPng, region = "frame") {
  return page.evaluate(
    async ({ on64, off64, region }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [on, off] = await Promise.all([bitmap(on64), bitmap(off64)]);
      if (on.width !== off.width || on.height !== off.height) {
        return { changedFraction: 1, meanAbs: 255, maxDelta: 255, width: 0 };
      }
      // The scene region in IMAGE pixels: everything left of the panel's own
      // left edge, scaled by the screenshot's pixels-per-CSS-pixel. 4px of
      // margin so a panel shadow or rounded corner can never leak in. Falls
      // back to the whole frame if the panel is not on screen.
      let width = on.width;
      if (region === "scene") {
        const canvas = document.querySelector("#container canvas");
        const panel = document.getElementById("panel");
        const canvasRect = canvas?.getBoundingClientRect();
        const panelRect = panel?.getBoundingClientRect();
        if (canvasRect?.width && panelRect?.width) {
          const scale = on.width / canvasRect.width;
          const edge = (panelRect.left - canvasRect.left) * scale - 4;
          if (edge > 0 && edge < width) width = Math.floor(edge);
        }
      }
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, image.height).data;
      };
      const a = pixels(on);
      const b = pixels(off);
      let changed = 0;
      let sum = 0;
      let maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        const dr = Math.abs(a[i] - b[i]);
        const dg = Math.abs(a[i + 1] - b[i + 1]);
        const db = Math.abs(a[i + 2] - b[i + 2]);
        const delta = Math.max(dr, dg, db);
        if (delta >= 3) changed++;
        sum += dr + dg + db;
        maxDelta = Math.max(maxDelta, delta);
      }
      const count = a.length / 4;
      return {
        changedFraction: changed / count,
        meanAbs: sum / (count * 3),
        maxDelta,
        width,
      };
    },
    {
      on64: onPng.toString("base64"),
      off64: offPng.toString("base64"),
      region,
    },
  );
}

/** The script's one log-line format: a phase name and its measured numbers. */
function reportDiff(name, diff) {
  console.error(
    `[explorer-balloon-4d] ${name} changed=${(100 * diff.changedFraction).toFixed(3)}% meanAbs=${diff.meanAbs.toFixed(3)} max=${diff.maxDelta}`,
  );
}

async function rows(page) {
  return page.evaluate(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      return Boolean(el && !el.classList.contains("hidden"));
    };
    return {
      echo: visible("balloonEchoRow"),
      radius: visible("balloonRadiusRow"),
      // fr-j85n's row hides and shows with balloonRadiusRow (state.balloonEcho
      // gates both) — reported here so the tint pair's own visibility rides
      // the same one place every other balloon row is read from.
      tint: visible("balloonTintRow"),
      checked: document.getElementById("balloonEchoCheckbox")?.checked === true,
      tumble: document.getElementById("fourDTumbleToggle")?.checked === true,
    };
  });
}

/**
 * Drive the Points section's balloon tint pair (fr-j85n) the way the page's own
 * listeners see it. The colour input's handler is bespoke and listens on
 * "input" (ui.ts's `onBalloonTint`); the strength slider is table-driven
 * through control-spec.ts, which reads "input" plus the trailing "change" a
 * real drag's release fires — so both go out, bubbling, and nothing here
 * depends on which node the app happened to bind. WHETHER THE DRIVE LANDED IS
 * NEVER INFERRED FROM THE DISPATCH: every phase reads the pair back off the
 * controls, and the phases where the tint is supposed to be visible read it off
 * the pixels. Works on a hidden row (the echo-off phase) — `hidden` is a class,
 * and a programmatic dispatch does not care whether the element is on screen.
 */
async function setTint(page, { hex = null, strength = null }) {
  await page.evaluate(
    ({ hex, strength }) => {
      const color = document.getElementById("balloonTintColor");
      const range = document.getElementById("balloonTintStrength");
      if (!color || !range) throw new Error("balloon tint controls missing");
      if (hex !== null) {
        color.value = hex;
        color.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (strength !== null) {
        range.value = String(strength);
        range.dispatchEvent(new Event("input", { bubbles: true }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { hex, strength },
  );
}

/** Drive the Balloon size slider (see TINT_PHASE_RADIUS) — the same
 * table-driven range pipeline as the strength half above. */
async function setBalloonRadius(page, radius) {
  await page.evaluate((radius) => {
    const slider = document.getElementById("balloonRadiusSlider");
    if (!slider) throw new Error("balloonRadiusSlider missing");
    slider.value = String(radius);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, radius);
}

/** The tint pair as the PANEL reads it back: both control values, the
 * percentage label control-spec.ts drives, and whether the row is on screen. */
async function tintControls(page) {
  return page.evaluate(() => {
    const color = document.getElementById("balloonTintColor");
    const range = document.getElementById("balloonTintStrength");
    const row = document.getElementById("balloonTintRow");
    const label = document.getElementById("balloonTintLabel");
    return {
      color: color?.value ?? "",
      strength: range ? Number(range.value) : Number.NaN,
      label: label?.textContent?.trim() ?? "",
      row: Boolean(row && !row.classList.contains("hidden")),
    };
  });
}

/** Capture the link produced by the app's Copy-link handler without depending
 * on host clipboard permissions. Re-installed per document — a reload drops the
 * override along with the rest of the page. */
async function copyShareLink(page, timeout) {
  await page.evaluate(() => {
    delete window.__explorerBalloonShareLink;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__explorerBalloonShareLink = text;
        },
      },
    });
    document.getElementById("shareSection").open = true;
    document.getElementById("copyLinkBtn").click();
  });
  await page.waitForFunction(
    () => typeof window.__explorerBalloonShareLink === "string",
    undefined,
    { timeout },
  );
  return page.evaluate(() => window.__explorerBalloonShareLink);
}

async function main() {
  const options = args(process.argv.slice(2));
  let dev = null;
  let browser = null;
  let failed = false;
  const failures = [];
  const pageErrors = [];
  const shaderErrors = [];
  const fail = (message) => {
    failed = true;
    failures.push(message);
    console.error(`[explorer-balloon-4d] FAIL ${message}`);
  };

  try {
    if (!options.url) {
      dev = await spawnDev();
      options.url = dev.url;
      await waitForHttps(options.url, START_TIMEOUT_MS);
    }

    const env = { ...process.env };
    delete env.DISPLAY;
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false,
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        /(WebGLProgram|GLSL|shader|link program|VALIDATE_STATUS)/i.test(text)
      ) {
        shaderErrors.push(text);
      }
    });

    await page.goto(`${options.url}/`, {
      waitUntil: "load",
      timeout: options.timeout,
    });
    await waitForPoints(page, options.timeout);
    const initial = await canvasShot(page);

    // Real preset-select path, then park the session-only tumble before any
    // image comparison. Waiting for a changed + stable canvas distinguishes
    // the arriving 4D cloud from the already-painted boot cloud.
    await page.selectOption("#presetSelect", PRESET);
    await page.waitForFunction(
      () =>
        !document.getElementById("fourDControls")?.classList.contains("hidden"),
      undefined,
      { timeout: options.timeout },
    );
    await page.evaluate(() => {
      const toggle = document.getElementById("fourDTumbleToggle");
      if (toggle?.checked) toggle.click();
    });
    const plain4 = await stableCanvas(page, options.timeout, initial);

    await page.evaluate(() => {
      document.getElementById("atmosphereSection").open = true;
      document.getElementById("balloonEchoCheckbox").click();
    });
    const enabled = await rows(page);
    if (!enabled.echo || !enabled.radius || !enabled.checked) {
      fail(`pre-share balloon rows/state ${JSON.stringify(enabled)}`);
    }
    await stableCanvas(page, options.timeout, plain4);

    const shareLink = await copyShareLink(page, options.timeout);
    if (!shareLink.includes("#v1=")) fail(`bad share link: ${shareLink}`);

    // The restored document is the important half: balloon state is applied
    // before its first 4D cloud installs the full bounding sphere.
    await page.goto(shareLink, {
      waitUntil: "load",
      timeout: options.timeout,
    });
    await waitForPoints(page, options.timeout);
    await page.evaluate(() => {
      const toggle = document.getElementById("fourDTumbleToggle");
      if (toggle?.checked) toggle.click();
    });
    const restored = await rows(page);
    if (!restored.echo || !restored.radius || !restored.checked) {
      fail(`restored balloon rows/state ${JSON.stringify(restored)}`);
    }
    const onShot = await stableCanvas(page, options.timeout);

    await page.evaluate(() => {
      document.getElementById("atmosphereSection").open = true;
      document.getElementById("balloonEchoCheckbox").click();
    });
    const offShot = await stableCanvas(page, options.timeout, onShot);
    const diff = await imageDiff(page, onShot, offShot);
    console.error(
      `[explorer-balloon-4d] on/off changed=${(100 * diff.changedFraction).toFixed(3)}% meanAbs=${diff.meanAbs.toFixed(3)} max=${diff.maxDelta}`,
    );
    if (diff.changedFraction < MIN_CHANGED_FRACTION || diff.maxDelta < 5) {
      fail(`echo produced no material canvas change: ${JSON.stringify(diff)}`);
    }
    // What that row does NOT measure, measured (header rule 1): at the
    // document's own 1.60x the echo is off-frame, so the SCENE half of those
    // same two frames is 0.000%/max 0 and the whole of the number above is the
    // panel growing its Balloon size row. Reported, never asserted — the row
    // above is fr-5666's and stays exactly as it was.
    reportDiff(
      "on/off SCENE-ONLY at the document radius (disclosure)",
      await imageDiff(page, onShot, offShot, "scene"),
    );

    // ——— fr-j85n: PUT THE ECHO ON SCREEN ———————————————————————————————
    // The tint phases below can only mean something where the echo has pixels
    // (header rule 2). Re-enable it and drive the app's own Balloon size
    // slider to a radius whose inversion images land inside the frame.
    await page.evaluate(() => {
      document.getElementById("balloonEchoCheckbox").click();
    });
    await setBalloonRadius(page, TINT_PHASE_RADIUS);
    const echoIn = await stableCanvas(page, options.timeout, offShot);

    // ——— fr-j85n: THE TINT REACHES THE 4D ECHO (DIMENSIONAL PARITY) ———
    // The 4D half of the tint is free by construction (see the header) —
    // VERIFIED here, not assumed. Pentatope is a 4D system, its tumble is
    // parked, and the echo is on screen, so the only thing between this frame
    // and `echoIn` is the mix on the echo's base albedo. A tint that never
    // reached the 4D branch's `sourceColor` leaves the scene untouched.
    await setTint(page, { hex: TINT_HEX, strength: 1 });
    // Read the PANEL back first, and separately: it costs nothing and it
    // splits the two ways this phase can fail — a drive the controls never
    // took, versus a tint that took but never reached the echo's pixels.
    const tintedControls = await tintControls(page);
    console.error(
      `[explorer-balloon-4d] tint drive ${JSON.stringify(tintedControls)}`,
    );
    if (tintedControls.color !== TINT_HEX || tintedControls.strength !== 1) {
      fail(`tint controls refused the drive ${JSON.stringify(tintedControls)}`);
    }
    const tinted = await stableCanvas(page, options.timeout, echoIn);
    const tintDiff = await imageDiff(page, echoIn, tinted, "scene");
    reportDiff("tint/4D (dimensional parity)", tintDiff);
    if (
      tintDiff.changedFraction < MIN_CHANGED_FRACTION ||
      tintDiff.maxDelta < 5
    ) {
      fail(
        `balloon tint did not reach the 4D echo: ${JSON.stringify(tintDiff)}`,
      );
    }

    // ——— fr-j85n: STRENGTH 0 IS THE IDENTITY ———————————————————————————
    // `mix(x, y, 0.0)` is exactly `x`, so a document that predates the pair —
    // or any document that leaves the strength at its default — must render
    // today's frame BYTE FOR BYTE. Measured, not argued: the COLOUR stays at
    // TINT_HEX and only the weight returns to 0, which is the strictest form
    // of the claim (an implementation that branched on the colour rather than
    // the weight would pass a black-tint test and fail this one).
    await setTint(page, { strength: 0 });
    const zeroedControls = await tintControls(page);
    if (zeroedControls.color !== TINT_HEX || zeroedControls.strength !== 0) {
      fail(`strength 0 drive did not land ${JSON.stringify(zeroedControls)}`);
    }
    const zeroed = await stableCanvas(page, options.timeout, tinted);
    const zeroDiff = await imageDiff(page, echoIn, zeroed, "scene");
    reportDiff("strength0 identity", zeroDiff);
    if (zeroDiff.maxDelta !== 0) {
      fail(
        "strength 0 is not the identity — this bar is fr-j85n's " +
          '"an absent-field document renders today\'s frame byte for byte" ' +
          `claim and must not be relaxed: ${JSON.stringify(zeroDiff)}`,
      );
    }

    // ——— fr-j85n: THE ECHO REALLY WAS ON SCREEN (precondition) —————————
    // Turn the echo off at the SAME radius the two phases above ran at. This
    // is what stops them being vacuous: it is the measurement that says those
    // pixels existed to be tinted, and it is the one the document's own 1.60x
    // cannot make (0.000% there, see the disclosure above).
    await page.evaluate(() => {
      document.getElementById("balloonEchoCheckbox").click();
    });
    const offIn = await stableCanvas(page, options.timeout, zeroed);
    const echoInDiff = await imageDiff(page, zeroed, offIn, "scene");
    reportDiff(
      `echo in frame at ${TINT_PHASE_RADIUS}x (precondition)`,
      echoInDiff,
    );
    if (
      echoInDiff.changedFraction < MIN_CHANGED_FRACTION ||
      echoInDiff.maxDelta < 5
    ) {
      fail(
        `echo had no pixels at ${TINT_PHASE_RADIUS}x, so the tint phases above proved nothing: ${JSON.stringify(echoInDiff)}`,
      );
    }

    // ——— fr-j85n: IT MOVES ONLY THE ECHO ———————————————————————————————
    // A control that tints the echo must be provably INERT when there is no
    // echo. Same strong colour, same full strength, echo off — anything but a
    // byte-identical scene means the mix has leaked out of the echo material
    // into the main cloud. The drive is read back off the controls here
    // because the pixels deliberately cannot confirm it in this phase.
    await setTint(page, { hex: TINT_HEX, strength: 1 });
    const offTinted = await quietCanvas(page, options.timeout);
    const offTintDiff = await imageDiff(page, offIn, offTinted, "scene");
    reportDiff("echo-off inert", offTintDiff);
    const offDriven = await tintControls(page);
    if (offDriven.color !== TINT_HEX || offDriven.strength !== 1) {
      fail(`echo-off tint drive did not land ${JSON.stringify(offDriven)}`);
    }
    if (offDriven.row) {
      fail(
        `balloon tint row visible with the echo off ${JSON.stringify(offDriven)}`,
      );
    }
    if (offTintDiff.maxDelta !== 0) {
      fail(
        `balloon tint moved something other than the echo: ${JSON.stringify(offTintDiff)}`,
      );
    }

    // ——— fr-j85n: THE PAIR RIDES THE #v1= HASH —————————————————————————
    // No pixels: the acceptance criterion is that the tint is scene CONTENT a
    // shared link carries, so the readback IS the two control values (and the
    // row being on screen for the echo that owns them). The echo goes back on
    // first — the row is what a recipient of the link sees.
    await page.evaluate(() => {
      document.getElementById("balloonEchoCheckbox").click();
    });
    await setTint(page, { hex: TINT_HEX, strength: PERSIST_TINT_STRENGTH });
    const authored = await tintControls(page);
    if (
      authored.color !== TINT_HEX ||
      authored.strength !== PERSIST_TINT_STRENGTH ||
      !authored.row
    ) {
      fail(`pre-share tint controls ${JSON.stringify(authored)}`);
    }
    const tintLink = await copyShareLink(page, options.timeout);
    if (!tintLink.includes("#v1=")) fail(`bad tint share link: ${tintLink}`);
    await page.goto(tintLink, { waitUntil: "load", timeout: options.timeout });
    await waitForPoints(page, options.timeout);
    // Give the decoded document its trip through updateLabels before reading,
    // but convert the wait's own failure into a MEASURED one: the assertions
    // below report whatever the controls actually came back with.
    await page
      .waitForFunction(
        ({ hex, strength }) => {
          const color = document.getElementById("balloonTintColor");
          const range = document.getElementById("balloonTintStrength");
          return color?.value === hex && Number(range?.value) === strength;
        },
        { hex: TINT_HEX, strength: PERSIST_TINT_STRENGTH },
        { timeout: 10_000, polling: 100 },
      )
      .catch(() => {});
    const persisted = await tintControls(page);
    const persistedRows = await rows(page);
    console.error(
      `[explorer-balloon-4d] tint persisted color=${persisted.color} strength=${persisted.strength} label=${persisted.label} tintRow=${persisted.row}`,
    );
    if (
      persisted.color !== TINT_HEX ||
      persisted.strength !== PERSIST_TINT_STRENGTH
    ) {
      fail(
        `balloon tint did not ride the #v1= hash: ${JSON.stringify(persisted)}`,
      );
    }
    if (!persisted.row || !persistedRows.checked) {
      fail(
        `restored tint row/echo ${JSON.stringify({ ...persistedRows, tintRow: persisted.row })}`,
      );
    }

    const appError = await page.evaluate(() => ({
      boot: document.getElementById("error")?.textContent?.trim() ?? "",
      renderVisible: !document
        .getElementById("renderError")
        ?.classList.contains("hidden"),
    }));
    if (appError.boot || appError.renderVisible) {
      fail(`app error UI ${JSON.stringify(appError)}`);
    }
    if (pageErrors.length) fail(`page errors: ${pageErrors.join(" | ")}`);
    if (shaderErrors.length) fail(`shader errors: ${shaderErrors.join(" | ")}`);

    console.error("[explorer-balloon-4d] ======== SUMMARY ========");
    console.error(`[explorer-balloon-4d] preset: ${PRESET}`);
    console.error(
      `[explorer-balloon-4d] restored rows: ${JSON.stringify(restored)}`,
    );
    reportDiff("SUMMARY echo on/off, full frame (fr-5666, pinned)", diff);
    reportDiff(
      `SUMMARY echo in frame at ${TINT_PHASE_RADIUS}x (fr-j85n precondition)`,
      echoInDiff,
    );
    reportDiff("SUMMARY tint/4D (dimensional parity, fr-j85n)", tintDiff);
    reportDiff("SUMMARY strength0 identity (fr-j85n)", zeroDiff);
    reportDiff("SUMMARY echo-off inert (fr-j85n)", offTintDiff);
    console.error(
      `[explorer-balloon-4d] SUMMARY tint persisted (fr-j85n): ${JSON.stringify(persisted)}`,
    );
    console.error(`[explorer-balloon-4d] VERDICT: ${failed ? "FAIL" : "PASS"}`);
  } catch (error) {
    // A phase that dies mid-flight (a canvas that never settles, a wait that
    // runs out) is very often downstream of something the page already
    // reported — an app error UI, a thrown handler, a shader that failed to
    // link — and the checks that read those sit AFTER the phases. Say what the
    // page had already told us before the throw leaves this frame.
    console.error(
      `[explorer-balloon-4d] at fatal: pageErrors=${JSON.stringify(pageErrors)} shaderErrors=${JSON.stringify(shaderErrors)}`,
    );
    throw error;
  } finally {
    if (browser) await browser.close();
    stopDev(dev?.child);
  }

  if (failed) throw new Error(failures.join("; "));
}

main().catch((error) => {
  console.error(`[explorer-balloon-4d] fatal: ${error.stack ?? error}`);
  process.exitCode = 1;
});
