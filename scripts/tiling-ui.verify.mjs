#!/usr/bin/env node
/**
 * Space-tiling AUTHORING, PRESET, POINTS, AND FLAME gate. This drives the production
 * app through the same panel controls and preset menu a person uses; it does
 * not construct a tiling block by editing the document hash.
 *
 * The five showcase presets are loaded FROM `#presetSelect`. Each must write
 * its authored finite group (B3, A4, F4) or mirrored-lattice scale (3D/4D),
 * enter Surface unaided through its
 * saved renderer hint, reach the requested completed rendering stage, draw a
 * non-backdrop share in a real canvas screenshot, and retain the group in the
 * persisted `#v1=` document. The gate then clears ONLY the tiling block through
 * its live checkbox, renders the same transforms at the preserved camera, and
 * requires a structural scene-region difference. That paired negative control
 * proves each showcase is visibly tiled rather than merely drawn with a dead
 * persisted block. At the default stage (8) the app's own settled
 * latch must hold; stages 1..7 are explicit quicker diagnostic runs that stop
 * only after that many full-detail antialiasing passes have completed. On a
 * real X11 display the natural production routing is also gated: the flat B3
 * showcase uses WebGL and the two genuinely 4D showcases use compute. The
 * SwiftShader run reports its engine but does not turn adapter availability
 * into a routing verdict.
 *
 * A same-page replacement walks finite -> lattice -> finite -> ordinary and
 * requires each arm to replace, rather than merge with, the prior block. The
 * authoring leg then proves the panel contract independently of the presets:
 *
 * - Space enables the finite block, ArrowDown changes the chamber group, and
 *   ArrowDown in the independent clip picker adds a bundled analytic content
 *   clip without changing that chamber;
 * - every checkbox/select has an unclipped 44x44 CSS-pixel activation target;
 *   the exact lattice numeric companion is keyboard-driven here while the
 *   phone-sized 44px/touch contract stays owned by the numeric-control gate;
 * - Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z restore the exact group-only and
 *   group-plus-clip tiling objects, and the app's own copied share link keeps
 *   the latter object exactly; the lattice copied link then re-enters Surface,
 *   exposes progress, settles, and draws on its natural production route;
 * - the kind selector replaces finite with lattice while retaining only the
 *   shared clip, ArrowRight edits the exact lattice cell scale, and the return
 *   to finite clears the lattice discriminator/scale;
 * - 3D lattice and 4D finite Points fixtures create and reply through the real
 *   cloud Worker, survive an app-copied link, land an active `complete`
 *   result, draw foreground, and differ from a same-view disabled result;
 * - the 3D Points fixture covers Auto-update-off/manual regeneration and a
 *   rapid superseding edit: the older reply must stay labeled stale and the
 *   final reply must match the latest authored tiling; the 4D fixture changes
 *   tumble/slice view state and pixels without posting another cloud request;
 * - 3D lattice and 4D finite Flame fixtures start a real worker from an
 *   app-copied document, run the active GPU tiling kernel (accepting a clearly
 *   disclosed software adapter), finish and draw, differ from the same-seed
 *   Off render, and keep only the latest of a rapid pair of 3D edits; the 4D
 *   fixture changes its settled rotor/slice in the same worker;
 * - 3D Solid applies tiling in its live material, while 4D Solid replaces
 *   the worker for authored tiling edits and bakes raw images into density
 *   before projection;
 * - Balloon and order>1 Symmetry leave the authored checkbox available as a
 *   clear route while disabling both dependent finite detail controls and
 *   explaining the refusal next to them.
 *
 * Screenshots are read only after Playwright captures the canvas. The live
 * WebGL canvas is never read outside its renderer's animation frame. Overlay
 * elements are hidden before capture, and the downsampled image is compared
 * with its own four corners to estimate non-backdrop coverage.
 *
 * This gate deliberately does NOT compare the five presets with each other,
 * certify the fold algebra (the CPU/kernel tests and renderer gates own that),
 * force a costly near-empty/underfilled Points carrier (the deterministic
 * point-tiling, worker and UI tests own those terminal states), exercise
 * imported/custom clips, or test phone layout (the panel must be open at a
 * viewport wider than the 640px breakpoint).
 *
 * MEASURED 2026-08-31 on verified Mesa Intel Iris Xe, settled 8/8 at 800x640:
 * B3 routed WebGL and drew/differed from untiled by 40.22%/6.62%; A4 compute
 * 40.18%/5.23%; F4 compute 38.99%/8.39%; lattice-3D WebGL 46.85%/13.23%;
 * lattice-4D compute 37.42%/0.29% (its fixture-specific floor is 0.20%). All
 * five exposed progress before settling. Exact finite/lattice replacement,
 * the 2.4 numeric edit, both finite and lattice app-copied links, and the
 * lattice copied link's WebGL progress/settle/draw at 46.85% all passed. So
 * did three lattice-authored untiled-mode notices (the then-current
 * Points/Flame/Solid contract), Balloon/Symmetry dormancy, explicit clear
 * routes, and three malformed-block fallbacks, without page or console errors.
 *
 * MEASURED 2026-09-01 on SwiftShader with `--scope=points --settle=120000`:
 * both real cloud-Worker fixtures passed without page, console or app errors.
 * Mirrored Lattice completed in 11.0s; copied-link restore, Auto-update-off,
 * manual stale reply, rapid latest-wins reply and terminal static-Off labeling
 * all passed, and its tiled/untiled frames differed by 11.85%. Tiled Pentatope
 * completed in 14.5s; its copied link restored, all eight focused-canvas rotor
 * keys were accepted, persisted p/q and slice true/0.35 changed while Worker
 * requests/replies stayed 2->2, and its tiled/untiled frames differed by
 * 15.27% (rotor-only/view frame differences were 14.54%/13.37%).
 *
 * PRE-LIFT BASELINE MEASURED 2026-09-01 on SwiftShader with
 * `--scope=flame --settle=120000`: both 1M/1x CPU fixtures finished without
 * page, console or app errors.
 * Mirrored Lattice completed in 41.1s; the copied link restored, the worker
 * reported CPU as intentional, the retired rapid edit produced no terminal or
 * active relabel, the seed survived both the latest edit and Off, and the
 * tiled/Off frames differed by 27.75%. Tiled Pentatope completed in 35.3s;
 * the copied link restored, all eight rotor keys plus slice true/0.35 produced
 * three view commands and another terminal frame in the original worker, and
 * the posed tiled/Off frames differed by 48.41% (the view changed 21.72%).
 *
 * POST-LIFT MEASURED 2026-09-01 on verified Mesa Intel Iris Xe with
 * `--scope=flame --settle=120000`: both fixtures selected the active WebGPU
 * backend (`intel gen-12lp`) without page, console or app errors. Mirrored
 * Lattice completed in 6.6s, survived a rapid latest-wins edit, and differed
 * from the same-seed Off frame by 27.65%. Tiled Pentatope completed in 8.3s,
 * kept rotor/slice edits in the original Worker, and differed from Off by
 * 42.46% (the posed 4D view changed 19.69%).
 *
 * BACKDROP LIFT MEASURED 2026-09-01 (`--scope=backdrop --settle=120000`):
 * each fixture freezes the displayed Points cloud (Auto-update off) so a
 * tiling edit re-renders ONLY the generated backdrop between captures —
 * the frame difference is the backdrop's and nothing else's. On SwiftShader
 * the Mirrored Lattice backdrop drew 70.96% coverage and its untiled round
 * differed by 40.82%; Tiled Pentatope drew 50.52% and differed by 32.45%.
 * On verified Mesa Intel Iris Xe: 72.26% / 44.01% and 51.80% / 30.66%.
 * Both rounds in both engines ran the fixed backdrop seed (0x5f3759df)
 * through the CPU accumulator with the exact authored tiling block then
 * none, the cloud stayed frozen at 2->2 requests, and no page, console or
 * app error appeared. This is the pixel evidence the lift's acceptance
 * criteria demanded: the backdrop the pane shows is the tiled one, and a
 * tiling edit invalidates it even with Points' Auto-update off.
 *
 * SOLID LIFT MEASURED 2026-09-01 (`--scope=solid --settle=240000`): each
 * fixture drives the REAL 128³/1M voxel session to a converged budget,
 * captures the tiled frame, clears the tiling checkbox, and captures again —
 * the tiling edit is material-only (the voxel worker probe stays 1->1) and
 * the frame difference is the tiled geometry's and nothing else's. On
 * SwiftShader the Mirrored Lattice solid drew 43.93% and its untiled round
 * differed by 11.01%; Tiled Octahedron drew 47.99% and differed by 24.63%.
 * Both rounds disclosed "Active in Solid" on entry and the Off consumer list
 * after clearing, with no page, console or app error.
 *
 * SOLID4 LIFT MEASURED 2026-09-01 (`--scope=solid4 --settle=240000`): each
 * fixture enters 4D Solid on a REAL voxel worker whose start payload carries
 * the authored tiling and whose converged grid reports the hierarchy
 * present; an authored tiling edit (A4 -> B4, lattice scale 1.6 -> 1.7)
 * REPLACES the worker from the same seed (prior worker terminated true,
 * worker count +1) while settled rotor/slice endpoints stay inside the
 * replacement worker (three setFourDView commands, zero extra starts, the
 * last command's viewRevision equal to the terminal grid's); clearing the
 * checkbox replaces the worker once more, still on the entry seed, and the
 * same-seed tiled/Off frames differ structurally. On verified Mesa Intel
 * Iris Xe: Pentatope completed in 5.6s, drew 45.12%, its posed view frame
 * differed 27.54% and its untiled round 18.53%; Mirrored Lattice 4D
 * completed in 6.7s, drew 55.14%, view difference 99.99%, untiled round
 * 35.50%. On SwiftShader: 14.3s/43.14%/28.86%/19.50% and
 * 17.7s/54.09%/99.97%/35.47%. The 3D scope on the same build keeps its
 * material-only contract (worker 1->1; Iris diffs 11.11%/24.69%), the
 * intended contrast. Both solid scopes disclose the entry dimension
 * ("Active in 3D/4D Solid") and clear to the Off consumer list, with no
 * page, console or app error. Two harness corrections were made while
 * landing this leg: the view leg waits for the terminal grid of the LAST
 * view command's viewRevision — the worker may legitimately post an older
 * endpoint's converged grid in the same delivery window the newer command
 * is recorded in, and the app's revision guard drops it (probe sequence
 * alone ranked that stale reply first); and the 3D leg's note regex moved
 * to the dimension-explicit "Active in 3D Solid" this lift discloses.
 *
 * Usage (build + `npm run preview` first):
 *   node scripts/tiling-ui.verify.mjs
 *   node scripts/tiling-ui.verify.mjs --mode=x11::0
 *   node scripts/tiling-ui.verify.mjs --stage=1
 *   node scripts/tiling-ui.verify.mjs --scope=points
 *   node scripts/tiling-ui.verify.mjs --scope=flame
 *   node scripts/tiling-ui.verify.mjs --scope=backdrop
 *   node scripts/tiling-ui.verify.mjs --scope=solid
 *   node scripts/tiling-ui.verify.mjs --scope=solid4
 *
 * Options:
 *   --url=URL        app origin (default https://localhost:4173)
 *   --mode=MODE      sw (default) or x11:<display>
 *   --scope=SCOPE    all (default), points, flame, backdrop, solid, or solid4
 *   --viewport=WxH   viewport, width must be >=641 (default 800x640)
 *   --settle=MS      per-preset Surface/Points/Flame target budget (default 300000)
 *   --stage=N        completed-pass target, 8 = settled latch (default 8)
 *   --dwell=MS       settled-latch hold time at stage 8 (default 1500)
 *   --draw=FRACTION  minimum non-backdrop screenshot share (default 0.005)
 *   --diff=FRACTION  minimum tiled/untiled structural difference (default 0.01)
 *   --outdir=PATH    PNG directory (default .playwright-mcp/tiling-ui)
 *
 * Exit 0 = every preset and authoring assertion passed.
 * Exit 1 = a scene/UI verdict failed.
 * Exit 2 = a CHECKING-side failure (bad arguments, browser/navigation/image
 *          decode, app boot, or missing instrumentation/control); rerun after
 *          correcting the checking environment.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(
  SCRIPT_DIR,
  "..",
  ".playwright-mcp",
  "tiling-ui",
);
const POLL_MS = 150;
const SETTLE_SAMPLES = 8;
const TARGET_PX = 44;
const NON_BACKDROP_TOLERANCE = 10;
const STRUCTURAL_DELTA = 12;
const OVERLAYS = [
  "#panel",
  "#help",
  "#legend",
  "#menuToggle",
  "#loading",
  "#error",
  "#updateBanner",
  "#renderError",
  "#toast",
];

const PRESETS = [
  {
    key: "tiledOctahedron",
    label: "Tiled Octahedron",
    tiling: { group: "b3" },
    x11Engine: "webgl",
  },
  {
    key: "tiledPentatope",
    label: "Tiled Pentatope",
    tiling: { group: "a4" },
    x11Engine: "compute",
  },
  {
    key: "tiledTwentyFourCell",
    label: "Tiled 24-Cell",
    tiling: { group: "f4" },
    x11Engine: "compute",
  },
  {
    key: "mirroredLattice",
    label: "Mirrored Lattice",
    tiling: { kind: "lattice", cellScale: 1.6 },
    x11Engine: "webgl",
  },
  {
    key: "mirroredLattice4",
    label: "Mirrored Lattice 4D",
    tiling: { kind: "lattice", cellScale: 1.6 },
    x11Engine: "compute",
    // The 4D fixture occupies nearly the same projected carrier without the
    // lattice; its repeated cells are a smaller but still robust difference.
    minDiff: 0.002,
  },
];

// Cross the two construction arms with the two dimensions without duplicating
// the algebra matrix already owned by the point-tiling harness and unit tests.
const POINTS_PRESETS = [
  { preset: PRESETS[3], fourD: false, lifecycle: true },
  { preset: PRESETS[1], fourD: true, lifecycle: false },
];

// The complementary accumulator leg crosses both construction arms and both
// dimensions without repeating the complete preset matrix.
const FLAME_PRESETS = [
  { preset: PRESETS[3], fourD: false, lifecycle: true },
  { preset: PRESETS[1], fourD: true, lifecycle: false },
];

// The generated Flame backdrop legs: one construction arm per dimension,
// same pairing as the flame fixtures. The gate freezes the Points cloud
// (Auto-update off) so a tiling edit re-renders ONLY the backdrop between
// captures — the isolated pixel evidence the backdrop lift's acceptance
// needs, where payloads alone would not prove what the pane shows.
const BACKDROP_PRESETS = [
  { preset: PRESETS[3], fourD: false },
  { preset: PRESETS[1], fourD: true },
];

// The Sampled Solid legs: one per 3D construction arm. The leg drives the
// REAL solid session to a converged budget, captures the
// tiled frame, flips the tiling checkbox, and captures again: a tiling
// edit must be material-only (the voxel worker probe shows no replacement)
// and the frame difference is the tiled geometry's and nothing else's —
// the isolated pixel evidence the Solid lift's acceptance needs.
const SOLID_PRESETS = [
  { preset: PRESETS[3], fourD: false },
  { preset: PRESETS[0], fourD: false },
];

// The worker-baked 4D Solid legs cross the finite and mirrored-lattice arms.
// Each proves replacement-worker/same-seed tiling edits, a same-worker
// settled rotor/slice rebuild, exact hierarchy publication, and a visible
// same-seed Off negative control.
const SOLID4_PRESETS = [
  { preset: PRESETS[1], nextTiling: { group: "b4" } },
  {
    preset: PRESETS[4],
    nextTiling: { kind: "lattice", cellScale: 1.7 },
  },
];

class CheckingError extends Error {}

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "sw",
    scope: "all",
    viewport: "800x640",
    settle: 300_000,
    stage: SETTLE_SAMPLES,
    dwell: 1_500,
    draw: 0.005,
    diff: 0.01,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--"))
      throw new CheckingError(`unknown argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new CheckingError(`unknown flag --${key}`);
    if (["settle", "stage", "dwell", "draw", "diff"].includes(key)) {
      args[key] = Number(value);
      if (!Number.isFinite(args[key])) {
        throw new CheckingError(`--${key} wants a finite number`);
      }
    } else if (key === "url") args.url = value.replace(/\/+$/, "");
    else args[key] = value;
  }
  if (args.mode !== "sw" && !args.mode.startsWith("x11:")) {
    throw new CheckingError(
      `--mode must be sw or x11:<display> (got ${args.mode})`,
    );
  }
  if (
    !["all", "points", "flame", "backdrop", "solid", "solid4"].includes(
      args.scope,
    )
  ) {
    throw new CheckingError(
      `--scope must be all, points, flame, backdrop, solid, or solid4 (got ${args.scope})`,
    );
  }
  const viewport = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!viewport) {
    throw new CheckingError(`--viewport wants WxH (got ${args.viewport})`);
  }
  args.width = Number(viewport[1]);
  args.height = Number(viewport[2]);
  if (args.width <= 640 || args.height < 320) {
    throw new CheckingError(
      "--viewport must be at least 641px wide and 320px high",
    );
  }
  if (
    !Number.isInteger(args.stage) ||
    args.stage < 1 ||
    args.stage > SETTLE_SAMPLES
  ) {
    throw new CheckingError(`--stage must be an integer 1..${SETTLE_SAMPLES}`);
  }
  if (args.settle <= 0 || args.dwell < 0 || args.draw < 0 || args.diff < 0) {
    throw new CheckingError(
      "--settle must be positive; --dwell, --draw and --diff must be nonnegative",
    );
  }
  if (!args.url) throw new CheckingError("--url must not be empty");
  return args;
}

function launchOptions(mode) {
  const env = { ...process.env };
  const flags = [
    "--ignore-certificate-errors",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ];
  if (mode.startsWith("x11:")) {
    env.DISPLAY = mode.slice(4);
    flags.push("--enable-unsafe-webgpu", "--enable-features=Vulkan");
    return { env, args: flags, headless: false };
  }
  delete env.DISPLAY;
  flags.push(
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
    "--enable-features=Vulkan",
    "--use-webgpu-adapter=swiftshader",
    "--use-vulkan=swiftshader",
  );
  return { env, args: flags, headless: true };
}

function decodeHash(hash) {
  const match = /^#v1=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new Error("location has no valid #v1= document");
  return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
}

function encodeHash(document) {
  return `#v1=${Buffer.from(JSON.stringify(document), "utf8").toString("base64url")}`;
}

async function readDocument(page) {
  return decodeHash(await page.evaluate(() => window.location.hash));
}

async function waitForDocument(page, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await readDocument(page);
      if (predicate(last)) return { ok: true, document: last };
    } catch {
      // The boot save and an edit's debounced save can leave the hash absent
      // for a short interval. The deadline distinguishes that from a failure.
    }
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, document: last };
}

async function waitForHashChange(page, before, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hash = await page.evaluate(() => window.location.hash);
    if (hash && hash !== before) return true;
    await page.waitForTimeout(POLL_MS);
  }
  return false;
}

/** Capture the app's own Copy-link payload without depending on host
 * clipboard permissions. The override belongs to this document, which is all
 * this one-shot check needs; navigating to the captured link replaces it. */
async function copyShareLink(page, timeout = 15_000) {
  await page.evaluate(() => {
    delete window.__tilingShareLink;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__tilingShareLink = text;
        },
      },
    });
  });
  await openSection(page, "shareSection");
  await page.locator("#copyLinkBtn").click();
  await page.waitForFunction(
    () => typeof window.__tilingShareLink === "string",
    undefined,
    { timeout },
  );
  return page.evaluate(() => window.__tilingShareLink);
}

async function openApp(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Observe the production Worker boundary without replacing its computation
  // or messages. A cloud request/reply proves Points did not quietly take its
  // fallback; Flame starts/events prove the accumulator ran in its real host.
  await page.addInitScript(() => {
    const probe = { workers: [] };
    Object.defineProperty(window, "__tilingCloudWorkerProbe", {
      value: probe,
      configurable: true,
    });
    const NativeWorker = window.Worker;
    if (typeof NativeWorker !== "function") return;
    const cloneJson = (value) => {
      if (value === undefined || value === null) return null;
      return JSON.parse(JSON.stringify(value));
    };
    const InstrumentedWorker = new Proxy(NativeWorker, {
      construct(target, argumentsList) {
        const worker = Reflect.construct(target, argumentsList);
        const entry = {
          url: String(argumentsList[0] ?? ""),
          terminated: false,
          sequence: 0,
          requests: [],
          replies: [],
        };
        probe.workers.push(entry);
        const nativePostMessage = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          entry.requests.push({
            sequence: ++entry.sequence,
            type: typeof message?.type === "string" ? message.type : "cloud",
            id: Number.isSafeInteger(message?.id) ? message.id : null,
            fourD:
              message?.type === "start"
                ? message?.fourD !== undefined
                : message?.fourD === true,
            numPoints: Number.isSafeInteger(message?.numPoints)
              ? message.numPoints
              : null,
            tiling: cloneJson(message?.tiling),
            seed: Number.isSafeInteger(message?.seed) ? message.seed : null,
            gpuPreference: message?.gpuPreference ?? null,
            iterationsBudget: Number.isSafeInteger(message?.iterationsBudget)
              ? message.iterationsBudget
              : null,
            view: cloneJson(message?.view),
            viewRevision: Number.isSafeInteger(message?.viewRevision)
              ? message.viewRevision
              : null,
          });
          return transfer === undefined
            ? nativePostMessage(message)
            : nativePostMessage(message, transfer);
        };
        worker.addEventListener("message", (event) => {
          const data = event.data;
          const reply = {
            sequence: ++entry.sequence,
            type: typeof data?.type === "string" ? data.type : "cloud",
            id: Number.isSafeInteger(data?.id) ? data.id : null,
            fourD: data?.fourD === true,
            count: Number.isSafeInteger(data?.count) ? data.count : null,
            pointTiling: cloneJson(data?.pointTiling),
            outcome: cloneJson(data?.outcome),
            backend: data?.backend ?? null,
            adapter: data?.adapter ?? null,
            software: data?.software === true,
            iterationsDone: Number.isFinite(data?.iterationsDone)
              ? data.iterationsDone
              : null,
            iterationsBudget: Number.isFinite(data?.iterationsBudget)
              ? data.iterationsBudget
              : null,
            viewRevision: Number.isSafeInteger(data?.viewRevision)
              ? data.viewRevision
              : null,
            hierarchy:
              data?.type === "grid" &&
              (data?.hierarchy?.status === "present" ||
                data?.hierarchy?.status === "absent")
                ? data.hierarchy.status
                : null,
            noteBeforeDispatch:
              document.getElementById("tilingNote")?.textContent ?? "",
            noteAfterDispatch: null,
          };
          entry.replies.push(reply);
          // main.ts's onmessage handler runs in this same event dispatch. The
          // next task records the label after that result was offered to the
          // scene; a two-million-point successor cannot overtake this sample.
          setTimeout(() => {
            reply.noteAfterDispatch =
              document.getElementById("tilingNote")?.textContent ?? "";
          }, 0);
        });
        const nativeTerminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          entry.terminated = true;
          entry.sequence++;
          return nativeTerminate();
        };
        return worker;
      },
    });
    Object.defineProperty(window, "Worker", {
      value: InstrumentedWorker,
      configurable: true,
      writable: true,
    });
  });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.goto(`${args.url}/?surfacestate`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const count = document.getElementById("pointCount")?.textContent ?? "";
        return (
          typeof window.__surfaceState === "function" &&
          Number(count.replace(/[^\d]/g, "")) > 0
        );
      },
      undefined,
      { timeout: 60_000, polling: 100 },
    );
    const required = [
      "presetSelect",
      "tilingSection",
      "tilingEnabledCheckbox",
      "tilingKind",
      "tilingGroup",
      "tilingCellScaleSlider",
      "tilingClip",
      "tilingNote",
    ];
    const missing = await page.evaluate(
      (ids) => ids.filter((id) => document.getElementById(id) === null),
      required,
    );
    if (missing.length) {
      throw new CheckingError(
        `required controls missing: ${missing.join(", ")}`,
      );
    }
    return { context, page, pageErrors, consoleErrors };
  } catch (error) {
    await context.close().catch(() => {});
    if (error instanceof CheckingError) throw error;
    throw new CheckingError(
      `app boot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readCloudWorkerProbe(page) {
  return page.evaluate(() => {
    const workers = window.__tilingCloudWorkerProbe?.workers ?? [];
    const cloud = workers.filter((worker) =>
      worker.url.includes("cloud-worker"),
    );
    return {
      created: cloud.length,
      requests: cloud.flatMap((worker) => worker.requests),
      replies: cloud.flatMap((worker) => worker.replies),
    };
  });
}

async function waitForCloudWorkerProbe(page, predicate, timeout) {
  const deadline = Date.now() + timeout;
  let probe = await readCloudWorkerProbe(page);
  while (Date.now() < deadline) {
    if (predicate(probe)) return { ok: true, probe };
    await page.waitForTimeout(POLL_MS);
    probe = await readCloudWorkerProbe(page);
  }
  return { ok: false, probe };
}

async function readFlameWorkerProbe(page) {
  return page.evaluate(() => {
    const workers = window.__tilingCloudWorkerProbe?.workers ?? [];
    return {
      workers: workers
        .filter((worker) => worker.url.includes("flame-worker"))
        .map((worker, index) => ({
          index,
          url: worker.url,
          terminated: worker.terminated === true,
          requests: worker.requests,
          replies: worker.replies,
        })),
    };
  });
}

function flameTerminalReplies(worker) {
  return worker.replies.filter(
    (reply) =>
      (reply.type === "progress" || reply.type === "sharedFrame") &&
      reply.iterationsBudget > 0 &&
      reply.iterationsDone >= reply.iterationsBudget,
  );
}

function matchingFlameRound(
  probe,
  tiling,
  fourD,
  afterCreated = 0,
  expectedSeed = null,
) {
  for (let at = probe.workers.length - 1; at >= afterCreated; at--) {
    const worker = probe.workers[at];
    const start = worker.requests.find(
      (request) =>
        request.type === "start" &&
        request.fourD === fourD &&
        (expectedSeed === null || request.seed === expectedSeed) &&
        exact(request.tiling) === exact(tiling),
    );
    if (!start) continue;
    const outcome = worker.replies.find(
      (reply) => reply.type === "tilingOutcome",
    );
    const backend = worker.replies.find((reply) => reply.type === "backend");
    const terminals = flameTerminalReplies(worker);
    return {
      worker,
      start,
      outcome,
      backend,
      terminal: terminals.at(-1) ?? null,
      terminalCount: terminals.length,
    };
  }
  return null;
}

async function readFlameUi(page) {
  return page.evaluate(() => ({
    active:
      document.getElementById("modeFlameBtn")?.getAttribute("aria-pressed") ===
      "true",
    note: document.getElementById("tilingNote")?.textContent ?? "",
    backend: document.getElementById("flameBackendNote")?.textContent ?? "",
    backendWarning:
      document
        .getElementById("flameBackendNote")
        ?.classList.contains("flame-note") === true,
    progress: document.getElementById("flameProgress")?.textContent ?? "",
  }));
}

async function waitForFlameRound(
  page,
  tiling,
  fourD,
  afterCreated,
  timeout,
  expectedSeed = null,
) {
  const deadline = Date.now() + timeout;
  let probe = await readFlameWorkerProbe(page);
  let round = matchingFlameRound(
    probe,
    tiling,
    fourD,
    afterCreated,
    expectedSeed,
  );
  let ui = await readFlameUi(page);
  while (Date.now() < deadline) {
    const active = tiling !== null;
    const outcomePass = active
      ? round?.outcome?.outcome?.availability === "active"
      : true;
    const backendPass = active
      ? round?.backend?.backend === "gpu" &&
        ui.backend.startsWith("GPU accumulation") &&
        ui.backendWarning === (round.backend.software === true)
      : round?.backend !== undefined;
    const notePass = active
      ? ui.note.includes("Active in Flame")
      : ui.note.startsWith("Off — Points, Flame, Solid, and Surface");
    if (
      round?.terminal != null &&
      ui.active &&
      outcomePass &&
      backendPass &&
      notePass
    ) {
      return { ok: true, probe, round, ui };
    }
    await page.waitForTimeout(POLL_MS);
    probe = await readFlameWorkerProbe(page);
    round = matchingFlameRound(
      probe,
      tiling,
      fourD,
      afterCreated,
      expectedSeed,
    );
    ui = await readFlameUi(page);
  }
  return { ok: false, probe, round, ui };
}

async function waitForAdditionalFlameTerminal(
  page,
  workerIndex,
  afterSequence,
  timeout,
) {
  const deadline = Date.now() + timeout;
  let probe = await readFlameWorkerProbe(page);
  while (Date.now() < deadline) {
    const worker = probe.workers[workerIndex];
    if (
      worker &&
      flameTerminalReplies(worker).some(
        (reply) => reply.sequence > afterSequence,
      ) &&
      (await readFlameUi(page)).note.includes("Active in Flame")
    ) {
      return { ok: true, probe, worker };
    }
    await page.waitForTimeout(POLL_MS);
    probe = await readFlameWorkerProbe(page);
  }
  return { ok: false, probe, worker: probe.workers[workerIndex] ?? null };
}

// ---------------------------------------------------------------------------
// Generated Flame backdrop rounds
// ---------------------------------------------------------------------------

/** The generator's fixed low-budget policy (flame-backdrop-generator.ts). */
const BACKDROP_ITERATIONS = 1_000_000;
/** main.ts's fixed backdrop seed: authored changes, not random noise, decide
 * how the echo changes — the same-seed control this leg's frame pairs rely
 * on. 0x5f3759df. */
const BACKDROP_SEED = 1597463007;

function isBackdropStart(request) {
  return (
    request.type === "start" &&
    request.gpuPreference === "off" &&
    request.iterationsBudget === BACKDROP_ITERATIONS
  );
}

function matchingBackdropRound(probe, tiling, afterSequence = 0) {
  const workers = probe.workers.filter((worker) =>
    worker.url.includes("flame-worker"),
  );
  for (let at = workers.length - 1; at >= 0; at--) {
    const worker = workers[at];
    const start = worker.requests
      .filter(
        (request) =>
          request.sequence > afterSequence && isBackdropStart(request),
      )
      .filter((request) => exact(request.tiling) === exact(tiling))
      .at(-1);
    if (!start) continue;
    const terminal = worker.replies
      .filter(
        (reply) =>
          reply.sequence > start.sequence &&
          reply.type === "progress" &&
          reply.iterationsBudget > 0 &&
          reply.iterationsDone >= reply.iterationsBudget,
      )
      .at(-1);
    if (!terminal) continue;
    return { worker, start, terminal };
  }
  return null;
}

async function waitForBackdropRound(page, tiling, timeout, afterSequence = 0) {
  const deadline = Date.now() + timeout;
  let probe = await readFlameWorkerProbe(page);
  let round = matchingBackdropRound(probe, tiling, afterSequence);
  while (Date.now() < deadline) {
    if (round !== null) return { ok: true, probe, round };
    await page.waitForTimeout(POLL_MS);
    probe = await readFlameWorkerProbe(page);
    round = matchingBackdropRound(probe, tiling, afterSequence);
  }
  return { ok: false, probe, round };
}

function matchingWorkerRequest(probe, tiling, afterId = 0, numPoints = null) {
  return [...probe.requests]
    .reverse()
    .find(
      (request) =>
        request.id > afterId &&
        exact(request.tiling) === exact(tiling) &&
        (numPoints === null || request.numPoints === numPoints),
    );
}

function matchingWorkerRound(probe, tiling, afterId = 0, numPoints = null) {
  const request = matchingWorkerRequest(probe, tiling, afterId, numPoints);
  if (!request) return null;
  const reply = probe.replies.find((candidate) => candidate.id === request.id);
  if (!reply) return null;
  if (tiling === null) {
    return reply.pointTiling === null ? { request, reply } : null;
  }
  return reply.pointTiling?.availability === "active" &&
    reply.pointTiling.fill === "complete"
    ? { request, reply }
    : null;
}

async function waitForWorkerRound(
  page,
  tiling,
  timeout,
  afterId = 0,
  numPoints = null,
) {
  const waited = await waitForCloudWorkerProbe(
    page,
    (probe) => matchingWorkerRound(probe, tiling, afterId, numPoints) !== null,
    timeout,
  );
  return {
    ...waited,
    round: matchingWorkerRound(waited.probe, tiling, afterId, numPoints),
  };
}

async function openSection(page, id) {
  await openPanel(page);
  const section = page.locator(`#${id}`);
  if ((await section.count()) !== 1) {
    throw new CheckingError(`missing panel section #${id}`);
  }
  if (!(await section.evaluate((element) => element.open))) {
    await section.locator(":scope > summary").click();
  }
  await page.waitForFunction(
    (sectionId) => document.getElementById(sectionId)?.open === true,
    id,
    { timeout: 5_000 },
  );
}

async function closePanel(page) {
  const panel = page.locator("#panel");
  if (await panel.evaluate((element) => element.classList.contains("open"))) {
    await page.locator("#menuToggle").click();
  }
  await page.waitForFunction(
    () => !document.getElementById("panel")?.classList.contains("open"),
    undefined,
    { timeout: 5_000 },
  );
  // The class flips at the start of the 320ms slide. Camera/canvas viewport
  // state must be sampled only after that layout transition has settled.
  await page.waitForTimeout(400);
}

async function openPanel(page) {
  const panel = page.locator("#panel");
  if (
    !(await panel.evaluate((element) => element.classList.contains("open")))
  ) {
    await page.locator("#menuToggle").click();
  }
  await page.waitForFunction(
    () => document.getElementById("panel")?.classList.contains("open") === true,
    undefined,
    { timeout: 5_000 },
  );
}

/** Observe before a preset or mode click so a fast full-detail pass cannot
 * appear and hide entirely between the polling samples below. */
async function armSurfaceProgressProbe(page) {
  await page.evaluate(() => {
    window.__tilingUiProgressSeen = false;
    const row = document.getElementById("surfaceProgress");
    if (!row) throw new Error("surface progress row missing");
    const sample = () => {
      if (
        !row.classList.contains("hidden") &&
        (row.textContent ?? "").trim().length > 0
      ) {
        window.__tilingUiProgressSeen = true;
      }
    };
    sample();
    new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "attributes" &&
            record.attributeName === "class" &&
            record.oldValue?.split(/\s+/).includes("hidden"),
        ) &&
        (row.textContent ?? "").trim().length > 0
      ) {
        window.__tilingUiProgressSeen = true;
      }
      sample();
    }).observe(row, {
      attributes: true,
      attributeOldValue: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}

/** Choose a preset through the one-shot menu and wait for its debounced
 * document write. This does not enter Surface itself: a showcase's renderer
 * hint must perform that transition unaided. */
async function loadPreset(page, key) {
  await openSection(page, "presetSection");
  const before = await page.evaluate(() => window.location.hash);
  await page.locator("#presetSelect").selectOption(key);
  return waitForHashChange(page, before);
}

async function pollSurfaceStage(page) {
  return page.evaluate(() => {
    const probe = window.__surfaceState?.() ?? null;
    const row = document.getElementById("surfaceProgress");
    const rowText =
      row && !row.classList.contains("hidden") ? (row.textContent ?? "") : "";
    const pass = /antialiasing pass (\d+)\/(\d+)/.exec(rowText);
    const completed =
      pass && /Full detail/.test(rowText)
        ? Math.max(0, Number(pass[1]) - 1)
        : 0;
    const settled = Boolean(
      probe &&
      probe.mode === "surface" &&
      probe.firstFrame &&
      probe.settled &&
      !probe.previewActive &&
      !probe.settleActive &&
      !probe.settlePending,
    );
    return { probe, rowText, completed, settled };
  });
}

async function waitForSurfaceTarget(page, args) {
  const deadline = Date.now() + args.settle;
  let last = null;
  let heldSince = null;
  while (Date.now() < deadline) {
    last = await pollSurfaceStage(page);
    const progressSeen = await page.evaluate(
      () => window.__tilingUiProgressSeen === true,
    );
    if (args.stage === SETTLE_SAMPLES) {
      if (last.settled) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= args.dwell) {
          return { ok: progressSeen, progressSeen, state: last };
        }
      } else heldSince = null;
    } else if (
      last.probe?.mode === "surface" &&
      last.probe.firstFrame &&
      last.completed >= args.stage
    ) {
      return { ok: progressSeen, progressSeen, state: last };
    }
    if (
      last.probe &&
      last.probe.mode !== "points" &&
      last.probe.mode !== "surface"
    ) {
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  return {
    ok: false,
    progressSeen: await page.evaluate(
      () => window.__tilingUiProgressSeen === true,
    ),
    state: last,
  };
}

async function visibleErrorText(page) {
  return page.evaluate(() =>
    ["#error", "#renderError"]
      .map((selector) => document.querySelector(selector))
      .filter((element) => {
        if (!element || element.classList.contains("hidden")) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0
        );
      })
      .map((element) => element.textContent ?? "")
      .join(" ")
      .trim(),
  );
}

async function captureCanvas(page, args, name) {
  const priorVisibility = await page.evaluate((selectors) => {
    const prior = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        prior.push([selector, element.style.getPropertyValue("visibility")]);
        element.style.setProperty("visibility", "hidden", "important");
      }
    }
    return prior;
  }, OVERLAYS);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  const canvas = page.locator("#container canvas").first();
  if ((await canvas.count()) !== 1)
    throw new CheckingError("main canvas missing");
  const png = await canvas.screenshot({ type: "png" });
  await page.evaluate(
    ({ selectors, prior }) => {
      let at = 0;
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const entry = prior[at++];
          if (entry?.[1]) {
            element.style.setProperty("visibility", entry[1]);
          } else {
            element.style.removeProperty("visibility");
          }
        }
      }
    },
    { selectors: OVERLAYS, prior: priorVisibility },
  );
  const metrics = await page.evaluate(
    async ({ base64, tolerance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const width = 128;
      const height = Math.max(
        1,
        Math.round((image.naturalHeight / image.naturalWidth) * width),
      );
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext("2d");
      if (!context) throw new Error("2D screenshot decode context unavailable");
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const pixel = (x, y) => {
        const at = (y * width + x) * 4;
        return [data[at], data[at + 1], data[at + 2]];
      };
      const corners = [
        pixel(0, 0),
        pixel(width - 1, 0),
        pixel(0, height - 1),
        pixel(width - 1, height - 1),
      ];
      let nonBackdrop = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = pixel(x, y);
          const backdrop = corners.some(
            (corner) =>
              Math.abs(corner[0] - p[0]) <= tolerance &&
              Math.abs(corner[1] - p[1]) <= tolerance &&
              Math.abs(corner[2] - p[2]) <= tolerance,
          );
          if (!backdrop) nonBackdrop++;
        }
      }
      return {
        coverage: nonBackdrop / (width * height),
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    },
    { base64: png.toString("base64"), tolerance: NON_BACKDROP_TOLERANCE },
  );
  await mkdir(args.outdir, { recursive: true });
  await writeFile(path.join(args.outdir, `${name}.png`), png);
  return { metrics, png };
}

async function screenshotDiff(page, a, b) {
  return page.evaluate(
    async ({ a64, b64, threshold }) => {
      async function decode(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D screenshot diff context unavailable");
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const A = await decode(a64);
      const B = await decode(b64);
      if (A.width !== B.width || A.height !== B.height) {
        throw new Error(
          `screenshot size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`,
        );
      }
      // Compare the canvas scene region rather than DOM chrome or the least
      // stable compositor edge band. Both frames use the identical live
      // camera; clearing tiling is the only document edit between them.
      const x0 = Math.floor(A.width * 0.05);
      const x1 = Math.ceil(A.width * 0.95);
      const y0 = Math.floor(A.height * 0.05);
      const y1 = Math.ceil(A.height * 0.95);
      let compared = 0;
      let structural = 0;
      let maxDelta = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * A.width + x) * 4;
          const delta = Math.max(
            Math.abs(A.data[at] - B.data[at]),
            Math.abs(A.data[at + 1] - B.data[at + 1]),
            Math.abs(A.data[at + 2] - B.data[at + 2]),
          );
          compared++;
          if (delta > threshold) structural++;
          if (delta > maxDelta) maxDelta = delta;
        }
      }
      return {
        fraction: compared > 0 ? structural / compared : 0,
        structural,
        compared,
        maxDelta,
      };
    },
    {
      a64: a.toString("base64"),
      b64: b.toString("base64"),
      threshold: STRUCTURAL_DELTA,
    },
  );
}

async function runPresetLeg(browser, args, preset) {
  const app = await openApp(browser, args);
  const { context, page, pageErrors, consoleErrors } = app;
  const started = Date.now();
  try {
    await armSurfaceProgressProbe(page);
    const loaded = await loadPreset(page, preset.key);
    if (!loaded) {
      return { ok: false, preset, reason: "preset document never changed" };
    }
    const installed = await waitForDocument(
      page,
      (document) => exact(document.tiling) === exact(preset.tiling),
    );
    if (!installed.ok) {
      return {
        ok: false,
        preset,
        reason: `preset did not install ${exact(preset.tiling)}`,
      };
    }
    // Do not press #modeSurfaceBtn. PRESET_RENDER_HINTS owns this transition,
    // and the gate must fail if the saved renderer hint never reaches it.
    const target = await waitForSurfaceTarget(page, args);
    const state = target.state?.probe ?? null;
    const expectedEngine = args.mode.startsWith("x11:")
      ? preset.x11Engine
      : null;
    const enginePass =
      expectedEngine === null || state?.engine === expectedEngine;
    const document = await readDocument(page);
    const documentPass = exact(document.tiling) === exact(preset.tiling);
    const errorText = await visibleErrorText(page);
    let tiledCapture = null;
    if (state?.firstFrame) {
      tiledCapture = await captureCanvas(page, args, `${preset.key}-tiled`);
    }
    let untiledTarget = null;
    let untiledCapture = null;
    let distinctness = null;
    if (target.ok && tiledCapture !== null) {
      await openSection(page, "tilingSection");
      await page.locator("#tilingEnabledCheckbox").scrollIntoViewIfNeeded();
      await page.locator("#tilingEnabledCheckbox").focus();
      await page.locator("#tilingEnabledCheckbox").press("Space");
      const cleared = await waitForDocument(
        page,
        (next) => next.tiling === undefined,
      );
      if (cleared.ok) {
        untiledTarget = await waitForSurfaceTarget(page, args);
        if (untiledTarget.ok && untiledTarget.state?.probe?.firstFrame) {
          untiledCapture = await captureCanvas(
            page,
            args,
            `${preset.key}-untiled`,
          );
          distinctness = await screenshotDiff(
            page,
            tiledCapture.png,
            untiledCapture.png,
          );
        }
      }
    }
    const minDiff = preset.minDiff ?? args.diff;
    const distinctPass =
      untiledTarget?.ok === true &&
      untiledCapture !== null &&
      untiledCapture.metrics.coverage >= args.draw &&
      distinctness !== null &&
      distinctness.fraction >= minDiff;
    const ok =
      target.ok &&
      state?.mode === "surface" &&
      state.firstFrame === true &&
      documentPass &&
      enginePass &&
      tiledCapture !== null &&
      tiledCapture.metrics.coverage >= args.draw &&
      distinctPass &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      errorText.length === 0;
    return {
      ok,
      preset,
      target,
      progressSeen: target.progressSeen,
      engine: state?.engine ?? null,
      backend: state?.backend ?? null,
      expectedEngine,
      documentPass,
      coverage: tiledCapture?.metrics.coverage ?? null,
      untiledCoverage: untiledCapture?.metrics.coverage ?? null,
      distinctness,
      minDiff,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      errorText,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runPointsPresetLeg(browser, args, fixture) {
  const { preset, fourD, lifecycle } = fixture;
  const app = await openApp(browser, args);
  const { context, page, pageErrors, consoleErrors } = app;
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    const loaded = await loadPreset(page, preset.key);
    const installed = await waitForExactTiling(page, preset.tiling);
    const mode = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    const initialRound = await waitForWorkerRound(
      page,
      preset.tiling,
      args.settle,
    );
    check(
      "initial Worker result",
      loaded &&
        installed.ok &&
        mode.ok &&
        initialRound.probe.created > 0 &&
        initialRound.round !== null &&
        initialRound.round.request.fourD === fourD,
      `created=${initialRound.probe.created}, request=${exact(initialRound.round?.request ?? null)}, status=${mode.note || "none"}`,
    );

    const shareLink = await copyShareLink(page);
    const validShareLink = shareLink.includes("#v1=");
    await page.goto(shareLink, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const count = document.getElementById("pointCount")?.textContent ?? "";
        return Number(count.replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 60_000 },
    );
    const restored = await waitForExactTiling(page, preset.tiling);
    const restoredMode = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    // Boot itself intentionally computes synchronously. Regenerate the
    // restored document once so this copied-link cell also crosses the real
    // Worker boundary rather than passing on boot's fallback-shaped path.
    const restoredBefore = await readCloudWorkerProbe(page);
    const restoredAfterId = maxWorkerRequestId(restoredBefore);
    await openSection(page, "rendererQualitySection");
    await page.locator("#regenerateBtn").click();
    const restoredRound = await waitForWorkerRound(
      page,
      preset.tiling,
      args.settle,
      restoredAfterId,
    );
    const restoredSettled = await waitForTilingNote(
      page,
      /Active in Points — .* · complete/,
      args.settle,
    );
    check(
      "copied-link Worker restore",
      validShareLink &&
        restored.ok &&
        restoredMode.ok &&
        restoredRound.probe.created > 0 &&
        restoredRound.round !== null &&
        restoredSettled.ok,
      `link=${validShareLink}, tiling=${restored.ok}, created=${restoredRound.probe.created}, request=${exact(restoredRound.round?.request ?? null)}, status=${restoredSettled.note || restoredMode.note || "none"}`,
    );

    if (lifecycle) {
      const lifecycleResult = await exercisePointsLifecycle(page, args);
      for (const result of lifecycleResult.checks) checks.push(result);
    }

    let viewCapture = null;
    if (fourD) {
      const viewResult = await exerciseFourDPointsView(page, args, preset.key);
      for (const result of viewResult.checks) checks.push(result);
      viewCapture = viewResult.capture;
    }

    const tiledCapture =
      viewCapture ??
      (await captureCanvas(page, args, `${preset.key}-points-tiled`));
    const beforeClear = await readCloudWorkerProbe(page);
    const clearAfterId = maxWorkerRequestId(beforeClear);
    await openSection(page, "tilingSection");
    await page.locator("#tilingEnabledCheckbox").scrollIntoViewIfNeeded();
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    const ordinaryRound = await waitForWorkerRound(
      page,
      null,
      args.settle,
      clearAfterId,
    );
    const clearedNote = await page.evaluate(
      () => document.getElementById("tilingNote")?.textContent ?? "",
    );
    const untiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-points-untiled`,
    );
    const distinctness = await screenshotDiff(
      page,
      tiledCapture.png,
      untiledCapture.png,
    );
    const minDiff = preset.minDiff ?? args.diff;
    check(
      "tiled/disabled frame",
      cleared.ok &&
        ordinaryRound.round !== null &&
        clearedNote ===
          "Off — Points, Flame, Solid, and Surface render the original attractor once." &&
        tiledCapture.metrics.coverage >= args.draw &&
        untiledCapture.metrics.coverage >= args.draw &&
        distinctness.fraction >= minDiff,
      `cleared=${cleared.ok}, note=${clearedNote || "none"}, tiled=${(tiledCapture.metrics.coverage * 100).toFixed(2)}%, untiled=${(untiledCapture.metrics.coverage * 100).toFixed(2)}%, diff=${(distinctness.fraction * 100).toFixed(2)}%/${(minDiff * 100).toFixed(2)}%, request=${exact(ordinaryRound.round?.request ?? null)}`,
    );

    const errorText = await visibleErrorText(page);
    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    check("visible app error", errorText.length === 0, errorText || "none");
    return {
      ok: checks.every((entry) => entry.ok),
      preset,
      checks,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function exercisePointsLifecycle(page, args) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  await openSection(page, "transformsSection");
  const autoUpdate = page.locator("#autoUpdate");
  if (await autoUpdate.isChecked()) await autoUpdate.click();

  await openSection(page, "rendererQualitySection");
  await setRangeValue(page, "#numPointsSlider", 10);
  await openSection(page, "tilingSection");
  await setRangeValue(page, "#tilingCellScaleSlider", 1.7);
  const authored = await waitForDocument(
    page,
    (document) =>
      document.numPoints === 2_000_000 &&
      document.tiling?.kind === "lattice" &&
      document.tiling.cellScale === 1.7,
  );
  const stale = await waitForTilingNote(
    page,
    /Stale Points result — Auto-update is off/,
    10_000,
  );
  const beforeManual = await readCloudWorkerProbe(page);
  await page.waitForTimeout(2 * POLL_MS);
  const afterIdle = await readCloudWorkerProbe(page);
  check(
    "Auto-update-off stale disclosure",
    authored.ok &&
      stale.ok &&
      afterIdle.requests.length === beforeManual.requests.length,
    `${stale.note || "no status"}; requests=${beforeManual.requests.length}->${afterIdle.requests.length}`,
  );

  const manualAfterId = maxWorkerRequestId(afterIdle);
  // One JS task makes the ordering unambiguous: the manual 1.70 request is
  // posted first, then the document advances to 1.80 and Auto-update resumes.
  // A Worker message cannot interleave until all three edits have completed.
  await page.evaluate(() => {
    document.getElementById("regenerateBtn")?.click();
    const scale = document.getElementById("tilingCellScaleSlider");
    if (!(scale instanceof HTMLInputElement)) {
      throw new Error("lattice scale control missing");
    }
    scale.value = "1.8";
    scale.dispatchEvent(new Event("input", { bubbles: true }));
    scale.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("autoUpdate")?.click();
  });
  const latestAuthored = await waitForDocument(
    page,
    (document) =>
      document.numPoints === 2_000_000 &&
      document.tiling?.kind === "lattice" &&
      document.tiling.cellScale === 1.8,
  );
  const manualRound = await waitForWorkerRound(
    page,
    { kind: "lattice", cellScale: 1.7 },
    args.settle,
    manualAfterId,
    2_000_000,
  );
  const manualId = manualRound.round?.request.id ?? manualAfterId;
  const latestRound = await waitForWorkerRound(
    page,
    { kind: "lattice", cellScale: 1.8 },
    args.settle,
    manualId,
    2_000_000,
  );
  const latest = await waitForTilingNote(
    page,
    /Active in Points — .* · complete/,
    args.settle,
  );
  await page.waitForTimeout(POLL_MS);
  const landedProbe = await readCloudWorkerProbe(page);
  const staleReply = landedProbe.replies.find(
    (reply) => reply.id === manualRound.round?.request.id,
  );
  const finalReply = landedProbe.replies.find(
    (reply) => reply.id === latestRound.round?.request.id,
  );
  const staleReplyNote = staleReply?.noteAfterDispatch ?? "";
  check(
    "manual stale reply",
    manualRound.round !== null &&
      /Awaiting regeneration/.test(staleReply?.noteBeforeDispatch ?? "") &&
      /Awaiting regeneration/.test(staleReplyNote) &&
      !/Active in Points/.test(staleReplyNote),
    `request=${exact(manualRound.round?.request ?? null)}, post-reply=${staleReplyNote || "none"}`,
  );
  check(
    "rapid latest-wins result",
    latestAuthored.ok &&
      latestRound.round !== null &&
      finalReply?.noteAfterDispatch?.includes("Active in Points") === true &&
      latest.ok,
    `request=${exact(latestRound.round?.request ?? null)}, post-reply=${finalReply?.noteAfterDispatch || "none"}`,
  );
  return { checks };
}

async function exerciseFourDPointsView(page, args, key) {
  const checks = [];
  const beforeProbe = await readCloudWorkerProbe(page);
  await openSection(page, "viewControls");
  const autoMotion = page.locator("#autoMotionToggle");
  if (await autoMotion.isChecked()) await autoMotion.click();
  await setRangeValue(page, "#fourDTumbleSpeedSlider", 3);
  await page.waitForTimeout(250);
  const beforeLink = await copyShareLink(page);
  const beforeDocument = decodeHash(new URL(beforeLink).hash);
  await closePanel(page);
  const before = await captureCanvas(page, args, `${key}-points-view-before`);
  const canvas = page.locator("#container canvas").first();
  await canvas.evaluate((element) => {
    window.__tilingRotorAccepted = 0;
    element.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow") && event.defaultPrevented) {
        window.__tilingRotorAccepted += 1;
      }
    });
  });
  await canvas.focus();
  await page.keyboard.down("Shift");
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
  }
  await page.keyboard.up("Shift");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  await openPanel(page);
  const rotorLink = await copyShareLink(page);
  const rotorDocument = decodeHash(new URL(rotorLink).hash);
  await closePanel(page);
  const rotorFrame = await captureCanvas(
    page,
    args,
    `${key}-points-view-rotor`,
  );
  const rotorDiff = await screenshotDiff(page, before.png, rotorFrame.png);
  await openPanel(page);
  await openSection(page, "viewControls");
  const slice = page.locator("#fourDSliceToggle");
  if (!(await slice.isChecked())) await slice.click();
  await setRangeValue(page, "#fourDSliceSlider", 0.35);
  // Live view state is deliberately out of the continuously saved hash. Two
  // app-owned Copy Link snapshots bracket the focused-canvas rotor keys so the gate
  // proves the rotor itself moved, independently of the later slice edit.
  const posedLink = await copyShareLink(page);
  const posedDocument = decodeHash(new URL(posedLink).hash);
  await closePanel(page);
  const pairChanged =
    exact({ p: rotorDocument.fourD?.p, q: rotorDocument.fourD?.q }) !==
    exact({ p: beforeDocument.fourD?.p, q: beforeDocument.fourD?.q });
  const posed =
    posedDocument.fourD?.sliceOn === true &&
    posedDocument.fourD.sliceCenter === 0.35 &&
    pairChanged;
  await page.waitForTimeout(750);
  const after = await captureCanvas(page, args, `${key}-points-view-after`);
  const afterProbe = await readCloudWorkerProbe(page);
  const viewDiff = await screenshotDiff(page, before.png, after.png);
  const view = await page.evaluate(() => ({
    motion: document.getElementById("autoMotionToggle")?.checked === true,
    slice: document.getElementById("fourDSliceToggle")?.checked === true,
    position: document.getElementById("fourDSliceSlider")?.value ?? "",
    speed: document.getElementById("fourDTumbleSpeedSlider")?.value ?? "",
    note: document.getElementById("tilingNote")?.textContent ?? "",
    rotorAccepted: window.__tilingRotorAccepted ?? 0,
  }));
  checks.push({
    name: "4D rotor/slice is view-only",
    ok:
      !view.motion &&
      view.slice &&
      Number(view.position) === 0.35 &&
      Number(view.speed) === 3 &&
      posed &&
      view.rotorAccepted === 8 &&
      rotorDiff.fraction >= 0.0005 &&
      view.note.includes("Active in Points") &&
      afterProbe.requests.length === beforeProbe.requests.length &&
      afterProbe.replies.length === beforeProbe.replies.length &&
      viewDiff.fraction >= 0.0005,
    detail: `requests=${beforeProbe.requests.length}->${afterProbe.requests.length}, replies=${beforeProbe.replies.length}->${afterProbe.replies.length}, rotorDiff=${(rotorDiff.fraction * 100).toFixed(2)}%, sliceDiff=${(viewDiff.fraction * 100).toFixed(2)}%, rotor=${posed} (pair=${pairChanged}, accepted=${view.rotorAccepted}, savedSlice=${posedDocument.fourD?.sliceOn ?? "missing"}/${posedDocument.fourD?.sliceCenter ?? "missing"}), motion=${view.motion}, slice=${view.position}, speed=${view.speed}`,
  });
  return { checks, capture: after };
}

async function configureFocusedFlameQuality(page) {
  await openSection(page, "rendererQualitySection");
  await setRangeValue(page, "#flameIterationsSlider", 0);
  await setRangeValue(page, "#flameSupersampleSlider", 1);
  return page.evaluate(() => ({
    iterations:
      document.getElementById("flameIterationsLabel")?.textContent ?? "",
    supersample:
      document.getElementById("flameSupersampleLabel")?.textContent ?? "",
  }));
}

async function exerciseFlameLatestWins(page, args, seed) {
  const checks = [];
  const before = await readFlameWorkerProbe(page);
  const afterCreated = before.workers.length;
  await openSection(page, "tilingSection");
  // Both edits happen in one main-thread task. The first replacement host is
  // therefore observable but cannot finish before the second edit retires it.
  await page.evaluate(() => {
    const scale = document.getElementById("tilingCellScaleSlider");
    if (!(scale instanceof HTMLInputElement)) {
      throw new Error("lattice scale control missing");
    }
    for (const value of ["1.7", "1.8"]) {
      scale.value = value;
      scale.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  const authored = await waitForExactTiling(page, {
    kind: "lattice",
    cellScale: 1.8,
  });
  const latest = await waitForFlameRound(
    page,
    { kind: "lattice", cellScale: 1.8 },
    false,
    afterCreated,
    args.settle,
  );
  const replacements = latest.probe.workers.slice(afterCreated);
  const stale = replacements.find((worker) =>
    worker.requests.some(
      (request) =>
        request.type === "start" &&
        exact(request.tiling) === exact({ kind: "lattice", cellScale: 1.7 }),
    ),
  );
  const staleTerminals = stale ? flameTerminalReplies(stale) : [];
  const staleActiveRelabel = stale?.replies.some(
    (reply) =>
      reply.noteAfterDispatch?.includes("Active in Flame") === true ||
      reply.noteAfterDispatch?.includes("bounded mirrored lattice") === true,
  );
  checks.push({
    name: "rapid latest-wins Flame edit",
    ok:
      authored.ok &&
      stale !== undefined &&
      stale.terminated &&
      staleTerminals.length === 0 &&
      staleActiveRelabel !== true &&
      latest.ok &&
      latest.round?.start.seed === seed,
    detail: `workers=${before.workers.length}->${latest.probe.workers.length}, staleTerminals=${staleTerminals.length}, staleRelabel=${Boolean(staleActiveRelabel)}, latest=${exact(latest.round?.start ?? null)}, status=${latest.ui.note || "none"}`,
  });
  return { checks, target: latest };
}

async function exerciseFourDFlameView(page, args, key, target, before) {
  const checks = [];
  if (!target.ok || !target.round) {
    checks.push({
      name: "4D Flame rotor/slice stays in one worker",
      ok: false,
      detail:
        "no completed active Flame worker was available for view commands",
    });
    return { checks, capture: before, target };
  }
  const workerIndex = target.round.worker.index;
  const beforeProbe = await readFlameWorkerProbe(page);
  const beforeWorker = beforeProbe.workers[workerIndex];
  const beforeStarts = beforeWorker.requests.filter(
    (request) => request.type === "start",
  ).length;
  const beforeRequestCount = beforeWorker.requests.length;
  await openSection(page, "viewControls");
  const autoMotion = page.locator("#autoMotionToggle");
  if (await autoMotion.isChecked()) await autoMotion.click();
  await setRangeValue(page, "#fourDTumbleSpeedSlider", 3);
  const beforeLink = await copyShareLink(page);
  const beforeDocument = decodeHash(new URL(beforeLink).hash);
  await closePanel(page);

  const canvas = page.locator("#container canvas").first();
  await canvas.evaluate((element) => {
    window.__tilingFlameRotorAccepted = 0;
    element.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow") && event.defaultPrevented) {
        window.__tilingFlameRotorAccepted += 1;
      }
    });
  });
  await canvas.focus();
  await page.keyboard.down("Shift");
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
  }
  await page.keyboard.up("Shift");

  await openSection(page, "viewControls");
  const slice = page.locator("#fourDSliceToggle");
  if (!(await slice.isChecked())) await slice.click();
  await setRangeValue(page, "#fourDSliceSlider", 0.35);
  const posedLink = await copyShareLink(page);
  const posedDocument = decodeHash(new URL(posedLink).hash);
  await closePanel(page);

  const afterCommands = await readFlameWorkerProbe(page);
  const commandWorker = afterCommands.workers[workerIndex];
  const viewCommands = commandWorker.requests
    .slice(beforeRequestCount)
    .filter((request) => request.type === "setFourDView");
  const lastViewCommand = viewCommands.at(-1);
  const settled = lastViewCommand
    ? await waitForAdditionalFlameTerminal(
        page,
        workerIndex,
        lastViewCommand.sequence,
        args.settle,
      )
    : { ok: false, probe: afterCommands, worker: commandWorker };
  const after = await captureCanvas(page, args, `${key}-flame-view-after`);
  const diff = await screenshotDiff(page, before.png, after.png);
  const finalWorker = settled.probe.workers[workerIndex];
  const finalStarts = finalWorker?.requests.filter(
    (request) => request.type === "start",
  ).length;
  const pairChanged =
    exact({ p: posedDocument.fourD?.p, q: posedDocument.fourD?.q }) !==
    exact({ p: beforeDocument.fourD?.p, q: beforeDocument.fourD?.q });
  const view = await page.evaluate(() => ({
    motion: document.getElementById("autoMotionToggle")?.checked === true,
    slice: document.getElementById("fourDSliceToggle")?.checked === true,
    position: document.getElementById("fourDSliceSlider")?.value ?? "",
    rotorAccepted: window.__tilingFlameRotorAccepted ?? 0,
    note: document.getElementById("tilingNote")?.textContent ?? "",
  }));
  checks.push({
    name: "4D Flame rotor/slice stays in one worker",
    ok:
      settled.ok &&
      settled.probe.workers.length === beforeProbe.workers.length &&
      finalWorker?.terminated === false &&
      finalStarts === beforeStarts &&
      viewCommands.length >= 2 &&
      lastViewCommand?.view?.sliceOn === true &&
      lastViewCommand.view.sliceCenter === 0.35 &&
      pairChanged &&
      posedDocument.fourD?.sliceOn === true &&
      posedDocument.fourD.sliceCenter === 0.35 &&
      view.rotorAccepted === 8 &&
      !view.motion &&
      view.slice &&
      Number(view.position) === 0.35 &&
      view.note.includes("Active in Flame") &&
      diff.fraction >= 0.0005,
    detail: `workers=${beforeProbe.workers.length}->${settled.probe.workers.length}, starts=${beforeStarts}->${finalStarts}, viewCommands=${viewCommands.length}, terminal=${settled.ok}, diff=${(diff.fraction * 100).toFixed(2)}%, pair=${pairChanged}, accepted=${view.rotorAccepted}, savedSlice=${posedDocument.fourD?.sliceOn ?? "missing"}/${posedDocument.fourD?.sliceCenter ?? "missing"}`,
  });
  return { checks, capture: after, target };
}

async function runFlamePresetLeg(browser, args, fixture) {
  const { preset, fourD, lifecycle } = fixture;
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    const loaded = await loadPreset(page, preset.key);
    const installed = await waitForExactTiling(page, preset.tiling);
    const points = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    const shareLink = await copyShareLink(page);
    const shared = decodeHash(new URL(shareLink).hash);
    await page.goto(shareLink, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const count = document.getElementById("pointCount")?.textContent ?? "";
        return Number(count.replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 60_000 },
    );
    const restored = await waitForExactTiling(page, preset.tiling);
    const restoredPoints = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    const quality = await configureFocusedFlameQuality(page);
    const beforeFlame = await readFlameWorkerProbe(page);
    await page.locator("#modeFlameBtn").click();
    const initial = await waitForFlameRound(
      page,
      preset.tiling,
      fourD,
      beforeFlame.workers.length,
      args.settle,
    );
    check(
      "copied-link Flame Worker",
      loaded &&
        installed.ok &&
        points.ok &&
        shareLink.includes("#v1=") &&
        exact(shared.tiling) === exact(preset.tiling) &&
        restored.ok &&
        restoredPoints.ok &&
        quality.iterations === "1.0M" &&
        quality.supersample === "1×" &&
        initial.ok &&
        initial.round?.start.fourD === fourD,
      `link=${shareLink.includes("#v1=")}, tiling=${restored.ok}, quality=${quality.iterations}/${quality.supersample}, workers=${beforeFlame.workers.length}->${initial.probe.workers.length}, start=${exact(initial.round?.start ?? null)}`,
    );
    check(
      "active GPU terminal",
      initial.ok &&
        initial.round?.outcome?.outcome?.availability === "active" &&
        initial.round.backend?.backend === "gpu" &&
        initial.round.terminal !== null &&
        initial.ui.backend.startsWith("GPU accumulation") &&
        initial.ui.backendWarning === (initial.round.backend.software === true),
      `outcome=${exact(initial.round?.outcome?.outcome ?? null)}, backend=${exact(initial.round?.backend ?? null)}, terminal=${exact(initial.round?.terminal ?? null)}, status=${initial.ui.note || "none"}`,
    );

    if (!initial.ok || !initial.round) {
      const errorText = await visibleErrorText(page);
      check(
        "page errors",
        pageErrors.length === 0,
        pageErrors.length ? pageErrors.join(" | ") : "none",
      );
      check(
        "console errors",
        consoleErrors.length === 0,
        consoleErrors.length ? consoleErrors.join(" | ") : "none",
      );
      check("visible app error", errorText.length === 0, errorText || "none");
      return {
        ok: false,
        preset,
        checks,
        elapsedMs: Date.now() - started,
      };
    }

    let tiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-flame-tiled`,
    );
    let activeTarget = initial;
    if (fourD) {
      const viewResult = await exerciseFourDFlameView(
        page,
        args,
        preset.key,
        initial,
        tiledCapture,
      );
      for (const result of viewResult.checks) checks.push(result);
      tiledCapture = viewResult.capture;
    }
    if (lifecycle) {
      const latest = await exerciseFlameLatestWins(
        page,
        args,
        initial.round?.start.seed,
      );
      for (const result of latest.checks) checks.push(result);
      activeTarget = latest.target;
      tiledCapture = await captureCanvas(
        page,
        args,
        `${preset.key}-flame-latest`,
      );
    }

    const beforeOff = await readFlameWorkerProbe(page);
    await openSection(page, "tilingSection");
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    const off = await waitForFlameRound(
      page,
      null,
      fourD,
      beforeOff.workers.length,
      args.settle,
      activeTarget.round?.start.seed ?? null,
    );
    const untiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-flame-off`,
    );
    const distinctness = await screenshotDiff(
      page,
      tiledCapture.png,
      untiledCapture.png,
    );
    const minDiff = preset.minDiff ?? args.diff;
    check(
      "same-seed tiled/Off Flame frame",
      cleared.ok &&
        off.ok &&
        off.round?.start.seed === activeTarget.round?.start.seed &&
        tiledCapture.metrics.coverage >= args.draw &&
        untiledCapture.metrics.coverage >= args.draw &&
        distinctness.fraction >= minDiff,
      `cleared=${cleared.ok}, seed=${activeTarget.round?.start.seed}->${off.round?.start.seed}, tiled=${(tiledCapture.metrics.coverage * 100).toFixed(2)}%, off=${(untiledCapture.metrics.coverage * 100).toFixed(2)}%, diff=${(distinctness.fraction * 100).toFixed(2)}%/${(minDiff * 100).toFixed(2)}%, status=${off.ui.note || "none"}`,
    );

    const errorText = await visibleErrorText(page);
    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    check("visible app error", errorText.length === 0, errorText || "none");
    return {
      ok: checks.every((entry) => entry.ok),
      preset,
      checks,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function maxWorkerRequestId(probe) {
  return Math.max(0, ...probe.requests.map((request) => request.id ?? 0));
}

/** The generated Flame backdrop legs. Each fixture freezes the displayed
 * Points cloud (Auto-update off) and then re-renders the backdrop alone
 * across a tiling edit, so the frame difference between captures is the
 * backdrop's and nothing else's — the pixel evidence a payload-only
 * assertion cannot supply. */
async function runBackdropPresetLeg(browser, args, fixture) {
  const { preset, fourD } = fixture;
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    const loaded = await loadPreset(page, preset.key);
    const installed = await waitForExactTiling(page, preset.tiling);
    const points = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    // Freeze the cloud: no further edit may regenerate it, so the tiled
    // cloud stays on screen while the backdrop alone re-renders.
    await openSection(page, "transformsSection");
    const autoUpdate = page.locator("#autoUpdate");
    if (await autoUpdate.isChecked()) await autoUpdate.click();
    await openSection(page, "atmosphereSection");
    await page.locator("#background").selectOption("flame");
    const tiled = await waitForBackdropRound(page, preset.tiling, args.settle);
    const tiledCloudProbe = await readCloudWorkerProbe(page);
    await closePanel(page);
    const tiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-backdrop-tiled`,
    );
    check(
      "tiled backdrop worker round",
      loaded &&
        installed.ok &&
        points.ok &&
        tiled.ok &&
        tiled.round.start.seed === BACKDROP_SEED &&
        exact(tiled.round.start.tiling) === exact(preset.tiling) &&
        tiled.round.terminal !== null &&
        tiledCapture.metrics.coverage >= args.draw,
      `link=${loaded}, tiling=${installed.ok}, points=${points.ok}, fourD=${fourD}, seed=${tiled.round?.start.seed ?? "none"}/${BACKDROP_SEED}, tiling=${exact(tiled.round?.start.tiling ?? null)}, drawn=${(tiledCapture.metrics.coverage * 100).toFixed(2)}%`,
    );
    if (!tiled.ok || !tiled.round) {
      check(
        "backdrop page errors",
        pageErrors.length === 0,
        pageErrors.length ? pageErrors.join(" | ") : "none",
      );
      check(
        "backdrop console errors",
        consoleErrors.length === 0,
        consoleErrors.length ? consoleErrors.join(" | ") : "none",
      );
      return {
        ok: checks.every((entry) => entry.ok),
        preset,
        checks,
        elapsedMs: Date.now() - started,
      };
    }

    // Clear tiling from the panel. Auto-update stays off, so Points keeps
    // the tiled cloud; the backdrop re-renders untiled because the tiling
    // control now tracks the generated backdrop even without a regenerate.
    await openSection(page, "tilingSection");
    const toggle = page.locator("#tilingEnabledCheckbox");
    if (await toggle.isChecked()) await toggle.click();
    // exact(null) cannot represent ABSENT tiling (JSON.stringify(undefined)
    // is undefined), so wait on the decoded document directly.
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    const untiled = await waitForBackdropRound(
      page,
      null,
      args.settle,
      tiled.round.start.sequence,
    );
    const untiledCloudProbe = await readCloudWorkerProbe(page);
    await closePanel(page);
    const untiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-backdrop-untiled`,
    );
    const distinctness = await screenshotDiff(
      page,
      tiledCapture.png,
      untiledCapture.png,
    );
    check(
      "untiled backdrop round keeps the cloud frozen and differs",
      cleared.ok &&
        untiled.ok &&
        untiled.round.start.seed === BACKDROP_SEED &&
        exact(untiled.round.start.tiling) === exact(null) &&
        distinctness.fraction >= args.diff &&
        untiledCloudProbe.requests.length === tiledCloudProbe.requests.length,
      `cleared=${cleared.ok}, seed=${untiled.round?.start.seed ?? "none"}/${BACKDROP_SEED}, tiling=${exact(untiled.round?.start.tiling ?? null)}, diff=${(distinctness.fraction * 100).toFixed(2)}%/${(args.diff * 100).toFixed(2)}%, cloudRequests=${tiledCloudProbe.requests.length}->${untiledCloudProbe.requests.length}, terminal=${untiled.round?.terminal !== null}`,
    );

    const errorText = await visibleErrorText(page);
    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    check("visible app error", errorText.length === 0, errorText || "none");
    return {
      ok: checks.every((entry) => entry.ok),
      preset,
      checks,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function printBackdropPreset(result) {
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${`${result.preset.label} backdrop`.padEnd(30)} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s\n`,
  );
  for (const check of result.checks) {
    process.stdout.write(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`,
    );
  }
}

function printSolidPreset(result) {
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${`${result.preset.label} solid`.padEnd(30)} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s\n`,
  );
  for (const check of result.checks) {
    process.stdout.write(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`,
    );
  }
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error(`${element.id || "range"} is not an input`);
    }
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function exact(value) {
  return JSON.stringify(value);
}

async function waitForExactTiling(page, wanted, timeout = 15_000) {
  return waitForDocument(
    page,
    (document) => exact(document.tiling) === exact(wanted),
    timeout,
  );
}

async function pressAndWaitTiling(page, selector, key, wanted) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await control.press(key);
  return waitForExactTiling(page, wanted);
}

async function readActivationTargets(
  page,
  ids = ["tilingEnabledCheckbox", "tilingKind", "tilingGroup", "tilingClip"],
) {
  return page.evaluate(
    ({ ids, minimum }) => {
      const panel = document.getElementById("panel");
      const panelRect = panel?.getBoundingClientRect() ?? null;
      return ids.map((id) => {
        const control = document.getElementById(id);
        if (!control) return { id, missing: true };
        const label = control.closest("label");
        const target = label ?? control;
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const hitPass =
          hit === target ||
          target.contains(hit) ||
          (label && label.contains(hit));
        const unclipped =
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight &&
          (!panelRect ||
            (rect.left >= panelRect.left &&
              rect.right <= panelRect.right &&
              rect.top >= panelRect.top &&
              rect.bottom <= panelRect.bottom));
        return {
          id,
          width: rect.width,
          height: rect.height,
          minimum,
          hitPass,
          unclipped,
          disabled: control.disabled,
        };
      });
    },
    { ids, minimum: TARGET_PX },
  );
}

async function waitForModeNote(page, buttonId, expression, timeout = 10_000) {
  await page.locator(`#${buttonId}`).click();
  const deadline = Date.now() + timeout;
  let note = "";
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      ({ id }) => ({
        pressed:
          document.getElementById(id)?.getAttribute("aria-pressed") === "true",
        note: document.getElementById("tilingNote")?.textContent ?? "",
      }),
      { id: buttonId },
    );
    note = state.note;
    if (state.pressed && expression.test(note)) return { ok: true, note };
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, note };
}

async function waitForTilingNote(page, expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let note = "";
  while (Date.now() < deadline) {
    note = await page.evaluate(
      () => document.getElementById("tilingNote")?.textContent ?? "",
    );
    if (expression.test(note)) return { ok: true, note };
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, note };
}

async function readDormantState(page, reason) {
  return page.evaluate((reasonText) => {
    const checkbox = document.getElementById("tilingEnabledCheckbox");
    const group = document.getElementById("tilingGroup");
    const clip = document.getElementById("tilingClip");
    const note = document.getElementById("tilingNote")?.textContent ?? "";
    return {
      checkboxEnabled:
        checkbox instanceof HTMLInputElement && !checkbox.disabled,
      checkboxChecked:
        checkbox instanceof HTMLInputElement && checkbox.checked === true,
      groupDisabled: group instanceof HTMLSelectElement && group.disabled,
      clipDisabled: clip instanceof HTMLSelectElement && clip.disabled,
      reasonPass: note.includes(reasonText),
      note,
    };
  }, reason);
}

async function runClearLeakLeg(browser, args) {
  const { context, page } = await openApp(browser, args);
  try {
    if (!(await loadPreset(page, "tiledOctahedron"))) {
      return { ok: false, reason: "tiled preset never changed the document" };
    }
    const finite3 = await waitForExactTiling(page, { group: "b3" });
    if (!finite3.ok) {
      return { ok: false, reason: "tiled preset never installed B3" };
    }

    if (!(await loadPreset(page, "mirroredLattice4"))) {
      return {
        ok: false,
        reason: "4D lattice preset never changed the document",
      };
    }
    const lattice4 = await waitForExactTiling(page, {
      kind: "lattice",
      cellScale: 1.6,
    });
    if (!lattice4.ok) {
      return {
        ok: false,
        reason: `lattice preset merged or lost fields: ${exact(lattice4.document?.tiling)}`,
      };
    }

    if (!(await loadPreset(page, "tiledPentatope"))) {
      return {
        ok: false,
        reason: "4D finite preset never changed the document",
      };
    }
    const finite4 = await waitForExactTiling(page, { group: "a4" });
    if (!finite4.ok) {
      return {
        ok: false,
        reason: `finite preset merged or lost fields: ${exact(finite4.document?.tiling)}`,
      };
    }

    if (!(await loadPreset(page, "default"))) {
      return {
        ok: false,
        reason: "ordinary preset never changed the document",
      };
    }
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    return {
      ok: cleared.ok,
      reason: cleared.ok
        ? "finite -> lattice -> finite replaced exactly; ordinary cleared"
        : `ordinary preset retained ${exact(cleared.document?.tiling)}`,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** The focused Solid quality: the smallest stepped grid and budget the panel
 * offers, so the leg's worker and marcher converge quickly without changing
 * the tiling block. */
async function configureFocusedSolidQuality(page) {
  await openSection(page, "rendererQualitySection");
  await setRangeValue(page, "#solidIterationsSlider", 0);
  await setRangeValue(page, "#solidResolutionSlider", 128);
  return page.evaluate(() => ({
    iterations:
      document.getElementById("solidIterationsLabel")?.textContent ?? "",
    resolution:
      document.getElementById("solidResolutionLabel")?.textContent ?? "",
  }));
}

/** The voxel worker probe: Solid's accumulation host. The 3D material leg
 * requires one unchanged host; the 4D deposition leg requires replacement
 * for authored tiling edits but same-host settled view commands. */
function readSolidWorkerProbe(page) {
  return page.evaluate(() => {
    const workers = window.__tilingCloudWorkerProbe?.workers ?? [];
    return {
      workers: workers
        .filter((worker) => worker.url.includes("voxel-worker"))
        .map((worker, index) => ({
          index,
          url: worker.url,
          terminated: worker.terminated === true,
          requests: worker.requests,
          replies: worker.replies,
        })),
    };
  });
}

function solidTerminalGrids(worker) {
  return worker.replies.filter(
    (reply) =>
      reply.type === "grid" &&
      reply.iterationsBudget > 0 &&
      reply.iterationsDone >= reply.iterationsBudget,
  );
}

function matchingSolidRound(
  probe,
  tiling,
  fourD,
  afterCreated = 0,
  expectedSeed = null,
) {
  for (let at = probe.workers.length - 1; at >= afterCreated; at--) {
    const worker = probe.workers[at];
    const start = worker.requests.find(
      (request) =>
        request.type === "start" &&
        request.fourD === fourD &&
        (expectedSeed === null || request.seed === expectedSeed) &&
        exact(request.tiling) === exact(tiling),
    );
    if (!start) continue;
    return {
      worker,
      start,
      terminal: solidTerminalGrids(worker).at(-1) ?? null,
    };
  }
  return null;
}

async function readSolidUi(page) {
  return page.evaluate(() => ({
    active:
      document.getElementById("modeSolidBtn")?.getAttribute("aria-pressed") ===
      "true",
    note: document.getElementById("tilingNote")?.textContent ?? "",
    progress: document.getElementById("solidProgress")?.textContent ?? "",
  }));
}

async function waitForSolidRound(
  page,
  tiling,
  fourD,
  afterCreated,
  timeout,
  expectedSeed = null,
) {
  const deadline = Date.now() + timeout;
  let probe = await readSolidWorkerProbe(page);
  let round = matchingSolidRound(
    probe,
    tiling,
    fourD,
    afterCreated,
    expectedSeed,
  );
  let ui = await readSolidUi(page);
  while (Date.now() < deadline) {
    const notePass =
      tiling === null
        ? ui.note.startsWith("Off — Points, Flame, Solid, and Surface")
        : ui.note.includes("Active in 4D Solid");
    if (
      round?.terminal !== null &&
      ui.active &&
      ui.progress.includes("converged") &&
      notePass
    ) {
      return { ok: true, probe, round, ui };
    }
    await page.waitForTimeout(POLL_MS);
    probe = await readSolidWorkerProbe(page);
    round = matchingSolidRound(
      probe,
      tiling,
      fourD,
      afterCreated,
      expectedSeed,
    );
    ui = await readSolidUi(page);
  }
  return { ok: false, probe, round, ui };
}

async function waitForAdditionalSolidTerminal(
  page,
  workerIndex,
  afterSequence,
  timeout,
  expectedRevision = null,
) {
  const deadline = Date.now() + timeout;
  let probe = await readSolidWorkerProbe(page);
  while (Date.now() < deadline) {
    const worker = probe.workers[workerIndex];
    // Match the LAST command's revision, not merely "any terminal after the
    // command": the worker may post an older endpoint's converged grid in
    // the same delivery window the newer command is recorded in, so probe
    // sequence alone can rank a stale (and, by the app's own revision guard,
    // never-displayed) reply first. Those stale publishes are legitimate
    // worker behavior; the endpoint under test is the newest revision's.
    const terminal = worker
      ? solidTerminalGrids(worker).find(
          (reply) =>
            reply.sequence > afterSequence &&
            (expectedRevision === null ||
              reply.viewRevision === expectedRevision),
        )
      : null;
    const ui = await readSolidUi(page);
    if (terminal && ui.active && ui.progress.includes("converged")) {
      return { ok: true, probe, worker, terminal, ui };
    }
    await page.waitForTimeout(POLL_MS);
    probe = await readSolidWorkerProbe(page);
  }
  return {
    ok: false,
    probe,
    worker: probe.workers[workerIndex] ?? null,
    terminal: null,
    ui: await readSolidUi(page),
  };
}

async function waitForSolidConverged(page, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  let text = "";
  while (Date.now() < deadline) {
    text = await page.evaluate(
      () => document.getElementById("solidProgress")?.textContent ?? "",
    );
    if (text.includes("converged")) return { ok: true, text };
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, text };
}

/** The Sampled Solid legs: drive the real voxel session to a converged
 * budget, capture the tiled frame, flip the tiling checkbox, and capture
 * again. The edit must be material-only — the same worker host with the same
 * grid, re-folding queries per frame — so the frame difference is the tiled
 * geometry's and nothing else's, exactly like the backdrop scope's frozen
 * cloud isolates the backdrop layer. */
async function runSolidPresetLeg(browser, args, fixture) {
  const { preset } = fixture;
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    const loaded = await loadPreset(page, preset.key);
    const installed = await waitForExactTiling(page, preset.tiling);
    const points = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    const quality = await configureFocusedSolidQuality(page);
    const beforeSolid = await readSolidWorkerProbe(page);
    const mode = await waitForModeNote(
      page,
      "modeSolidBtn",
      /(Active in 3D Solid|Unavailable in Solid)/,
      args.settle,
    );
    const converged = await waitForSolidConverged(page, args.settle);
    check(
      "Solid entry and converged budget",
      loaded &&
        installed.ok &&
        points.ok &&
        quality.iterations === "1.0M" &&
        quality.resolution === "128³" &&
        mode.ok &&
        mode.note.includes("Active in 3D Solid") &&
        converged.ok,
      `quality=${quality.iterations}/${quality.resolution}, note=${mode.note || "none"}, status=${converged.text || "none"}`,
    );
    if (!converged.ok) {
      const errorText = await visibleErrorText(page);
      check(
        "page errors",
        pageErrors.length === 0,
        pageErrors.length ? pageErrors.join(" | ") : "none",
      );
      check(
        "console errors",
        consoleErrors.length === 0,
        consoleErrors.length ? consoleErrors.join(" | ") : "none",
      );
      check("visible app error", errorText.length === 0, errorText || "none");
      return {
        ok: false,
        preset,
        checks,
        elapsedMs: Date.now() - started,
      };
    }

    const tiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-solid-tiled`,
    );
    const beforeOff = await readSolidWorkerProbe(page);
    await openSection(page, "tilingSection");
    await page.locator("#tilingEnabledCheckbox").scrollIntoViewIfNeeded();
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    const off = await waitForTilingNote(
      page,
      /Off — Points, Flame, Solid, and Surface render the original attractor once/,
      args.settle,
    );
    await page.waitForTimeout(1_000);
    const untiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-solid-off`,
    );
    const distinctness = await screenshotDiff(
      page,
      tiledCapture.png,
      untiledCapture.png,
    );
    const afterOff = await readSolidWorkerProbe(page);
    const minDiff = preset.minDiff ?? args.diff;
    check(
      "tiled/Off Solid frame with unchanged worker",
      cleared.ok &&
        off.ok &&
        beforeOff.workers.length === afterOff.workers.length &&
        tiledCapture.metrics.coverage >= args.draw &&
        untiledCapture.metrics.coverage >= args.draw &&
        distinctness.fraction >= minDiff,
      `cleared=${cleared.ok}, workers=${beforeOff.workers.length}->${afterOff.workers.length}, tiled=${(tiledCapture.metrics.coverage * 100).toFixed(2)}%, off=${(untiledCapture.metrics.coverage * 100).toFixed(2)}%, diff=${(distinctness.fraction * 100).toFixed(2)}%/${(minDiff * 100).toFixed(2)}%, status=${off.note || "none"}`,
    );

    const errorText = await visibleErrorText(page);
    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    check("visible app error", errorText.length === 0, errorText || "none");
    return {
      ok: checks.every((entry) => entry.ok),
      preset,
      checks,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function authorSolid4TilingEdit(page, nextTiling) {
  await openSection(page, "tilingSection");
  if (nextTiling.kind === "lattice") {
    await setRangeValue(page, "#tilingCellScaleSlider", nextTiling.cellScale);
  } else {
    await page.locator("#tilingGroup").selectOption(nextTiling.group);
  }
  return waitForExactTiling(page, nextTiling);
}

async function exerciseFourDSolidView(page, args, key, target, before) {
  const checks = [];
  if (!target.ok || !target.round) {
    return {
      checks: [
        {
          name: "4D Solid rotor/slice stays in one worker",
          ok: false,
          detail: "no completed active Solid worker was available",
        },
      ],
      capture: before,
      target,
    };
  }
  const workerIndex = target.round.worker.index;
  const beforeProbe = await readSolidWorkerProbe(page);
  const beforeWorker = beforeProbe.workers[workerIndex];
  const beforeStarts = beforeWorker.requests.filter(
    (request) => request.type === "start",
  ).length;
  const beforeRequestCount = beforeWorker.requests.length;
  await openSection(page, "viewControls");
  const autoMotion = page.locator("#autoMotionToggle");
  if (await autoMotion.isChecked()) await autoMotion.click();
  await setRangeValue(page, "#fourDTumbleSpeedSlider", 3);
  await closePanel(page);

  const canvas = page.locator("#container canvas").first();
  await canvas.evaluate((element) => {
    window.__tilingSolidRotorAccepted = 0;
    element.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow") && event.defaultPrevented) {
        window.__tilingSolidRotorAccepted += 1;
      }
    });
  });
  await canvas.focus();
  await page.keyboard.down("Shift");
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
  }
  await page.keyboard.up("Shift");

  await openSection(page, "viewControls");
  const slice = page.locator("#fourDSliceToggle");
  if (!(await slice.isChecked())) await slice.click();
  await setRangeValue(page, "#fourDSliceSlider", 0.35);
  await closePanel(page);

  const afterCommands = await readSolidWorkerProbe(page);
  const commandWorker = afterCommands.workers[workerIndex];
  const viewCommands = commandWorker.requests
    .slice(beforeRequestCount)
    .filter((request) => request.type === "setFourDView");
  const lastViewCommand = viewCommands.at(-1);
  const settled = lastViewCommand
    ? await waitForAdditionalSolidTerminal(
        page,
        workerIndex,
        lastViewCommand.sequence,
        args.settle,
        lastViewCommand.viewRevision,
      )
    : {
        ok: false,
        probe: afterCommands,
        worker: commandWorker,
        terminal: null,
        ui: await readSolidUi(page),
      };
  const after = await captureCanvas(page, args, `${key}-solid4-view-after`);
  const diff = await screenshotDiff(page, before.png, after.png);
  const finalWorker = settled.probe.workers[workerIndex];
  const finalStarts = finalWorker?.requests.filter(
    (request) => request.type === "start",
  ).length;
  const view = await page.evaluate(() => ({
    motion: document.getElementById("autoMotionToggle")?.checked === true,
    slice: document.getElementById("fourDSliceToggle")?.checked === true,
    position: document.getElementById("fourDSliceSlider")?.value ?? "",
    rotorAccepted: window.__tilingSolidRotorAccepted ?? 0,
    note: document.getElementById("tilingNote")?.textContent ?? "",
  }));
  checks.push({
    name: "4D Solid rotor/slice stays in one worker",
    ok:
      settled.ok &&
      settled.probe.workers.length === beforeProbe.workers.length &&
      finalWorker?.terminated === false &&
      finalStarts === beforeStarts &&
      viewCommands.length >= 2 &&
      lastViewCommand?.view?.sliceOn === true &&
      lastViewCommand.view.sliceCenter === 0.35 &&
      lastViewCommand.viewRevision === settled.terminal?.viewRevision &&
      settled.terminal?.hierarchy === "present" &&
      view.rotorAccepted === 8 &&
      !view.motion &&
      view.slice &&
      Number(view.position) === 0.35 &&
      view.note.includes("Active in 4D Solid") &&
      after.metrics.coverage >= args.draw &&
      diff.fraction >= 0.0005,
    detail: `workers=${beforeProbe.workers.length}->${settled.probe.workers.length}, starts=${beforeStarts}->${finalStarts}, viewCommands=${viewCommands.length}, revisions=${lastViewCommand?.viewRevision ?? "none"}/${settled.terminal?.viewRevision ?? "none"}, hierarchy=${settled.terminal?.hierarchy ?? "none"}, terminal=${settled.ok}, draw=${(after.metrics.coverage * 100).toFixed(2)}%, diff=${(diff.fraction * 100).toFixed(2)}%, accepted=${view.rotorAccepted}`,
  });
  return { checks, capture: after, target };
}

/** The 4D Solid representation gate. Unlike the 3D material leg above, an
 * authored tiling edit replaces the voxel worker while retaining its seed;
 * settled rotor/slice endpoints then rebuild inside that replacement worker. */
async function runSolid4PresetLeg(browser, args, fixture) {
  const { preset, nextTiling } = fixture;
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    const loaded = await loadPreset(page, preset.key);
    const installed = await waitForExactTiling(page, preset.tiling);
    const points = await waitForModeNote(
      page,
      "modePointsBtn",
      /Active in Points — .* · complete/,
      args.settle,
    );
    const quality = await configureFocusedSolidQuality(page);
    const beforeSolid = await readSolidWorkerProbe(page);
    const mode = await waitForModeNote(
      page,
      "modeSolidBtn",
      /Active in 4D Solid/,
      args.settle,
    );
    const initial = await waitForSolidRound(
      page,
      preset.tiling,
      true,
      beforeSolid.workers.length,
      args.settle,
    );
    check(
      "4D Solid worker-baked entry",
      loaded &&
        installed.ok &&
        points.ok &&
        quality.iterations === "1.0M" &&
        quality.resolution === "128³" &&
        mode.ok &&
        initial.ok &&
        initial.round?.start.fourD === true &&
        initial.round.terminal?.hierarchy === "present",
      `quality=${quality.iterations}/${quality.resolution}, workers=${beforeSolid.workers.length}->${initial.probe.workers.length}, start=${exact(initial.round?.start ?? null)}, hierarchy=${initial.round?.terminal?.hierarchy ?? "none"}, status=${initial.ui.note || mode.note || "none"}`,
    );
    if (!initial.ok || !initial.round) {
      const errorText = await visibleErrorText(page);
      check(
        "page errors",
        pageErrors.length === 0,
        pageErrors.length ? pageErrors.join(" | ") : "none",
      );
      check(
        "console errors",
        consoleErrors.length === 0,
        consoleErrors.length ? consoleErrors.join(" | ") : "none",
      );
      check("visible app error", errorText.length === 0, errorText || "none");
      return {
        ok: false,
        preset,
        checks,
        elapsedMs: Date.now() - started,
      };
    }

    const beforeEdit = await readSolidWorkerProbe(page);
    const installedEdit = await authorSolid4TilingEdit(page, nextTiling);
    const edited = await waitForSolidRound(
      page,
      nextTiling,
      true,
      beforeEdit.workers.length,
      args.settle,
      initial.round.start.seed,
    );
    const priorWorker = edited.probe.workers[initial.round.worker.index];
    check(
      "same-seed 4D tiling edit replaces the worker",
      installedEdit.ok &&
        edited.ok &&
        priorWorker?.terminated === true &&
        edited.probe.workers.length === beforeEdit.workers.length + 1 &&
        edited.round?.start.seed === initial.round.start.seed &&
        edited.round?.terminal?.hierarchy === "present",
      `authored=${installedEdit.ok}, workers=${beforeEdit.workers.length}->${edited.probe.workers.length}, terminated=${priorWorker?.terminated ?? "missing"}, seed=${initial.round.start.seed}->${edited.round?.start.seed ?? "none"}, hierarchy=${edited.round?.terminal?.hierarchy ?? "none"}`,
    );
    if (!edited.ok || !edited.round) {
      return {
        ok: false,
        preset,
        checks,
        elapsedMs: Date.now() - started,
      };
    }

    let tiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-solid4-edited`,
    );
    const viewResult = await exerciseFourDSolidView(
      page,
      args,
      preset.key,
      edited,
      tiledCapture,
    );
    for (const result of viewResult.checks) checks.push(result);
    tiledCapture = viewResult.capture;

    const beforeOff = await readSolidWorkerProbe(page);
    await openSection(page, "tilingSection");
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    const off = await waitForSolidRound(
      page,
      null,
      true,
      beforeOff.workers.length,
      args.settle,
      edited.round.start.seed,
    );
    const untiledCapture = await captureCanvas(
      page,
      args,
      `${preset.key}-solid4-off`,
    );
    const distinctness = await screenshotDiff(
      page,
      tiledCapture.png,
      untiledCapture.png,
    );
    const minDiff = preset.minDiff ?? args.diff;
    check(
      "same-seed tiled/Off 4D Solid frame",
      cleared.ok &&
        off.ok &&
        off.round?.start.seed === edited.round.start.seed &&
        off.round?.terminal?.hierarchy === "present" &&
        off.probe.workers[edited.round.worker.index]?.terminated === true &&
        off.probe.workers.length === beforeOff.workers.length + 1 &&
        tiledCapture.metrics.coverage >= args.draw &&
        untiledCapture.metrics.coverage >= args.draw &&
        distinctness.fraction >= minDiff,
      `cleared=${cleared.ok}, workers=${beforeOff.workers.length}->${off.probe.workers.length}, seed=${edited.round.start.seed}->${off.round?.start.seed ?? "none"}, hierarchy=${off.round?.terminal?.hierarchy ?? "none"}, tiled=${(tiledCapture.metrics.coverage * 100).toFixed(2)}%, off=${(untiledCapture.metrics.coverage * 100).toFixed(2)}%, diff=${(distinctness.fraction * 100).toFixed(2)}%/${(minDiff * 100).toFixed(2)}%, status=${off.ui.note || "none"}`,
    );

    const errorText = await visibleErrorText(page);
    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    check("visible app error", errorText.length === 0, errorText || "none");
    return {
      ok: checks.every((entry) => entry.ok),
      preset,
      checks,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runAuthoringLeg(browser, args) {
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    await openSection(page, "tilingSection");

    const enabled = await pressAndWaitTiling(
      page,
      "#tilingEnabledCheckbox",
      "Space",
      { group: "a3" },
    );
    check(
      "keyboard toggle",
      enabled.ok,
      enabled.ok ? "Space authored A3" : "Space did not author A3",
    );
    if (!enabled.ok) return { ok: false, checks, pageErrors, consoleErrors };

    await page.locator("#tilingClip").scrollIntoViewIfNeeded();
    const targets = await readActivationTargets(page);
    for (const target of targets) {
      const ok =
        !target.missing &&
        !target.disabled &&
        target.width >= TARGET_PX &&
        target.height >= TARGET_PX &&
        target.hitPass &&
        target.unclipped;
      check(
        `${target.id} target`,
        ok,
        target.missing
          ? "missing"
          : `${target.width.toFixed(1)}x${target.height.toFixed(1)}px, ` +
              `hit=${target.hitPass}, unclipped=${target.unclipped}`,
      );
    }

    const grouped = await pressAndWaitTiling(
      page,
      "#tilingGroup",
      "ArrowDown",
      { group: "b3" },
    );
    check(
      "keyboard group",
      grouped.ok,
      grouped.ok ? "ArrowDown changed A3 to B3" : "group did not become B3",
    );

    const clipBefore = await page.locator("#tilingClip").inputValue();
    await page.locator("#tilingClip").focus();
    await page.locator("#tilingClip").press("ArrowDown");
    const clipped = await waitForDocument(
      page,
      (document) =>
        document.tiling?.group === "b3" && document.tiling.clip !== undefined,
    );
    const clipAfter = await page.locator("#tilingClip").inputValue();
    const groupOnly = { group: "b3" };
    const groupAndClip = clipped.document?.tiling;
    check(
      "keyboard clip",
      clipped.ok && clipAfter !== "" && clipAfter !== clipBefore,
      clipped.ok
        ? `ArrowDown selected ${clipAfter}; chamber remained B3`
        : "clip was not authored independently of B3",
    );

    if (clipped.ok) {
      await page.locator("#tilingClip").press("Control+z");
      const undoClip = await waitForExactTiling(page, groupOnly);
      check(
        "undo clip",
        undoClip.ok,
        undoClip.ok
          ? "restored exact group-only object"
          : "did not restore B3-only",
      );
      await page.keyboard.press("Control+z");
      const undoGroup = await waitForExactTiling(page, { group: "a3" });
      check(
        "undo group",
        undoGroup.ok,
        undoGroup.ok ? "restored exact A3 object" : "did not restore A3",
      );
      await page.keyboard.press("Control+Shift+z");
      const redoGroup = await waitForExactTiling(page, groupOnly);
      check(
        "redo group",
        redoGroup.ok,
        redoGroup.ok
          ? "restored exact B3-only object"
          : "did not restore B3-only",
      );
      await page.keyboard.press("Control+Shift+z");
      const redoClip = await waitForExactTiling(page, groupAndClip);
      check(
        "redo clip",
        redoClip.ok,
        redoClip.ok
          ? "restored exact B3-plus-clip object"
          : "did not restore exact B3-plus-clip object",
      );

      const shareLink = await copyShareLink(page);
      const validShareLink = shareLink.includes("#v1=");
      await page.goto(shareLink, { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction(
        () => {
          const count =
            document.getElementById("pointCount")?.textContent ?? "";
          return Number(count.replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: 60_000 },
      );
      const reloaded = await waitForExactTiling(page, groupAndClip);
      check(
        "copied-link reload",
        validShareLink && reloaded.ok,
        validShareLink && reloaded.ok
          ? "app-copied link restored the exact B3-plus-clip object"
          : "app-copied link was invalid or changed/lost its tiling object",
      );

      await openSection(page, "tilingSection");
      const lattice = await pressAndWaitTiling(
        page,
        "#tilingKind",
        "ArrowDown",
        {
          kind: "lattice",
          cellScale: 1.5,
          clip: groupAndClip.clip,
        },
      );
      check(
        "finite-to-lattice replacement",
        lattice.ok,
        lattice.ok
          ? "kind replaced group with the default cell scale and kept only the shared clip"
          : `conversion produced ${exact(lattice.document?.tiling)}`,
      );

      await page.locator("#tilingCellScaleSlider").scrollIntoViewIfNeeded();
      const latticeTargets = await readActivationTargets(page, [
        "tilingEnabledCheckbox",
        "tilingKind",
        "tilingClip",
      ]);
      for (const target of latticeTargets) {
        const ok =
          !target.missing &&
          !target.disabled &&
          target.width >= TARGET_PX &&
          target.height >= TARGET_PX &&
          target.hitPass &&
          target.unclipped;
        check(
          `${target.id} lattice target`,
          ok,
          target.missing
            ? "missing"
            : `${target.width.toFixed(1)}x${target.height.toFixed(1)}px, ` +
                `hit=${target.hitPass}, unclipped=${target.unclipped}`,
        );
      }

      const scaled = await pressAndWaitTiling(
        page,
        "#tilingCellScaleSlider",
        "ArrowRight",
        {
          kind: "lattice",
          cellScale: 1.55,
          clip: groupAndClip.clip,
        },
      );
      const scaleLabel = await page
        .locator("#tilingCellScaleLabel")
        .textContent();
      check(
        "keyboard lattice scale",
        scaled.ok && scaleLabel?.trim() === "1.55×",
        scaled.ok
          ? `ArrowRight authored 1.55; label=${scaleLabel?.trim()}`
          : `scale edit produced ${exact(scaled.document?.tiling)}`,
      );

      await page.locator("#tilingCellScaleSliderNumber").evaluate((element) => {
        element.focus();
        element.select();
      });
      await page.keyboard.type("2.4");
      await page.keyboard.press("Enter");
      const exactScale = await waitForExactTiling(page, {
        kind: "lattice",
        cellScale: 2.4,
        clip: groupAndClip.clip,
      });
      const exactScaleUi = await page.evaluate(() => ({
        range: document.getElementById("tilingCellScaleSlider")?.value ?? "",
        number:
          document.getElementById("tilingCellScaleSliderNumber")?.value ?? "",
        label:
          document
            .getElementById("tilingCellScaleLabel")
            ?.textContent?.trim() ?? "",
      }));
      check(
        "exact lattice scale",
        exactScale.ok &&
          Number(exactScaleUi.range) === 2.4 &&
          Number(exactScaleUi.number) === 2.4 &&
          exactScaleUi.label === "2.40×",
        exactScale.ok
          ? `numeric companion authored exact 2.4; slider=${exactScaleUi.range}, label=${exactScaleUi.label}`
          : `numeric edit produced ${exact(exactScale.document?.tiling)}`,
      );

      // The clip-bearing B3 authoring scene above is intentionally a panel
      // stress case, not a render fixture. Copy the app's known lightweight
      // lattice showcase so this acceptance cell measures link persistence
      // and renderer entry rather than an unrelated expensive clip.
      const linkFixtureLoaded = await loadPreset(page, "mirroredLattice");
      const linkFixturePoints = await waitForModeNote(
        page,
        "modePointsBtn",
        /Active in Points — .* · complete/,
        args.settle,
      );
      const linkFixture = await waitForExactTiling(page, {
        kind: "lattice",
        cellScale: 1.6,
      });
      check(
        "lattice copied-link fixture",
        linkFixtureLoaded && linkFixturePoints.ok && linkFixture.ok,
        linkFixtureLoaded && linkFixturePoints.ok && linkFixture.ok
          ? "app preset installed the lightweight 1.6 lattice and parked in Points before copying"
          : `preset=${linkFixtureLoaded}, points=${linkFixturePoints.ok}, tiling=${exact(linkFixture.document?.tiling)}`,
      );

      const latticeShareLink = await copyShareLink(page);
      const validLatticeShareLink = latticeShareLink.includes("#v1=");
      await page.goto(latticeShareLink, {
        waitUntil: "load",
        timeout: 60_000,
      });
      await page.waitForFunction(
        () => {
          const count =
            document.getElementById("pointCount")?.textContent ?? "";
          return Number(count.replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: 60_000 },
      );
      const latticeReloaded = await waitForExactTiling(page, {
        kind: "lattice",
        cellScale: 1.6,
      });
      const latticeReloadedPoints = await waitForModeNote(
        page,
        "modePointsBtn",
        /Active in Points — .* · complete/,
        args.settle,
      );
      check(
        "lattice copied-link reload",
        validLatticeShareLink && latticeReloaded.ok && latticeReloadedPoints.ok,
        validLatticeShareLink && latticeReloaded.ok && latticeReloadedPoints.ok
          ? "app-copied link restored the exact lattice object and landed complete tiled Points"
          : `link=${validLatticeShareLink}, tiling=${latticeReloaded.ok}, points=${latticeReloadedPoints.note || "no status"}`,
      );

      // Copy Link intentionally emits a clean public URL and therefore drops
      // this harness's read-only query instrumentation. Keep the exact public
      // reload above as the persistence assertion, then reboot its unchanged
      // app-generated hash with the settle probe enabled for the render cell.
      const instrumentedLatticeLink = new URL(latticeShareLink);
      instrumentedLatticeLink.searchParams.set("surfacestate", "");
      instrumentedLatticeLink.searchParams.set("tilingcase", "copied-link");
      await page.goto(instrumentedLatticeLink.toString(), {
        waitUntil: "load",
        timeout: 60_000,
      });
      await page.waitForFunction(
        () => {
          const count =
            document.getElementById("pointCount")?.textContent ?? "";
          return (
            typeof window.__surfaceState === "function" &&
            Number(count.replace(/[^\d]/g, "")) > 0
          );
        },
        undefined,
        { timeout: 60_000 },
      );
      const instrumentedLatticeReload = await waitForExactTiling(page, {
        kind: "lattice",
        cellScale: 1.6,
      });

      const surfaceButton = await page
        .locator("#modeSurfaceBtn")
        .evaluate((element) => ({
          disabled: element.disabled,
          title: element.title,
        }));
      await armSurfaceProgressProbe(page);
      if (!surfaceButton.disabled) {
        await page.locator("#modeSurfaceBtn").click();
      }
      const copiedLinkTarget = await waitForSurfaceTarget(page, args);
      const copiedLinkState = copiedLinkTarget.state?.probe ?? null;
      const copiedLinkDocument = await readDocument(page);
      const copiedLinkError = await visibleErrorText(page);
      const expectedEngine = args.mode.startsWith("x11:") ? "webgl" : null;
      let copiedLinkCapture = null;
      if (copiedLinkState?.firstFrame) {
        copiedLinkCapture = await captureCanvas(
          page,
          args,
          "lattice-copied-link",
        );
      }
      const copiedLinkRenderPass =
        !surfaceButton.disabled &&
        instrumentedLatticeReload.ok &&
        copiedLinkTarget.ok &&
        copiedLinkState?.mode === "surface" &&
        copiedLinkState.settled === true &&
        (expectedEngine === null ||
          copiedLinkState.engine === expectedEngine) &&
        exact(copiedLinkDocument.tiling) ===
          exact({
            kind: "lattice",
            cellScale: 1.6,
          }) &&
        copiedLinkCapture !== null &&
        copiedLinkCapture.metrics.coverage >= args.draw &&
        copiedLinkError.length === 0;
      check(
        "lattice copied-link render",
        copiedLinkRenderPass,
        copiedLinkRenderPass
          ? `app-copied link re-entered Surface on ${copiedLinkState.engine}, exposed progress, settled, and drew ${(copiedLinkCapture.metrics.coverage * 100).toFixed(2)}%`
          : `disabled=${surfaceButton.disabled} title=${surfaceButton.title || "none"}; mode=${copiedLinkState?.mode ?? "none"}, engine=${copiedLinkState?.engine ?? "none"}, progress=${copiedLinkTarget.progressSeen}, settled=${Boolean(copiedLinkState?.settled)}, drawn=${copiedLinkCapture === null ? "none" : `${(copiedLinkCapture.metrics.coverage * 100).toFixed(2)}%`}, error=${copiedLinkError || "none"}`,
      );
    }

    await openSection(page, "tilingSection");
    const modeChecks = [
      ["modePointsBtn", /Active in Points — .* · complete/],
      ["modeSolidBtn", /(Active|Unavailable) in Solid/],
    ];
    for (const [button, expression] of modeChecks) {
      const mode = await waitForModeNote(
        page,
        button,
        expression,
        button === "modePointsBtn" ? args.settle : 10_000,
      );
      check(
        `${button} disclosure`,
        mode.ok,
        mode.note || "adjacent tiling note stayed empty",
      );
      if (button !== "modePointsBtn") {
        await waitForModeNote(
          page,
          "modePointsBtn",
          /Active in Points — .* · complete/,
          args.settle,
        );
      }
    }

    if (clipped.ok) {
      await openSection(page, "tilingSection");
      const finiteAgain = await pressAndWaitTiling(
        page,
        "#tilingKind",
        "ArrowUp",
        { group: "a3" },
      );
      check(
        "lattice-to-finite replacement",
        finiteAgain.ok,
        finiteAgain.ok
          ? "kind cleared the lattice discriminator/scale without leaking stale clip state"
          : `conversion produced ${exact(finiteAgain.document?.tiling)}`,
      );
    }

    await openSection(page, "balloonSection");
    await page.locator("#balloonEchoCheckbox").focus();
    await page.locator("#balloonEchoCheckbox").press("Space");
    const balloonAuthored = await waitForDocument(
      page,
      (document) => document.balloonEcho === true,
    );
    await openSection(page, "tilingSection");
    const balloon = await readDormantState(page, "Unavailable with Balloon");
    check(
      "Balloon dormant details",
      balloonAuthored.ok &&
        balloon.checkboxEnabled &&
        balloon.checkboxChecked &&
        balloon.groupDisabled &&
        balloon.clipDisabled &&
        balloon.reasonPass,
      balloon.note,
    );
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const balloonClear = await waitForDocument(
      page,
      (document) =>
        document.tiling === undefined && document.balloonEcho === true,
    );
    check(
      "Balloon clear recovery",
      balloonClear.ok,
      balloonClear.ok
        ? "enabled checkbox cleared tiling without clearing Balloon"
        : "checkbox did not clear the dormant tiling block",
    );

    await openSection(page, "balloonSection");
    await page.locator("#balloonEchoCheckbox").focus();
    await page.locator("#balloonEchoCheckbox").press("Space");
    await waitForDocument(page, (document) => document.balloonEcho !== true);
    await openSection(page, "tilingSection");
    const reenabled = await pressAndWaitTiling(
      page,
      "#tilingEnabledCheckbox",
      "Space",
      { group: "a3" },
    );
    check(
      "re-enable for Symmetry",
      reenabled.ok,
      reenabled.ok
        ? "restored a finite block"
        : "could not restore finite tiling",
    );
    await openSection(page, "symmetrySection");
    await page.locator("#symmetryOrderSlider").focus();
    await page.locator("#symmetryOrderSlider").press("ArrowRight");
    const symmetryAuthored = await waitForDocument(
      page,
      (document) => document.symmetry?.order === 2,
    );
    await openSection(page, "tilingSection");
    const symmetry = await readDormantState(page, "Unavailable with Symmetry");
    check(
      "Symmetry dormant details",
      symmetryAuthored.ok &&
        symmetry.checkboxEnabled &&
        symmetry.checkboxChecked &&
        symmetry.groupDisabled &&
        symmetry.clipDisabled &&
        symmetry.reasonPass,
      symmetry.note,
    );
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const symmetryClear = await waitForDocument(
      page,
      (document) =>
        document.tiling === undefined && document.symmetry?.order === 2,
    );
    check(
      "Symmetry clear recovery",
      symmetryClear.ok,
      symmetryClear.ok
        ? "enabled checkbox cleared tiling without clearing Symmetry"
        : "checkbox did not clear the dormant tiling block",
    );

    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    return {
      ok: checks.every((entry) => entry.ok),
      checks,
      pageErrors,
      consoleErrors,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runMalformedDecodeLeg(browser, args) {
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const checks = [];
  try {
    const baselineLink = await copyShareLink(page);
    const baseline = decodeHash(new URL(baselineLink).hash);
    const malformed = [
      {
        name: "lattice string scale",
        value: { kind: "lattice", cellScale: "2" },
      },
      {
        name: "lattice cross-arm group",
        value: { kind: "lattice", cellScale: 2, group: "a3" },
      },
      { name: "unknown finite group", value: { group: "z9" } },
    ];
    for (const [index, candidate] of malformed.entries()) {
      const document = {
        ...baseline,
        pointSize: 1.23,
        tiling: candidate.value,
      };
      await page.goto(
        `${args.url}/?surfacestate&malformed=${index}${encodeHash(document)}`,
        {
          waitUntil: "load",
          timeout: 60_000,
        },
      );
      await page.waitForFunction(
        () => {
          const count =
            document.getElementById("pointCount")?.textContent ?? "";
          return Number(count.replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: 60_000 },
      );
      await openSection(page, "tilingSection");
      const panel = await page.evaluate(() => {
        const checkbox = document.getElementById("tilingEnabledCheckbox");
        const controls = document.getElementById("tilingControls");
        return {
          checked:
            checkbox instanceof HTMLInputElement && checkbox.checked === true,
          controlsHidden: controls?.classList.contains("hidden") === true,
        };
      });
      const shareLink = await copyShareLink(page);
      const shared = decodeHash(new URL(shareLink).hash);
      const ok =
        panel.checked === false &&
        panel.controlsHidden &&
        shared.tiling === undefined &&
        shared.pointSize === 1.23 &&
        exact(shared.transforms) === exact(baseline.transforms);
      checks.push({
        name: candidate.name,
        ok,
        detail: ok
          ? "tiling decoded quietly to absent while the distinctive valid scene survived canonically"
          : `panel=${exact(panel)}, tiling=${exact(shared.tiling)}, pointSize=${exact(shared.pointSize)}, transformsPreserved=${exact(shared.transforms) === exact(baseline.transforms)}`,
      });
    }
    checks.push({
      name: "malformed page errors",
      ok: pageErrors.length === 0,
      detail: pageErrors.length ? pageErrors.join(" | ") : "none",
    });
    checks.push({
      name: "malformed console errors",
      ok: consoleErrors.length === 0,
      detail: consoleErrors.length ? consoleErrors.join(" | ") : "none",
    });
    return { ok: checks.every((entry) => entry.ok), checks };
  } finally {
    await context.close().catch(() => {});
  }
}

function printPreset(result) {
  const coverage =
    result.coverage === null || result.coverage === undefined
      ? "n/a"
      : `${(result.coverage * 100).toFixed(2)}%`;
  const backend = result.backend
    ? `${result.backend.software ? "software" : "hardware"}:${result.backend.label ?? "?"}`
    : "n/a";
  const expected = result.expectedEngine ?? "reported-only";
  const difference = result.distinctness
    ? `${(result.distinctness.fraction * 100).toFixed(2)}%/${(
        result.minDiff * 100
      ).toFixed(2)}%`
    : "n/a";
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${result.preset.label.padEnd(20)} ` +
      `tiling=${exact(result.preset.tiling)} ` +
      `engine=${result.engine ?? "none"}/${expected} ` +
      `progress=${String(Boolean(result.progressSeen))} ` +
      `drawn=${coverage} tiled/untiled=${difference} backend=${backend} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s` +
      `${result.reason ? ` — ${result.reason}` : ""}\n`,
  );
  for (const error of result.pageErrors ?? []) {
    process.stdout.write(`  page error: ${error}\n`);
  }
  for (const error of result.consoleErrors ?? []) {
    process.stdout.write(`  console error: ${error}\n`);
  }
  if (result.errorText)
    process.stdout.write(`  app error: ${result.errorText}\n`);
}

function printPointsPreset(result) {
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${`${result.preset.label} Points`.padEnd(27)} ` +
      `tiling=${exact(result.preset.tiling)} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s\n`,
  );
  for (const check of result.checks) {
    process.stdout.write(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`,
    );
  }
}

function printFlamePreset(result) {
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${`${result.preset.label} Flame`.padEnd(27)} ` +
      `tiling=${exact(result.preset.tiling)} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s\n`,
  );
  for (const check of result.checks) {
    process.stdout.write(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`,
    );
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const launch = launchOptions(args.mode);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    ...launch,
  });
  let failed = false;
  try {
    process.stdout.write(
      `[tiling-ui] mode=${args.mode}, viewport=${args.width}x${args.height}, ` +
        `scope=${args.scope}, target=${args.stage === SETTLE_SAMPLES ? "settled" : `${args.stage}/${SETTLE_SAMPLES} completed passes`}\n`,
    );
    if (args.scope === "all") {
      for (const preset of PRESETS) {
        const result = await runPresetLeg(browser, args, preset);
        printPreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all" || args.scope === "points") {
      for (const fixture of POINTS_PRESETS) {
        const result = await runPointsPresetLeg(browser, args, fixture);
        printPointsPreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all" || args.scope === "flame") {
      for (const fixture of FLAME_PRESETS) {
        const result = await runFlamePresetLeg(browser, args, fixture);
        printFlamePreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all" || args.scope === "backdrop") {
      for (const fixture of BACKDROP_PRESETS) {
        const result = await runBackdropPresetLeg(browser, args, fixture);
        printBackdropPreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all" || args.scope === "solid") {
      for (const fixture of SOLID_PRESETS) {
        const result = await runSolidPresetLeg(browser, args, fixture);
        printSolidPreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all" || args.scope === "solid4") {
      for (const fixture of SOLID4_PRESETS) {
        const result = await runSolid4PresetLeg(browser, args, fixture);
        printSolidPreset(result);
        if (!result.ok) failed = true;
      }
    }

    if (args.scope === "all") {
      const clear = await runClearLeakLeg(browser, args);
      process.stdout.write(
        `${clear.ok ? "PASS" : "FAIL"}  absent-means-clear — ${clear.reason}\n`,
      );
      if (!clear.ok) failed = true;

      const authoring = await runAuthoringLeg(browser, args);
      for (const result of authoring.checks) {
        process.stdout.write(
          `${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}\n`,
        );
      }
      if (!authoring.ok) failed = true;

      const malformed = await runMalformedDecodeLeg(browser, args);
      for (const result of malformed.checks) {
        process.stdout.write(
          `${result.ok ? "PASS" : "FAIL"}  malformed ${result.name} — ${result.detail}\n`,
        );
      }
      if (!malformed.ok) failed = true;
    }
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
}

run().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[tiling-ui] ${message}\n`);
  process.exit(error instanceof CheckingError ? 2 : 2);
});
