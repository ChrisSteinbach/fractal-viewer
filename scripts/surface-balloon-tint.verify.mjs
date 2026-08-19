#!/usr/bin/env node
/**
 * fr-j85n's SURFACE-arm gate — the balloon echo's authored tint pair
 * (`balloonTint` + `balloonTintStrength`) measured on real GPU frames.
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-balloon-tint.verify.mjs [--url=…] [--display=:0]
 *
 * Its sibling `scripts/explorer-balloon-4d.verify.mjs` gates the POINTS arm
 * of the same pair. This one gates the two SURFACE arms, and it exists for
 * exactly the three things no unit test — and no `npm run bench:surface`
 * row — can reach:
 *
 *   (i)   THE WGSL SHADER READS THE TINT WHERE THE HOST WROTE IT. The unit
 *         tests pin that `packSurfaceShadeParams` writes 208/212/216/220,
 *         that `ShadeParams` declares the members, and that the mix line is
 *         emitted and gated on `hi.shell`. NOTHING source-level can see a
 *         LAYOUT mismatch between the two, and `bench:surface` cannot
 *         either: the default tint is zero and every other ShadeParams
 *         field precedes it, so a misaligned read lands on zeros and every
 *         bench row stays green. Only a COMPUTE frame with a non-zero tint
 *         answers it. That is leg 1, and it is the leg to keep if only one
 *         survives.
 *   (ii)  THE GLSL UNIFORMS REACH THE COMPILED PROGRAM. `uBalloonTint` /
 *         `uBalloonTintStrength` are declared INSIDE the `SURFACE_BALLOON`
 *         arm; a uniform that never resolves is silently 0 in GLSL, which
 *         is `mix(base, black, 0)` = base — invisible to every test that is
 *         not a picture. That is leg 2, forced onto the fragment arm with
 *         `?surfacegl`.
 *   (iii) THE MIX MOVES ONLY THE ECHO — L4 with no echo present, and S
 *         inside a balloon frame, where a mix wired to the wrong bit would
 *         still have somewhere to leak.
 *
 * WHAT EACH LEG COMPARES. Every leg is two full page loads of two `#v1=`
 * DOCUMENTS that differ ONLY in the tint pair, each driven into Surface
 * FROM THE UI and captured on the fr-opgk settle latch:
 *
 *   L1 tint reaches compute   balloon ON,  #00ff88 @1.0  vs  NO tint fields
 *   L2 tint reaches webgl     balloon ON,  #00ff88 @1.0  vs  NO tint fields
 *   L3 strength 0 identity    balloon ON,  #00ff88 @0.0  vs  NO tint fields
 *   L4 echo-off inert         balloon OFF, #00ff88 @1.0  vs  NO tint fields
 *   L5 tint reaches 4D        L1's pair on the 4D system — `core:"affine4"`
 *                             through the SAME shared shade entry, which is
 *                             why fr-j85n's 4D half was one emission and
 *                             not a lift, and why it is shown rather than
 *                             argued
 *   L6 tint reaches webgl-4D  L2's pair one dimension up —
 *                             `surface-material-4d.ts` declares its own
 *                             `uBalloonTint` pair inside its own balloon
 *                             arm, so it is a SECOND program that can
 *                             silently fail to resolve them, and (ii)
 *                             without it would be a 3D-only claim
 *   P / P4 precondition       balloon ON vs balloon OFF, both untinted
 *   S  shell gate             L1's own pair, restricted to the pixels the
 *                             balloon itself never changed
 *
 * THE TINT IS AUTHORED IN THE DOCUMENT, not dialled through the panel: one
 * hop exercises persist -> state -> scene -> packer/uniform, and there is
 * no event-dispatch to mistake for an effect. The UNTINTED side of every
 * leg carries NO `balloonTint`/`balloonTintStrength` AT ALL — it is
 * literally a pre-fr-j85n document decoding through the absent-field path,
 * which is what makes L3's `maxDelta === 0` the measured form of "absent
 * means classic" rather than an assertion about `mix(x, y, 0)`.
 *
 * TWO MEASUREMENT RULES INHERITED FROM THE SIBLING GATE, both of which cost
 * it a wrong number before they were written down — and rule 2 cost this
 * file one too, in the opposite direction, which is why its table is
 * measured rather than reasoned:
 *
 * 1. COMPARE THE SCENE, NOT THE PANEL. `#panel` is painted OVER the canvas,
 *    so an ELEMENT screenshot of the canvas contains it — and here the
 *    panel is GUARANTEED to differ between the two sides of every leg: the
 *    Surface section's own tint row shows the swatch (#00ff88 vs #000000)
 *    and the strength readout (100% vs 0%) the document carries. A
 *    full-frame identity claim would be measuring the colour picker. Every
 *    comparison below is therefore of the SCENE REGION — the canvas left of
 *    `#panel`, derived from the live DOM — and `#help` / `#legend`, the two
 *    static overlays that also sit over the canvas, are hidden before every
 *    capture so the region is the render and nothing else.
 * 2. PUT THE ECHO ON SCREEN FIRST — AND MEASURE HOW MUCH OF IT IS THERE.
 *    The inversion sends the attractor's shell to radius `R²/r ≥ rMult²·r`,
 *    so a large rMult pushes the echo away from the framed view; the
 *    sibling gate drives its own slider down for the same reason. MEASURED
 *    at this pose through `--radius`, the re-measurement knob below:
 *
 *      rMult   P (balloon on vs off)      L1 (the tint's own effect)
 *      0.50    29.041%  meanAbs 13.174    26.802%  meanAbs 18.529  max 206
 *      1.60    11.151%  meanAbs  1.288     4.670%  meanAbs  0.279  max  26
 *
 *    So the document's own 1.60x does not HIDE the echo here, it FLATTENS
 *    it — the run at 1.60x passes every claim too, on a tint signal 66x
 *    weaker in the mean and 8x weaker at the peak. That is close enough to
 *    the floor that a future regression could shrink it to nothing without
 *    ever failing, which is the whole argument for BALLOON_RADIUS = 0.50x,
 *    where the echo is a fifth of the frame. Phase P asserts it is in frame
 *    before any tint claim is read, whatever radius a run is given.
 *
 * THE RASTER IS DELIBERATELY TINY, and that is a measurement too. The
 * balloon's union DE is worth two orders of magnitude on this stack —
 * MEASURED on SwiftShader compute, full raster: this system settles in 112s
 * at 720x400 with the balloon OFF, and with it ON reaches 0.3% of one
 * settle in 180s at 1024x640 (~2.3x the rays, so ~200x the per-ray cost).
 * A ray that misses the shell still marches to fr-5wlv's far cap through a
 * region where the inverted query sits near the ball centre and the
 * estimate is tiny. So the gate shrinks the RAY COUNT rather than the
 * claim: `deviceScaleFactor` 0.12 traces a ~108x67 buffer inside a full
 * desktop layout (the CSS viewport stays past `MOBILE_BREAKPOINT`, so the
 * mode buttons are where a user's are). Both engines take the same lever,
 * both sides of every leg take the same raster, and a colour claim does not
 * need resolution — a misaligned uniform is wrong on every pixel. The
 * WebGL legs additionally pass `?surfacesamples=1` (fr-jf9y's A/B override,
 * read by the STRIP arm only — it is not a knob the compute arm has), which
 * is why the two engines' legs are not comparable to each other in cost and
 * are never compared here.
 *
 * THE CAMERA IS PINNED INTO EVERY DOCUMENT, and it is the app's OWN
 * auto-frame: the script boots each system once with no pose, reads the
 * pose back out of the Copy-link handler's `#v1=`, and writes it into every
 * document of that system. fr-opgk's latch is bit-reproducible run to run
 * ONLY for a document that pins its camera — a pose-less scene auto-frames
 * from a cloud and drifts — so without this L3 and L4 would be measuring
 * framing noise. Reading it rather than hardcoding it keeps the framing
 * honest if the system, the layout or the fit ever changes. The 4D system's
 * `fourD` rotor rides the same read, for the same reason one dimension up.
 *
 * ENGINE. `window.__surfaceState().engine` (needs `?surfacestate`) is read
 * and PRINTED for every leg. The compute legs are GATED on it whenever a
 * WebGPU adapter came up at boot, because a compute leg that silently ran
 * WebGL has covered (ii) twice and (i) never — the one outcome that would
 * make this gate worthless. With no adapter the run reports claim (i)
 * UNCOVERED and exits 1 rather than green.
 *
 * EXIT 0 = every claim held. EXIT 3 = a claim FAILED (a frame that must
 * differ did not, a frame that must be bit-identical was not, or a leg took
 * the wrong engine) — the measured numbers are printed either way. EXIT 1 =
 * the CHECKING side broke or could not pose a question: no server, no
 * browser, a leg that never settled, or no WebGPU adapter to ask (i) of. A
 * flaky environment must never read as a product verdict.
 *
 * MEASURED, this file's own successful run (SwiftShader WebGPU + ANGLE
 * SwiftShader GL, headless, CSS 900x560 at deviceScaleFactor 0.12 → 108x67
 * device px, scene region 70x67 = 4690 px, balloonRadius 0.50x):
 *
 *   P  echo on screen (3D)      29.041% changed  meanAbs 13.174  max 222
 *   L1 tint reaches compute     26.802% changed  meanAbs 18.529  max 206
 *   L2 tint reaches webgl       24.712% changed  meanAbs 18.571  max 206
 *   L3 strength-0 identity       0.000% changed  meanAbs  0.000  max 0
 *   L4 echo-off inert            0.000% changed  meanAbs  0.000  max 0
 *   S  shell gate               interior 3006 px, max 0 (raw mask 3276 px,
 *                               max 3, 4 pixels moved and all 4 of them on
 *                               the balloon's own edge — see the
 *                               instrument's own note)
 *   P4 echo on screen (4D)      19.339% changed  meanAbs 10.030  max 196
 *   L5 tint reaches compute-4D  18.337% changed  meanAbs  7.247  max 159
 *   L6 tint reaches webgl-4D    16.738% changed  meanAbs  7.337  max 183
 *
 * EVERY ONE OF THOSE FIGURES REPRODUCED TO THE LAST DIGIT across independent
 * runs of the same build, which is the pinned camera and fr-opgk's latch
 * doing exactly what they promise — worth stating, because it is what makes
 * L3's and L4's `max 0` a measurement rather than a coincidence.
 *
 * Engines, ASSERTED and not merely printed: `3d-on-plain` / `3d-on-tinted`
 * / `3d-on-zero` and the three compute 4D captures took `compute`; all four
 * `gl-` captures took `webgl`. Settles, ACROSS those runs: compute 3D
 * 118-246s, webgl 3D 95-243s, balloon-off 6-26s, compute 4D 40-73s, webgl
 * 4D 28-31s. Those spreads are the MACHINE, not the scene — the same
 * capture ran 118s and 246s on a quiet and a busy box while returning the
 * identical picture — which is the argument for reading the pixel rows and
 * ignoring the clock. They are recorded only so a later session knows what
 * "slow" looks like here before it suspects a hang.
 *
 * NOT COVERED HERE, and the reason is the environment rather than the
 * feature: every figure above is SOFTWARE — SwiftShader for WebGPU, ANGLE
 * SwiftShader for GL — because this machine's X display refuses an
 * unauthorized client, so `--display=:0` could not be exercised. The
 * kernels and the programs are genuinely run; what a real driver would add
 * is a real raster (see the cost note above) and nothing about the claims.
 */
import { chromium } from "playwright-core";

/** CSS viewport. Wider than `MOBILE_BREAKPOINT` (640) on purpose: below it
 * the panel becomes a closed drawer and `#modeSurfaceBtn` is not clickable,
 * so the layout — not the render — would decide whether this gate runs. */
const VIEWPORT = { width: 900, height: 560 };
/** The ray-count lever. `scene.ts`'s `basePixelRatio()` is
 * `min(devicePixelRatio, 2)` with no floor, so this scales the surface
 * trace buffer directly while every CSS box stays where a user's is. See
 * the header for why the raster has to be this small. */
const DEVICE_SCALE = 0.12;
/** Normalized balloon radius (multiples of the raw ball radius,
 * `buildBalloon`'s `rMult`). 0.50x rather than the document's shipped
 * 1.60x because the tint's own signal there is 66x stronger in the mean —
 * MEASURED both ways, rule 2's table in the header, reproducible with
 * `--radius`. */
const BALLOON_RADIUS = 0.5;
/** Deliberately far from anything this system's per-transform palette
 * produces, so a tinted shell cannot coincide with an untinted one. Same
 * hex as the sibling Points gate, so one colour means one thing across both
 * halves of fr-j85n. */
const TINT_HEX = "#00ff88";
/** Strength 1.0 for the difference legs: `mix(base, tint, 1)` is the tint
 * exactly, the largest signal the pair can produce. Strength 0.0 is L3's
 * claim and also the absent-field value. */
const TINT_ON = 1;
const TINT_OFF = 0;
/** A leg that must move the frame has to move MORE than the settle's own
 * run-to-run noise. There is none — a pinned-camera settle is
 * bit-reproducible (fr-opgk), and L3/L4 measure exactly 0.000% below — so
 * this is a floor against a leg that "passes" on a handful of edge pixels,
 * not a tolerance. */
const MIN_CHANGED_FRACTION = 0.01;
/** Per-leg settle budget. Generous: see the header's cost note. */
const DEFAULT_SETTLE_MS = 420_000;

/** The 3D system: `harness-profiles`' foldBoxfoldPair, the light
 * fold-frontier pair `scripts/balloon-real-driver.verify.mjs` also drives.
 * TWO boxfolds and nothing else, because `deHasFolds(de)` is what routes a
 * 3D session to the compute arm (a plain-affine 3D IFS prefers WebGL and
 * would never reach claim (i)), and because every extra map is another
 * inverse-map branch the echo's descent pays for twice. */
const SYSTEM_3D = [
  {
    position: [0.4, 0.1, 0],
    rotation: [0.3, 0.2, 0],
    scale: [0.45, 0.45, 0.45],
    variations: [{ type: "boxfold", weight: 1 }],
  },
  {
    position: [-0.35, -0.2, 0.3],
    rotation: [0, 0.5, 0.1],
    scale: [0.5, 0.5, 0.5],
    variations: [{ type: "boxfold", weight: 0.9 }],
  },
];

/** The 4D system: the transforms of `surface-4d-lift.verify.mjs`'s
 * `ifs4balloon` scene — fr-qxxw's own balloon fixture — DECODED from that
 * file's `#v1=` payload rather than retyped, so the two gates are asking
 * about the same object. A 4D session prefers compute at any symmetry order
 * (fr-fniy), and `deHasFolds4` is false here, so this leg lands on
 * `core:"affine4"`: the same shared shade entry and the same `ShadeParams`
 * tail as the 3D cores, which is exactly why fr-j85n's 4D half was one
 * emission rather than a lift — and why it still has to be SHOWN drawing. */
const SYSTEM_4D = [
  {
    position: [0.5, 0.5, 0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    w: { position: 0.3, rotation: { xw: 0.4 } },
  },
  {
    position: [-0.5, 0.5, -0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  },
  {
    position: [0.5, -0.5, -0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    w: { rotation: { yw: 0.25 } },
  },
  {
    position: [-0.5, -0.5, 0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  },
];

/** `persist.ts`'s encoder, the way `balloon-real-driver.verify.mjs` writes
 * scenes: a plain object through `JSON.stringify` + base64url. Far better
 * than pasting a base64 blob — the tint fields are readable in the diff,
 * and nothing here can be a hand-edited payload. */
const enc = (scene) =>
  "#v1=" + Buffer.from(JSON.stringify(scene)).toString("base64url");

/**
 * One scene document. `tint === null` writes NO `balloonTint` and NO
 * `balloonTintStrength` at all — the pre-fr-j85n document every leg's
 * baseline is (see the header). `pose` carries the camera (and, for the 4D
 * system, the rotor/slice) read off the app's own share link.
 */
function sceneDoc({ system, balloon, tint, strength, pose, radius }) {
  const doc = {
    transforms: system,
    numPoints: 100000,
    pointSize: 1,
    colorMode: "transform",
    renderStyle: "depthFade",
    showGuides: false,
    balloonEcho: balloon,
    balloonRadius: radius,
  };
  if (tint !== null) {
    doc.balloonTint = tint;
    doc.balloonTintStrength = strength;
  }
  if (pose?.camera) doc.camera = pose.camera;
  if (pose?.fourD) doc.fourD = pose.fourD;
  return doc;
}

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: DEFAULT_SETTLE_MS,
    only: null,
    // `--radius=` is rule 2's re-measurement knob, not a tuning dial: it is
    // how a later session reproduces "the echo is off screen at 1.60x and
    // in frame at 0.50x" instead of taking this file's word for it. The
    // gate's own verdict is only ever read at BALLOON_RADIUS.
    radius: BALLOON_RADIUS,
  };
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument: ${raw}`);
    const [, key, value] = m;
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "only" && value) out.only = value;
    else if (key === "radius" && value) out.radius = Number(value);
    else throw new Error(`Unknown argument: ${raw}`);
  }
  if (out.only !== null && out.only !== "3d" && out.only !== "4d") {
    throw new Error(`--only takes 3d or 4d, not ${out.only}`);
  }
  if (!Number.isFinite(out.radius) || out.radius <= 0) {
    throw new Error(`--radius takes a positive number, not ${out.radius}`);
  }
  return out;
}

/** A failure of the CHECKING side (no server, no settle, no adapter) as
 * against a failure of the CLAIM — the two exits this gate keeps apart. */
class HarnessError extends Error {}

const log = (line) => process.stdout.write(`[balloon-tint] ${line}\n`);

/**
 * Chrome flags. The default is the SwiftShader recipe that exposes a real
 * WebGPU adapter headlessly on this stack — `navigator.gpu` is absent on
 * `about:blank`, so the probe below only means anything once the page is on
 * the (secure) preview origin. `--display=:0` drops the SwiftShader forcing
 * and runs headed against whatever driver the display has, which is the
 * mode that answers the engine question on real hardware.
 */
function launchOptions(display) {
  const env = { ...process.env };
  if (display === undefined) {
    delete env.DISPLAY;
    return {
      env,
      headless: true,
      args: [
        "--no-sandbox",
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-vulkan-surface",
      ],
    };
  }
  env.DISPLAY = display;
  return {
    env,
    headless: false,
    args: [
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
    ],
  };
}

/**
 * Load one document. The query is unique per capture because a URL that
 * differs only in its FRAGMENT does not reload, and this app reads the
 * scene hash exactly once, at boot — the trap `surface-4d-lift.verify.mjs`
 * documents having fallen into (three documents, three identical frames).
 */
async function openScene(page, { url, tag, hash, gl }) {
  const query = gl
    ? `?surfacestate&surfacegl&surfacesamples=1&leg=${tag}`
    : `?surfacestate&leg=${tag}`;
  await page.goto(`${url}/${query}${hash}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    undefined,
    { timeout: 60_000 },
  );
}

/** Does this page have a live WebGPU adapter? Asked ON THE APP ORIGIN, for
 * the reason in the header. */
async function probeAdapter(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return { gpu: false, adapter: false, vendor: null };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return {
        gpu: true,
        adapter: adapter !== null,
        vendor: adapter?.info?.vendor ?? null,
        architecture: adapter?.info?.architecture ?? null,
      };
    } catch {
      return { gpu: true, adapter: false, vendor: null };
    }
  });
}

/** The pose the app itself framed this system with, read out of the Copy-link
 * handler's `#v1=` rather than the camera object — the handler is the one
 * place that decides what a shared document carries.
 *
 * Waits out the boot first: the synchronous boot cloud auto-frames instantly
 * and the async density upgrade can re-fit behind it, so a pose read at
 * `load` is a pose the app may still be moving away from. It only has to be
 * a GOOD framing once — every leg then shares whatever this returns — but a
 * half-fitted one would frame the legs badly for the whole run. */
async function readPose(page) {
  await page.waitForFunction(
    () =>
      Number(
        (document.getElementById("pointCount")?.textContent ?? "").replace(
          /[^\d]/g,
          "",
        ),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2500);
  const link = await page.evaluate(async () => {
    delete window.__balloonTintLink;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__balloonTintLink = text;
        },
      },
    });
    document.getElementById("shareSection").open = true;
    document.getElementById("copyLinkBtn").click();
    return new Promise((resolve) =>
      setTimeout(() => resolve(window.__balloonTintLink ?? null), 750),
    );
  });
  if (typeof link !== "string" || !link.includes("#v1=")) {
    throw new HarnessError("copy-link produced no #v1= document");
  }
  const decoded = JSON.parse(
    Buffer.from(link.split("#v1=")[1], "base64url").toString("utf8"),
  );
  if (!decoded.camera) {
    throw new HarnessError("the app's own share link carried no camera pose");
  }
  return { camera: decoded.camera, fourD: decoded.fourD };
}

/**
 * Enter Surface FROM THE UI and wait for a COMPLETED settle — fr-opgk's
 * latch, not "the pixels stopped changing", which strip pacing and the
 * compute arm's measured pass sizing both make a lie, and not the progress
 * row, which hides at both ends.
 */
async function enterAndSettle(page, timeoutMs) {
  const started = Date.now();
  await page.click("#modeSurfaceBtn");
  let state = null;
  let entered = false;
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (state && state.mode !== "surface") break;
    if (state && state.firstFrame) entered = true;
    if (state && state.settled) break;
    await page.waitForTimeout(250);
  }
  return {
    entered,
    settled: Boolean(state?.settled),
    engine: state?.engine ?? null,
    ms: Date.now() - started,
  };
}

/**
 * A settled frame, captured twice byte-identically. The latch says a
 * completed frame EXISTS; this says the compositor has finished putting it
 * on screen, so an identity claim cannot fail on a half-presented capture.
 * `#help` and `#legend` go first: both are painted over the canvas and both
 * would ride into the scene region (see rule 1 in the header).
 */
async function settledShot(page, tag) {
  await page.evaluate(() => {
    for (const id of ["help", "legend"]) {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }
  });
  let previous = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const shot = await page
      .locator("#container canvas")
      .first()
      .screenshot({ type: "png" });
    if (previous && previous.equals(shot)) return shot;
    previous = shot;
    await page.waitForTimeout(250);
  }
  throw new HarnessError(`${tag}: the settled canvas never held still`);
}

/**
 * Difference between two captures over the SCENE REGION — the canvas left
 * of `#panel`, in IMAGE pixels, derived from the live DOM rather than
 * hardcoded. One routine, one definition of "changed" (a channel delta of 3
 * or more), one place to read the arithmetic. See rule 1 in the header for
 * why nothing here compares whole frames.
 */
async function sceneDiff(page, aPng, bPng) {
  return page.evaluate(
    async ({ a64, b64 }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [a, b] = await Promise.all([bitmap(a64), bitmap(b64)]);
      if (a.width !== b.width || a.height !== b.height) {
        return { changedFraction: 1, meanAbs: 255, maxDelta: 255, pixels: 0 };
      }
      let width = a.width;
      const canvas = document.querySelector("#container canvas");
      const panel = document.getElementById("panel");
      const canvasRect = canvas?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      if (canvasRect?.width && panelRect?.width) {
        const scale = a.width / canvasRect.width;
        // 2 device px of margin so a panel shadow or rounded corner can
        // never leak into the render's half of the frame.
        const edge = (panelRect.left - canvasRect.left) * scale - 2;
        if (edge > 0 && edge < width) width = Math.floor(edge);
      }
      const pixelsOf = (image) => {
        const off = document.createElement("canvas");
        off.width = width;
        off.height = image.height;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, image.height).data;
      };
      const pa = pixelsOf(a);
      const pb = pixelsOf(b);
      let changed = 0;
      let sum = 0;
      let maxDelta = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const dr = Math.abs(pa[i] - pb[i]);
        const dg = Math.abs(pa[i + 1] - pb[i + 1]);
        const db = Math.abs(pa[i + 2] - pb[i + 2]);
        const delta = Math.max(dr, dg, db);
        if (delta >= 3) changed++;
        sum += dr + dg + db;
        maxDelta = Math.max(maxDelta, delta);
      }
      const count = pa.length / 4;
      return {
        changedFraction: changed / count,
        meanAbs: sum / (count * 3),
        maxDelta,
        pixels: count,
        width,
        height: a.height,
      };
    },
    { a64: aPng.toString("base64"), b64: bPng.toString("base64") },
  );
}

/**
 * The shell-gate instrument (claim (iii), measured INSIDE a balloon frame
 * rather than beside one — L4 asks the same question with no echo present,
 * which a mix wired to the wrong bit would also pass).
 *
 * `maskA`/`maskB` are the untinted balloon-ON and balloon-OFF captures.
 * Where those agree, the balloon changed nothing, so the pixel is a
 * fractal-term hit or backdrop and `hi.shell` — a hard 1.0/0.0, ties to the
 * fractal — must leave it at ANY strength. The tint's delta over exactly
 * those pixels is then the sharpest reading available of "the mix is
 * gated", and it costs no extra capture.
 *
 * THE MASK HAS TO BE ERODED, and finding out why is the measurement. The
 * raw mask is byte-equality of an EIGHT-SAMPLE AVERAGE (fr-vpbq): a pixel
 * whose subsamples straddle the shell's edge can average to the same bytes
 * with the balloon off and still carry one tinted subsample, worth ~1/8 of
 * the tint's own step. MEASURED on the first run of this gate: of 3276 raw
 * mask pixels exactly FOUR moved (three by 1, one by 3, against the tint's
 * own max of 206 elsewhere in the same frame), and ALL FOUR were adjacent
 * to a pixel the balloon did change — 4 of 4, which is the signature of an
 * edge artefact and not of a leak, whose pixels would be interior and would
 * move by tens. Requiring the pixel AND its eight neighbours to be
 * balloon-unchanged drops 270 boundary pixels and takes the maximum to
 * EXACTLY 0 over the remaining 3006. So `interiorMax` is the gated number
 * and `rawMax`/`rawAdjacent` are reported beside it as the evidence for
 * that choice — a later session can see the artefact rather than wonder
 * whether the erosion is hiding something.
 */
async function shellGateDelta(page, { base, tinted, maskA, maskB }) {
  return page.evaluate(
    async ({ base64, tint64, maskA64, maskB64 }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const images = await Promise.all(
        [base64, tint64, maskA64, maskB64].map(bitmap),
      );
      let width = images[0].width;
      const canvas = document.querySelector("#container canvas");
      const panel = document.getElementById("panel");
      const canvasRect = canvas?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      if (canvasRect?.width && panelRect?.width) {
        const scale = images[0].width / canvasRect.width;
        const edge = (panelRect.left - canvasRect.left) * scale - 2;
        if (edge > 0 && edge < width) width = Math.floor(edge);
      }
      const height = images[0].height;
      const pixelsOf = (image) => {
        const off = document.createElement("canvas");
        off.width = width;
        off.height = height;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, height).data;
      };
      const [pb, pt, pa1, pa2] = images.map(pixelsOf);
      const unchanged = new Uint8Array(width * height);
      for (let p = 0; p < unchanged.length; p++) {
        const i = p * 4;
        unchanged[p] =
          pa1[i] === pa2[i] &&
          pa1[i + 1] === pa2[i + 1] &&
          pa1[i + 2] === pa2[i + 2]
            ? 1
            : 0;
      }
      const tintDelta = (p) => {
        const i = p * 4;
        return Math.max(
          Math.abs(pb[i] - pt[i]),
          Math.abs(pb[i + 1] - pt[i + 1]),
          Math.abs(pb[i + 2] - pt[i + 2]),
        );
      };
      let rawCount = 0;
      let rawMax = 0;
      let rawMoved = 0;
      let rawAdjacent = 0;
      let interiorCount = 0;
      let interiorMax = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = y * width + x;
          if (!unchanged[p]) continue;
          const delta = tintDelta(p);
          rawCount++;
          rawMax = Math.max(rawMax, delta);
          let interior = true;
          for (let dy = -1; dy <= 1 && interior; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (!unchanged[ny * width + nx]) {
                interior = false;
                break;
              }
            }
          }
          if (delta > 0) {
            rawMoved++;
            if (!interior) rawAdjacent++;
          }
          if (interior) {
            interiorCount++;
            interiorMax = Math.max(interiorMax, delta);
          }
        }
      }
      return {
        pixels: width * height,
        rawCount,
        rawMax,
        rawMoved,
        rawAdjacent,
        interiorCount,
        interiorMax,
      };
    },
    {
      base64: base.toString("base64"),
      tint64: tinted.toString("base64"),
      maskA64: maskA.toString("base64"),
      maskB64: maskB.toString("base64"),
    },
  );
}

function reportDiff(name, diff) {
  log(
    `${name.padEnd(26)} changed=${(100 * diff.changedFraction).toFixed(3)}% ` +
      `meanAbs=${diff.meanAbs.toFixed(3)} max=${diff.maxDelta} ` +
      `over ${diff.width}x${diff.height}=${diff.pixels}px`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { env, headless, args: flags } = launchOptions(args.display);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless,
    args: flags,
    env,
  });

  const failures = [];
  const uncovered = [];
  const fail = (line) => {
    failures.push(line);
    log(`FAIL ${line}`);
  };

  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
      // Auto-orbit and the 4D auto-tumble both follow this at boot, and a
      // rotor that advanced for a different number of frames between two
      // loads would make the 4D leg's two documents render different
      // objects. Surface mode's early return freezes the motion tick
      // anyway; this makes the pre-entry gap deterministic too.
      reducedMotion: "reduce",
    });
    page.on("pageerror", (e) => log(`page:uncaught ${e.message}`));

    /** Capture one document's settled scene, or throw a HarnessError. */
    const capture = async ({
      tag,
      system,
      balloon,
      tint,
      strength,
      pose,
      gl,
    }) => {
      const hash = enc(
        sceneDoc({
          system,
          balloon,
          tint,
          strength,
          pose,
          radius: args.radius,
        }),
      );
      await openScene(page, { url: args.url, tag, hash, gl });
      const state = await enterAndSettle(page, args.settleMs);
      if (!state.entered || !state.settled) {
        throw new HarnessError(
          `${tag}: entered=${state.entered} settled=${state.settled} ` +
            `engine=${state.engine} after ${(state.ms / 1000).toFixed(0)}s`,
        );
      }
      const png = await settledShot(page, tag);
      log(
        `capture ${tag.padEnd(18)} engine=${String(state.engine).padEnd(8)} ` +
          `settle=${(state.ms / 1000).toFixed(0)}s`,
      );
      return { png, engine: state.engine };
    };

    // ---- the adapter question, asked on the app origin -------------------
    const poseProbeHash = enc(
      sceneDoc({
        system: SYSTEM_3D,
        balloon: true,
        tint: null,
        strength: 0,
        pose: null,
        radius: args.radius,
      }),
    );
    await openScene(page, {
      url: args.url,
      tag: "pose3d",
      hash: poseProbeHash,
      gl: false,
    });
    const adapter = await probeAdapter(page);
    log(
      `adapter gpu=${adapter.gpu} adapter=${adapter.adapter} ` +
        `vendor=${adapter.vendor ?? "n/a"} arch=${adapter.architecture ?? "n/a"}`,
    );
    if (!adapter.adapter) {
      log(
        "NOTE  no WebGPU adapter on this stack — claim (i) (the WGSL " +
          "shader reads the tint where the host wrote it) CANNOT be asked " +
          "here, and the compute legs below will report webgl.",
      );
      uncovered.push("claim (i): no WebGPU adapter");
    } else if (adapter.architecture === "swiftshader") {
      log(
        "NOTE  the adapter is SwiftShader, not a real driver: the kernels " +
          "are genuinely exercised, the timings mean nothing.",
      );
    }
    const pose3d = await readPose(page);
    log(`pose3d ${JSON.stringify(pose3d.camera)}`);

    const run3d = args.only !== "4d";
    const run4d = args.only !== "3d";

    // ---- 3D -------------------------------------------------------------
    if (run3d) {
      const base = {
        system: SYSTEM_3D,
        pose: pose3d,
        strength: TINT_OFF,
        gl: false,
      };
      // The four 3D captures. `tint: null` writes no tint fields at all.
      const onPlain = await capture({
        ...base,
        tag: "3d-on-plain",
        balloon: true,
        tint: null,
      });
      const onTinted = await capture({
        ...base,
        tag: "3d-on-tinted",
        balloon: true,
        tint: TINT_HEX,
        strength: TINT_ON,
      });
      const onZero = await capture({
        ...base,
        tag: "3d-on-zero",
        balloon: true,
        tint: TINT_HEX,
        strength: TINT_OFF,
      });
      const offPlain = await capture({
        ...base,
        tag: "3d-off-plain",
        balloon: false,
        tint: null,
      });
      const offTinted = await capture({
        ...base,
        tag: "3d-off-tinted",
        balloon: false,
        tint: TINT_HEX,
        strength: TINT_ON,
      });

      const wantCompute = adapter.adapter;
      for (const [tag, cap] of [
        ["3d-on-plain", onPlain],
        ["3d-on-tinted", onTinted],
        ["3d-on-zero", onZero],
      ]) {
        if (wantCompute && cap.engine !== "compute") {
          fail(
            `${tag} took engine=${cap.engine}, not compute — claim (i) was ` +
              `NOT exercised by this leg`,
          );
        }
      }

      // P: the precondition. Nothing below means anything if the echo is
      // not on screen (rule 2 in the header).
      const precondition = await sceneDiff(page, onPlain.png, offPlain.png);
      reportDiff("P  echo on screen (3D)", precondition);
      if (precondition.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `the balloon echo contributes ${(100 * precondition.changedFraction).toFixed(3)}% ` +
            `of scene pixels at radius ${args.radius}x — there is nothing ` +
            `on screen for a tint to colour, so no tint claim below is ` +
            `meaningful. Move BALLOON_RADIUS, do not relax this.`,
        );
      }

      // L1 / claim (i): the WGSL shader reads the tint the packer wrote.
      const l1 = await sceneDiff(page, onTinted.png, onPlain.png);
      reportDiff("L1 tint reaches compute", l1);
      if (l1.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `L1: an authored tint of ${TINT_HEX} at strength ${TINT_ON} moved ` +
            `${(100 * l1.changedFraction).toFixed(3)}% of scene pixels on the ` +
            `${onTinted.engine} engine — the shader is not reading what the ` +
            `packer wrote`,
        );
      }

      // L3 / claim B: strength 0 is the pre-fr-j85n frame, byte for byte.
      const l3 = await sceneDiff(page, onZero.png, onPlain.png);
      reportDiff("L3 strength-0 identity", l3);
      if (l3.maxDelta !== 0) {
        fail(
          `L3: an authored tint at strength 0 moved the frame (max delta ` +
            `${l3.maxDelta}, ${(100 * l3.changedFraction).toFixed(3)}% of ` +
            `scene pixels). "Absent means classic" is broken — this is a ` +
            `product bug, not a threshold to widen.`,
        );
      }

      // L4 / claim (iii), the beside-the-frame half: with no echo, the
      // control is inert.
      const l4 = await sceneDiff(page, offTinted.png, offPlain.png);
      reportDiff("L4 echo-off inert", l4);
      if (l4.maxDelta !== 0) {
        fail(
          `L4: with the balloon OFF the tint still moved the frame (max ` +
            `delta ${l4.maxDelta}) — the mix is reaching something that is ` +
            `not the echo`,
        );
      }

      // S / claim (iii) measured inside a balloon frame — see the
      // instrument's doc comment for why the gated number is the eroded
      // one and the raw pair is printed beside it.
      const shell = await shellGateDelta(page, {
        base: onPlain.png,
        tinted: onTinted.png,
        maskA: onPlain.png,
        maskB: offPlain.png,
      });
      log(
        `S  shell gate              interior=${shell.interiorCount}px max=${shell.interiorMax} ` +
          `(raw mask ${shell.rawCount}px max=${shell.rawMax}, ` +
          `${shell.rawMoved} moved of which ${shell.rawAdjacent} sit on the ` +
          `balloon's own edge)`,
      );
      if (shell.interiorCount > 0 && shell.interiorMax !== 0) {
        fail(
          `S: the tint moved ${shell.interiorMax} on pixels INTERIOR to the ` +
            `region the balloon itself never changed — those are ` +
            `fractal-term or backdrop pixels, no supersample of them saw the ` +
            `shell, and the mix must be gated off them by hi.shell`,
        );
      }
      if (shell.interiorCount === 0) {
        log(
          "NOTE  the balloon repainted every scene pixel at this pose, so S " +
            "had nothing to measure — claim (iii) rests on L4 alone here.",
        );
      }

      // L2 / claim (ii): the same document pair through the GLSL arm.
      const glPlain = await capture({
        ...base,
        tag: "gl-on-plain",
        balloon: true,
        tint: null,
        gl: true,
      });
      const glTinted = await capture({
        ...base,
        tag: "gl-on-tinted",
        balloon: true,
        tint: TINT_HEX,
        strength: TINT_ON,
        gl: true,
      });
      for (const [tag, cap] of [
        ["gl-on-plain", glPlain],
        ["gl-on-tinted", glTinted],
      ]) {
        if (cap.engine !== "webgl") {
          fail(`${tag} took engine=${cap.engine} under ?surfacegl, not webgl`);
        }
      }
      const l2 = await sceneDiff(page, glTinted.png, glPlain.png);
      reportDiff("L2 tint reaches webgl", l2);
      if (l2.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `L2: the authored tint moved ${(100 * l2.changedFraction).toFixed(3)}% ` +
            `of scene pixels on the fragment arm — uBalloonTint / ` +
            `uBalloonTintStrength are not reaching the compiled program`,
        );
      }
    }

    // ---- 4D (dimensional parity — the shade entry is shared, and this is
    // where that gets SHOWN rather than argued) --------------------------
    if (run4d) {
      const poseProbe4 = enc(
        sceneDoc({
          system: SYSTEM_4D,
          balloon: true,
          tint: null,
          strength: 0,
          pose: null,
          radius: args.radius,
        }),
      );
      await openScene(page, {
        url: args.url,
        tag: "pose4d",
        hash: poseProbe4,
        gl: false,
      });
      const pose4d = await readPose(page);
      log(
        `pose4d ${JSON.stringify(pose4d.camera)} fourD=${JSON.stringify(pose4d.fourD ?? null)}`,
      );
      const base4 = {
        system: SYSTEM_4D,
        pose: pose4d,
        strength: TINT_OFF,
        gl: false,
      };
      const on4Plain = await capture({
        ...base4,
        tag: "4d-on-plain",
        balloon: true,
        tint: null,
      });
      const off4Plain = await capture({
        ...base4,
        tag: "4d-off-plain",
        balloon: false,
        tint: null,
      });
      const on4Tinted = await capture({
        ...base4,
        tag: "4d-on-tinted",
        balloon: true,
        tint: TINT_HEX,
        strength: TINT_ON,
      });
      if (adapter.adapter) {
        for (const [tag, cap] of [
          ["4d-on-plain", on4Plain],
          ["4d-on-tinted", on4Tinted],
        ]) {
          if (cap.engine !== "compute") {
            fail(`${tag} took engine=${cap.engine}, not compute`);
          }
        }
      }
      const p4 = await sceneDiff(page, on4Plain.png, off4Plain.png);
      reportDiff("P4 echo on screen (4D)", p4);
      if (p4.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `the 4D balloon echo contributes ${(100 * p4.changedFraction).toFixed(3)}% ` +
            `of scene pixels — the 4D tint leg below has nothing to colour`,
        );
      }
      const l5 = await sceneDiff(page, on4Tinted.png, on4Plain.png);
      reportDiff("L5 tint reaches compute-4D", l5);
      if (l5.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `L5: the authored tint moved ${(100 * l5.changedFraction).toFixed(3)}% ` +
            `of scene pixels on the 4D compute core — fr-j85n's 4D half is ` +
            `supposed to be the same shade entry, and it is not drawing`,
        );
      }

      // L6: claim (ii) one dimension up. `surface-material-4d.ts` declares
      // its OWN `uBalloonTint`/`uBalloonTintStrength` inside its own
      // balloon arm and packs them through the SHARED
      // `packSurfaceBalloonTint` — a second program, a second uniform
      // resolution, and therefore a second thing that can silently fail to
      // link. This system is plain-affine, so `?surfacegl` genuinely
      // reaches the 4D fragment tracer (a fold-shaped 4D session is
      // compute-only by fr-rsp6 and could not be asked here at all).
      const gl4Plain = await capture({
        ...base4,
        tag: "gl4-on-plain",
        balloon: true,
        tint: null,
        gl: true,
      });
      const gl4Tinted = await capture({
        ...base4,
        tag: "gl4-on-tinted",
        balloon: true,
        tint: TINT_HEX,
        strength: TINT_ON,
        gl: true,
      });
      for (const [tag, cap] of [
        ["gl4-on-plain", gl4Plain],
        ["gl4-on-tinted", gl4Tinted],
      ]) {
        if (cap.engine !== "webgl") {
          fail(`${tag} took engine=${cap.engine} under ?surfacegl, not webgl`);
        }
      }
      const l6 = await sceneDiff(page, gl4Tinted.png, gl4Plain.png);
      reportDiff("L6 tint reaches webgl-4D", l6);
      if (l6.changedFraction < MIN_CHANGED_FRACTION) {
        fail(
          `L6: the authored tint moved ${(100 * l6.changedFraction).toFixed(3)}% ` +
            `of scene pixels on the 4D fragment arm — surface-material-4d's ` +
            `own uBalloonTint / uBalloonTintStrength are not reaching its ` +
            `compiled program`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    log(`RESULT ${failures.length} claim(s) FAILED`);
    for (const line of failures) log(`  - ${line}`);
    process.exit(3);
  }
  if (uncovered.length > 0) {
    log(`RESULT claims held, but this environment could not ask them all:`);
    for (const line of uncovered) log(`  - ${line}`);
    process.exit(1);
  }
  log("RESULT every claim held");
  process.exit(0);
}

main().catch((e) => {
  const harness = e instanceof HarnessError;
  process.stderr.write(
    `[balloon-tint] ${harness ? "CHECKING SIDE BROKE" : "ERROR"}: ` +
      `${e instanceof Error ? (harness ? e.message : e.stack) : String(e)}\n`,
  );
  process.exit(1);
});
