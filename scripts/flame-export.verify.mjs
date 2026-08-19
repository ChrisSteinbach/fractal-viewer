#!/usr/bin/env node
/**
 * The flame Save-PNG gate: end-to-end PASS/FAIL verification, in a real
 * headless browser, that a Save PNG taken in Flame mode saves THE FLAME,
 * FINISHED — and never the Points explorer.
 *
 * THE TWO BUGS THIS EXISTS TO CATCH, both invisible to the unit suite
 * because both live in what a downloaded image CONTAINS:
 *
 *  1. WRONG SUBJECT. Every arm of main.ts's `planPngExport` used to read
 *     `renderMode === X && session.hasFirstFrame`, and the fall-through when
 *     a gate failed was `scene.captureFrame(scale)` — the point cloud. So an
 *     export during any render's startup gap silently saved a DIFFERENT
 *     render mode's picture. The Export-size select reaches that state on
 *     purpose: changing it restarts the flame session (a flame
 *     accumulates AT the export size), so switching to 2x and pressing Save
 *     straight away downloaded the explorer. Phase 2 is that exact sequence.
 *
 *  2. UNFINISHED PICTURE. The flame canvas IS the export, so whatever the
 *     accumulation had reached at the moment of the press is what saved.
 *     That is not merely a noisier frame: the worker's finishing chunk
 *     re-filters the histogram with the ADAPTIVE density estimator where
 *     every progressive frame uses the cheap fixed-radius one. Phase 3
 *     presses Save mid-accumulation and asserts the PNG does not arrive
 *     until the readout says 100%.
 *
 * MEASURED at the fix, same box, same build otherwise — 16/16 fixed, and on
 * the pre-fix build SIX failures naming every symptom:
 *
 *   phase 2  the 2x save right after the Capture-size restart came back the
 *            POINTS EXPLORER at 1640x1080 — distance 3.4 to the points
 *            reference against 13.5 to the flame. Note the SIZE was right,
 *            which is how this evaded notice for so long.
 *   phase 2  the PNG landed at 0% — and, fixed, the 2x accumulation reaches
 *            100% before it does. That kills the report's open "the 2x
 *            restart is failing outright" hypothesis: the session converges
 *            fine, the export was simply racing its first-frame gap.
 *   phase 3  pressed at 5%, saved at 5%.
 *   phase 3  the wait was never disclosed — no modal at all.
 *   phase 4  no modal, so nothing to cancel.
 *   phase 5  a Save on SOLID's entry landed with its readout at 0%.
 *
 * HOW A PNG IS CLASSIFIED, and why it is a comparison rather than a
 * heuristic: the script first saves a POINTS reference (points mode) and a
 * FLAME reference (a converged flame), from the SAME camera, and then asks
 * of every later PNG only which reference it is closer to — mean absolute
 * difference over a 64x64 grayscale downscale. No threshold on "smoothness"
 * or "lit fraction" has to be tuned, and the question asked is exactly the
 * question the bug is about: is this the explorer's image or the flame's?
 *
 * The blobs are read through a `URL.createObjectURL` hook rather than the
 * download machinery, so the assertion is on the bytes the app handed the
 * browser, and each is stamped with the moment it appeared — which is what
 * makes phase 3's ordering assertion (PNG after 100%, not before) possible.
 *
 *   node scripts/flame-export.verify.mjs [url]            # default :4173
 *   node scripts/flame-export.verify.mjs --keep-open
 *
 * Serve a production build first (`npm run build && npm run preview`); the
 * dev server works too. Software WebGL is fine and expected — the flame
 * takes its CPU backend there, which is the slow path, so the quality slider
 * is pinned to its 1M-iteration floor for every phase that has to converge.
 *
 * Exit 0 = every assertion held. Exit 1 = a real failure.
 */
import { chromium } from "playwright-core";

const args = { url: "https://localhost:4173", keepOpen: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--keep-open") args.keepOpen = true;
  else if (arg.startsWith("--url=")) args.url = arg.slice(6);
  else if (!arg.startsWith("--")) args.url = arg;
}
args.url = args.url.replace(/\/+$/, "");

const log = (s) => console.log(`[flame-export] ${s}`);
let passed = 0;
let failed = 0;
const ok = (s) => {
  passed++;
  log(`ok   ${s}`);
};
const bad = (s) => {
  failed++;
  log(`FAIL ${s}`);
};

/** Mean absolute difference between two 64x64 grayscale vectors, 0..255. */
function grayDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Did the PNG land only once the accumulation had FINISHED? — the one
 * question symptom 1 turns on, asked of a 100ms trace.
 *
 * Two spellings of "finished", because the readout has two: the sample the
 * PNG appears in reads 100%, or some sample at or before it caught the
 * worker's density-estimation pass, which runs only on the finishing chunk
 * and blanks the percentage while it does. A partial save shows neither —
 * it lands at whatever percent the press caught, with no estimating spell
 * anywhere before it.
 */
function landedAfterConvergence(trace, pngsBefore) {
  const at = trace.findIndex((s) => s.pngs > pngsBefore);
  if (at < 0) return { ok: false, why: "no PNG in the trace" };
  const upTo = trace.slice(0, at + 1);
  const lastPct = [...upTo].reverse().find((s) => s.pct !== null)?.pct ?? null;
  if (upTo[at].pct === 100) return { ok: true, why: "readout at 100%" };
  if (upTo.some((s) => s.est)) {
    return {
      ok: true,
      why: `density-estimation pass seen first (last ${String(lastPct)}%)`,
    };
  }
  return { ok: false, why: `landed at ${String(lastPct)}%` };
}

const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 820, height: 540 },
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── instrumentation, installed before the app can save anything ───────
  // Both hooks are read-only observers: the PNG hook passes the blob
  // straight through to the real createObjectURL so the download still
  // happens exactly as it would unobserved, and the sampler only reads DOM
  // text. Nothing here can make a broken build look fixed.
  await page.addInitScript(() => {
    window.__pngs = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob && b.type === "image/png") {
        window.__pngs.push({ at: performance.now(), blob: b });
      }
      return origCreate(b);
    };
    window.__trace = [];
    setInterval(() => {
      const el = document.getElementById("flameProgress");
      const text = el?.textContent ?? "";
      const m = /\((\d+)%\)/.exec(text);
      const modal = document.getElementById("exportModal");
      window.__trace.push({
        t: performance.now(),
        pct: m ? Number(m[1]) : null,
        // The worker's FINISHING chunk, and only it: `estimating` precedes
        // the adaptive density-estimation pass that rebuilds the final
        // display, so no progressive frame ever shows this. It replaces the
        // percentage while it runs, which is why the percentage alone
        // cannot answer "had the render finished when the PNG landed".
        est: /density estimate/.test(text),
        solidPct: (() => {
          const sm = /\((\d+)%\)/.exec(
            document.getElementById("solidProgress")?.textContent ?? "",
          );
          return sm ? Number(sm[1]) : null;
        })(),
        pngs: window.__pngs.length,
        modal: modal ? !modal.classList.contains("hidden") : false,
      });
    }, 100);
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

  const clickSave = () =>
    page.evaluate(() => {
      const btn = document.getElementById("savePngBtn");
      if (btn.disabled) return false;
      btn.click();
      return true;
    });

  const pngCount = () => page.evaluate(() => window.__pngs.length);
  const flamePct = () =>
    page.evaluate(() => {
      const m = /\((\d+)%\)/.exec(
        document.getElementById("flameProgress")?.textContent ?? "",
      );
      return m ? Number(m[1]) : null;
    });
  const toastText = () =>
    page.evaluate(() =>
      (document.getElementById("toast")?.textContent ?? "").trim(),
    );

  /** Read PNG #i back as {w, h, gray[4096], at}. */
  const readPng = (i) =>
    page.evaluate(async (i) => {
      const rec = window.__pngs[i];
      if (!rec) return null;
      const bm = await createImageBitmap(rec.blob);
      const c = new OffscreenCanvas(64, 64);
      const g = c.getContext("2d");
      g.drawImage(bm, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      const gray = [];
      for (let p = 0; p < d.length; p += 4) {
        gray.push(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
      }
      return { w: bm.width, h: bm.height, gray, at: rec.at };
    }, i);

  /** Let the 100ms sampler tick a couple more times, so the sample that
   * records a just-arrived PNG is definitely in the buffer before it is
   * drained. `waitFor` polls `window.__pngs` directly and can beat the
   * sampler to it, which reads as "no PNG in the trace" — an instrument
   * race, not a finding. */
  const settleTrace = () => page.waitForTimeout(350);

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

  const takeTrace = () =>
    page.evaluate(() => {
      const t = window.__trace;
      window.__trace = [];
      return t;
    });

  // ── boot ──────────────────────────────────────────────────────────────
  await page.goto(`${args.url}/`);
  const booted = await waitFor(
    () =>
      page.evaluate(
        () => !document.getElementById("modeFlameBtn")?.disabled ?? false,
      ),
    60_000,
    "the app to boot (mode buttons enabled)",
  );
  if (!booted) throw new Error("app never booted");
  ok("app booted, render modes enabled");

  // Pin the camera before either reference is taken: the two references and
  // every test image must be the same view, or "closer to points" stops
  // meaning anything. A drag is the cheapest way to freeze the auto-frame
  // glide; after this nothing moves the camera again.
  await page.mouse.move(410, 270);
  await page.mouse.down();
  await page.mouse.move(430, 280, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // ── reference A: the points explorer ──────────────────────────────────
  if (!(await clickSave())) throw new Error("Save PNG button was disabled");
  if (
    !(await waitFor(async () => (await pngCount()) >= 1, 30_000, "points PNG"))
  )
    throw new Error("no points reference PNG");
  const refPoints = await readPng(0);
  ok(`points reference captured (${refPoints.w}x${refPoints.h})`);

  // ── enter flame at the 1M-iteration floor ─────────────────────────────
  await setControl("flameIterationsSlider", "0"); // detent 0 = 1M iterations
  await page.evaluate(() => {
    document.getElementById("modeFlameBtn").click();
  });
  const converged = await waitFor(
    async () => (await flamePct()) === 100,
    120_000,
    "the first flame accumulation to reach 100%",
  );
  if (!converged) throw new Error("flame never converged at 1x");
  ok("flame converged at 1x (1M iterations)");

  // ── phase 1: a converged 1x save is the flame ─────────────────────────
  await takeTrace();
  if (!(await clickSave())) bad("phase 1: Save PNG was disabled");
  if (
    !(await waitFor(async () => (await pngCount()) >= 2, 60_000, "flame PNG"))
  ) {
    bad("phase 1: no PNG was produced from a converged flame");
  }
  const refFlame = await readPng(1);
  if (refFlame) {
    const dPts = grayDistance(refFlame.gray, refPoints.gray);
    if (dPts > 3) {
      ok(
        `phase 1: converged 1x save differs from the explorer (dist ${dPts.toFixed(1)}/255, ${refFlame.w}x${refFlame.h})`,
      );
    } else {
      bad(
        `phase 1: converged 1x save is indistinguishable from the explorer (dist ${dPts.toFixed(1)}/255)`,
      );
    }
  }

  /** Classify a PNG against the two references. */
  const classify = (img) => {
    const dFlame = grayDistance(img.gray, refFlame.gray);
    const dPoints = grayDistance(img.gray, refPoints.gray);
    return { dFlame, dPoints, isFlame: dFlame < dPoints };
  };

  // ── phase 2: THE HEADLINE. 2x, saved the instant the select restarts ──
  // Symptom 2 of the report, reproduced literally: set Capture size to 2x
  // (which calls restartFlameRender -> flameSession.enter -> firstFrame
  // false) and press Save with no wait at all.
  await takeTrace();
  const beforeP2 = await pngCount();
  await setControl("exportScale", "2");
  const pressed2 = await clickSave();
  if (!pressed2) bad("phase 2: Save PNG was disabled right after the restart");
  const got2 = await waitFor(
    async () => (await pngCount()) > beforeP2,
    180_000,
    "the 2x PNG",
  );
  await settleTrace();
  const trace2 = await takeTrace();
  if (!got2) {
    bad("phase 2: no PNG was ever produced at 2x");
  } else {
    const img2 = await readPng(beforeP2);
    const c2 = classify(img2);
    const dims = `${img2.w}x${img2.h}`;
    if (c2.isFlame) {
      ok(
        `phase 2: 2x save right after the Capture-size restart is the FLAME (${dims}; dist flame ${c2.dFlame.toFixed(1)} vs points ${c2.dPoints.toFixed(1)})`,
      );
    } else {
      bad(
        `phase 2: 2x save right after the Capture-size restart is the POINTS EXPLORER (${dims}; dist flame ${c2.dFlame.toFixed(1)} vs points ${c2.dPoints.toFixed(1)})`,
      );
    }
    // The restart must also actually COMPLETE at 2x — the report left open
    // whether the export merely raced a startup gap or whether the 2x
    // session was failing outright and dropping back to the explorer.
    const w2 = landedAfterConvergence(trace2, beforeP2);
    if (w2.ok) {
      ok(
        `phase 2: the 2x accumulation finished before the PNG landed (${w2.why})`,
      );
    } else {
      bad(
        `phase 2: the export did not wait for the 2x accumulation (${w2.why})`,
      );
    }
    if (trace2.some((s) => s.modal)) {
      ok("phase 2: the export modal disclosed the wait");
    } else {
      log("     note: the 2x wait finished inside the modal's grace period");
    }
  }

  // ── phase 3: a mid-accumulation save waits for 100% ───────────────────
  // Symptom 1. Back to 1x with a budget big enough that the press lands
  // well short of the end (detent 4 = 20M, the shipped default).
  await setControl("exportScale", "1");
  await setControl("flameIterationsSlider", "4");
  const climbing = await waitFor(
    async () => {
      const p = await flamePct();
      return p !== null && p >= 5 && p < 60 ? p : null;
    },
    120_000,
    "the accumulation to climb past 5%",
  );
  if (climbing === null) {
    bad("phase 3: never caught the accumulation mid-flight");
  } else {
    await takeTrace();
    const beforeP3 = await pngCount();
    const pctAtPress = await flamePct();
    if (!(await clickSave())) bad("phase 3: Save PNG was disabled");
    const got3 = await waitFor(
      async () => (await pngCount()) > beforeP3,
      300_000,
      "the mid-accumulation PNG",
    );
    await settleTrace();
    const trace3 = await takeTrace();
    if (!got3) {
      bad("phase 3: no PNG was produced");
    } else {
      const w3 = landedAfterConvergence(trace3, beforeP3);
      if (w3.ok) {
        ok(
          `phase 3: pressed at ${String(pctAtPress)}%, PNG landed only once the render finished (${w3.why})`,
        );
      } else {
        bad(
          `phase 3: pressed at ${String(pctAtPress)}%, the export saved an unfinished flame (${w3.why})`,
        );
      }
      const img3 = await readPng(beforeP3);
      const c3 = classify(img3);
      if (c3.isFlame) {
        ok("phase 3: the saved image is the flame, not the explorer");
      } else {
        bad(
          `phase 3: the saved image is the explorer (dist flame ${c3.dFlame.toFixed(1)} vs points ${c3.dPoints.toFixed(1)})`,
        );
      }
      if (trace3.some((s) => s.modal)) {
        ok("phase 3: the export modal disclosed the wait");
      } else {
        bad("phase 3: the wait was never disclosed — no modal appeared");
      }
    }
  }

  // ── phase 4: Cancel stops the wait and saves nothing ──────────────────
  // A bigger budget (detent 6 = 100M) so the modal is certainly up when the
  // cancel lands.
  await setControl("flameIterationsSlider", "6");
  await page.waitForTimeout(1500);
  const beforeP4 = await pngCount();
  if (!(await clickSave())) bad("phase 4: Save PNG was disabled");
  const modalUp = await waitFor(
    () =>
      page.evaluate(
        () =>
          !document.getElementById("exportModal").classList.contains("hidden"),
      ),
    30_000,
    "the export modal",
  );
  if (!modalUp) {
    bad("phase 4: the export modal never opened for a long flame wait");
  } else {
    ok("phase 4: the export modal opened for the wait");
    await page.evaluate(() => {
      document.getElementById("exportCancelBtn").click();
    });
    const cancelled = await waitFor(
      async () => (await toastText()).includes("cancelled"),
      30_000,
      'the "Export cancelled" toast',
    );
    if (cancelled)
      ok(`phase 4: cancel honoured (toast "${await toastText()}")`);
    else bad("phase 4: cancel produced no cancellation toast");
    if ((await pngCount()) === beforeP4) {
      ok("phase 4: a cancelled export saved no PNG");
    } else {
      bad("phase 4: a cancelled export still downloaded a PNG");
    }
    const reArmed = await waitFor(
      () =>
        page.evaluate(() => !document.getElementById("savePngBtn").disabled),
      15_000,
      "Save PNG to re-enable",
    );
    if (reArmed) ok("phase 4: Save PNG is usable again after a cancel");
    else bad("phase 4: Save PNG stayed disabled after a cancel");
  }

  // ── phase 5: SOLID's arm had the same fall-through ────────────────────
  // The report only names Flame, but the substitution lived in the arms'
  // SHARED fall-through, so every render mode carried it. Solid's window is
  // its voxel worker's grid build, which a Save pressed on the mode entry
  // lands squarely inside.
  //
  // Asked of the trace rather than of the pixels, deliberately. The obvious
  // image test — is this closer to a solid reference or to the points one —
  // is not sound here: the explorer re-seeds its chaos game on every mode
  // switch, so a points reference does not survive one, and the two
  // distances came out 5.1 vs 5.1 when it was tried. The trace question is
  // exact and needs no threshold at all: solid's `#solidProgress` reads 0%
  // from the session's resetProgress until the worker's grid lands, and the
  // solid arm's wait is the ONLY thing that can hold a PNG past that point.
  await page.evaluate(() => {
    document.getElementById("modePointsBtn").click();
  });
  await page.waitForTimeout(1200);
  await setControl("solidIterationsSlider", "1000000"); // the floor: a CPU grid build
  await takeTrace();
  const beforeP5 = await pngCount();
  await page.evaluate(() => {
    document.getElementById("modeSolidBtn").click();
  });
  if (!(await clickSave()))
    bad("phase 5: Save PNG was disabled on solid entry");
  const got5 = await waitFor(
    async () => (await pngCount()) > beforeP5,
    180_000,
    "the entry-time solid PNG",
  );
  await settleTrace();
  const trace5 = await takeTrace();
  if (!got5) {
    bad("phase 5: no PNG was produced from a solid entry-time save");
  } else {
    const at = trace5.findIndex((s) => s.pngs > beforeP5);
    const solidPct = at < 0 ? null : trace5[at].solidPct;
    if (solidPct !== null && solidPct > 0) {
      ok(
        `phase 5: a Save pressed on solid entry waited for the grid (readout ${String(solidPct)}% when the PNG landed)`,
      );
    } else {
      bad(
        `phase 5: a Save pressed on solid entry did not wait for the grid (readout ${String(solidPct)}% when the PNG landed) — this is the points explorer`,
      );
    }
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

log(`ok=${passed} fail=${failed}`);
process.exit(failed === 0 ? 0 : 1);
