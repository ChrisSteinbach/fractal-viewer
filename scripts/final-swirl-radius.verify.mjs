#!/usr/bin/env node
/**
 * Production-browser authoring gate for the final Swirl radius control.
 * Build and preview first, then run on a quiet machine:
 *   node scripts/final-swirl-radius.verify.mjs --display=:0
 *   node scripts/final-swirl-radius.verify.mjs --viewport=320x727
 *
 * Uses the real preset menu, final toggle, variation picker, Fit for Surface,
 * trusted touch/keyboard input, Undo/Redo and Copy Link. Both ordinary 3D/4D
 * bases are authored from scratch; both Swirl showcases must also open their
 * final editor (regression: reciprocal weights above 2 previously threw).
 * The .5 endpoint must survive a fresh context and remain Surface-eligible.
 * Radius is derived geometry, so the document assertions inspect the full
 * pre-affine and reciprocal variation weight, never an invented radius field.
 *
 * Phone controls must retain 44px fields/tracks, accessible refusal/timing,
 * and input focus across valid edits. Invalid drafts must leave the document
 * unchanged. Four app-copied scenes then complete the shared eight-pass
 * compute/WebGL capture gate, with hits and zero exhausted rays. Source math
 * and broader thin-slice fidelity remain owned by their existing harnesses.
 *
 * MEASURED 2026-09-08 on AMD RX 7900 XTX / radeonsi: the full 320x727
 * authoring matrix and all eight hardware captures pass, with zero exhausted
 * rays. Radius fields are 89.1875x44px and tracks 89.1875px. The first 320px
 * check caught a 46.1875px field clipping its 57px text; removing the unused
 * remove-button padding and shortening the radius label column fixed it.
 * Exit 0: pass; 1: checking/setup failure; 3: asserted application failure.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureSettledSurface,
  launchSurfaceBrowser,
} from "./lib/surface-browser-runner.mjs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

const options = {
  url: "https://localhost:4173",
  display: null,
  viewport: "393x727",
  settle: 180_000,
  outdir: "scripts/out/final-swirl-radius",
};
for (const argument of process.argv.slice(2)) {
  const match = /^--(url|display|viewport|settle|outdir)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown option ${argument}`);
  options[match[1]] = match[1] === "settle" ? Number(match[2]) : match[2];
}
const [width, height] = options.viewport.split("x").map(Number);
assert.ok(width > 0 && width <= 640 && height >= 400, "phone viewport");
assert.ok(Number.isFinite(options.settle) && options.settle > 0);
options.url = options.url.replace(/\/+$/, "");

const SLIDER = "#finalSwirlRadiusSlider";
const NUMBER = "#finalSwirlRadiusSliderNumber";
const FIT = "#finalSwirlRadiusFit";
const encode = (scene) =>
  `#v1=${Buffer.from(JSON.stringify(scene)).toString("base64url")}`;
const decode = (hash) =>
  JSON.parse(Buffer.from(hash.replace(/^#?v1=/, ""), "base64url").toString());
// Only a cheap boot document. Every tested system is loaded from the menu.
const BOOT = encode({
  transforms: [
    { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
  ],
  numPoints: 50_000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: false,
  balloonEcho: false,
  surface: { antialiasSamples: 8 },
});
const cases = [
  { name: "manual3", preset: "sierpinski", fourD: false, manual: true },
  { name: "manual4", preset: "pentatope", fourD: true, manual: true },
  { name: "preset3", preset: "swirlTetrahedron", fourD: false },
  { name: "preset4", preset: "swirlPentatope", fourD: true },
];
const contextOptions = {
  ignoreHTTPSErrors: true,
  viewport: { width, height },
  hasTouch: true,
  reducedMotion: "reduce",
};

function near(actual, expected, label, tolerance = 1e-8) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} (tolerance ${tolerance})`,
  );
}

async function boot(page, hash = BOOT) {
  await page.goto(`${options.url}/?surfacestate${hash}`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      Number(
        document
          .getElementById("pointCount")
          ?.textContent?.replace(/[^\d]/g, ""),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
  if (
    !(await page
      .locator("#panel")
      .evaluate((el) => el.classList.contains("open")))
  ) {
    await page.locator("#menuToggle").click();
  }
}

async function openDetails(page, selector) {
  const details = page.locator(selector);
  if (!(await details.evaluate((el) => el.open))) {
    await details.locator(":scope > summary").click();
  }
}

async function openFinal(page) {
  await openDetails(page, "#transformsSection");
  await page
    .locator("#transformList > .transform-btn")
    .filter({ hasText: "Final Transform" })
    .click();
  const group = page
    .locator("#transformEditor > details")
    .filter({ has: page.locator("summary", { hasText: /^Variations$/ }) });
  if (!(await group.evaluate((el) => el.open))) {
    await group.locator(":scope > summary").click();
  }
}

async function copiedHash(page) {
  await page.evaluate(() => {
    window.__radiusCopiedLink = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__radiusCopiedLink = text;
        },
      },
    });
    document.getElementById("copyLinkBtn").click();
  });
  await page.waitForFunction(
    () => typeof window.__radiusCopiedLink === "string",
  );
  return new URL(await page.evaluate(() => window.__radiusCopiedLink)).hash;
}

async function documentAfterChange(page, beforeHash) {
  await page.waitForFunction(
    (previous) =>
      location.hash.startsWith("#v1=") && location.hash !== previous,
    beforeHash,
    { timeout: 15_000 },
  );
  return decode(await copiedHash(page));
}

async function exactRadius(page, value) {
  const beforeHash = await page.evaluate(() => location.hash);
  const number = page.locator(NUMBER);
  // A retained DOM node proves focus did not merely move to its replacement.
  await number.evaluate((el) => {
    window.__radiusFocusedNode = el;
  });
  await number.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  const scene = await documentAfterChange(page, beforeHash);
  assert.equal(
    await number.evaluate(
      (el) =>
        el === window.__radiusFocusedNode && document.activeElement === el,
    ),
    true,
    "valid radius edit retains the focused numeric control",
  );
  near(Number(await number.inputValue()), value, "exact radius readout");
  return scene;
}

function assertScaledFinal(before, after, factor) {
  for (const key of ["scale", "position"]) {
    for (let axis = 0; axis < 3; axis++) {
      near(
        after[key][axis],
        before[key][axis] * factor,
        `${key}[${axis}]`,
        1e-7,
      );
    }
  }
  assert.deepEqual(
    after.rotation,
    before.rotation,
    "radius preserves rotation",
  );
  assert.deepEqual(after.shear, before.shear, "radius preserves shear");
  assert.deepEqual(after.post, before.post, "radius preserves post-affine");
  assert.equal(after.variations.length, before.variations.length);
  const active = before.variations.findIndex(
    (v) => v.type === "swirl" && v.weight !== 0,
  );
  assert.ok(active >= 0);
  for (let i = 0; i < before.variations.length; i++) {
    if (i === active) {
      near(
        after.variations[i].weight,
        before.variations[i].weight / factor,
        "reciprocal swirl weight",
        1e-7,
      );
      assert.equal(
        Math.sign(after.variations[i].weight),
        Math.sign(before.variations[i].weight),
      );
    } else assert.deepEqual(after.variations[i], before.variations[i]);
  }
  if (before.w === undefined)
    assert.equal(after.w, undefined, "retain absent w extension");
  else {
    const expected = { ...before.w };
    if (expected.position !== undefined) expected.position *= factor;
    if (expected.scale !== undefined) expected.scale *= factor;
    assert.deepEqual(
      after.w,
      expected,
      "scale authored w position/scale, retain its pose",
    );
  }
}

async function surfaceEntry(page) {
  assert.equal(
    await page.locator("#modeSurfaceBtn").isEnabled(),
    true,
    "edited scene remains Surface-eligible",
  );
  if (
    (await page.locator("#modeSurfaceBtn").getAttribute("aria-pressed")) !==
    "true"
  ) {
    await page.locator("#modeSurfaceBtn").click();
  }
  await page.waitForFunction(
    () =>
      window.__surfaceState?.().mode === "surface" &&
      window.__surfaceState().firstFrame,
    undefined,
    { timeout: options.settle },
  );
}

async function auditControl(page) {
  await page.locator(NUMBER).scrollIntoViewIfNeeded();
  const layout = await page.locator(NUMBER).evaluate((number) => {
    const slider = document.getElementById("finalSwirlRadiusSlider");
    const note = document.getElementById("finalSwirlRadiusNote");
    const box = number.getBoundingClientRect();
    const track = slider.getBoundingClientRect();
    const panel = document.getElementById("panel").getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      track: track.width,
      insidePanel: box.left >= panel.left && box.right <= panel.right,
      clipped: number.scrollWidth > number.clientWidth + 1,
      disabledParity: slider.disabled === number.disabled,
      descriptions: number.getAttribute("aria-describedby") ?? "",
      note: note.textContent,
    };
  });
  assert.ok(
    layout.width >= 44 && layout.height >= 44 && layout.track >= 44,
    `44px number field and retained track: ${JSON.stringify(layout)}`,
  );
  assert.ok(
    layout.insidePanel && !layout.clipped && layout.disabledParity,
    `unclipped, synchronized radius control inside the panel: ${JSON.stringify(layout)}`,
  );
  assert.match(layout.descriptions, /finalSwirlRadiusNote/);
  assert.match(layout.descriptions, /transformTimingHint/);
  assert.ok(
    layout.note.trim(),
    "radius purpose/qualification has adjacent copy",
  );
  await page.locator(NUMBER).tap();
  assert.equal(
    await page.locator(NUMBER).evaluate((el) => document.activeElement === el),
    true,
    "trusted touch focuses radius",
  );
  await page.locator(SLIDER).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(NUMBER).evaluate((el) => document.activeElement === el),
    true,
    "Tab reaches exact radius",
  );
  return layout;
}

async function authorCase(browser, fixture) {
  const context = await browser.newContext(contextOptions);
  const pageErrors = [];
  let hash;
  let scene;
  let layout;
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await boot(page);
    await openDetails(page, "#presetSection");
    const initialHash = await page.evaluate(() => location.hash);
    await page.selectOption("#presetSelect", fixture.preset);
    await documentAfterChange(page, initialHash);
    if (fixture.manual) {
      await openDetails(page, "#transformsSection");
      await page.locator("#finalTransformToggle").check();
      await openFinal(page);
      await page.selectOption("#transformEditor .variation-add", "swirl");
      await page.locator(NUMBER).waitFor({ state: "visible" });
      assert.ok(
        Number(await page.locator(NUMBER).inputValue()) > 0.5,
        "new unscaled swirl displays its over-cap radius",
      );
      assert.equal(
        await page.locator("#modeSurfaceBtn").isEnabled(),
        false,
        "raw swirl radius exceeds Surface qualification",
      );
      const beforeFit = decode(await copiedHash(page));
      const beforeFitHash = await page.evaluate(() => location.hash);
      await page.locator(FIT).click();
      const fitted = await documentAfterChange(page, beforeFitHash);
      near(
        Number(await page.locator(NUMBER).inputValue()),
        0.5,
        "Fit for Surface radius",
      );
      assert.notDeepEqual(
        fitted.finalTransform.scale,
        beforeFit.finalTransform.scale,
        "fit changes pre-affine",
      );
      assert.notEqual(
        fitted.finalTransform.variations[0].weight,
        beforeFit.finalTransform.variations[0].weight,
        "fit restores output scale through weight",
      );
      assert.equal(await page.locator("#modeSurfaceBtn").isEnabled(), true);
      layout = await auditControl(page);

      scene = await exactRadius(page, 0.3);
      assertScaledFinal(fitted.finalTransform, scene.finalTransform, 0.6);
      const exact = scene;
      let previous = await page.evaluate(() => location.hash);
      await page.locator("#undoBtn").click();
      let restored = await documentAfterChange(page, previous);
      assert.deepEqual(
        restored.finalTransform,
        fitted.finalTransform,
        "one Undo restores entire fitted final",
      );
      previous = await page.evaluate(() => location.hash);
      await page.locator("#redoBtn").click();
      restored = await documentAfterChange(page, previous);
      assert.deepEqual(
        restored.finalTransform,
        exact.finalTransform,
        "one Redo restores the radius edit",
      );
      await openFinal(page);

      const step = Number(await page.locator(SLIDER).getAttribute("step"));
      assert.ok(step > 0 && step < 0.1);
      previous = await page.evaluate(() => location.hash);
      await page.locator(NUMBER).focus();
      await page.keyboard.press("ArrowUp");
      scene = await documentAfterChange(page, previous);
      near(
        Number(await page.locator(NUMBER).inputValue()),
        0.3 + step,
        "Arrow increments radius",
      );
      assertScaledFinal(
        exact.finalTransform,
        scene.finalTransform,
        (0.3 + step) / 0.3,
      );
      const accepted = await page.locator(NUMBER).inputValue();
      const acceptedHash = await page.evaluate(() => location.hash);
      await page.locator(NUMBER).focus();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("-0.1");
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator(NUMBER).getAttribute("aria-invalid"),
        "true",
      );
      const error = page
        .locator(NUMBER)
        .locator("..")
        .locator(".range-number-error");
      assert.equal(await error.isVisible(), true);
      assert.equal(await error.getAttribute("role"), "alert");
      assert.equal(
        await page.evaluate(() => location.hash),
        acceptedHash,
        "negative radius never mutates the document",
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(NUMBER).inputValue(), accepted);
      assert.equal(
        await page.locator(NUMBER).getAttribute("aria-invalid"),
        null,
      );
    } else {
      await page.waitForFunction(
        () => window.__surfaceState?.().mode === "surface",
        undefined,
        { timeout: 30_000 },
      );
      await openFinal(page);
      layout = await auditControl(page);
      const authored = decode(await copiedHash(page));
      assert.ok(
        authored.finalTransform.variations[0].weight > 2,
        "exercise expanded variation-weight bounds",
      );
      scene = await exactRadius(page, 0.5);
      assert.deepEqual(
        scene.transforms,
        authored.transforms,
        "radius never changes recursive generators",
      );
    }
    await surfaceEntry(page);
    assert.match(
      await page.locator("#transformTimingHint").textContent(),
      /restart Surface/,
    );
    hash = await copiedHash(page);
    scene = decode(hash);
    assert.equal(
      scene.transforms.some((t) => t.w !== undefined),
      fixture.fourD,
    );
    // Mode entry scrolls its button into view; put the authored control back
    // on screen so the UI artifact actually shows what this gate exercised.
    await page.locator(NUMBER).scrollIntoViewIfNeeded();
    await page.locator(NUMBER).evaluate((number) => {
      const panel = document.getElementById("panel");
      panel.scrollTo({
        top:
          panel.scrollTop +
          number.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          180,
        behavior: "instant",
      });
    });
    await writeFile(
      path.join(options.outdir, `${fixture.name}-ui.png`),
      await page.screenshot(),
    );
    assert.deepEqual(pageErrors, [], "final editor emits no page errors");
  } finally {
    await context.close();
  }

  const restored = await browser.newContext(contextOptions);
  try {
    const page = await restored.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await boot(page, hash);
    await openFinal(page);
    const reloaded = decode(await copiedHash(page));
    assert.deepEqual(
      reloaded.finalTransform,
      scene.finalTransform,
      "copied final survives fresh-context reload",
    );
    assert.deepEqual(
      reloaded.transforms,
      scene.transforms,
      "copied generators survive fresh-context reload",
    );
    await surfaceEntry(page);
    assert.deepEqual(pageErrors, [], "reload emits no page errors");
  } finally {
    await restored.close();
  }
  return {
    name: fixture.name,
    hash,
    layout,
    finalTransform: scene.finalTransform,
  };
}

async function main() {
  await guardFreshDist({ url: options.url });
  await mkdir(options.outdir, { recursive: true });
  const browser = await launchSurfaceBrowser(
    options.display ? `x11:${options.display}` : "sw",
  );
  const records = [];
  try {
    for (const fixture of cases) {
      console.log(`[final-swirl-radius] ${fixture.name}: authoring`);
      const row = await authorCase(browser, fixture);
      row.captures = [];
      records.push(row);
      await writeFile(
        path.join(options.outdir, "results.json"),
        JSON.stringify(records, null, 2),
      );
      for (const engine of ["compute", "webgl"]) {
        console.log(`[final-swirl-radius] ${fixture.name}: ${engine}`);
        const capture = await captureSettledSurface(browser, {
          url: options.url,
          hash: row.hash,
          engine,
          timeoutMs: options.settle,
          release: Boolean(options.display),
        });
        await writeFile(
          path.join(options.outdir, `${fixture.name}-${engine}.png`),
          capture.png,
        );
        row.captures.push({
          engine,
          backend: capture.backend,
          census: capture.census,
          elapsedMs: capture.elapsedMs,
        });
        await writeFile(
          path.join(options.outdir, "results.json"),
          JSON.stringify(records, null, 2),
        );
        assert.ok(
          capture.census.covered > 0,
          "edited scene draws completed hits",
        );
        assert.equal(
          capture.census.exhausted,
          0,
          "edited scene has no exhausted rays",
        );
      }
    }
    console.log(
      "[final-swirl-radius] PASS: 3D/4D manual and preset edits, touch/keyboard, undo/reload, eight compute/WebGL captures",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = error?.code === "ERR_ASSERTION" ? 3 : 1;
});
