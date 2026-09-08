#!/usr/bin/env node
/**
 * Production gate for Space tiling + kaleidoscope. The 16 combinations cross
 * Points / Flame / Solid / Surface, finite / mirrored lattice, and 3D / 4D.
 * Every positive scene must restore the authored pair, complete real worker
 * output (or Surface's settled latch), disclose active tiling, draw foreground,
 * and survive the app's own Copy-link encoding. Its negative control reloads
 * the exact copied view with kaleidoscope disabled (order one, no twist). Both
 * boots use the app's ordinary deterministic BOOT_SEED; worker seed equality
 * is asserted for the active renderer too. No renderer is mocked.
 *
 * Browser launch and Surface settle semantics are shared with the production
 * release runner. Screenshots are decoded only after capture, never by reading
 * the live WebGL canvas outside its rAF. The presentation overlays are hidden
 * while capturing both images. GPU work stays serial.
 *
 * npm run build && npm run preview &
 * node scripts/tiling-symmetry.verify.mjs --display=:0
 * Options: --url=URL --only=points|flame|solid|surface --engine=compute|webgl
 *          --settle=180000 --outdir=scripts/out/tiling-symmetry-browser
 * Omit --display for SwiftShader. Exit 0 passes; any failed leg exits 1.
 *
 * MEASURED 2026-09-08 on AMD Radeon RX 7900 XTX, Mesa 25.2.8: all 16
 * combinations passed, plus all four Surface combinations through WebGL.
 * Paired structural differences: Points 3.82--38.03%, Flame 19.54--65.22%,
 * Solid 16.58--59.49%, Surface compute 14.95--39.74%; WebGL agrees within
 * 0.02 percentage points on these image differences. Every Flame case used
 * the real amd rdna-3 GPU. All eight Surface cases carried a non-software
 * backend and a nonempty settled ray census.
 *
 * Two instrument corrections are part of this record. Lattice Surface
 * deliberately frames its canonical cell on entry, so a saved Points camera
 * is not the eventual comparison camera. After entry, a trusted centered
 * pinch restores the common radius and the copied pose checks input precision
 * (relative 1e-6 for radius/target, exact angles/FOV). Canvas focus outlines
 * are hidden before screenshot capture so the blue focus edge cannot be
 * mistaken for a backdrop color by the foreground instrument. No geometric
 * threshold was relaxed. This measured the AMD driver, not the historical
 * Iris reference described in older project records.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const engine = options.engine ?? "compute";
const settle = Number(options.settle ?? 180_000);
const outdir = path.resolve(
  options.outdir ?? "scripts/out/tiling-symmetry-browser",
);
const renderers = options.only
  ? [options.only]
  : ["points", "flame", "solid", "surface"];
assert(["compute", "webgl"].includes(engine));
assert(
  renderers.every((r) => ["points", "flame", "solid", "surface"].includes(r)),
);
assert(Number.isFinite(settle) && settle > 0);
const viewport = { width: 640, height: 480 };
const exact = (value) => JSON.stringify(value);
const encode = (document) =>
  `#v1=${Buffer.from(exact(document), "utf8").toString("base64url")}`;
const decode = (hash) =>
  JSON.parse(
    Buffer.from(hash.replace(/^#v1=/, ""), "base64url").toString("utf8"),
  );

function scene(dimension, lattice) {
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
    numPoints: 120_000,
    pointSize: 1.5,
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
    symmetry:
      dimension === 3
        ? { order: 3, plane: "xy" }
        : { order: 3, plane: "xw", twist: 1 },
    tiling: lattice
      ? { kind: "lattice", cellScale: 1.5 }
      : { group: dimension === 3 ? "a3" : "a4" },
    glowBrightness: 1,
    balloonEcho: false,
    balloonRadius: 1.6,
    fogDensity: 0.3,
    fogTint: "#ffffff",
    fogTintStrength: 0,
    groundPlane: false,
    background: { mode: "dark" },
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
            p: [1, 0, 0, 0],
            q: [1, 0, 0, 0],
            sliceOn: false,
            sliceCenter: 0,
            sliceThickness: 0,
            sliceRelColor: false,
          },
        }
      : {}),
  };
}

/** Observe only messages, retaining no transferred point or voxel buffers. */
function observeWorkers() {
  const probe = { serial: 0, workers: [] };
  window.__tilingSymmetryWorkers = probe;
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args);
      const entry = { url: String(args[0]), sent: [], replies: [] };
      probe.workers.push(entry);
      const send = worker.postMessage.bind(worker);
      worker.postMessage = (data, transfer) => {
        entry.sent.push({
          serial: ++probe.serial,
          type: data?.type ?? "cloud",
          id: data?.id,
          seed: data?.seed,
          symmetry: data?.symmetry,
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

async function waitReady(page, renderer) {
  const button = `mode${renderer[0].toUpperCase()}${renderer.slice(1)}Btn`;
  const deadline = Date.now() + settle;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      ({ renderer, button }) => {
        const workers = window.__tilingSymmetryWorkers.workers;
        const name =
          renderer === "solid"
            ? "voxel-worker"
            : renderer === "points"
              ? "cloud-worker"
              : "flame-worker";
        const worker = workers.filter((w) => w.url.includes(name)).at(-1);
        const terminal = worker?.replies.findLast((r) =>
          renderer === "points"
            ? r.count > 0
            : r.iterationsBudget > 0 && r.iterationsDone >= r.iterationsBudget,
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
        };
      },
      { renderer, button },
    );
    const active =
      renderer === "solid"
        ? /Active in [34]D Solid/.test(last.note)
        : last.note.includes(
            `Active in ${renderer[0].toUpperCase()}${renderer.slice(1)}`,
          );
    if (last.pressed && active) {
      if (renderer === "surface") {
        const state = await pollSurfaceState(page);
        if (state.settled) return { ...last, surface: state.probe };
      } else if (
        last.terminal &&
        (renderer !== "solid" || last.progress.includes("converged"))
      ) {
        await page.waitForTimeout(300);
        return last;
      }
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

function assertCameraNear(actual, wanted, label) {
  assert.equal(actual.theta, wanted.theta, `${label} azimuth`);
  assert.equal(actual.phi, wanted.phi, `${label} elevation`);
  assert.equal(actual.fov, wanted.fov, `${label} lens`);
  assert.equal(actual.infiniteZoom, wanted.infiniteZoom, `${label} zoom mode`);
  const error = Math.max(
    Math.abs(actual.radius / wanted.radius - 1),
    ...actual.target.map(
      (v, i) => Math.abs(v - wanted.target[i]) / wanted.radius,
    ),
  );
  assert(error < 1e-6, `${label} trusted-touch camera error ${error}`);
  return error;
}

/** Lattice Surface deliberately fits its canonical cell on entry, even
 * when Points restored a saved camera. Use a real centered pinch after that
 * fit to restore the common comparison radius; no private app state is read
 * or modified. Both scenes must then copy back the requested pose within the
 * serializer's numerical precision. */
async function restoreSurfaceLatticeCamera(page, context, wanted) {
  const current = decode(new URL(await copyLink(page)).hash).camera;
  assertCameraNear(
    { ...current, radius: wanted.radius },
    wanted,
    "lattice entry",
  );
  const startSpan = 100;
  const endSpan = (startSpan * current.radius) / wanted.radius;
  const centerX = viewport.width * 0.75;
  const centerY = viewport.height * 0.5;
  const points = (span) => [
    { id: 0, x: centerX - span / 2, y: centerY },
    { id: 1, x: centerX + span / 2, y: centerY },
  ];
  const input = await context.newCDPSession(page);
  try {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(startSpan),
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(endSpan),
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await input.detach();
  }
  await page.waitForTimeout(100);
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
    async ({ a, b }) => {
      async function pixels(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 192;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const first = await pixels(a);
      const second = await pixels(b);
      let foreground = 0;
      let changed = 0;
      let total = 0;
      for (let y = 10; y < 182; y++)
        for (let x = 13; x < 243; x++) {
          const at = (y * 256 + x) * 4;
          const edge = (y * 256 + 3) * 4;
          let backdropDelta = 0;
          let diff = 0;
          for (let c = 0; c < 3; c++) {
            backdropDelta = Math.max(
              backdropDelta,
              Math.abs(first[at + c] - first[edge + c]),
            );
            diff = Math.max(diff, Math.abs(first[at + c] - second[at + c]));
          }
          if (backdropDelta > 10) foreground++;
          if (diff > 12) changed++;
          total++;
        }
      return { coverage: foreground / total, difference: changed / total };
    },
    { a: positive.toString("base64"), b: negative.toString("base64") },
  );
}

async function runScene(browser, document, renderer, name) {
  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const errors = [];
  const page = await context.newPage();
  await page.addInitScript(observeWorkers);
  // rollSeed is a viewer-side source choice. Pin it while retaining the real
  // worker RNG and kernels, then assert what the active worker received.
  await page.addInitScript(() => {
    let word = 0x71e52026;
    Math.random = () => {
      word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
      return word / 4294967296;
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(
      `${url}/?surfacestate&surface${engine === "webgl" ? "gl" : "compute"}&tilingSymmetry=${name}${encode(document)}`,
      { waitUntil: "load", timeout: 60_000 },
    );
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
    if (renderer !== "points") {
      const selector = `#mode${renderer[0].toUpperCase()}${renderer.slice(1)}Btn`;
      assert.equal(
        await page.locator(selector).isDisabled(),
        false,
        `${name} entry refused`,
      );
      await page.locator(selector).evaluate((button) => button.click());
    }
    let ready = await waitReady(page, renderer);
    if (renderer === "surface" && document.tiling.kind === "lattice") {
      await restoreSurfaceLatticeCamera(page, context, document.camera);
      ready = await waitReady(page, renderer);
    }
    const copied = decode(new URL(await copyLink(page)).hash);
    assert.deepEqual(copied.tiling, document.tiling, `${name} copied tiling`);
    assert.deepEqual(
      copied.symmetry,
      document.symmetry,
      `${name} copied symmetry`,
    );
    if (renderer === "surface" && document.tiling.kind === "lattice") {
      // Trusted touch coordinates have finite input precision, including a
      // tiny numerical pan when a centered pinch's two coordinates round.
      assertCameraNear(copied.camera, document.camera, `${name} fixed camera`);
    } else {
      assert.deepEqual(copied.camera, document.camera, `${name} fixed camera`);
    }
    if (document.fourD)
      assert.deepEqual(copied.fourD, document.fourD, `${name} fixed 4D pose`);
    if (renderer === "surface") {
      assert.equal(ready.surface.engine, engine, `${name} surface engine`);
      assert(
        ready.surface.census?.covered > 0,
        `${name} settled ray census has no hits`,
      );
      if (options.display)
        assert.equal(
          ready.surface.backend.software,
          false,
          `${name} hardware backend`,
        );
    }
    if (renderer === "flame") {
      const backend = ready.worker.replies.findLast(
        (r) => r.type === "backend",
      );
      assert.equal(backend?.backend, "gpu", `${name} tiled Flame GPU route`);
      if (options.display)
        assert.equal(backend.software, false, `${name} hardware Flame backend`);
    }
    const png = await capture(page, name);
    assert.deepEqual(errors, [], `${name} browser errors`);
    const start = ready.worker?.sent.find(
      (s) => s.type === (renderer === "points" ? "cloud" : "start"),
    );
    return {
      context,
      page,
      png,
      copied,
      seed: start?.seed ?? null,
      engine: ready.surface?.engine ?? renderer,
      backend:
        ready.surface?.backend ??
        ready.worker?.replies.findLast((r) => r.type === "backend") ??
        null,
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

await mkdir(outdir, { recursive: true });
const browser = await launchSurfaceBrowser(mode);
const results = [];
try {
  for (const renderer of renderers)
    for (const dimension of [3, 4])
      for (const lattice of [false, true]) {
        const name = `${renderer}-${dimension}d-${lattice ? "lattice" : "finite"}-${engine}`;
        const started = Date.now();
        let positive;
        let negative;
        try {
          const document = scene(dimension, lattice);
          // Surface's lattice fit is corrected with an ordinary camera gesture
          // after entry. Keep that gesture on the standard perspective lens.
          if (renderer === "surface" && lattice) {
            document.camera.radius = Number(
              (document.camera.radius * 3).toFixed(4),
            );
            document.camera.fov = 60;
            document.camera.infiniteZoom = true;
          }
          positive = await runScene(browser, document, renderer, `${name}-on`);
          const negativeDocument = {
            ...positive.copied,
            symmetry: { plane: positive.copied.symmetry.plane, order: 1 },
          };
          // One active GPU context at a time; captured bytes survive teardown.
          await positive.context.close();
          negative = await runScene(
            browser,
            negativeDocument,
            renderer,
            `${name}-off`,
          );
          assert.equal(
            positive.seed,
            negative.seed,
            `${name} matched renderer seed`,
          );
          const metrics = await compare(
            negative.page,
            positive.png,
            negative.png,
          );
          assert(
            metrics.coverage >= 0.005,
            `${name} no foreground: ${exact(metrics)}`,
          );
          assert(
            metrics.difference >= 0.01,
            `${name} symmetry did not change the visible tiled object: ${exact(metrics)}`,
          );
          const result = {
            name,
            pass: true,
            elapsedMs: Date.now() - started,
            ...metrics,
            seed: positive.seed,
            backend: positive.backend,
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
        } finally {
          await positive?.context.close().catch(() => {});
          await negative?.context.close().catch(() => {});
        }
      }
} finally {
  await browser.close();
  await writeFile(
    path.join(outdir, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}
process.exitCode = results.every((result) => result.pass) ? 0 : 1;
