#!/usr/bin/env node
/**
 * The motion-clip export's end-to-end gate: real build, real browser, and a
 * recorded clip that must encode N FULLY-CONVERGED frames whose motion is
 * VISIBLE between the first and the last one — for BOTH motion sources the
 * clip can drive:
 *
 *   leg 1  a click in Points refuses: the disclosure toast appears, no mp4
 *          is produced, and the button stays at its idle label.
 *   leg 2  the flat boot flame records a 2s clip of the 3D auto-orbit
 *          turntable (4 frames at ?motionfps=2), fully converged per frame.
 *   leg 3  the same flat boot system through SOLID records the same orbit
 *          clip — the cheapest arm there is: the voxel volume is
 *          world-space and the camera is a raymarcher uniform, so a frame
 *          is one paint at the new camera with NO worker commit at all.
 *          Pins that a camera move never restarts the voxel session.
 *   leg 4  hopfBloom — a non-flat 4D system whose render hint enters Flame
 *          on its own — records the same-length clip of the 4D rotor tumble.
 *   leg 5  hopfBloom through SOLID records the tumble: per frame the driver
 *          commits the settled-edit pose (the manual-edit path's revision
 *          bump + post) and waits out a FULL VOXEL REBUILD — the heaviest
 *          per-frame commit the clip machinery drives, budget-pinned to 1M
 *          so the gate's four frames stay seconds each. The revision
 *          filter is what makes the two-phase wait sound here: a stale
 *          pre-commit grid event cannot set the completion flag.
 *   leg 6  swirlPentatope — a 4D Surface-hinted preset — records the same
 *          clip through the compute surface path: per frame the rotor
 *          commit is the per-frame spec `view4`, the force frame re-traces
 *          at the new pose, and the tracer claim holds the live tier loop
 *          off the driver's frames.
 *   leg 7  (--surfacegl or --mode=x11::0) the SAME 4D surface session
 *          forced onto the WEBGL FALLBACK tracer (`?surfacegl` wins even
 *          where compute is available): per frame the driver holds the
 *          tracer claim, abandons the settle, and drains the full-tier
 *          strip pump synchronously at the committed pose — the record
 *          path the compute leg cannot see. Same assertions — 4 frames,
 *          valid MP4, visible tumble motion — with ONE instrument
 *          difference the arm forces: a synchronous whole-frame strip
 *          drain blocks the main thread for every frame, leaving the
 *          between-frame event-loop gaps too short for a CDP canvas
 *          screenshot to land in (measured: 1 readable mid-run sample
 *          across the whole 4-frame clip), so the motion evidence comes
 *          from the settled pane BEFORE the run versus the re-settled
 *          pane AFTER it — the post-run pane is the clip's final pose,
 *          re-settled by the live tier loop the driver's unwind restored.
 *          That re-settle wait is also the regression pin for the wedge
 *          leg 7's first run caught: the clip's forced renders at
 *          advancing poses never pass through the tier branches (the
 *          tracer claim suppresses them), so an unwind that left the view
 *          un-invalidated left the tier clock nothing to quiet from —
 *          needsRender consumed by the last forced render,
 *          lastInvalidatedMs null since the pre-clip settle — and the
 *          settled latch stuck false until the next user gesture. The
 *          driver's unwind now re-invalidates (the same recovery a
 *          gesture gets); without it this leg's post-run wait times out.
 *          MEASURED, one occurrence: a clip stalled at 75% for ~80s on
 *          this driver and later ran 4 frames in under 200ms — the sync
 *          drain's documented mid-join stall (a single strip's GPU work
 *          can outrun the per-frame spend ceiling while the join blocks;
 *          spentMs cannot grow until the join returns), not a new
 *          mechanism. A strip drain that prices past the capture ceilings
 *          throws SurfaceCaptureCostError and finalizes the PARTIAL
 *          clip — the stsz count then reads low and this leg fails on it
 *          honestly, because a fallback arm that cannot drain a 4-frame
 *          clip is exactly the regression this certification exists to
 *          catch.
 *
 * `?motionfps=2` is the page-load frame-rate override the feature ships for
 * exactly this purpose: a 2s clip is 4 frames instead of the 30fps 60. At
 * 30fps the gate would pay 60 full re-renders per leg — each frame restarts
 * the flame at its budget and awaits its own convergence — and SwiftShader
 * CPU could not finish one leg in a sitting. Every clip below must still
 * hold the frame-exact contract itself: the button's progress ladder reaches
 * 100% before the MP4 blob exists (the clip encodes only after every frame
 * converged), the download is a real MP4 container whose stsz sample count
 * is exactly 4, and the picture visibly turns (mean absolute gray distance
 * between the first and the last pre-download frame sample > 2.0/255 — the
 * orbit visibly rotates the flame; the tumble visibly turns the 4D flame).
 *
 * MEASURED INSTRUMENT NOTE — the frame samples CANNOT come from an in-page
 * drawImage of the on-screen canvas: the renderer runs without
 * `preserveDrawingBuffer`, so a composited frame's drawing buffer is
 * cleared and drawImage reads transparent black (probed in this exact
 * headless SwiftShader environment: every byte zero). The samples are
 * therefore canvas ELEMENT screenshots — the compositor's own capture, the
 * mechanism escape-family/pattern/finish already use — decoded to 64x64
 * grayscale in-page. Same sample shape, honest pixels.
 *
 * The button's "⏳ Recording 100%" flash lives only for the encoder's flush
 * + mux (a few macrotasks), so the label WRITE itself is logged by a
 * read-only MutationObserver (`__recLabels`, microtask-timed, so it cannot
 * lose the race against the later blob) and the 100%-before-blob assertion
 * accepts either the 100ms sampler's pct===100 sample or the log's
 * pre-blob 100% label. The completion toast gets the same treatment
 * (`__toasts`): a plain confirmation auto-hides after 1.8s, and this
 * adapter's canvas screenshots can take longer than that between sampler
 * ticks — leg 3's first run measured the sampler returning ~2.5s after the
 * mp4 landed (two ~2.5s screenshot ticks spanning the whole fast orbit
 * clip), by which time the live toast was gone — so the toast assertion
 * accepts the live read OR the logged flash. sampleClip checks the mp4
 * count BEFORE its screenshot tick for the same reason.
 *
 * USAGE (build + `npm run preview` first — this measures a real build):
 *   node scripts/motion-export.verify.mjs [url]            # default :4173
 *   node scripts/motion-export.verify.mjs --mode=x11::0    # real driver
 *   node scripts/motion-export.verify.mjs --surfacegl      # leg 7 only
 *   node scripts/motion-export.verify.mjs --keep-open
 *
 * `--surfacegl` runs ONLY leg 7 (the WebGL fallback arm; the other legs'
 * verdicts are not re-litigated by a fallback-arm run and a full leg 1-7
 * sweep doubles the sitting). Default (no flag): all legs.
 *
 * Default --mode=sw: legs 1-5 run on SwiftShader (the CPU flame backend is
 * the slow-but-working path there, and the solid legs' rebuilds run on the
 * CPU voxel worker regardless of adapter). Leg 6 needs SURFACE COMPUTE,
 * which this adapter's WebGPU refuses (measured: both 4D surface presets
 * fall back to the WebGL tracer, whose software strip settle is unbounded
 * in a gate) — leg 6 SKIPS with a disclosed note rather than failing, and
 * `--mode=x11::0` (a headed window on a live X display, escape-family's
 * idiom) certifies it on the real driver, where compute takes the session
 * and a settle is seconds.
 *
 * Written 2026-10-06. Exit 0 = every assertion held. Exit 1 = a real
 * failure.
 */
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

const args = {
  url: "https://localhost:4173",
  keepOpen: false,
  mode: "sw",
  surfacegl: false,
};
for (const arg of process.argv.slice(2)) {
  if (arg === "--keep-open") args.keepOpen = true;
  else if (arg === "--surfacegl") args.surfacegl = true;
  else if (arg.startsWith("--url=")) args.url = arg.slice(6);
  else if (arg.startsWith("--mode=")) args.mode = arg.slice(7);
  else if (!arg.startsWith("--")) args.url = arg;
}
args.url = args.url.replace(/\/+$/, "");
if (args.surfacegl && args.mode === "sw") {
  console.error(
    "[motion-export] --surfacegl needs a real driver: the WebGL fallback's " +
      "software strip settle is unbounded in a gate. Run with --mode=x11::0.",
  );
  process.exit(2);
}
await guardFreshDist({ url: args.url });

/** escape-family.verify.mjs's launch idiom: a headed window on a live X
 * display is the only route to the real driver (WebGPU reaches it through
 * Vulkan — deliberately NO SwiftShader/ANGLE flags); anything else measures
 * the software stack. */
function launchOptions(mode) {
  const env = { ...process.env };
  if (mode.startsWith("x11:")) {
    env.DISPLAY = mode.slice(4);
    return {
      env,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
      headless: false,
    };
  }
  if (mode === "sw") {
    delete env.DISPLAY;
    return {
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
      headless: true,
    };
  }
  throw new Error(`unknown --mode ${mode} (expected x11:<display> or sw)`);
}

const { env: launchEnv, args: launchArgs, headless } = launchOptions(args.mode);
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless,
  env: launchEnv,
  args: launchArgs,
});

const log = (s) => console.log(`[motion-export] ${s}`);
let passed = 0;
let failed = 0;
let skipped = 0;
const ok = (s) => {
  passed++;
  log(`ok   ${s}`);
};
const bad = (s) => {
  failed++;
  log(`FAIL ${s}`);
};
/** A leg the current adapter cannot exercise — disclosed in the summary,
 * never silently dropped, and never a failure of the build under test. */
const skip = (s) => {
  skipped++;
  log(`skip ${s}`);
};

/** Mean absolute difference between two 64x64 grayscale vectors, 0..255. */
function grayDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Walk the MP4 box tree — moov > trak > mdia > minf > stbl, the first box
 * of that type at each level — and read the stsz sample count: the number
 * of encoded frames. A stsz box is version/flags (4 B) + sample_size (u32)
 * + sample_count (u32) +, when sample_size is 0, a table of sample_count
 * u32 byte-sizes; when sample_size is nonzero the count alone gives the
 * frames. Either way the count is the clip's frame total.
 */
function countStszSamples(bytes) {
  const u32 = (off) =>
    ((bytes[off] << 24) |
      (bytes[off + 1] << 16) |
      (bytes[off + 2] << 8) |
      bytes[off + 3]) >>>
    0;
  const boxType = (off) =>
    String.fromCharCode(
      bytes[off + 4],
      bytes[off + 5],
      bytes[off + 6],
      bytes[off + 7],
    );
  /** Iterate the child boxes of [start, end): { type, start, end } each. */
  function* children(start, end) {
    let off = start;
    while (off + 8 <= end) {
      const size = u32(off);
      if (size === 1) throw new Error(`64-bit box size at offset ${off}`);
      if (size < 8 || off + size > end) {
        throw new Error(`bad box size ${size} at offset ${off}`);
      }
      yield { type: boxType(off), start: off + 8, end: off + size };
      off += size;
    }
  }
  const firstBox = (start, end, want) => {
    for (const box of children(start, end)) {
      if (box.type === want) return box;
    }
    return null;
  };
  const moov = firstBox(0, bytes.length, "moov");
  if (!moov) throw new Error("no moov box");
  const trak = firstBox(moov.start, moov.end, "trak");
  if (!trak) throw new Error("no trak box in moov");
  const mdia = firstBox(trak.start, trak.end, "mdia");
  if (!mdia) throw new Error("no mdia box in trak");
  const minf = firstBox(mdia.start, mdia.end, "minf");
  if (!minf) throw new Error("no minf box in mdia");
  const stbl = firstBox(minf.start, minf.end, "stbl");
  if (!stbl) throw new Error("no stbl box in minf");
  const stsz = firstBox(stbl.start, stbl.end, "stsz");
  if (!stsz) throw new Error("no stsz box in stbl");
  const sampleSize = u32(stsz.start + 4);
  const count = u32(stsz.start + 8);
  if (sampleSize === 0) {
    const tableBytes = stsz.end - stsz.start - 12;
    if (tableBytes < count * 4) {
      throw new Error(
        `stsz table holds ${tableBytes} B, need ${count * 4} for ${count} entries`,
      );
    }
  }
  return count;
}

try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 820, height: 540 },
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── instrumentation, installed before the app can record anything ─────
  // Read-only observers: the blob hook passes straight through to the real
  // createObjectURL so the download still happens exactly as it would
  // unobserved, and the label log only mirrors the button's own text.
  // Nothing here can make a broken build look fixed.
  await page.addInitScript(() => {
    window.__mp4s = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob && b.type === "video/mp4") {
        window.__mp4s.push({ at: performance.now(), blob: b });
      }
      return origCreate(b);
    };
    // Every relabel of the record button, microtask-timed — see the module
    // doc's note on the 100% flash window.
    window.__recLabels = [];
    const hookButton = (btn) => {
      const mo = new MutationObserver(() => {
        window.__recLabels.push({
          t: performance.now(),
          label: btn.textContent,
        });
      });
      mo.observe(btn, { childList: true, characterData: true, subtree: true });
    };
    // The toast's own log, same pattern and same justification: a plain
    // confirmation auto-hides after TOAST_DURATION_MS (1.8s), and this
    // adapter's canvas screenshots can take longer than that between
    // sampler ticks — leg 3's first run measured the sampler returning
    // ~2.5s after the mp4 landed (two ~2.5s screenshot ticks spanning the
    // whole fast orbit clip), by which time the live toast was gone. The
    // microtask-timed log catches the flash regardless of sampler latency.
    window.__toasts = [];
    const hookToast = (el) => {
      const mo = new MutationObserver(() => {
        const text = (el.textContent ?? "").trim();
        if (text) window.__toasts.push({ t: performance.now(), text });
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    };
    const btn0 = document.getElementById("recordMotionBtn");
    const toast0 = document.getElementById("toast");
    if (btn0) hookButton(btn0);
    if (toast0) hookToast(toast0);
    if (!btn0 || !toast0) {
      document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("recordMotionBtn");
        if (btn) hookButton(btn);
        const toast = document.getElementById("toast");
        if (toast) hookToast(toast);
      });
    }
  });

  const setControl = (id, value) =>
    page.evaluate(
      ({ id, value }) => {
        const el = document.getElementById(id);
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { id, value },
    );

  const toastText = () =>
    page.evaluate(() => {
      // escape-family's visibility gate (a hidden toast's stale text must
      // never be mistaken for a fresh one) over flame-export's #toast read.
      const el = document.getElementById("toast");
      if (!el || el.classList.contains("hidden")) return "";
      return (el.textContent ?? "").trim();
    });

  const flamePct = () =>
    page.evaluate(() => {
      const m = /\((\d+)%\)/.exec(
        document.getElementById("flameProgress")?.textContent ?? "",
      );
      return m ? Number(m[1]) : null;
    });

  /** The solid render row's text — `sampledSolidStatusText`'s composition
   * ("Solid · 192³ voxels · converging 42% · 0.4M / 1.0M iterations"); the
   * word "converged" appears exactly when the budget is met. */
  const solidProgressText = () =>
    page.evaluate(
      () => document.getElementById("solidProgress")?.textContent ?? "",
    );

  /** Poll `fn` until truthy or `ms` elapses. Returns the value or null. */
  const waitFor = async (fn, ms, label) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > deadline) {
        log(`     timed out after ${ms}ms waiting for ${label}`);
        return null;
      }
      await page.waitForTimeout(150);
    }
  };

  /** Playwright rejects an in-flight evaluate with "Execution context was
   * destroyed" when the COOP/COEP isolation reload navigates under it —
   * expected here, retried once (escape-family's wrapper). */
  async function settled(page, fn) {
    try {
      return await fn();
    } catch (error) {
      if (
        !/Execution context was destroyed|frame was detached/i.test(
          String(error),
        )
      ) {
        throw error;
      }
      await page.waitForLoadState("load").catch(() => {});
      return fn();
    }
  }

  /** Choose a preset from the panel's menu — the path a user takes, and the
   * one that runs main.ts's onPreset handler with its side tables. */
  async function loadPreset(page, key) {
    let shape = null;
    for (let i = 0; i < 20; i++) {
      shape = await settled(page, () =>
        page.evaluate(() => {
          const sel = document.getElementById("presetSelect");
          if (!sel) return { found: false, w: 0, h: 0 };
          const details = sel.closest("details");
          if (details && !details.open) details.open = true;
          const r = sel.getBoundingClientRect();
          return { found: true, w: r.width, h: r.height };
        }),
      );
      if (shape.found && shape.w > 0 && shape.h > 0) break;
      await page.waitForTimeout(250);
    }
    if (!shape?.found || shape.w === 0 || shape.h === 0) {
      throw new Error(`preset menu unreachable: ${JSON.stringify(shape)}`);
    }
    // `persist.ts` rewrites the `#v1=` hash on every edit, but
    // `edit-session.ts` DEBOUNCES that save — "the document changed" is the
    // only reliable signal that the load has actually landed.
    const before = await page.evaluate(() => location.hash);
    await page.selectOption("#presetSelect", key);
    await page
      .waitForFunction(
        (h) => location.hash !== h && location.hash !== "",
        before,
        { timeout: 15_000 },
      )
      .catch(() => {
        throw new Error(
          `preset ${key}: the document never changed after loading`,
        );
      });
  }

  /** Open the Capture accordion; the record button must be visible in it. */
  const openCaptureSection = async () => {
    await page.evaluate(() => {
      const details = document.getElementById("captureSection");
      if (details && !details.open) details.open = true;
    });
    const visible = await waitFor(
      () => page.locator("#recordMotionBtn").isVisible(),
      10_000,
      "the Capture section to open",
    );
    if (!visible) throw new Error("Capture section never opened");
  };

  const idleLabelText = "🎞 Record motion";
  const buttonIdle = () =>
    page.evaluate(
      (idle) =>
        (
          document.getElementById("recordMotionBtn")?.textContent ?? ""
        ).trim() === idle,
      idleLabelText,
    );

  /** Decode a PNG (base64) into a 64x64 grayscale vector — escape-family's
   * differingFraction decode, downscaled like flame-export's readPng. The
   * bytes go through atob → Blob → createImageBitmap: a `fetch(data:…)`;
   * probe failed with "Failed to fetch" in this isolated page, and the
   * Blob path needs no network stack at all. */
  const decodeGray64 = (b64) =>
    page.evaluate(async (b64) => {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const bmp = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const c = new OffscreenCanvas(64, 64);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      const gray = [];
      for (let p = 0; p < d.length; p += 4) {
        gray.push(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
      }
      return gray;
    }, b64);

  /**
   * The clip trace, sampled from the Node side while a recording runs:
   * { t, pct, mp4s, frame } — pct off #recordMotionBtn's own text (read
   * every ~25ms tick, so the short 100% flash is caught), mp4s off the
   * createObjectURL hook, frame off a canvas ELEMENT screenshot every
   * ~100ms (the compositor's capture; see the module doc for why an in-page
   * drawImage cannot read this canvas). Runs until mp4s passes
   * `mp4sBefore` — the clip landed — or `ms` elapses.
   */
  const sampleClip = async (label, mp4sBefore, ms) => {
    const samples = [];
    const deadline = Date.now() + ms;
    let lastFrameAt = 0;
    for (;;) {
      const sample = {
        t: Date.now(),
        pct: null,
        mp4s: mp4sBefore,
        frame: null,
      };
      try {
        const r = await page.evaluate(() => {
          const m = /Recording (\d+)%/.exec(
            document.getElementById("recordMotionBtn")?.textContent ?? "",
          );
          return { pct: m ? Number(m[1]) : null, mp4s: window.__mp4s.length };
        });
        sample.pct = r.pct;
        sample.mp4s = r.mp4s;
      } catch {
        // A transient evaluate failure — the next tick retries.
      }
      samples.push(sample);
      // The mp4 check comes BEFORE the screenshot below on purpose: this
      // adapter's canvas screenshots can take seconds (leg 3's first run
      // measured ~2.5s per tick), and checking after one would delay the
      // return past the toast's 1.8s auto-hide — the __toasts log is the
      // backstop, but the live read should still get first crack.
      if (sample.mp4s > mp4sBefore) return samples;
      if (Date.now() > deadline) {
        log(`     timed out after ${ms}ms waiting for ${label}`);
        return samples;
      }
      if (Date.now() - lastFrameAt >= 100) {
        lastFrameAt = Date.now();
        try {
          const png = await page
            .locator("canvas")
            .first()
            .screenshot({ type: "png" });
          sample.frame = await decodeGray64(png.toString("base64"));
        } catch (e) {
          // Not paintable at this instant — keep the state-only sample.
          if (!sampleClip.loggedError) {
            sampleClip.loggedError = true;
            log(
              `     first frame-sample capture failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
      await page.waitForTimeout(25);
    }
  };

  /** Read mp4 #i's bytes out as base64. */
  const readMp4B64 = (i) =>
    page.evaluate(async (i) => {
      const rec = window.__mp4s[i];
      if (!rec) return null;
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      let str = "";
      for (let off = 0; off < bytes.length; off += 0x8000) {
        str += String.fromCharCode(...bytes.subarray(off, off + 0x8000));
      }
      return btoa(str);
    }, i);

  /**
   * The one clip-verdict block both recording legs share: exactly one mp4;
   * the progress ladder reached 100% before the blob (sampler sample or the
   * microtask-timed label log); the button is back at its idle label; the
   * picture visibly advanced; the "Motion clip saved" toast appeared; the
   * bytes are an MP4 container whose stsz counts exactly `wantFrames`.
   */
  const verifyClip = async (
    leg,
    samples,
    mp4sBefore,
    labelsStart,
    wantFrames,
    motionPair = null,
    toastsBefore = 0,
  ) => {
    const landed =
      samples.length > 0 && samples[samples.length - 1].mp4s > mp4sBefore;
    if (!landed) {
      bad(`${leg}: no motion-clip mp4 was ever produced`);
      return;
    }
    const total = await page.evaluate(() => window.__mp4s.length);
    if (total === mp4sBefore + 1) {
      ok(`${leg}: exactly one mp4 was produced`);
    } else {
      bad(`${leg}: expected 1 mp4, found ${total - mp4sBefore}`);
    }
    const preBlob = samples.filter((s) => s.mp4s === mp4sBefore);
    const sampled100 = preBlob.some((s) => s.pct === 100);
    const at = await page.evaluate(
      (i) => window.__mp4s[i]?.at ?? null,
      mp4sBefore,
    );
    const labels = await page.evaluate(
      (s) => window.__recLabels.slice(s),
      labelsStart,
    );
    const logged100 =
      at !== null &&
      labels.some((l) => /Recording 100%/.test(l.label ?? "") && l.t < at);
    if (sampled100 || logged100) {
      ok(
        `${leg}: the button reached 100% before the mp4 existed (${sampled100 ? "sampler" : "label log"})`,
      );
    } else {
      bad(
        `${leg}: the clip encoded without the button's 100% — a frame may not have converged`,
      );
    }
    // The idle read must come after the toast wait: the run's finally
    // clears the label only after the toast is flashed. The live read gets
    // a short window (the toast auto-hides after 1.8s); the __toasts log —
    // microtask-timed at the flash itself — is the backstop for a sampler
    // that returned after the toast was already gone (see the hook's doc).
    const saved = await waitFor(
      async () => (/Motion clip saved/.test(await toastText()) ? true : null),
      4_000,
      "the Motion clip saved toast",
    );
    const loggedSaved = (
      await page.evaluate((s) => window.__toasts.slice(s), toastsBefore)
    ).some((e) => /Motion clip saved/.test(e.text ?? ""));
    if (saved || loggedSaved) {
      ok(
        `${leg}: the "Motion clip saved" toast appeared (${saved ? "live" : "toast log"})`,
      );
    } else {
      bad(`${leg}: no "Motion clip saved" toast`);
    }
    if (await buttonIdle()) {
      ok(`${leg}: the button is back at its idle label`);
    } else {
      bad(`${leg}: the button never returned to its idle label`);
    }
    const frames = preBlob.filter((s) => s.frame !== null);
    if (motionPair !== null) {
      // Leg 5's instrument: the settled pane before the run vs the
      // re-settled pane after it (the WebGL arm's synchronous drains
      // starve mid-run sampling — see the module doc). Same 2.0/255 bar.
      const d = grayDistance(motionPair[0], motionPair[1]);
      if (d > 2.0) {
        ok(
          `${leg}: the picture visibly advanced (settled pre→post gray distance ${d.toFixed(1)}/255)`,
        );
      } else {
        bad(
          `${leg}: pre- and post-run settled frames are nearly identical (gray distance ${d.toFixed(1)}/255 ≤ 2.0) — the motion did not reach the picture`,
        );
      }
    } else if (frames.length < 2) {
      bad(
        `${leg}: fewer than 2 pre-download frame samples (${frames.length}) — no readable canvas during the run`,
      );
    } else {
      const d = grayDistance(frames[0].frame, frames[frames.length - 1].frame);
      if (d > 2.0) {
        ok(
          `${leg}: the picture visibly advanced (first→last gray distance ${d.toFixed(1)}/255 over ${frames.length} samples)`,
        );
      } else {
        bad(
          `${leg}: first and last frames are nearly identical (gray distance ${d.toFixed(1)}/255 ≤ 2.0) — the motion did not reach the picture`,
        );
      }
    }
    const b64 = await readMp4B64(mp4sBefore);
    if (!b64) {
      bad(`${leg}: the recorded blob vanished before it could be read`);
      return;
    }
    const bytes = Buffer.from(b64, "base64");
    const ftypOk =
      bytes.length > 8 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70;
    if (ftypOk) {
      ok(
        `${leg}: the mp4 opens with an ftyp box (${(bytes.length / 1024).toFixed(0)} KB)`,
      );
    } else {
      bad(`${leg}: the blob is not an MP4 container (no ftyp at offset 4)`);
    }
    try {
      const counted = countStszSamples(bytes);
      if (counted === wantFrames) {
        ok(
          `${leg}: stsz counts exactly ${wantFrames} frames (2s at ?motionfps=2)`,
        );
      } else {
        bad(`${leg}: stsz counts ${counted} frames, expected ${wantFrames}`);
      }
    } catch (e) {
      bad(
        `${leg}: could not read the stsz sample count — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // ── boot ──────────────────────────────────────────────────────────────
  // `?motionfps=2` — the override the feature ships for gates: a 2s clip is
  // exactly 4 frames, not 60 full re-renders. `?surfacestate` publishes the
  // settle latch the surface legs read their engine and settle readiness
  // from. `--surfacegl` adds the fallback-arm forcing flag and runs ONLY
  // leg 7 (see the module doc).
  await page.goto(
    `${args.url}/?motionfps=2&surfacestate${args.surfacegl ? "&surfacegl" : ""}`,
  );
  const booted = await waitFor(
    () =>
      page.evaluate(
        () => !document.getElementById("modeFlameBtn")?.disabled ?? false,
      ),
    60_000,
    "the app to boot (mode buttons enabled)",
  );
  if (!booted) throw new Error("app never booted");
  ok(
    args.surfacegl
      ? "app booted, render modes enabled (?motionfps=2&surfacegl in the URL)"
      : "app booted, render modes enabled (?motionfps=2 in the URL)",
  );

  if (args.surfacegl) {
    await runSurfaceglLeg();
  } else {
    await runDefaultLegs();
  }

  // Legs 1-4, the default sweep. Declared as a function so `--surfacegl`
  // can route around them (leg 7 only — see the module doc); hoisted, so
  // the boot block's call below lands fine.
  async function runDefaultLegs() {
    // ── leg 1: a click in Points refuses, records nothing ─────────────────
    await openCaptureSection();
    await page.click("#recordMotionBtn");
    const refusal = await waitFor(
      async () => {
        const t = await toastText();
        return /Flame, Solid or Surface/.test(t) ? t : null;
      },
      10_000,
      "the points-mode refusal toast",
    );
    if (refusal) {
      ok(`leg 1: points-mode click refused with a toast ("${refusal}")`);
    } else {
      bad(
        "leg 1: no /Flame, Solid or Surface/ refusal toast appeared in Points mode",
      );
    }
    const leg1Mp4s = await page.evaluate(() => window.__mp4s.length);
    if (leg1Mp4s === 0) {
      ok("leg 1: no mp4 was produced by the refused click");
    } else {
      bad(`leg 1: a refused click produced ${leg1Mp4s} mp4(s)`);
    }
    if (await buttonIdle()) {
      ok('leg 1: the button still reads "🎞 Record motion"');
    } else {
      bad("leg 1: the button left its idle label after a refused click");
    }

    // ── leg 2: the flat boot flame records the 3D auto-orbit clip ─────────
    // The gate's own documented floor (flame-export's): detent 0 = 1M
    // iterations, so each of the clip's 4 frames still converges in tens of
    // seconds on SwiftShader CPU.
    await setControl("flameIterationsSlider", "0"); // detent 0 = 1M iterations
    await page.evaluate(() => {
      document.getElementById("modeFlameBtn").click();
    });
    const converged2 = await waitFor(
      async () => (await flamePct()) === 100,
      120_000,
      "the flat flame accumulation to reach 100%",
    );
    if (!converged2)
      throw new Error("flame never converged at 1M before leg 2");
    ok("flame converged at 1M (flat boot system)");
    // 2 seconds → exactly 4 frames at ?motionfps=2.
    await setControl("motionClipDurationSlider", "2");
    await openCaptureSection();
    const before2 = await page.evaluate(() => window.__mp4s.length);
    const labelsBefore2 = await page.evaluate(() => window.__recLabels.length);
    const toastsBefore2 = await page.evaluate(() => window.__toasts.length);
    await page.click("#recordMotionBtn");
    const samples2 = await sampleClip(
      "the flat-orbit motion clip mp4",
      before2,
      240_000,
    );
    await verifyClip(
      "leg 2",
      samples2,
      before2,
      labelsBefore2,
      4,
      null,
      toastsBefore2,
    );

    // ── leg 3: the flat boot solid records the auto-orbit clip ────────────
    // The cheapest arm: the voxel volume is world-space, so the camera is
    // live at paint time and a frame is one raymarch pass with NO worker
    // commit — the leg pins that nothing restarts the voxel session for a
    // camera move. Back to Points first (the way flame-export leaves a
    // mode), then the mode button; the budget is pinned through the slider
    // BEFORE the enter so the session starts at its 1M floor.
    await page.evaluate(() => {
      document.getElementById("modePointsBtn").click();
    });
    await page.waitForTimeout(1200);
    await setControl("solidIterationsSlider", "0"); // detent 0 = 1M iterations
    await page.evaluate(() => {
      document.getElementById("modeSolidBtn").click();
    });
    const convergedSolidFlat = await waitFor(
      async () => (/converged/.test(await solidProgressText()) ? true : null),
      240_000,
      "the flat solid render to converge at 1M",
    );
    if (!convergedSolidFlat)
      throw new Error("the flat boot solid never converged at 1M");
    ok("leg 3: the flat boot solid converged at 1M");
    await setControl("motionClipDurationSlider", "2");
    await openCaptureSection();
    const before3 = await page.evaluate(() => window.__mp4s.length);
    const labelsBefore3 = await page.evaluate(() => window.__recLabels.length);
    const toastsBefore3 = await page.evaluate(() => window.__toasts.length);
    await page.click("#recordMotionBtn");
    const samples3 = await sampleClip(
      "the flat solid orbit motion clip mp4",
      before3,
      240_000,
    );
    await verifyClip(
      "leg 3",
      samples3,
      before3,
      labelsBefore3,
      4,
      null,
      toastsBefore3,
    );

    // ── leg 4: hopfBloom records the 4D rotor tumble clip ─────────────────
    // Back to Points first (the way flame-export leaves a mode), then the
    // preset from the menu — the path that runs its render hint, which enters
    // Flame on its own for this non-flat (4D) system.
    await page.evaluate(() => {
      document.getElementById("modePointsBtn").click();
    });
    await page.waitForTimeout(1200);
    await loadPreset(page, "hopfBloom");
    const inFlame = await waitFor(
      () =>
        page.evaluate(
          () =>
            document
              .getElementById("modeFlameBtn")
              ?.getAttribute("aria-pressed") === "true",
        ),
      30_000,
      "the preset's render hint to enter Flame",
    );
    if (!inFlame) {
      bad("leg 4: hopfBloom did not enter Flame automatically");
      throw new Error("hopfBloom never entered Flame mode");
    }
    ok("leg 4: hopfBloom's render hint entered Flame on its own");
    const iters = await page.evaluate(
      () => document.getElementById("flameIterationsSlider")?.value ?? null,
    );
    if (iters === "0") {
      ok("leg 4: the flame budget is still at its 1M floor (slider 0)");
    } else {
      log(
        `     note: leg 4 pinned the flame budget back to the floor (slider read ${String(iters)})`,
      );
      await setControl("flameIterationsSlider", "0");
    }
    const converged4 = await waitFor(
      async () => (await flamePct()) === 100,
      120_000,
      "hopfBloom's first flame convergence",
    );
    if (!converged4) throw new Error("hopfBloom's flame never converged at 1M");
    ok("leg 4: hopfBloom's 4D flame converged at 1M");
    await setControl("motionClipDurationSlider", "2");
    await openCaptureSection();
    const before4 = await page.evaluate(() => window.__mp4s.length);
    const labelsBefore4 = await page.evaluate(() => window.__recLabels.length);
    const toastsBefore4 = await page.evaluate(() => window.__toasts.length);
    await page.click("#recordMotionBtn");
    const samples4 = await sampleClip(
      "the 4D tumble motion clip mp4",
      before4,
      240_000,
    );
    await verifyClip(
      "leg 4",
      samples4,
      before4,
      labelsBefore4,
      4,
      null,
      toastsBefore4,
    );

    // ── leg 5: hopfBloom records the tumble through SOLID ─────────────────
    // The heaviest per-frame commit the clip machinery drives: the 4D pose
    // is baked into the density volume, so each frame's commit (the
    // manual-edit path's revision bump + post) discards the volume and the
    // worker rebuilds it from scratch — bounds re-pilot, grid reallocation,
    // the whole iteration budget, pack + hierarchy — and the frame waits
    // for THAT budget before it paints. Pinned to the 1M floor so the
    // gate's four frames stay seconds each. The main thread stays
    // responsive throughout (the rebuild runs on the CPU worker), so the
    // between-frame sampling instrument works here.
    await page.evaluate(() => {
      document.getElementById("modePointsBtn").click();
    });
    await page.waitForTimeout(1200);
    await setControl("solidIterationsSlider", "0"); // detent 0 = 1M iterations
    await page.evaluate(() => {
      document.getElementById("modeSolidBtn").click();
    });
    const convergedSolidTumble = await waitFor(
      async () => (/converged/.test(await solidProgressText()) ? true : null),
      240_000,
      "hopfBloom's solid render to converge at 1M",
    );
    if (!convergedSolidTumble)
      throw new Error("hopfBloom's solid never converged at 1M");
    ok("leg 5: hopfBloom's 4D solid converged at 1M");
    await setControl("motionClipDurationSlider", "2");
    await openCaptureSection();
    const before5 = await page.evaluate(() => window.__mp4s.length);
    const labelsBefore5 = await page.evaluate(() => window.__recLabels.length);
    const toastsBefore5 = await page.evaluate(() => window.__toasts.length);
    await page.click("#recordMotionBtn");
    const samples5 = await sampleClip(
      "the 4D solid tumble motion clip mp4",
      before5,
      300_000,
    );
    await verifyClip(
      "leg 5",
      samples5,
      before5,
      labelsBefore5,
      4,
      null,
      toastsBefore5,
    );

    // ── leg 6: swirlPentatope records the 4D tumble through Surface compute ─
    // The surface arm's per-frame convergence is the force-frame trace, not a
    // flame budget: the record path's own ensureSurfaceComputeForceFrame
    // supersedes any settle in flight and traces single-sampled frames at the
    // committed pose. No settle wait before recording — the clip's frames
    // ARE the readiness. 480s: SwiftShader compute is the slow path, and 4
    // full traces ride inside this timeout.
    await page.evaluate(() => {
      document.getElementById("modePointsBtn").click();
    });
    await page.waitForTimeout(1200);
    await loadPreset(page, "swirlPentatope");
    const inSurface = await waitFor(
      () =>
        page.evaluate(
          () =>
            document
              .getElementById("modeSurfaceBtn")
              ?.getAttribute("aria-pressed") === "true",
        ),
      30_000,
      "the preset's render hint to enter Surface",
    );
    if (!inSurface) {
      bad("leg 6: swirlPentatope did not enter Surface automatically");
      throw new Error("swirlPentatope never entered Surface mode");
    }
    ok("leg 6: swirlPentatope's render hint entered Surface on its own");
    // The engine token off the ?surfacestate settle latch (the URL carries it
    // at boot) — a 4D surface session is compute-preferred, and the probe's
    // own `engine` field is the app's answer, not a DOM guess. The read must
    // WAIT OUT the async create (an early read says "webgl" while
    // surfaceComputeRenderer is still being assigned), so it polls for
    // "compute" specifically.
    const computeEngine = await waitFor(
      async () => {
        const s = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        return s && s.engine === "compute" ? s : null;
      },
      120_000,
      "the surface session to take compute",
    );
    if (!computeEngine) {
      skip(
        "leg 6: surface compute never took this adapter (the WebGL fallback's " +
          "software strip settle is unbounded in a gate) — run with " +
          "--mode=x11::0 on a real driver to certify the surface leg",
      );
    } else {
      ok("leg 6: the surface session is on compute");
      // The SETTLE must complete before the record click: compute blocks the
      // main thread in multi-second bursts (measured — the record click's
      // input dispatch timed out behind a running settle), and a settled
      // pane is a quiet main thread. The latch's own `completed` is the
      // readiness signal.
      const settled6 = await waitFor(
        async () => {
          const s = await page.evaluate(() =>
            window.__surfaceState ? window.__surfaceState() : null,
          );
          // The latch's field is `settled` (its `completed` local renamed at
          // publish) — the first settle done AND the pane not re-dirtied.
          return s && s.settled ? true : null;
        },
        480_000,
        "the first surface settle to complete",
      );
      if (!settled6) throw new Error("swirlPentatope's settle never completed");
      ok(
        "leg 6: the first surface settle completed (pane quiet, ready to record)",
      );
      await setControl("motionClipDurationSlider", "2");
      await openCaptureSection();
      const before6 = await page.evaluate(() => window.__mp4s.length);
      const labelsBefore6 = await page.evaluate(
        () => window.__recLabels.length,
      );
      const toastsBefore6 = await page.evaluate(() => window.__toasts.length);
      await page.click("#recordMotionBtn");
      const samples6 = await sampleClip(
        "the 4D surface tumble motion clip mp4",
        before6,
        480_000,
      );
      await verifyClip(
        "leg 6",
        samples6,
        before6,
        labelsBefore6,
        4,
        null,
        toastsBefore6,
      );
    }
  } // runDefaultLegs

  // ── leg 7 (--surfacegl): the WebGL fallback tracer records the tumble ──
  // The compute leg's sibling on the FALLBACK arm: `?surfacegl` forces the
  // session onto the WebGL strip tracer even where compute is available.
  // Per frame the driver holds the tracer claim, abandons the settle, and
  // drains the full-tier strip pump synchronously at the committed pose —
  // the record path the compute leg cannot see. A drain that prices past
  // the capture ceilings throws SurfaceCaptureCostError and finalizes the
  // PARTIAL clip, which the stsz assertion fails on honestly (module doc).
  async function runSurfaceglLeg() {
    await page.evaluate(() => {
      document.getElementById("modePointsBtn").click();
    });
    await page.waitForTimeout(1200);
    await loadPreset(page, "swirlPentatope");
    const inSurface = await waitFor(
      () =>
        page.evaluate(
          () =>
            document
              .getElementById("modeSurfaceBtn")
              ?.getAttribute("aria-pressed") === "true",
        ),
      30_000,
      "the preset's render hint to enter Surface",
    );
    if (!inSurface) {
      bad("leg 7: swirlPentatope did not enter Surface automatically");
      throw new Error("swirlPentatope never entered Surface mode");
    }
    ok("leg 7: swirlPentatope's render hint entered Surface on its own");
    // The engine token off the ?surfacestate settle latch: ?surfacegl wins
    // over the compute preference, so the probe must report "webgl" —
    // polling for it specifically also waits out the async session create
    // (an early read says "webgl" while the tracer is still being built,
    // leg 6's note mirrored).
    const webglEngine = await waitFor(
      async () => {
        const s = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        return s && s.engine === "webgl" ? s : null;
      },
      120_000,
      "the surface session to take the WebGL fallback tracer",
    );
    if (!webglEngine) {
      bad("leg 7: the ?surfacegl-forced session never reported engine=webgl");
      return;
    }
    ok("leg 7: the surface session is on the WebGL fallback tracer");
    // Same quiet-main-thread rule as leg 6: wait out the first settle
    // before the record click. The WebGL arm's settle is the full-tier
    // strip drain itself, so `settled` here means the pump finished.
    const settled7 = await waitFor(
      async () => {
        const s = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        return s && s.settled ? true : null;
      },
      480_000,
      "the first WebGL-arm surface settle to complete",
    );
    if (!settled7)
      throw new Error("the WebGL session's settle never completed");
    ok(
      "leg 7: the first surface settle completed (strip pump drained, ready to record)",
    );
    await setControl("motionClipDurationSlider", "2");
    await openCaptureSection();
    // The motion instrument (see the module doc): the settled pane now —
    // the clip's first pose — and the re-settled pane after the run.
    const shotGray64 = async () => {
      const png = await page.locator("canvas").first().screenshot({
        type: "png",
      });
      return decodeGray64(png.toString("base64"));
    };
    const preGray7 = await shotGray64();
    const before7 = await page.evaluate(() => window.__mp4s.length);
    const labelsBefore7 = await page.evaluate(() => window.__recLabels.length);
    const toastsBefore7 = await page.evaluate(() => window.__toasts.length);
    await page.click("#recordMotionBtn");
    const samples7 = await sampleClip(
      "the WebGL-fallback 4D tumble motion clip mp4",
      before7,
      480_000,
    );
    // The unwind restored the live tier loop; wait for it to re-settle the
    // pane at the clip's final pose, then take the post-run shot.
    const reSettled = await waitFor(
      async () => {
        const s = await page.evaluate(() =>
          window.__surfaceState ? window.__surfaceState() : null,
        );
        return s && s.settled ? true : null;
      },
      480_000,
      "the pane to re-settle at the clip's final pose",
    );
    if (!reSettled) throw new Error("the pane never re-settled after the clip");
    const postGray7 = await shotGray64();
    await verifyClip(
      "leg 7",
      samples7,
      before7,
      labelsBefore7,
      4,
      [preGray7, postGray7],
      toastsBefore7,
    );
  }

  // ── page errors ───────────────────────────────────────────────────────
  const realErrors = pageErrors.filter((m) => !/SSL|service worker/i.test(m));
  if (realErrors.length === 0) ok("no page errors");
  else bad(`page errors: ${realErrors.join(" | ")}`);

  if (args.keepOpen) await page.waitForTimeout(600_000);
} catch (err) {
  bad(`script error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
}

log(`ok=${passed} fail=${failed} skipped=${skipped}`);
process.exit(failed === 0 ? 0 : 1);
