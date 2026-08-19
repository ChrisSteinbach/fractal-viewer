#!/usr/bin/env node
/**
 * fr-5666 AND fr-j85n's real-WebGL gate for the 4D Points explorer's balloon
 * echo — RE-PINNED by fr-23oa, which caught the row below measuring the
 * control panel rather than the render.
 *
 * fr-5666: the 4D Points explorer must project, then invert, its balloon
 * echo, and that echo must reach real PIXELS out of a restored `#v1=`
 * document — so a shader/link failure, or the boot-time "enabled before a
 * bounding sphere exists" zero-uniform bug, cannot pass as a merely present
 * checkbox.
 * fr-j85n: the echo's authored tint pair (`balloonTint` +
 * `balloonTintStrength`) must reach that same 4D echo's pixels, be the exact
 * identity at strength 0, move nothing but the echo, and ride the same link.
 *
 * WHAT CARRIES fr-5666'S CLAIM (fr-23oa): the echo-on/off row compared over
 * the SCENE REGION, on the RESTORED page, at a balloon radius the restored
 * DOCUMENT itself carries and where the echo is measurably in frame. All
 * three qualifiers replaced something that was load-bearing and wrong, and
 * every one of them is measured here rather than argued.
 *
 * THE ROW IT REPLACED IS KEPT AS A DISCLOSED HISTORICAL MEASUREMENT, because
 * that number is on the record in two other places (fr-5666's bead, and
 * CLAUDE.md's "MEASURED at the lift" line) and a reader who meets it is owed
 * what it actually measured. fr-5666 recorded "10.255% of pixels changed,
 * meanAbs 3.285, max 234" from a FULL-FRAME diff of an element screenshot at
 * the document's own 1.60x radius. `#container canvas` fills the viewport
 * and `#panel` is painted ON TOP of it, so that screenshot contains the
 * control panel — and ticking the Balloon checkbox reveals
 * `balloonRadiusRow`, so the PANEL RELAYOUT alone moves 27.6-31.0% of the
 * panel's own pixels. MEASURED on the same two frames, scene region only:
 * 0.000% changed, meanAbs 0, MAX 0. At 1.60x the inversion's nearest image
 * sits outside the auto-framed view, so the echo contributed NO scene pixels
 * and the whole of the pinned figure was the panel growing a row. A shader
 * that rendered literally nothing would have passed. The confirmatory
 * symptom is fr-j85n's own doing: it added a Tint row to the same
 * gated-on-balloonEcho group, so the checkbox grew the panel by one MORE row
 * — and the figure moved with it, 10.255% -> 10.349%. A number that responds
 * to adding a UI row is not measuring a render.
 *
 * BOTH HALVES OF THAT ARE STILL MEASURED ON EVERY RUN — the full-frame and
 * the scene-only diff of one echo on/off pair at the document's own 1.60x,
 * taken on the pre-share page where that radius still stands — and both are
 * REPORTED, NEVER ASSERTED. The historical row stays reproducible instead of
 * merely remembered; it simply no longer decides anything.
 *
 * THE RADIUS RIDES THE DOCUMENT, NOT A POST-BOOT DRIVE, and that ordering is
 * load-bearing rather than tidy. Half of fr-5666's subject is the boot-time
 * ball-uniform sync — a document that enables the echo before its first 4D
 * cloud installs the enclosing ball — and `scene.ts`'s
 * `setBalloonEchoRadius` calls `syncBalloonEchoUniforms`, so a radius
 * dialled through the panel AFTER the reload would REPAIR exactly the
 * desync this gate exists to catch. The Balloon size slider is therefore
 * driven to GATE_RADIUS on the PRE-SHARE page, the share link is copied
 * after it, and the restored page's slider is read back to prove the hash
 * carried it. Nothing touches that slider on the restored page before the
 * row is measured.
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
 * TWO MEASUREMENT RULES, both of them things this script got wrong before and
 * both of them measured rather than argued. fr-j85n wrote them for its own
 * phases; fr-23oa found the fr-5666 row breaking both, so they now govern
 * EVERY phase in the file:
 *
 * 1. COMPARE THE SCENE, NOT THE PANEL. The panel is painted over the canvas
 *    (see above), and it moves for reasons that have nothing to do with the
 *    render: rows appearing, a colour swatch changing, a "100%" readout. So
 *    every comparison that decides anything diffs the SCENE REGION — the
 *    canvas left of `#panel`, derived from the live DOM rather than
 *    hardcoded — through the one `imageDiff` routine below. The two
 *    full-frame numbers this file still prints are disclosures, labelled as
 *    such at the call site.
 *
 * 2. PUT THE ECHO ON SCREEN FIRST. At the document's own balloon radius
 *    (1.60x) the inversion's nearest image sits outside the auto-framed view:
 *    MEASURED, radius 1.6 -> 2.5 moves 0.0000% of scene pixels and echo on/off
 *    moves 0.0000% with max 0. The echo IS drawing — radius 0.2 -> 0.5 moves
 *    20.7% and 0.5 -> 1.0 moves 22.8% — so every phase runs at GATE_RADIUS,
 *    where it is in frame, and the FIRST thing measured on the restored page
 *    is that it is (the fr-5666 row, which is also the precondition every
 *    later phase leans on; fr-j85n's own precondition re-measures it at the
 *    exact state its tint phases ran at). Without that a green tint phase
 *    would prove nothing — and the fr-5666 row proved nothing for a year.
 *
 * WHAT THIS GATE STILL DOES NOT SETTLE, said plainly so no later session
 * reads more into a green run than is in it: "the echo draws" does NOT
 * distinguish PROJECT-THEN-INVERT from invert-then-project, which is
 * fr-5666's actual subject. Both orders put an echo on screen — they
 * disagree about WHICH object it is the echo of — and at the pose this
 * script drives (a parked tumble, the pentatope's own rotor) they can agree
 * pixel for pixel. Separating them needs a fixture built for it: a rotor
 * pose where the two orders visibly disagree, plus a reference frame saying
 * which one is right. The original gate never separated them either, and
 * fr-23oa re-pinned the row it had rather than growing that fixture inside a
 * bug fix; it is filed as its own follow-up.
 *
 * Every image comparison that decides something happens INSIDE ONE
 * post-reload page. A pose-less document auto-frames from a
 * `Math.random()`-seeded cloud, so a cross-reload pixel diff is not a sound
 * instrument here — which is also why the historical 1.60x disclosure is
 * taken on the pre-share page as its own self-contained on/off pair rather
 * than compared against anything on the restored one.
 *
 * MEASURED (SwiftShader, 960x720, pentatope, scene region 656x720). The
 * echo-bearing rows move a few tenths of a percent between runs — a pose-less
 * document seeds its cloud from `Math.random()` — so they are recorded as what
 * a passing run measured, not as pins:
 *   echo on/off, SCENE @0.50x (fr-5666)  19.546% changed, meanAbs 0.933, max 57
 *                                        — THE GATED ROW, floor 2.0%. Three
 *                                          runs: 19.546 / 19.840 / 20.066,
 *                                          which is the framing noise a
 *                                          pose-less first boot carries and is
 *                                          the whole reason the bar is a floor
 *                                          an order of magnitude below it
 *                                          rather than a pinned figure
 *   echo on/off, full frame @0.50x       23.714% changed, meanAbs 3.818, max 234
 *                                        — the same two frames, panel included:
 *                                          reported for continuity with the
 *                                          historical row, asserted nowhere
 *   echo on/off, full frame @1.60x        9.199% changed, meanAbs 3.812, max 255
 *                                        — the SHAPE of the historical
 *                                          comparison (fr-5666 recorded
 *                                          10.255%/3.285/234, fr-j85n
 *                                          re-measured 10.349%/3.179/234), and
 *                                          READ THE NEXT PARAGRAPH BEFORE
 *                                          TREATING THE GAP AS A REGRESSION
 *
 * WHY THAT ROW READS 9.199 AND NOT 10.3, since a later reader WILL meet the
 * three figures side by side and a 10% gap in a row nothing asserts is exactly
 * the kind of thing that starts a phantom regression hunt. IT IS NOT THE SAME
 * COMPARISON. fr-5666 and fr-j85n measured on the RESTORED page in whatever
 * accordion state the restore produced; fr-23oa moved the disclosure to the
 * PRE-SHARE page (the header's ordering argument — nothing may touch the
 * radius on the restored page before the gated row), and this script opens
 * `atmosphereSection` explicitly on the way in. Different page, different
 * open section, therefore a different PANEL — and this row is panel-dominated
 * by construction, which is the entire finding. The figure is stable to the
 * digit across runs (9.199 twice, meanAbs 3.811/3.812); it is not noise, it is
 * a different panel. So the gap is CONFIRMATORY rather than concerning: a
 * number that moves when you open an accordion section is not measuring a
 * render, which is fr-23oa's thesis restated by accident. The row that is
 * comparable across all three sessions is the SCENE one below, and it reads
 * 0.000% in every one of them.
 *   echo on/off, SCENE @1.60x             0.000% changed, meanAbs 0, MAX 0
 *                                        — the same two frames, and the whole
 *                                          of fr-23oa: the row above is panel
 *   echo in frame @0.50x (fr-j85n)       19.546% changed, meanAbs 0.933, max 57
 *                                        — EXACTLY the fr-5666 row's figure,
 *                                          every digit, because strength 0 is
 *                                          the identity and the two pairs of
 *                                          frames are therefore byte-identical.
 *                                          The redundancy is the point: it is
 *                                          the same claim re-measured at the
 *                                          state the tint phases actually ran
 *                                          at, and its agreeing to the digit is
 *                                          what says nothing drifted between
 *                                          them
 *   tint/4D parity @0.50x (fr-j85n)      37.207% changed, meanAbs 1.457, max 80
 *   strength 0 identity                   0.000% changed, meanAbs 0, max 0
 *   echo-off inert                        0.000% changed, meanAbs 0, max 0
 *   tint persisted                       #00ff88 / 0.42 read back off the hash
 *
 * NON-VACUITY, measured the only way that counts (fr-23oa) — twice, because
 * the two ways this gate could lie are different bugs:
 *
 *   A. THE ECHO DRAWS NOTHING. `scene.ts`'s `syncBalloonEchoVisibility`
 *      forced to `const visible = false`, so the echo's Points object never
 *      renders. The gated row falls to 0.000% changed, meanAbs 0, MAX 0 and
 *      the run FAILS (exit 1) — while on that same build the full-frame diff
 *      of the SAME two frames reads 10.349% / 3.179 / 234, which is fr-j85n's
 *      historical re-measurement to the last digit. So a build whose echo
 *      renders LITERALLY NOTHING reproduces the number the gate used to pass
 *      on, exactly. The defect and the fix, on one build.
 *   B. THE ECHO IS OFF SCREEN. GATE_RADIUS moved to 2.50x, where the
 *      inversion's images sit outside the framed view. The gated row falls to
 *      1.609% (meanAbs 0.210) and the run FAILS on the
 *      ECHO_MIN_CHANGED_FRACTION floor — which is what that constant is for:
 *      at fr-j85n's 0.1% bar this configuration would have passed on a rim of
 *      clipped pixels. The full-frame row on those same frames reads 11.448%.
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
// The floor the fr-5666 row itself must clear (fr-23oa). Deliberately far
// above MIN_CHANGED_FRACTION: that one is fr-j85n's "a tint moved something"
// bar, where this one is the gate's whole verdict on whether the 4D echo
// draws, and the row it replaced passed at ~10% while the echo contributed
// EXACTLY ZERO scene pixels. MEASURED 19.5% at GATE_RADIUS, ten times this
// floor — and MEASURED 1.609% with the echo pushed off screen at 2.50x,
// which is what makes this a floor rather than a formality: at
// MIN_CHANGED_FRACTION's 0.1% that vacuous configuration would have passed
// on a rim of clipped pixels. Move GATE_RADIUS, never this.
const ECHO_MIN_CHANGED_FRACTION = 0.02;
// fr-j85n's drive values. TINT_HEX is deliberately far from anything the
// pentatope cloud's own per-transform palette produces, so a tinted echo
// cannot coincide with the untinted one by accident. PERSIST_TINT_STRENGTH is
// deliberately NEITHER endpoint: a 0/1 round trip would survive a wire that
// carried the pair as a flag, where 0.42 only survives one that carries the
// number.
const TINT_HEX = "#00ff88";
const PERSIST_TINT_STRENGTH = 0.42;
// The Balloon size EVERY phase runs at (see rule 2 in the header): the
// document's own 1.60x puts the inversion's nearest image outside the
// auto-framed view, where the echo has no pixels for a row to measure or a
// tint to colour. 0.50x is measured well inside it and is still the app's own
// slider, driven the way a user drives it — on the PRE-SHARE page, so the
// restored document carries it and no post-boot uniform push can stand in for
// the boot-time sync fr-5666 is about.
const GATE_RADIUS = 0.5;
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

/** stableCanvas for a capture with no baseline to change away from: wait out
 * the scheduled render (QUIET_MS) and then demand the same two byte-identical
 * screenshots every other capture here demands.
 *
 * TWO CALLERS, and the second one is fr-23oa's. The first is the phase that
 * asserts NOTHING moved, which by construction has no edge to wait on. The
 * second is the FIRST capture after the reload, where `resolution-governor.ts`
 * restores a parked still to full scale after ~2s of quiet: a capture taken
 * before that lands is a coarser rung of the same picture, and diffing it
 * against a later one reads the RESAMPLE as content. MEASURED, and by exactly
 * the sort of accident that makes a gate lie — the fr-23oa non-vacuity run
 * (echo deliberately off screen) came back 1.609% changed with max 209 on
 * that pair while the same comparison later in the same page read 0.000%
 * max 0. Both were right; only one was measuring the echo. */
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
      // The Balloon size the panel is showing. Read here rather than
      // inferred, because on the restored page it is the evidence that the
      // `#v1=` hash carried GATE_RADIUS — the ordering the header's
      // "THE RADIUS RIDES THE DOCUMENT" paragraph turns on.
      radiusValue: Number(
        document.getElementById("balloonRadiusSlider")?.value ?? Number.NaN,
      ),
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

/** Drive the Balloon size slider (see GATE_RADIUS) — the same table-driven
 * range pipeline as the strength half above. Called ONCE, on the pre-share
 * page, so the value rides the `#v1=` hash into the restored document
 * instead of being pushed at the renderer after its boot. */
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
    const echoAtDocRadius = await stableCanvas(page, options.timeout, plain4);

    // ——— fr-23oa: THE HISTORICAL ROW, DISCLOSED ————————————————————————
    // One echo on/off pair at the document's OWN 1.60x — the radius fr-5666
    // measured at — compared both ways. The full-frame figure is the shape of
    // the number fr-5666 pinned (10.255%) and CLAUDE.md carried; the scene
    // figure is what that number was worth. Both are printed, NEITHER is
    // asserted: the header explains why, and the gate's own row is the one
    // below, on the restored page at GATE_RADIUS.
    const historicalFull = await imageDiff(page, echoAtDocRadius, plain4);
    const historicalScene = await imageDiff(
      page,
      echoAtDocRadius,
      plain4,
      "scene",
    );
    reportDiff(
      "DISCLOSURE echo on/off, full frame at the document's 1.60x (fr-5666's historical comparison)",
      historicalFull,
    );
    reportDiff(
      "DISCLOSURE echo on/off, SCENE ONLY at the document's 1.60x (what that number was worth)",
      historicalScene,
    );

    // ——— fr-23oa: PUT THE ECHO ON SCREEN, IN THE DOCUMENT ———————————————
    // Drive the app's own Balloon size slider to a radius whose inversion
    // images land inside the frame (rule 2), BEFORE the link is copied, so
    // the restored page boots with it and the row below never touches a
    // uniform the boot was supposed to have synced (see the header).
    await setBalloonRadius(page, GATE_RADIUS);
    await stableCanvas(page, options.timeout, echoAtDocRadius);

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
    // The hash carried the radius, so the frames below are the boot's own
    // uniforms. A restored slider anywhere else means the row that follows is
    // measuring something this script did not set up, and the whole
    // "not a post-boot drive" argument in the header is void — so this is a
    // failure, not a note.
    if (restored.radiusValue !== GATE_RADIUS) {
      fail(
        `restored document came back at balloon radius ${restored.radiusValue}x, ` +
          `not the ${GATE_RADIUS}x driven before the link was copied — the ` +
          `fr-5666 row below would be measuring an unknown pose`,
      );
    }
    // quietCanvas, not stableCanvas: this is the first capture after the
    // reload and it has no baseline to change away from, so it must outlast
    // the resolution governor's restore-to-full — see quietCanvas's own note
    // for the measurement that says why.
    const onShot = await quietCanvas(page, options.timeout);

    await page.evaluate(() => {
      document.getElementById("atmosphereSection").open = true;
      document.getElementById("balloonEchoCheckbox").click();
    });
    const offShot = await stableCanvas(page, options.timeout, onShot);

    // ——— fr-5666: THE 4D ECHO DRAWS (the gate's load-bearing row) ————————
    // Scene region, restored page, document-carried GATE_RADIUS: every
    // qualifier the header argues for, in one comparison. This is what a
    // shader/link failure and the boot-time zero-uniform bug both have to
    // survive, and it is the precondition every later phase leans on.
    const diff = await imageDiff(page, onShot, offShot, "scene");
    reportDiff(`echo on/off, scene at ${GATE_RADIUS}x (fr-5666)`, diff);
    if (diff.changedFraction < ECHO_MIN_CHANGED_FRACTION || diff.maxDelta < 5) {
      fail(
        `the 4D balloon echo moved ${(100 * diff.changedFraction).toFixed(3)}% of ` +
          `SCENE pixels (max ${diff.maxDelta}) on a restored document at ` +
          `${GATE_RADIUS}x — it is not reaching the frame. Do not relax this ` +
          `bar and do not fall back to the full-frame number: fr-23oa is the ` +
          `record of that number passing on a panel relayout while the echo ` +
          `drew nothing: ${JSON.stringify(diff)}`,
      );
    }
    // The same two frames the historical way, for continuity with the
    // disclosure above — panel included, so it reads HIGHER than the row that
    // decides. Reported, never asserted.
    const gatedFull = await imageDiff(page, onShot, offShot);
    reportDiff(
      `DISCLOSURE the same two frames, full frame at ${GATE_RADIUS}x`,
      gatedFull,
    );

    // ——— fr-j85n: BACK TO THE ECHO ———————————————————————————————————————
    // The tint phases below can only mean something where the echo has pixels
    // (header rule 2), which the row above just measured at this radius. The
    // document already carries it, so this is the checkbox and nothing else —
    // no second slider drive, no fresh uniform push.
    await page.evaluate(() => {
      document.getElementById("balloonEchoCheckbox").click();
    });
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
    reportDiff(`echo in frame at ${GATE_RADIUS}x (precondition)`, echoInDiff);
    if (
      echoInDiff.changedFraction < MIN_CHANGED_FRACTION ||
      echoInDiff.maxDelta < 5
    ) {
      fail(
        `echo had no pixels at ${GATE_RADIUS}x, so the tint phases above proved nothing: ${JSON.stringify(echoInDiff)}`,
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
    reportDiff(
      `SUMMARY echo on/off, SCENE at ${GATE_RADIUS}x (fr-5666, THE GATED ROW)`,
      diff,
    );
    reportDiff(
      `SUMMARY echo on/off, full frame at ${GATE_RADIUS}x (disclosure)`,
      gatedFull,
    );
    reportDiff(
      "SUMMARY echo on/off, full frame at 1.60x (fr-5666's historical row, disclosure)",
      historicalFull,
    );
    reportDiff(
      "SUMMARY echo on/off, SCENE at 1.60x (what that row was worth, disclosure)",
      historicalScene,
    );
    reportDiff(
      `SUMMARY echo in frame at ${GATE_RADIUS}x (fr-j85n precondition)`,
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
