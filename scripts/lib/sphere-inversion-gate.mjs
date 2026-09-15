/**
 * The shared browser vocabulary of the sphere-inversion menu gates:
 * `scripts/sphere-inversion-presets.verify.mjs` (the presets' own gate) and
 * `scripts/sphere-inversion-family.verify.mjs` (the family's qualification).
 * One definition each of "open the app", "load a preset from the menu",
 * "wait for the settle latch", "read the document out of the hash" and "how
 * far apart are two frames", so the two gates cannot drift apart on what a
 * check means.
 */
import fs from "node:fs";
import { pollSurfaceState } from "./surface-browser-runner.mjs";

/**
 * The Sphere inversion menu group, in menu order. `block` is
 * `presets.ts`'s PRESET_SPHERE_INVERSIONS entry TRANSCRIBED (plain Node has
 * no loader for `src/`, the surface-teardown gate's precedent): the family
 * gate asserts the document's block equals it, so a table edit that is not
 * carried here fails that gate loudly instead of passing on a stale copy.
 */
export const SI_PRESETS = Object.freeze([
  {
    key: "inversionPearls",
    dim: 3,
    block: {
      arrangement: "oct6",
      radiusFraction: 0.99,
      seed: { kind: "ball", size: 0.28 },
      depth: 8,
    },
  },
  {
    key: "inversionCubePearls",
    dim: 3,
    block: {
      arrangement: "cube8",
      radiusFraction: 0.99,
      seed: { kind: "ball", size: 0.42 },
      depth: 8,
    },
  },
  {
    key: "inversionVault",
    dim: 3,
    block: {
      arrangement: "oct6",
      radiusFraction: 0.99,
      seed: {
        kind: "cutShell",
        size: 1,
        thickness: 0.06,
        cutDirection: [0.35, 1, 0.55],
        cutOffset: 0.25,
        cutRadius: 10,
      },
      depth: 8,
    },
  },
  {
    key: "inversionLace",
    dim: 3,
    block: {
      arrangement: "ico12",
      radiusFraction: 0.99,
      seed: { kind: "shell", size: 1, thickness: 0.03 },
      depth: 6,
    },
  },
  {
    key: "inversionVault4",
    dim: 4,
    block: {
      arrangement: "cell600",
      radiusFraction: 0.99,
      seed: {
        kind: "cutShell",
        size: 0.9,
        thickness: 0.04,
        cutDirection: [0.35, 1, 0.55],
        cutDirectionW: 0,
        cutOffset: 0.25,
        cutRadius: 10,
      },
      depth: 5,
    },
  },
  {
    key: "inversionMedallions4",
    dim: 4,
    block: {
      arrangement: "cell600",
      radiusFraction: 0.99,
      seed: { kind: "shell", size: 1.1, thickness: 0.03 },
      depth: 5,
    },
  },
]);

/** The viewport both gates measure at (the presets' recorded settles). */
export const SI_VIEWPORT = Object.freeze({ width: 1600, height: 900 });

/** The DOM that sits over the scene canvas (surface-browser-runner.mjs's
 * overlay list): hidden for a frame capture so two sessions whose panels,
 * toasts or progress rows differ still compare on the render alone. */
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

/** The live document, out of the hash persist.ts writes. Runs in the page. */
export const READ_DOCUMENT = () => {
  const raw = location.hash.replace(/^#v1=/, "");
  if (!raw) return null;
  try {
    return JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};

/** Decode a `#v1=` hash (or a full link carrying one) in Node. */
export function decodeDocumentHash(linkOrHash) {
  const at = linkOrHash.indexOf("#v1=");
  if (at === -1) return null;
  try {
    return JSON.parse(
      Buffer.from(linkOrHash.slice(at + 4), "base64url").toString("utf8"),
    );
  } catch {
    return null;
  }
}

/** Key-order-insensitive structural equality for JSON values. */
export function sameJson(a, b) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon(v[k])]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** A fresh reduced-motion DSF-1 context on the app with the settle latch
 * published. `query` is appended to `?surfacestate`; `hash` (with its `#`)
 * boots a document; `initScripts` (`[fn, arg]` pairs) run before the app.
 * Errors that matter are collected, not thrown. */
export async function openApp(browser, options) {
  const {
    url,
    query = "",
    hash = "",
    contextOptions = {},
    initScripts = [],
  } = options;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: SI_VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    ...contextOptions,
  });
  for (const [fn, arg] of initScripts) await context.addInitScript(fn, arg);
  const page = await context.newPage();
  const errors = [];
  const consoleLines = [];
  page.on("console", (m) => {
    consoleLines.push(m.text());
    if (m.type() === "error" || /device lost|validation error/i.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e)}`));
  const q = query ? `?surfacestate&${query}` : "?surfacestate";
  await page.goto(`${url}/${q}${hash}`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__surfaceState === "function");
  return { context, page, errors, consoleLines };
}

/** Choose a preset from the panel's menu and wait for the document to
 * change (the save is debounced; escape-family.verify.mjs's lesson). */
export async function loadPreset(page, key) {
  await page.evaluate(() => {
    const details = document.getElementById("presetSelect")?.closest("details");
    if (details && !details.open) details.open = true;
  });
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page.waitForFunction((h) => location.hash !== h, before, {
    timeout: 15_000,
  });
}

/** The settle latch, held for a second. */
export async function waitSettled(page, timeoutMs) {
  const t0 = Date.now();
  let held = 0;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await pollSurfaceState(page);
    if (last.settled) {
      held += 200;
      if (held >= 1_000) return { ok: true, state: last.probe, t0 };
    } else {
      held = 0;
    }
    await page.waitForTimeout(200);
  }
  return { ok: false, state: last?.probe ?? null, t0 };
}

/** Wait until the document's debounced save has caught up with a predicate. */
export async function waitDocument(page, predicate, arg) {
  for (let i = 0; i < 60; i++) {
    const doc = await page.evaluate(READ_DOCUMENT);
    if (doc && predicate(doc, arg)) return doc;
    await page.waitForTimeout(250);
  }
  return page.evaluate(READ_DOCUMENT);
}

/** An init script recording every toast the page shows, in order, into
 * `window.__toasts`: a toast lives 1.8 s and a later one replaces it, so
 * one sample cannot say whether the user was TOLD. */
export const TOAST_RECORDER = () => {
  window.__toasts = [];
  let attached = false;
  const attach = () => {
    const el = document.getElementById("toast");
    if (attached || !el) return;
    attached = true;
    const note = () => {
      if (!el.classList.contains("hidden")) {
        const t = el.textContent ?? "";
        if (window.__toasts.at(-1) !== t) window.__toasts.push(t);
      }
    };
    new MutationObserver(note).observe(el, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  // "interactive", not DOMContentLoaded: module scripts run BETWEEN the two,
  // and a boot-time toast (the isolation handoff's refusal) fires there.
  // Measured: attached at DOMContentLoaded, the recorder saw no toast while
  // the hidden #toast still held the refusal text.
  document.addEventListener("readystatechange", attach);
  document.addEventListener("DOMContentLoaded", attach, { once: true });
  attach();
};

/** The visible toast's text, or null. */
export function toastText(page) {
  return page.evaluate(() => {
    const el = document.getElementById("toast");
    return el && !el.classList.contains("hidden") ? el.textContent : null;
  });
}

/** Screenshot the scene canvas with every overlay hidden; resolves the PNG
 * bytes and writes them to `file` when given. */
export async function captureScene(page, file) {
  await page.evaluate((selectors) => {
    const style = document.createElement("style");
    style.id = "__si-gate-hide";
    style.textContent = `${selectors.join(",")}{visibility:hidden !important}`;
    document.head.append(style);
  }, OVERLAYS);
  try {
    await page.waitForTimeout(100);
    const png = await page
      .locator("#container canvas")
      .first()
      .screenshot({ type: "png" });
    if (file) fs.writeFileSync(file, png);
    return png;
  } finally {
    await page.evaluate(() =>
      document.getElementById("__si-gate-hide")?.remove(),
    );
  }
}

const toB64 = (x) =>
  (Buffer.isBuffer(x) ? x : fs.readFileSync(x)).toString("base64");

/** In-page PNG decoder source, shared by every comparison below. The app's
 * isolation headers refuse the blob decode, so run these on about:blank. */
const DECODE = `async (b64) => {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}`;

/** Fraction of pixels differing by more than `delta` on any channel (the
 * presets gate's object-difference measure). Paths or Buffers. */
export async function differingFraction(page, a, b, delta = 8) {
  return page.evaluate(
    async ([aB64, bB64, d, decodeSrc]) => {
      const decode = eval(decodeSrc);
      const ia = await decode(aB64);
      const ib = await decode(bB64);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      let n = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        if (
          Math.abs(ia.data[i] - ib.data[i]) > d ||
          Math.abs(ia.data[i + 1] - ib.data[i + 1]) > d ||
          Math.abs(ia.data[i + 2] - ib.data[i + 2]) > d
        ) {
          n++;
        }
      }
      return n / (ia.width * ia.height);
    },
    [toB64(a), toB64(b), delta, DECODE],
  );
}

/** Exact comparison: mean/max channel difference and the share of pixels
 * off by more than 8, with `b` optionally resampled to `a`'s size first (an
 * export against its live frame). */
export async function compareFrames(page, a, b, { resample = false } = {}) {
  return page.evaluate(
    async ([aB64, bB64, doResample, decodeSrc]) => {
      const decode = eval(decodeSrc);
      const x = await decode(aB64);
      let y = await decode(bB64);
      const size = { bw: y.width, bh: y.height };
      if (doResample && (y.width !== x.width || y.height !== x.height)) {
        const src = new OffscreenCanvas(y.width, y.height);
        src.getContext("2d").putImageData(y, 0, 0);
        const dst = new OffscreenCanvas(x.width, x.height);
        const g = dst.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(src, 0, 0, x.width, x.height);
        y = g.getImageData(0, 0, x.width, x.height);
      }
      if (x.width !== y.width || x.height !== y.height) {
        return { ...size, aw: x.width, ah: x.height, sizeMismatch: true };
      }
      let sum = 0;
      let max = 0;
      let over8 = 0;
      const px = x.width * x.height;
      for (let i = 0; i < px; i++) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i * 4 + c] - y.data[i * 4 + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > max) max = worst;
        if (worst > 8) over8++;
      }
      return {
        ...size,
        aw: x.width,
        ah: x.height,
        sizeMismatch: false,
        meanDiff: sum / (px * 3),
        maxDiff: max,
        over8: over8 / px,
      };
    },
    [toB64(a), toB64(b), resample, DECODE],
  );
}

/**
 * Coverage of two frames of the same scene on a VERTICAL backdrop ramp, and
 * their agreement. The backdrop is a function of the row alone and is not
 * dithered (`background-shape.ts`), so a row's backdrop is read off the
 * frame's first column, and a pixel is covered when some channel departs
 * from it by more than `delta`. Refuses (`backdropOk: false`) when either
 * frame's first and last columns disagree, i.e. the subject reaches the
 * frame edge and the premise does not hold.
 */
export async function coverageAgreement(page, a, b, delta = 6) {
  return page.evaluate(
    async ([aB64, bB64, d, decodeSrc]) => {
      const decode = eval(decodeSrc);
      const x = await decode(aB64);
      const y = await decode(bB64);
      if (x.width !== y.width || x.height !== y.height)
        return { sizeMismatch: true };
      const w = x.width;
      const h = x.height;
      const mask = (img) => {
        const m = new Uint8Array(w * h);
        let edgeBad = 0;
        for (let r = 0; r < h; r++) {
          const o = r * w * 4;
          const l = o;
          const rr = o + (w - 1) * 4;
          for (let c = 0; c < 3; c++) {
            if (Math.abs(img.data[l + c] - img.data[rr + c]) > 2) {
              edgeBad++;
              break;
            }
          }
          for (let p = 0; p < w; p++) {
            const i = o + p * 4;
            for (let c = 0; c < 3; c++) {
              if (Math.abs(img.data[i + c] - img.data[l + c]) > d) {
                m[r * w + p] = 1;
                break;
              }
            }
          }
        }
        return { m, edgeBad };
      };
      const ma = mask(x);
      const mb = mask(y);
      let inter = 0;
      let uni = 0;
      let ca = 0;
      let cb = 0;
      let sum = 0;
      for (let i = 0; i < w * h; i++) {
        const pa = ma.m[i];
        const pb = mb.m[i];
        ca += pa;
        cb += pb;
        if (pa && pb) {
          inter++;
          for (let c = 0; c < 3; c++) {
            sum += Math.abs(x.data[i * 4 + c] - y.data[i * 4 + c]);
          }
        }
        if (pa || pb) uni++;
      }
      return {
        sizeMismatch: false,
        backdropOk: ma.edgeBad === 0 && mb.edgeBad === 0,
        edgeRowsBad: [ma.edgeBad, mb.edgeBad],
        coveredA: ca / (w * h),
        coveredB: cb / (w * h),
        iou: uni === 0 ? 1 : inter / uni,
        meanDiffCovered: inter === 0 ? 0 : sum / (inter * 3),
      };
    },
    [toB64(a), toB64(b), delta, DECODE],
  );
}

/** Coarse content measures of one PNG: distinct 5-bit colours and the
 * luminance standard deviation. A flat or near-flat image scores low. */
export async function imageContent(page, a) {
  return page.evaluate(
    async ([aB64, decodeSrc]) => {
      const decode = eval(decodeSrc);
      const x = await decode(aB64);
      const seen = new Set();
      let s = 0;
      let s2 = 0;
      const px = x.width * x.height;
      for (let i = 0; i < px; i++) {
        const o = i * 4;
        seen.add(
          ((x.data[o] >> 3) << 10) |
            ((x.data[o + 1] >> 3) << 5) |
            (x.data[o + 2] >> 3),
        );
        const l =
          0.2126 * x.data[o] + 0.7152 * x.data[o + 1] + 0.0722 * x.data[o + 2];
        s += l;
        s2 += l * l;
      }
      const mean = s / px;
      return {
        width: x.width,
        height: x.height,
        distinctColors: seen.size,
        lumaStd: Math.sqrt(Math.max(0, s2 / px - mean * mean)),
      };
    },
    [toB64(a), DECODE],
  );
}

/** A labelled grid of PNGs, `columns` wide, each cell `cellW` px wide at the
 * source aspect. Resolves the sheet's PNG bytes. */
export async function contactSheet(
  page,
  cells,
  { columns = 4, cellW = 400 } = {},
) {
  const b64 = await page.evaluate(
    async ([items, cols, cw, decodeSrc]) => {
      const decode = eval(decodeSrc);
      const decoded = [];
      for (const it of items) {
        const img = await decode(it.b64);
        const c = new OffscreenCanvas(img.width, img.height);
        c.getContext("2d").putImageData(img, 0, 0);
        decoded.push({
          label: it.label,
          canvas: c,
          aspect: img.height / img.width,
        });
      }
      const ch = Math.round(cw * Math.max(...decoded.map((d) => d.aspect)));
      const labelH = 22;
      const rows = Math.ceil(decoded.length / cols);
      const sheet = new OffscreenCanvas(cols * cw, rows * (ch + labelH));
      const g = sheet.getContext("2d");
      g.fillStyle = "#111";
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = "13px sans-serif";
      decoded.forEach((d, i) => {
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * (ch + labelH);
        g.imageSmoothingQuality = "high";
        g.drawImage(d.canvas, x, y + labelH, cw, Math.round(cw * d.aspect));
        g.fillStyle = "#ddd";
        g.fillText(d.label, x + 6, y + 15);
      });
      const blob = await sheet.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    },
    [
      cells.map((c) => ({ label: c.label, b64: toB64(c.file) })),
      columns,
      cellW,
      DECODE,
    ],
  );
  return Buffer.from(b64, "base64");
}
