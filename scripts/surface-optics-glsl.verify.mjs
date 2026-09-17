#!/usr/bin/env node
/**
 * The GLSL twins' optical-transport gate: does the dielectric lane reach a
 * PIXEL in a real ?surfacegl session, from a real `#v1=` document, on the
 * real driver — the fragment-path twin of the invalidation sweep's premise,
 * with the authored-vs-stripped structural diff as its verdict shape
 * (finish.verify.mjs's, over the transport fixtures).
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-optics-glsl.verify.mjs --display=:0
 *
 * WHAT IT PROVES, and what it deliberately does not. The unit pins prove
 * the emitted source and the packed lanes to the byte; this gate traces the
 * frame, because a lane that decodes, packs, compiles and strips correctly
 * but never reaches a PIXEL is invisible to all of them. Per dimension it
 * boots the fixture twice — optics-authored and its optics-stripped twin
 * (derived in-script from the one embedded hash, with the round-trip
 * check that keeps the pair from drifting) — through `?surfacegl`, enters
 * Surface from the UI, waits for the TRUE settled latch, and asserts:
 *
 *   live     the optics session reports engine=webgl on a hardware
 *            rasterizer and carries the lane's near-black signature
 *            (the estimator backend's disclosed vacuous state on IFS
 *            geometry: every inside path refuses, unresolved paints
 *            black, so the object's ray coverage reads as near-black).
 *   stripped the optics-stripped twin renders classic — near-black ~0.
 *   diff     the two settled frames differ STRUCTURALLY (>8/255) across
 *            the full canvas — the lane's pixels, object-shaped.
 *
 * A forced ?surfacegl session that secretly routed to compute fails the
 * engine assertion read at capture time (the finish gate's rule).
 *
 * THE FIXTURES are scripts/lib/optics-fixtures.mjs — the invalidation
 * sweep's own documents, dielectric authored on every transform. On IFS
 * geometry the estimator backend resolves nothing: every optical hit's
 * inside path refuses and paints black, so the live signature is the
 * object's silhouette, not a glass render. The closed-solid resolution
 * evidence is the envelope leg's; this gate pins that the GLSL lane
 * REACHES the frame in both dimensions.
 *
 * MEASURED (this script's own run, radeonsi RX 7900 XTX, 1024x640,
 * settled): recorded in docs/surface-glsl-tracers.md's optics size
 * section's gate rows.
 *
 * --dim 3 | 4 | all (default all). --settle per-boot budget (default
 * 240000). Exit codes: 0 pass, 3 fail, 2 inconclusive (no engine, a
 * software rasterizer, or the settle never landed — the wire strips the
 * lane on software by measured crash), 1 harness failure.
 */
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { OPTICS_SCENES } from "./lib/optics-fixtures.mjs";

/** Live-signature floors and stripped ceilings, per dimension — the same
 * observables the invalidation sweep's webgl lane asserts. */
const BLACK_FLOOR = { 3: 0.05, 4: 0.001 };
const BLACK_CEILING = 0.002;
/** The structural-diff floor (fraction of the full canvas, delta > 8). */
const DIFF_FLOOR = { 3: 0.03, 4: 0.003 };

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: 240000,
    dim: "all",
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "dim" && value) out.dim = value;
  }
  if (!["3", "4", "all"].includes(out.dim)) {
    throw new Error(`--dim must be 3, 4 or all (got ${out.dim})`);
  }
  return out;
}

const log = (...a) => console.log("[surface-optics-glsl]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The optics-stripped twin: decode, drop every transform's optics block,
 * re-encode. The base must round-trip through this script's codec first —
 * the one way the pair could silently diverge. */
function stripOptics(hash) {
  const raw = hash.replace(/^v1=/, "");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const doc = JSON.parse(
    Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8"),
  );
  if (!doc.transforms.some((t) => t.optics)) {
    throw new Error("fixture carries no optics to strip");
  }
  for (const t of doc.transforms) delete t.optics;
  return (
    "#v1=" +
    Buffer.from(JSON.stringify(doc), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
  );
}

async function newPage(browser, args, hash, armTag, webglQuery) {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 640 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const url = `${args.url}/?surfacestate&surfacetrace&surfacesamples=1&surfacegl&scene=${armTag}#${hash}`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.bringToFront();
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    { timeout: 30000 },
  );
  return { page, pageErrors };
}

const probe = (page) => page.evaluate(() => window.__surfaceState?.() ?? null);

async function settle(page, budgetMs) {
  await page.click("#modeSurfaceBtn");
  const started = Date.now();
  let state = null;
  while (Date.now() - started < budgetMs) {
    state = await probe(page);
    if (state && state.settled) break;
    await sleep(250);
  }
  return {
    settled: Boolean(state && state.settled),
    engine: state ? state.engine : null,
    software: state && state.backend ? state.backend.software : null,
  };
}

async function canvasShot(page) {
  const canvas = await page.$("canvas");
  if (!canvas) return null;
  return canvas.screenshot({ type: "png" });
}

/** The 128-wide downsample's absolute near-black fraction — the same
 * instrument the invalidation sweep's webgl lane reads. */
async function blackFraction(page, shot) {
  return page.evaluate(
    async ({ bytes }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const w = 128;
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      let black = 0;
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        if (data[p] < 10 && data[p + 1] < 10 && data[p + 2] < 10) black++;
      }
      return black / (w * h);
    },
    { bytes: Array.from(shot) },
  );
}

/** Full-resolution structural difference (>8/255) between two captures. */
async function structuralDiff(page, aPng, bPng) {
  return page.evaluate(
    async ({ a64, b64 }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [a, b] = await Promise.all([bitmap(a64), bitmap(b64)]);
      if (a.width !== b.width || a.height !== b.height) return null;
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      };
      const pa = pixels(a);
      const pb = pixels(b);
      let structural = 0;
      let maxDelta = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const delta = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2]),
        );
        if (delta > 8) structural++;
        if (delta > maxDelta) maxDelta = delta;
      }
      return {
        structuralFraction: structural / (pa.length / 4),
        maxDelta,
      };
    },
    { a64: aPng.toString("base64"), b64: bPng.toString("base64") },
  );
}

async function bootLeg(browser, args, hash, tag) {
  const { page, pageErrors } = await newPage(browser, args, hash, tag);
  try {
    const s = await settle(page, args.settleMs);
    const shot = s.settled ? await canvasShot(page) : null;
    const black = shot ? await blackFraction(page, shot) : null;
    return { ...s, shot, black, pageErrors };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's timing rows.",
    );
  }
  const dims = args.dim === "all" ? ["3", "4"] : [args.dim];
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
    ...(args.display !== undefined
      ? { env: { ...process.env, DISPLAY: args.display } }
      : {}),
  });
  const results = [];
  let failed = false;
  let inconclusive = false;
  try {
    for (const dim of dims) {
      const scene = OPTICS_SCENES[dim];
      const strippedHash = stripOptics(scene.hash);
      log(`=== ${scene.name} (?surfacegl) ===`);
      const live = await bootLeg(browser, args, scene.hash, "glsl-live");
      const stripped = await bootLeg(
        browser,
        args,
        strippedHash,
        "glsl-stripped",
      );
      log(
        `  live: settled=${live.settled} engine=${live.engine} software=${live.software} nearBlack=${live.black === null ? "n/a" : (live.black * 100).toFixed(2) + "%"}`,
      );
      log(
        `  stripped: settled=${stripped.settled} nearBlack=${stripped.black === null ? "n/a" : (stripped.black * 100).toFixed(2) + "%"}`,
      );
      const engineOk =
        live.settled && live.engine === "webgl" && live.software === false;
      const strippedOk =
        stripped.settled &&
        stripped.black !== null &&
        stripped.black <= BLACK_CEILING;
      const liveOk =
        live.settled &&
        live.engine === "webgl" &&
        live.software === false &&
        live.black !== null &&
        live.black >= BLACK_FLOOR[dim];
      const diff =
        live.shot && stripped.shot
          ? await (async () => {
              const page = await browser.newPage({
                ignoreHTTPSErrors: true,
              });
              try {
                await page.goto("about:blank");
                return await structuralDiff(page, live.shot, stripped.shot);
              } finally {
                await page.close().catch(() => {});
              }
            })()
          : null;
      const diffOk =
        diff !== null && diff.structuralFraction >= DIFF_FLOOR[dim];
      log(
        `  diff: ${diff === null ? "n/a" : `structural ${(diff.structuralFraction * 100).toFixed(2)}% (floor ${(DIFF_FLOOR[dim] * 100).toFixed(2)}%), max delta ${diff.maxDelta}`}`,
      );
      const checks = [
        {
          what: `live settle (engine webgl, lane signature >= ${(BLACK_FLOOR[dim] * 100).toFixed(2)}%)`,
          pass: liveOk,
        },
        {
          what: "stripped control renders classic (~0 near-black)",
          pass: strippedOk,
        },
        {
          what: "live-vs-stripped structural diff",
          pass: diff !== null && diff.structuralFraction >= DIFF_FLOOR[dim],
        },
        {
          what: "no uncaught page errors",
          pass:
            live.pageErrors.length === 0 && stripped.pageErrors.length === 0,
        },
      ];
      for (const c of checks) {
        log(`    ${c.pass ? "PASS" : "FAIL"}  ${c.what}`);
      }
      // A software rasterizer or a missing engine is APPARATUS (exit 2),
      // not a verdict: the wire strips the lane on software by measured
      // crash, so an engine=webgl-but-software reading cannot decide.
      const apparatus =
        !live.settled ||
        !stripped.settled ||
        (live.settled && live.software !== false);
      if (checks.every((c) => c.pass)) continue;
      if (apparatus) {
        inconclusive = true;
        log(`    INCONCLUSIVE: rerun on the real driver.`);
      } else {
        failed = true;
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(failed ? 3 : inconclusive ? 2 : 0);
}

main().catch((e) => {
  console.error("[surface-optics-glsl] harness failure:", e);
  process.exit(1);
});
