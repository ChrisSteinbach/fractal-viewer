#!/usr/bin/env node
/**
 * Finite-reflection tiling + Balloon production gate, in both dimensions.
 * Points / Flame / Solid and both Surface engines must restore the authored
 * pair, complete real output, disclose active tiling and produce visible echo
 * pixels against an echo-off boot at the identical copied camera/rotor and
 * actual worker seed. Points keeps the application's reproducible boot seed;
 * Flame/Solid entry seeds are pinned at the observed worker message boundary,
 * preserving production kernels and ordinary window randomness (Three UUIDs).
 * The restored positive loads the app's own Copy-link payload before any
 * uniform edits. 1x Save-PNG downloads are compared as images too.
 *
 * The lifecycle scope drives finite -> lattice -> finite with Auto-update
 * disabled in Points. A held finite cloud must retain its echo until the
 * replacement lands, and a held lattice cloud must remain
 * echo-free until the finite replacement lands. Shader flags and worker
 * requests are observed without replacing any rendering path.
 *
 * --look=true adds separate tint and independent-palette image controls plus
 * an echo-off inert control. All screenshots hide overlays and decode only
 * captured PNGs; live WebGL canvas readback is never used. GPU work is serial.
 *
 * npm run build && npm run preview &
 * node scripts/tiling-balloon.verify.mjs --display=:0
 * Options: --url=URL --only=points|flame|solid|surface --dimension=3|4
 * --engine=compute|webgl|both --scope=all|render|lifecycle --look=true|false
 * --export=true|false --settle=240000 --outdir=scripts/out/tiling-balloon-browser
 * Omit --display for SwiftShader. Exit 0 passes; failed legs exit 1.
 * This instrument's first qualification is recorded in its results.json and
 * docs/tiling-contract.md; the script contains no claimed unperformed run.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
} from "./lib/surface-browser-runner.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const at = arg.indexOf("=");
    assert(at > 2, `Expected --option=value, got ${arg}`);
    return [arg.slice(2, at), arg.slice(at + 1)];
  }),
);
const url = (options.url ?? "https://localhost:4173").replace(/\/+$/, "");
const mode = options.display ? `x11:${options.display}` : "sw";
const engine = options.engine ?? "both";
const settle = Number(options.settle ?? 240_000);
const outdir = path.resolve(
  options.outdir ?? "scripts/out/tiling-balloon-browser",
);
const renderers = options.only
  ? [options.only]
  : ["points", "flame", "solid", "surface"];
assert(["compute", "webgl", "both"].includes(engine));
const engines = engine === "both" ? ["compute", "webgl"] : [engine];
const dimensions = options.dimension ? [Number(options.dimension)] : [3, 4];
const scope = options.scope ?? "all";
const exportPng = options.export !== "false";
const lookControls = options.look === "true";
assert(dimensions.every((d) => d === 3 || d === 4));
assert(["all", "render", "lifecycle"].includes(scope));
assert(
  renderers.every((r) => ["points", "flame", "solid", "surface"].includes(r)),
);
assert(Number.isFinite(settle) && settle > 0);
const viewport = { width: 640, height: 480 };
const BACKDROP = [13, 13, 24];
const exact = (value) => JSON.stringify(value);
const encode = (document) =>
  `#v1=${Buffer.from(exact(document), "utf8").toString("base64url")}`;
const decode = (hash) =>
  JSON.parse(
    Buffer.from(hash.replace(/^#v1=/, ""), "base64url").toString("utf8"),
  );

function scene(dimension, renderer = "points") {
  const s = Math.sqrt(5) / 8;
  const transforms =
    dimension === 3
      ? [
          [0.5, 0.5, 0.5],
          [-0.5, 0.5, -0.5],
          [0.5, -0.5, -0.5],
          [-0.5, -0.5, 0.5],
        ].map((position) => ({
          position,
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        }))
      : [
          [s, s, s, -0.125],
          [s, -s, -s, -0.125],
          [-s, s, -s, -0.125],
          [-s, -s, s, -0.125],
          [0, 0, 0, 0.5],
        ].map(([x, y, z, w]) => ({
          position: [x, y, z],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { position: w },
        }));
  return {
    transforms,
    // The 4D Points echo uses the fixed 0.055 per-sample intensity and spreads
    // images over the visible shell. Give that source its ordinary 1M budget
    // so the downsampled echo has pixels; the image threshold stays fixed.
    numPoints: dimension === 4 && renderer === "points" ? 1_000_000 : 120_000,
    // Balloon has its own fixed point-size material. Shrink the dense 4D
    // primary so its extra source budget does not wash the tetrahedron white.
    pointSize: dimension === 4 && renderer === "points" ? 0.5 : 1.5,
    colorMode: "transform",
    colorGamma: 1,
    rampPaletteId: "legacy",
    fourDColor: "wBlueOrange",
    fourDDepthFade: false,
    renderStyle: "depthFade",
    showGuides: false,
    flame: {
      exposure: 1,
      iterations: 1_000_000,
      gamma: 2.4,
      vibrancy: 1,
      supersample: 1,
      estimatorRadius: 6,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
      paletteId: "spectrum",
    },
    solid: {
      resolution: 128,
      iterations: 1_000_000,
      threshold: 0.3,
      lightAzimuth: 135,
      lightElevation: 50,
      ambient: 0.25,
      paletteId: "spectrum",
    },
    surface: {
      antialiasSamples: 1,
      lightAzimuth: 135,
      lightElevation: 50,
      ambient: 0.25,
      colorSource: "transform",
      paletteId: "spectrum",
      colorSpeed: 0.5,
    },
    symmetry: { order: 1, plane: "xy" },
    tiling: { group: dimension === 3 ? "a3" : "a4" },
    glowBrightness: 1,
    balloonEcho: true,
    // The projected Solid volume has near-centre density which sends a 0.5x
    // inversion outside this camera. A smaller radius exposes the source and
    // echo together, instead of putting every ray inside a noisy shell.
    balloonRadius: dimension === 4 ? (renderer === "solid" ? 0.1 : 0.5) : 0.5,
    balloonTint: "#00ff88",
    balloonTintStrength: 0.42,
    balloonPaletteId: "ember",
    fogDensity: 0.3,
    fogTint: "#ffffff",
    fogTintStrength: 0,
    groundPlane: false,
    // Authored flat backdrop makes background occupancy independently
    // measurable, including a rejection of a camera embedded in the echo.
    background: { mode: "custom", top: "#0d0d18", bottom: "#0d0d18" },
    camera: {
      target: [0, 0, 0],
      radius: dimension === 3 ? 4.7 : 3.2,
      theta: 0.71,
      phi: 1.1,
      fov: 50,
      infiniteZoom: true,
    },
    ...(dimension === 4
      ? {
          fourD: {
            p: [0.9847, 0.1741, 0, 0],
            q: [0.9847, -0.1741, 0, 0],
            sliceOn: false,
            sliceCenter: 0,
            sliceThickness: 0,
            sliceRelColor: false,
          },
        }
      : {}),
  };
}

/** Pin renderer-entry seeds and observe message metadata, retaining no
 * transferred point or voxel buffers. Window randomness stays untouched. */
function observeWorkers() {
  const probe = { serial: 0, workers: [] };
  window.__tilingBalloonWorkers = probe;
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args);
      const entry = { url: String(args[0]), sent: [], replies: [] };
      probe.workers.push(entry);
      const send = worker.postMessage.bind(worker);
      worker.postMessage = (data, transfer) => {
        // Only renderer-entry seed choice is pinned. Keep window randomness
        // intact (Three uses it for UUIDs), and preserve the real production
        // workers, RNG streams, kernels and every other message field.
        if (
          data?.type === "start" &&
          /(?:flame|voxel)-worker/.test(entry.url)
        ) {
          data = { ...data, seed: 0x71e52026 };
        }
        entry.sent.push({
          serial: ++probe.serial,
          type: data?.type ?? "cloud",
          id: data?.id,
          seed: data?.seed,
          balloonEcho: data?.balloonEcho,
          balloon: data?.balloon,
          tiling: data?.tiling,
          fourD: Boolean(data?.fourD),
        });
        return transfer === undefined ? send(data) : send(data, transfer);
      };
      worker.addEventListener("message", ({ data }) => {
        entry.replies.push({
          serial: ++probe.serial,
          type: data?.type ?? "cloud",
          id: data?.id,
          count: data?.count,
          pointTiling: data?.pointTiling,
          tilingOriginRadius: data?.tilingOriginRadius,
          backend: data?.backend,
          software: data?.software,
          adapter: data?.adapter,
          outcome: data?.outcome,
          iterationsDone: data?.iterationsDone,
          iterationsBudget: data?.iterationsBudget,
        });
      });
      return worker;
    },
  });
}

/** Observe the actual uploaded Points echo ball without accessing scene.ts.
 * Program draws are counted separately from uniform writes, so an inert
 * compiled program cannot stand in for a visible echo. */
function observeEchoProgram() {
  const probe = { uniforms: {}, draws: 0 };
  window.__tilingBalloonEcho = probe;
  const locations = new WeakMap();
  const programs = new WeakSet();
  for (const prototype of [
    WebGLRenderingContext.prototype,
    WebGL2RenderingContext.prototype,
  ]) {
    const get = prototype.getUniformLocation;
    prototype.getUniformLocation = function (program, name) {
      const location = get.call(this, program, name);
      if (location && name.startsWith("uEcho")) {
        locations.set(location, name);
        programs.add(program);
      }
      return location;
    };
    for (const method of ["uniform1f", "uniform3f", "uniform3fv"]) {
      const original = prototype[method];
      prototype[method] = function (location, ...values) {
        const name = locations.get(location);
        if (name)
          probe.uniforms[name] =
            method === "uniform3fv"
              ? Array.from(values[0])
              : values.length === 1
                ? values[0]
                : values;
        return original.call(this, location, ...values);
      };
    }
    let current = null;
    const use = prototype.useProgram;
    prototype.useProgram = function (program) {
      current = program;
      return use.call(this, program);
    };
    for (const method of ["drawArrays", "drawElements"]) {
      const original = prototype[method];
      prototype[method] = function (...args) {
        if (current && programs.has(current)) probe.draws++;
        return original.call(this, ...args);
      };
    }
  }
}

function observeFrameCadence() {
  const probe = { gaps: [], visibility: document.visibilityState };
  window.__tilingBalloonFrames = probe;
  let previous;
  const tick = (now) => {
    if (previous !== undefined) {
      probe.gaps.push(now - previous);
      if (probe.gaps.length > 16) probe.gaps.shift();
    }
    previous = now;
    probe.visibility = document.visibilityState;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function waitReady(page, renderer, { active = true, after = 0 } = {}) {
  const button = `mode${renderer[0].toUpperCase()}${renderer.slice(1)}Btn`;
  const deadline = Date.now() + settle;
  let reportDue = Date.now() + 15_000;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      ({ renderer, button, after }) => {
        const workers = window.__tilingBalloonWorkers.workers;
        const name =
          renderer === "solid"
            ? "voxel-worker"
            : renderer === "points"
              ? "cloud-worker"
              : "flame-worker";
        const worker = workers.filter((w) => w.url.includes(name)).at(-1);
        const terminal = worker?.replies.findLast(
          (r) =>
            r.serial > after &&
            (renderer === "points"
              ? r.count > 0
              : r.iterationsBudget > 0 &&
                r.iterationsDone >= r.iterationsBudget),
        );
        return {
          pressed:
            document.getElementById(button)?.getAttribute("aria-pressed") ===
            "true",
          note: document.getElementById("tilingNote")?.textContent ?? "",
          progress:
            document.getElementById(`${renderer}Progress`)?.textContent ?? "",
          worker,
          terminal,
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          frameCadence: window.__tilingBalloonFrames,
        };
      },
      { renderer, button, after },
    );
    const activeNote =
      renderer === "solid"
        ? /Active in [34]D Solid/.test(last.note)
        : last.note.includes(
            `Active in ${renderer[0].toUpperCase()}${renderer.slice(1)}`,
          );
    if (last.pressed && (!active || activeNote)) {
      if (renderer === "surface") {
        const state = await pollSurfaceState(page);
        last.surface = state.probe;
        if (state.settled) return { ...last, surface: state.probe };
      } else if (
        last.terminal &&
        (renderer !== "solid" || last.progress.includes("converged"))
      ) {
        await page.waitForTimeout(500);
        return last;
      }
    }
    if (Date.now() >= reportDue) {
      console.log(
        exact({
          waiting: renderer,
          remainingMs: Math.max(0, deadline - Date.now()),
          progress: last.progress,
          visibility: last.visibility,
          focused: last.focused,
          frameCadence: last.frameCadence,
          surface: last.surface,
        }),
      );
      reportDue = Date.now() + 15_000;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`${renderer} did not complete: ${exact(last)}`);
}

async function copyLink(page) {
  return page.evaluate(async () => {
    let copied = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          copied = text;
        },
      },
    });
    document.getElementById("copyLinkBtn").click();
    const deadline = performance.now() + 10_000;
    while (copied === null && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (copied === null) throw new Error("Copy link produced no payload");
    return copied;
  });
}

async function capture(page, name) {
  await page.addStyleTag({
    content:
      "#panel,#help,#legend,#menuToggle,#loading,#error,#updateBanner,#renderError,#toast { visibility: hidden !important; } #container canvas { outline: none !important; }",
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  const png = await page.locator("#container canvas").first().screenshot();
  await writeFile(path.join(outdir, `${name}.png`), png);
  return png;
}

async function compare(page, positive, negative) {
  return page.evaluate(
    async ({ a, b, backdrop }) => {
      async function pixels(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 192;
        const context = canvas.getContext("2d");
        // Points exports may retain transparent backdrop pixels. Composite
        // them on this fixture's authored backdrop exactly as the page does.
        context.fillStyle = `rgb(${backdrop.join(",")})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const first = await pixels(a);
      const second = await pixels(b);
      let foreground = 0;
      let background = 0;
      let changed = 0;
      let absolute = 0;
      let total = 0;
      for (let y = 10; y < 182; y++)
        for (let x = 13; x < 243; x++) {
          const at = (y * 256 + x) * 4;
          let backdropDelta = 0;
          let diff = 0;
          for (let c = 0; c < 3; c++) {
            backdropDelta = Math.max(
              backdropDelta,
              Math.abs(first[at + c] - backdrop[c]),
            );
            diff = Math.max(diff, Math.abs(first[at + c] - second[at + c]));
            absolute += Math.abs(first[at + c] - second[at + c]);
          }
          if (backdropDelta > 10) foreground++;
          if (backdropDelta <= 3) background++;
          if (diff > 12) changed++;
          total++;
        }
      return {
        coverage: foreground / total,
        backdrop: background / total,
        difference: changed / total,
        meanAbs: absolute / (total * 3),
      };
    },
    {
      a: positive.toString("base64"),
      b: negative.toString("base64"),
      backdrop: BACKDROP,
    },
  );
}

async function createPage(browser) {
  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  await page.addInitScript(observeWorkers);
  await page.addInitScript(observeEchoProgram);
  await page.addInitScript(observeFrameCadence);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page, errors };
}

async function boot(page, document, engine, restoredLink) {
  const target = new URL(restoredLink ?? `${url}/${encode(document)}`);
  target.searchParams.set("surfacestate", "");
  target.searchParams.delete(
    engine === "webgl" ? "surfacecompute" : "surfacegl",
  );
  target.searchParams.set(
    engine === "webgl" ? "surfacegl" : "surfacecompute",
    "",
  );
  await page.goto(target.href, { waitUntil: "load", timeout: 60_000 });
  await page.bringToFront();
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
}

async function edit(page, id, value, kind = "input") {
  await page.evaluate(
    ({ id, value, kind }) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing control ${id}`);
      if (element.disabled) throw new Error(`Disabled control ${id}`);
      if (kind === "checkbox") {
        if (element.checked !== value) element.click();
      } else {
        element.value = String(value);
        element.dispatchEvent(new Event(kind, { bubbles: true }));
        if (kind !== "change")
          element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { id, value, kind },
  );
}

async function savePng(page, name) {
  await edit(page, "exportScale", "1", "change");
  const downloadPromise = page.waitForEvent("download", { timeout: settle });
  await page.locator("#savePngBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  assert.equal(await download.failure(), null, `${name} PNG download`);
  const filename = await download.path();
  assert(filename, `${name} downloaded file is absent`);
  const bytes = await readFile(filename);
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${name} PNG signature`,
  );
  await writeFile(path.join(outdir, `${name}-export.png`), bytes);
  return bytes;
}

function assertAuthored(actual, wanted, label) {
  for (const key of [
    "tiling",
    "balloonEcho",
    "balloonRadius",
    "balloonTint",
    "balloonTintStrength",
    "balloonPaletteId",
    "camera",
    "fourD",
    "background",
  ]) {
    assert.deepEqual(actual[key], wanted[key], `${label} copied ${key}`);
  }
}

function assertEchoBall(ready, echo, document, name) {
  if (!document.balloonEcho || ready.terminal?.pointTiling?.kind !== "finite")
    return;
  const radius = ready.terminal.tilingOriginRadius;
  assert(
    radius > 0,
    `${name} worker omitted the certified finite origin radius`,
  );
  assert(echo.draws > 0, `${name} no Points echo program drew`);
  assert.deepEqual(
    echo.uniforms.uEchoCenter,
    [0, 0, 0],
    `${name} Points echo origin`,
  );
  assert(
    Math.abs(echo.uniforms.uEchoR / (document.balloonRadius * radius) - 1) <
      1e-6,
    `${name} Points echo radius differs from landed worker ball`,
  );
}

async function runScene(
  browser,
  document,
  renderer,
  name,
  selectedEngine,
  { restoredLink, save = exportPng } = {},
) {
  const session = await createPage(browser);
  const { context, page, errors } = session;
  try {
    await boot(page, document, selectedEngine, restoredLink);
    if (renderer !== "points") {
      const button = page.locator(
        `#mode${renderer[0].toUpperCase()}${renderer.slice(1)}Btn`,
      );
      assert.equal(await button.isDisabled(), false, `${name} entry refused`);
      await button.evaluate((element) => element.click());
    }
    const ready = await waitReady(page, renderer);
    const copiedLink = await copyLink(page);
    const copied = decode(new URL(copiedLink).hash);
    assertAuthored(copied, document, name);
    assert.equal(
      await page.locator("#balloonEchoCheckbox").isDisabled(),
      false,
      `${name} Balloon refused`,
    );
    let backend = null;
    if (renderer === "surface") {
      assert.equal(
        ready.surface.engine,
        selectedEngine,
        `${name} Surface engine`,
      );
      assert(
        ready.surface.census?.covered > 0,
        `${name} settled Surface has no hits`,
      );
      backend = ready.surface.backend;
      if (options.display)
        assert.equal(
          backend.software,
          false,
          `${name} hardware Surface backend`,
        );
    } else if (renderer === "flame") {
      backend = ready.worker.replies.findLast((r) => r.type === "backend");
      assert.equal(backend?.backend, "gpu", `${name} tiled Flame GPU route`);
      if (options.display)
        assert.equal(backend.software, false, `${name} hardware Flame backend`);
    }
    const png = await capture(page, name);
    const echo = await page.evaluate(() => window.__tilingBalloonEcho);
    if (renderer === "points") assertEchoBall(ready, echo, document, name);
    const exported = save ? await savePng(page, name) : null;
    assert.deepEqual(errors, [], `${name} browser errors`);
    const start = ready.worker?.sent.find(
      (s) => s.type === (renderer === "points" ? "cloud" : "start"),
    );
    return {
      ...session,
      png,
      exported,
      copied,
      copiedLink,
      ready,
      echo,
      seed: start?.seed ?? null,
      backend,
    };
  } catch (error) {
    await context.close();
    throw new Error(
      `${name}: ${error instanceof Error ? error.message : String(error)}; browser errors: ${exact(errors)}`,
      { cause: error },
    );
  }
}

function assertVisibleEcho(metrics, name) {
  assert(metrics.coverage >= 0.005, `${name} no foreground: ${exact(metrics)}`);
  assert(
    metrics.difference >= 0.01,
    `${name} echo did not change visible pixels: ${exact(metrics)}`,
  );
  assert(
    metrics.backdrop >= 0.1,
    `${name} no meaningful backdrop remains (camera inside echo): ${exact(metrics)}`,
  );
}

async function runLookControls(
  browser,
  reference,
  document,
  renderer,
  selectedEngine,
  name,
) {
  const results = [];
  // Each changed arm and its inert control boots the exact same scene seed,
  // camera and 4D pose; a different Monte Carlo orbit cannot qualify a knob.
  for (const [key, value] of [
    ["balloonTintStrength", 1],
    ["balloonPaletteId", "lagoon"],
  ]) {
    const changed = { ...document, [key]: value };
    let on;
    let off;
    try {
      on = await runScene(
        browser,
        changed,
        renderer,
        `${name}-${key}`,
        selectedEngine,
        { save: false },
      );
      assert.equal(on.seed, reference.seed, `${name} ${key} seed`);
      const visible = await compare(on.page, reference.png, on.png);
      assert(
        visible.difference >= 0.001,
        `${name} ${key} is inert: ${exact(visible)}`,
      );
      await on.context.close();
      off = await runScene(
        browser,
        { ...changed, balloonEcho: false },
        renderer,
        `${name}-${key}-echo-off`,
        selectedEngine,
        { save: false },
      );
      assert.equal(off.seed, reference.off.seed, `${name} ${key} inert seed`);
      const inert = await compare(off.page, reference.off.png, off.png);
      // The same-seed echo-off program must ignore both authored look edits.
      // Integer histogram deposition also makes Flame exact on this path.
      assert(
        inert.meanAbs === 0,
        `${name} ${key} changes the echo-off scene: ${exact(inert)}`,
      );
      results.push({ key, visible, inert });
    } finally {
      await on?.context.close().catch(() => {});
      await off?.context.close().catch(() => {});
    }
  }
  return results;
}

async function runRenderLeg(
  browser,
  dimension,
  renderer,
  selectedEngine,
  name,
) {
  let first;
  let positive;
  let negative;
  try {
    first = await runScene(
      browser,
      scene(dimension, renderer),
      renderer,
      `${name}-authored`,
      selectedEngine,
      { save: false },
    );
    await first.context.close();
    positive = await runScene(
      browser,
      first.copied,
      renderer,
      `${name}-restored`,
      selectedEngine,
      { restoredLink: first.copiedLink },
    );
    assert.equal(positive.seed, first.seed, `${name} restored seed`);
    await positive.context.close();
    negative = await runScene(
      browser,
      { ...positive.copied, balloonEcho: false },
      renderer,
      `${name}-echo-off`,
      selectedEngine,
    );
    assert.equal(positive.seed, negative.seed, `${name} paired renderer seed`);
    const pixels = await compare(negative.page, positive.png, negative.png);
    assertVisibleEcho(pixels, name);
    let exported = null;
    if (exportPng) {
      exported = await compare(
        negative.page,
        positive.exported,
        negative.exported,
      );
      assertVisibleEcho(exported, `${name} saved PNG`);
    }
    await negative.context.close();
    const look = lookControls
      ? await runLookControls(
          browser,
          { ...positive, off: negative },
          positive.copied,
          renderer,
          selectedEngine,
          name,
        )
      : null;
    return {
      pixels,
      exported,
      look,
      seed: positive.seed,
      backend: positive.backend,
      echo: positive.echo,
    };
  } finally {
    await first?.context.close().catch(() => {});
    await positive?.context.close().catch(() => {});
    await negative?.context.close().catch(() => {});
  }
}

async function pointProbe(page) {
  return page.evaluate(() => {
    const probe = window.__tilingBalloonWorkers;
    const cloud = probe.workers.filter((worker) =>
      worker.url.includes("cloud-worker"),
    );
    return {
      serial: probe.serial,
      requests: cloud.flatMap((worker) => worker.sent).length,
      note: document.getElementById("tilingNote")?.textContent ?? "",
      balloonNote: document.getElementById("balloonNote")?.textContent ?? "",
      echo: window.__tilingBalloonEcho,
    };
  });
}

async function regeneratePoints(page, active) {
  const before = await pointProbe(page);
  await page.locator("#regenerateBtn").evaluate((button) => button.click());
  const ready = await waitReady(page, "points", {
    active,
    after: before.serial,
  });
  assert(
    (await pointProbe(page)).requests > before.requests,
    "Manual Regenerate sent no worker request",
  );
  return ready;
}

async function runLifecycleLeg(browser, dimension, name) {
  let finite;
  let lattice;
  try {
    finite = await runScene(
      browser,
      scene(dimension),
      "points",
      `${name}-finite`,
      "compute",
      { save: false },
    );
    await edit(finite.page, "autoUpdate", false, "checkbox");
    const finiteBefore = await pointProbe(finite.page);
    await edit(finite.page, "tilingKind", "lattice", "change");
    await finite.page.waitForTimeout(600);
    const pendingLattice = await pointProbe(finite.page);
    assert.equal(
      pendingLattice.requests,
      finiteBefore.requests,
      `${name} Auto-update-off finite -> lattice regenerated`,
    );
    assert.match(
      pendingLattice.note,
      /Unavailable with Balloon.*finite enclosing ball/i,
      `${name} lattice refusal disclosure`,
    );
    const staleFinite = await capture(
      finite.page,
      `${name}-finite-held-for-lattice`,
    );
    const heldFinite = await compare(finite.page, finite.png, staleFinite);
    assert.equal(
      heldFinite.meanAbs,
      0,
      `${name} changing authored tiling erased/moved the held finite echo`,
    );
    const refused = await regeneratePoints(finite.page, false);
    assert.equal(
      refused.terminal.pointTiling?.availability,
      "refused",
      `${name} lattice with Balloon did not reach refusal worker arm`,
    );
    const refusedDocument = decode(new URL(await copyLink(finite.page)).hash);
    assert.equal(
      refusedDocument.tiling.kind,
      "lattice",
      `${name} refusal cleared authored tiling`,
    );
    assert.equal(
      refusedDocument.balloonEcho,
      true,
      `${name} refusal cleared authored Balloon`,
    );
    // Kind remains the adjacent recovery control while lattice-specific
    // dependent details are disabled. Recovery retains the authored echo.
    assert.equal(await finite.page.locator("#tilingKind").isDisabled(), false);
    assert.equal(
      await finite.page.locator("#tilingCellScaleSlider").isDisabled(),
      true,
    );
    await edit(finite.page, "tilingKind", "reflection", "change");
    const recovery = await regeneratePoints(finite.page, true);
    assert.equal(recovery.terminal.pointTiling?.kind, "finite");
    assert.equal(
      decode(new URL(await copyLink(finite.page)).hash).balloonEcho,
      true,
    );
    assertEchoBall(
      recovery,
      (await pointProbe(finite.page)).echo,
      scene(dimension),
      `${name} recovered finite`,
    );
    assert.deepEqual(
      finite.errors,
      [],
      `${name} finite lifecycle browser errors`,
    );
    await finite.context.close();

    const latticeDocument = {
      ...scene(dimension),
      tiling: { kind: "lattice", cellScale: 1.5 },
      balloonEcho: false,
    };
    lattice = await runScene(
      browser,
      latticeDocument,
      "points",
      `${name}-lattice`,
      "compute",
      { save: false },
    );
    await edit(lattice.page, "autoUpdate", false, "checkbox");
    const latticeBefore = await pointProbe(lattice.page);
    await edit(lattice.page, "tilingKind", "reflection", "change");
    await edit(lattice.page, "balloonEchoCheckbox", true, "checkbox");
    await lattice.page.waitForTimeout(600);
    const pendingFinite = await pointProbe(lattice.page);
    assert.equal(
      pendingFinite.requests,
      latticeBefore.requests,
      `${name} Auto-update-off lattice -> finite regenerated`,
    );
    const staleLattice = await capture(
      lattice.page,
      `${name}-lattice-held-for-finite`,
    );
    const heldLattice = await compare(lattice.page, lattice.png, staleLattice);
    assert.equal(
      heldLattice.meanAbs,
      0,
      `${name} a held infinite lattice received an echo`,
    );
    assert.equal(
      pendingFinite.echo.draws,
      latticeBefore.echo.draws,
      `${name} echo program drew the held lattice`,
    );
    assert.match(
      pendingFinite.balloonNote,
      /lattice|regenerat/i,
      `${name} missing held-lattice Balloon disclosure`,
    );
    const landed = await regeneratePoints(lattice.page, true);
    assert.equal(landed.terminal.pointTiling?.kind, "finite");
    const landedPng = await capture(lattice.page, `${name}-finite-landed`);
    const replacement = await compare(lattice.page, landedPng, staleLattice);
    assertVisibleEcho(replacement, `${name} finite replacement`);
    assertEchoBall(
      landed,
      (await pointProbe(lattice.page)).echo,
      scene(dimension),
      `${name} landed finite`,
    );
    assert.deepEqual(
      lattice.errors,
      [],
      `${name} lattice lifecycle browser errors`,
    );
    return {
      heldFinite,
      heldLattice,
      replacement,
      originRadius: landed.terminal.tilingOriginRadius,
    };
  } finally {
    await finite?.context.close().catch(() => {});
    await lattice?.context.close().catch(() => {});
  }
}

await mkdir(outdir, { recursive: true });
const browser = await launchSurfaceBrowser(mode);
const results = [];
async function record(name, run) {
  const started = Date.now();
  try {
    const result = {
      name,
      pass: true,
      ...(await run()),
      elapsedMs: Date.now() - started,
    };
    results.push(result);
    console.log(exact(result));
  } catch (error) {
    const result = {
      name,
      pass: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    console.error(exact(result));
  }
}
try {
  if (scope !== "lifecycle") {
    for (const renderer of renderers)
      for (const dimension of dimensions)
        for (const selectedEngine of renderer === "surface"
          ? engines
          : ["compute"]) {
          const name = `${renderer}-${dimension}d-finite-${selectedEngine}`;
          await record(name, () =>
            runRenderLeg(browser, dimension, renderer, selectedEngine, name),
          );
        }
  }
  if (scope !== "render" && renderers.includes("points")) {
    for (const dimension of dimensions) {
      const name = `points-${dimension}d-balloon-handoff`;
      await record(name, () => runLifecycleLeg(browser, dimension, name));
    }
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(outdir, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}
process.exitCode =
  results.length > 0 && results.every((result) => result.pass) ? 0 : 1;
