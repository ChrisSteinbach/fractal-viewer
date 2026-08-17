import {
  buildSurfaceComputeBackground,
  fitSurfaceComputeRaster,
  initialShadeHitCost,
  marchChunkFor,
  nextShadeBatchSize,
  nextShadeHitCost,
  nextStepsPerPass,
  resampleSurfacePixels,
  shadeHitBatchSize,
  shadeHitAllowanceUs,
  shadeHitBudgetUs,
  SURFACE_COMPUTE_MARCH_CHUNK_MIN,
  SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
  SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
  SURFACE_COMPUTE_MAX_TILE_RAYS,
  SURFACE_COMPUTE_PASS_TARGET_MS,
  SURFACE_COMPUTE_RAY_STATE_BYTES,
  SURFACE_COMPUTE_SHADE_COST_PIVOT,
  SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS,
  SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
  SURFACE_COMPUTE_SHADE_HIT_CAP_START,
  SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  SurfaceComputeRenderer,
  surfaceComputeBandStops,
  surfaceComputeMaxDispatchRays,
  surfaceComputeMaxFrameRays,
  surfaceComputeProgressDone,
  surfaceComputeTileRows,
  subPixelSample,
} from "./surface-compute";
import type {
  SurfaceComputeFrameSpec,
  SurfaceComputeTarget,
} from "./surface-compute";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";

describe("buildSurfaceComputeBackground", () => {
  it("fills each row with the kernel's own bottom-to-top gradient at pixel centers", () => {
    // 2x4: row 0 is the BOTTOM (the kernel's py=0 is ndcY=-1), sampled at
    // v=(py+0.5)/h — the GLSL main()'s mix(uBgBottom, uBgTop, vUv.y) with
    // pack4x8unorm's round-half-up quantization.
    const rows = buildSurfaceComputeBackground(
      2,
      4,
      hexToRgb01(DARK_BACKDROP.top),
      hexToRgb01(DARK_BACKDROP.bottom),
    );
    expect(rows.length).toBe(2 * 4 * 4);
    const bottom = hexToRgb01(DARK_BACKDROP.bottom);
    const top = hexToRgb01(DARK_BACKDROP.top);
    const expected = (py: number, c: number): number =>
      Math.round((bottom[c] + (top[c] - bottom[c]) * ((py + 0.5) / 4)) * 255);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 2; px++) {
        const o = (py * 2 + px) * 4;
        expect(rows[o]).toBe(expected(py, 0));
        expect(rows[o + 1]).toBe(expected(py, 1));
        expect(rows[o + 2]).toBe(expected(py, 2));
        expect(rows[o + 3]).toBe(255);
      }
    }
    // The gradient really runs bottom -> top (backdrop darkens upward).
    expect(rows[2]).toBeGreaterThan(rows[3 * 2 * 4 + 2]);
  });

  it("tracks custom top/bottom stops rather than any built-in constant", () => {
    // Red top / blue bottom, hand-computed against the documented formula —
    // NOT re-derived by calling the function under test — so this proves
    // the prefill actually reads the passed stops (fr-5ps1's Background
    // control) instead of silently always reproducing DARK_BACKDROP.
    const rows = buildSurfaceComputeBackground(2, 4, [1, 0, 0], [0, 0, 1]);

    expect(rows.length).toBe(2 * 4 * 4);
    // v = (py + 0.5) / 4; r = round(v * 255), g = 0, b = round((1 - v) * 255).
    const expected = [
      { r: 32, b: 223 }, // py=0, v=0.125
      { r: 96, b: 159 }, // py=1, v=0.375
      { r: 159, b: 96 }, // py=2, v=0.625
      { r: 223, b: 32 }, // py=3, v=0.875
    ];
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 2; px++) {
        const o = (py * 2 + px) * 4;
        expect(rows[o]).toBe(expected[py].r);
        expect(rows[o + 1]).toBe(0);
        expect(rows[o + 2]).toBe(expected[py].b);
        expect(rows[o + 3]).toBe(255);
      }
    }
  });
});

describe("surfaceComputeMaxDispatchRays", () => {
  it("buys 4,194,240 rays at WebGPU's spec-minimum workgroup ceiling (fr-257o)", () => {
    // The device is requested without raising maxComputeWorkgroupsPerDimension
    // (only the two storage limits are), which pins it at the spec floor of
    // 65535 on every shipped adapter — so this is the figure that actually
    // bounds a dispatch in the field, since every dispatch this module issues
    // is one-dimensional at SURFACE_COMPUTE_WORKGROUP_SIZE (64) threads per
    // workgroup.
    const rays = surfaceComputeMaxDispatchRays({
      maxComputeWorkgroupsPerDimension: 65535,
    });
    expect(rays).toBe(65535 * SURFACE_COMPUTE_WORKGROUP_SIZE);
    expect(rays).toBe(4_194_240);
  });

  it("scales linearly with a larger reported ceiling", () => {
    // A device advertising 4x the spec-minimum workgroup ceiling buys 4x
    // the rays — the relationship is a straight multiply, not a curve.
    expect(
      surfaceComputeMaxDispatchRays({
        maxComputeWorkgroupsPerDimension: 65535 * 4,
      }),
    ).toBe(4_194_240 * 4);
  });

  it("floors at one workgroup's worth of rays rather than 0 on a degenerate limit", () => {
    // A zero-reported ceiling would zero out the multiplication, and a
    // zero-length dispatch drains no queue and never terminates the loop
    // that sized it — so the floor holds it at SURFACE_COMPUTE_WORKGROUP_SIZE.
    expect(
      surfaceComputeMaxDispatchRays({ maxComputeWorkgroupsPerDimension: 0 }),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });
});

describe("surfaceComputeMaxFrameRays", () => {
  it("sizes the frame by the ray-state buffer against the tighter ceiling", () => {
    // A 128 MiB storage-binding ceiling under a 256 MiB buffer ceiling:
    // the binding one governs, and it buys 128 MiB / 16 B = 8.4M rays —
    // just over a 4K raster, and a quarter of what a 4x export of a
    // 1920x1057 pane would ask for (fr-biox's report).
    expect(
      surfaceComputeMaxFrameRays({
        maxBufferSize: 256 * 1024 * 1024,
        maxStorageBufferBindingSize: 128 * 1024 * 1024,
      }),
    ).toBe((128 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES);
  });

  it("takes the buffer ceiling when it is the lower of the two", () => {
    expect(
      surfaceComputeMaxFrameRays({
        maxBufferSize: 64 * 1024 * 1024,
        maxStorageBufferBindingSize: 2 * 1024 * 1024 * 1024,
      }),
    ).toBe((64 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES);
  });

  it("does NOT clamp to the dispatch ceiling — a memory question, not a submission-shape one (fr-257o)", () => {
    // A 128 MiB storage binding still buys 8.4M rays here even though that
    // is twice surfaceComputeMaxDispatchRays of a spec-minimum device: the
    // two are deliberately not met against each other, since folding the
    // smaller in would soften a 4K pane's raster for a submission-shape
    // ceiling no single piece of work has to meet. Every dispatch this
    // loop issues sizes and clamps at its own call site instead.
    const frameRays = surfaceComputeMaxFrameRays({
      maxBufferSize: 256 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    });
    const dispatchRays = surfaceComputeMaxDispatchRays({
      maxComputeWorkgroupsPerDimension: 65535,
    });
    expect(frameRays).toBe(
      (128 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES,
    );
    expect(frameRays).toBeGreaterThan(dispatchRays);
  });
});

describe("surfaceComputeTileRows", () => {
  it("traces an ordinary export as one whole tile", () => {
    // 1920x1057 at 1x is 2.0M rays — comfortably inside the cap, so the
    // capture keeps its single-frame path.
    expect(surfaceComputeTileRows(1920, 1057, Infinity)).toBe(1057);
  });

  it("bands a 4x export under the tile cap", () => {
    // The fr-biox report's raster: 7680x4228 = 32.5M rays, which asked
    // for a 520 MB ray-state buffer as one frame.
    const rows = surfaceComputeTileRows(7680, 4228, Infinity);
    expect(rows * 7680).toBeLessThanOrEqual(SURFACE_COMPUTE_MAX_TILE_RAYS);
    expect(Math.ceil(4228 / rows)).toBe(9);
  });

  it("balances the bands rather than leaving a one-row remainder", () => {
    // 521 rows per tile would fit the cap, but 4228 = 8x521 + 60: the
    // last band would be a 60-row sliver, and the export modal's
    // per-tile progress would lurch through it.
    const rows = surfaceComputeTileRows(7680, 4228, Infinity);
    const count = Math.ceil(4228 / rows);
    expect(4228 - (count - 1) * rows).toBeGreaterThan(rows / 2);
  });

  it("covers every row exactly once, none of them over the cap", () => {
    for (const [w, h, cap] of [
      [7680, 4228, Infinity],
      [3840, 2160, 1_000_000],
      [1000, 1000, 999_999],
      [1920, 1057, 100_000],
    ] as const) {
      const rows = surfaceComputeTileRows(w, h, cap);
      const count = Math.ceil(h / rows);
      let covered = 0;
      for (let i = 0; i < count; i++) {
        const band = Math.min(rows, h - i * rows);
        expect(band).toBeGreaterThan(0);
        expect(band * w).toBeLessThanOrEqual(
          Math.min(cap, SURFACE_COMPUTE_MAX_TILE_RAYS),
        );
        covered += band;
      }
      expect(covered).toBe(h);
    }
  });

  it("honours a device ceiling below the tile cap", () => {
    // A device that allocates 500k rays per frame gets 250-row bands
    // (500k / 2000 px), not the 4M-ray constant's 2000-row whole image.
    expect(surfaceComputeTileRows(2000, 2000, 500_000)).toBe(250);
  });
});

describe("surfaceComputeBandStops", () => {
  it("reproduces the full image's gradient band by band", () => {
    // The identity the tiled export depends on: every tracer spreads its
    // two stops over its OWN raster, so a band handed the whole image's
    // stops would repeat the whole gradient. Assembling the bands' own
    // prefills must rebuild the full-height prefill row for row —
    // buildSurfaceComputeBackground being the CPU mirror of the kernel's
    // own mix(bgBottom, bgTop, (py + 0.5) / rasterHeight).
    const top: [number, number, number] = [1, 0, 0];
    const bottom: [number, number, number] = [0, 0, 1];
    const whole = buildSurfaceComputeBackground(1, 12, top, bottom);
    for (const rows of [12, 6, 4, 5]) {
      const assembled = new Uint8Array(12 * 4);
      for (let bandBottom = 0; bandBottom < 12; bandBottom += rows) {
        const height = Math.min(rows, 12 - bandBottom);
        const stops = surfaceComputeBandStops(
          top,
          bottom,
          bandBottom,
          height,
          12,
        );
        assembled.set(
          buildSurfaceComputeBackground(1, height, stops.bgTop, stops.bgBottom),
          bandBottom * 4,
        );
      }
      expect(Array.from(assembled)).toEqual(Array.from(whole));
    }
  });

  it("hands a full-height band the original stops", () => {
    const stops = surfaceComputeBandStops([1, 0.5, 0], [0, 0.25, 1], 0, 8, 8);
    expect(stops.bgTop).toEqual([1, 0.5, 0]);
    expect(stops.bgBottom).toEqual([0, 0.25, 1]);
  });
});

describe("fitSurfaceComputeRaster", () => {
  it("leaves a raster the device can allocate for alone", () => {
    expect(fitSurfaceComputeRaster(1920, 1057, Infinity)).toEqual({
      width: 1920,
      height: 1057,
    });
  });

  it("shrinks an oversized live raster keeping its aspect", () => {
    // A hidpi 5K pane (14.7M rays) on a device that allocates 8.4M: the
    // pane traces softer and blits up rather than failing to allocate.
    const fit = fitSurfaceComputeRaster(5120, 2880, 8_388_608);
    expect(fit.width * fit.height).toBeLessThanOrEqual(8_388_608);
    expect(fit.width / fit.height).toBeCloseTo(5120 / 2880, 2);
  });

  it("fits even a ceiling below one row of the raster", () => {
    const fit = fitSurfaceComputeRaster(1000, 1, 2);
    expect(fit.width * fit.height).toBeLessThanOrEqual(2);
    expect(fit.width).toBeGreaterThanOrEqual(1);
    expect(fit.height).toBeGreaterThanOrEqual(1);
  });
});

describe("resampleSurfacePixels", () => {
  it("nearest-samples pixel centers with row 0 staying the bottom row", () => {
    // 1x2 source: bottom row red, top row green. Upscaled to 1x4, the
    // bottom two rows must stay red and the top two green — no flip.
    const src = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const out = resampleSurfacePixels(src, 1, 2, 1, 4);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(8, 12))).toEqual([0, 255, 0, 255]);
    expect(Array.from(out.slice(12, 16))).toEqual([0, 255, 0, 255]);
  });

  it("downsamples by picking the covering source texel", () => {
    // 4x1 source, distinct reds; 2x1 output samples centers at x=1 and 3.
    const src = new Uint8Array([10, 20, 30, 40].flatMap((r) => [r, 0, 0, 255]));
    const out = resampleSurfacePixels(src, 4, 1, 2, 1);
    expect(out[0]).toBe(20);
    expect(out[4]).toBe(40);
  });
});

describe("nextStepsPerPass", () => {
  it("doubles while the last pass came in under the target", () => {
    expect(nextStepsPerPass(1, 10)).toBe(2);
    expect(nextStepsPerPass(8, SURFACE_COMPUTE_PASS_TARGET_MS - 1)).toBe(16);
  });

  it("holds at or over the target", () => {
    expect(nextStepsPerPass(8, SURFACE_COMPUTE_PASS_TARGET_MS)).toBe(8);
    expect(nextStepsPerPass(1, 5000)).toBe(1);
  });

  it("caps at the per-pass step bound", () => {
    expect(nextStepsPerPass(SURFACE_COMPUTE_MAX_STEPS_PER_PASS, 1)).toBe(
      SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
    );
    expect(nextStepsPerPass(20, 1)).toBe(SURFACE_COMPUTE_MAX_STEPS_PER_PASS);
  });
});

describe("marchChunkFor", () => {
  it("sizes slices to the pass target from the measured per-ray-step cost", () => {
    // 10µs/ray·step at 1 step → 25k rays fill the 250ms target.
    expect(marchChunkFor(10, 1)).toBe(25_000);
    // Deeper steps shrink the slice proportionally (floored).
    expect(marchChunkFor(10, 2)).toBe(12_500);
  });

  it("never drops below the dispatch-overhead floor", () => {
    expect(marchChunkFor(200, 1)).toBe(SURFACE_COMPUTE_MARCH_CHUNK_MIN);
    expect(marchChunkFor(10, 32)).toBe(SURFACE_COMPUTE_MARCH_CHUNK_MIN);
  });
});

describe("shadeHitAllowanceUs", () => {
  it("is the room left inside the pass target while the fixed cost fits there", () => {
    // lens3's ~25ms of fixed dispatch cost leaves ~225ms of the 250ms
    // target to buy hits with, and the predicted total is the target
    // itself. That branch owns every intercept under
    // 250ms / (1 + WORK_PER_FIXED_COST).
    expect(shadeHitAllowanceUs(25_000)).toBe(
      SURFACE_COMPUTE_PASS_TARGET_MS * 1000 - 25_000,
    );
    expect(shadeHitBudgetUs(25_000)).toBe(
      SURFACE_COMPUTE_PASS_TARGET_MS * 1000,
    );
  });

  it("spends a multiple of the fixed cost once the dispatch is latency-bound", () => {
    // A dispatch whose fixed cost alone is 100ms cannot be made cheaper
    // by shrinking it, so it buys hits in proportion rather than refusing
    // to widen.
    expect(shadeHitAllowanceUs(100_000)).toBe(
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST * 100_000,
    );
  });

  it("names a WIDTH in that branch, not a ratio the scene has a say in", () => {
    // nextShadeHitCost preserves intercept = PIVOT x marginal identically
    // (proof at that function), so the allowance divided by the marginal
    // is WORK_PER_FIXED_COST x PIVOT hits for EVERY scene that reaches
    // this branch. The two models below differ by 100x in both terms and
    // in what a hit costs, and the sizer asks for the same width — which
    // is exactly why that constant had to be chosen by measuring widths.
    const wide =
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
      SURFACE_COMPUTE_SHADE_COST_PIVOT;
    // Both models sit in the middle branch, which owns fixed costs from
    // 250ms/(1+K) to 250ms — i.e. marginals of ~61 to ~488us per hit.
    for (const marginalUs of [100, 400]) {
      expect(
        shadeHitBatchSize(
          {
            interceptUs: SURFACE_COMPUTE_SHADE_COST_PIVOT * marginalUs,
            marginalUs,
          },
          Number.MAX_SAFE_INTEGER,
        ),
      ).toBe(wide);
    }
  });

  it("keeps buying hits across the whole range real scenes measure in", () => {
    // The ceiling on the predicted TOTAL necessarily squeezes the
    // allowance to nothing as the intercept approaches it — a dispatch
    // that costs the ceiling before its first hit has no room for hits.
    // That squeeze is fr-d6g5's trapdoor if it lands where scenes live,
    // and mandelboxKifs, the hardest scene here, measures its intercept
    // between 430 and 960 ms. So across 0-1s of fixed cost the allowance
    // is never less than a quarter of the pass target, and never less
    // than what a batch of hits can be bought with.
    for (let interceptUs = 0; interceptUs <= 1_000_000; interceptUs += 10_000) {
      expect(shadeHitAllowanceUs(interceptUs)).toBeGreaterThanOrEqual(
        (SURFACE_COMPUTE_PASS_TARGET_MS * 1000) / 4,
      );
    }
  });

  it("never aims a dispatch lower as its fixed cost rises", () => {
    // The property the allowance exists to have, stated on the number it
    // is about: what one dispatch is PREDICTED to cost in total. A rule
    // that traded the allowance away against a rising intercept would
    // shrink the dispatch exactly where shrinking it cannot help, which
    // is fr-d6g5's trapdoor. Monotone up to the ceiling and then pinned
    // there — the allowance itself falls through that upper range only
    // because the intercept it is added to is rising.
    let prev = 0;
    for (let interceptUs = 0; interceptUs <= 1_900_000; interceptUs += 10_000) {
      const totalUs = shadeHitBudgetUs(interceptUs);
      expect(totalUs).toBeGreaterThanOrEqual(prev);
      prev = totalUs;
    }
    expect(shadeHitBudgetUs(300_000)).toBe(
      SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS * 1000,
    );
  });

  it("stops adding work as the predicted total approaches the ceiling", () => {
    // Above the ceiling there is nothing safe left to add — and unlike
    // the range above, this is a regime where a dispatch's FIXED cost
    // alone is a watchdog conversation, so declining to widen it is the
    // answer rather than a trapdoor.
    const ceilingUs = SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS * 1000;
    expect(shadeHitBudgetUs(1_500_000)).toBe(ceilingUs);
    expect(shadeHitAllowanceUs(ceilingUs)).toBe(0);
    expect(shadeHitAllowanceUs(3_000_000)).toBe(0);
  });
});

describe("nextShadeBatchSize", () => {
  it("doubles only while batches come in under the budget they were sized for", () => {
    expect(nextShadeBatchSize(32, 249, 250)).toBe(64);
    // In the holding band (between the budget and double it) the capacity
    // neither grows nor shrinks.
    expect(nextShadeBatchSize(32, 250, 250)).toBe(32);
  });

  it("reads the LATENCY-BOUND budget, not a fixed pass target (fr-2ojg)", () => {
    // A 500ms dispatch under an 800ms budget is a batch that fit: the
    // capacity has to keep climbing there. Judged against the old fixed
    // PASS_TARGET/2 threshold this froze at whatever width cost 125ms —
    // ~256 hits on the fr-2ojg scene against a measured optimum of ~1050.
    expect(nextShadeBatchSize(256, 500, 800)).toBe(512);
    expect(nextShadeBatchSize(256, 500, SURFACE_COMPUTE_PASS_TARGET_MS)).toBe(
      256,
    );
  });

  it("quarters on a big overshoot — the watchdog-safety bias", () => {
    expect(nextShadeBatchSize(256, 501, 250)).toBe(64);
  });

  it("quarters down to the one-workgroup floor, never below (fr-d6g5)", () => {
    // Quartering from just above the floor lands exactly on it...
    expect(nextShadeBatchSize(256, 10_000, 250)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
    // ...and quartering FROM the floor holds there rather than dropping
    // below it: a sub-workgroup batch buys no submission-wall safety (GPU
    // cost inside one workgroup is depth-, not width-dominated), so
    // shrinking further would only multiply worst-ray-cost submissions —
    // the fr-d6g5 park was exactly this floor missing, quartering all the
    // way to 1-ray batches.
    expect(
      nextShadeBatchSize(SURFACE_COMPUTE_WORKGROUP_SIZE, 10_000, 250),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });

  it("caps at the batch ceiling", () => {
    expect(
      nextShadeBatchSize(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH, 1, 250),
    ).toBe(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH);
  });
});

describe("shadeHitBatchSize", () => {
  it("hands a frame that has measured nothing exactly one workgroup", () => {
    // The empty model asks for everything (fr-2ojg deleted the per-hit
    // prior — it could only ask for less than the floor already gives)
    // and the one-workgroup starting capacity is what answers.
    expect(
      shadeHitBatchSize(
        initialShadeHitCost(),
        SURFACE_COMPUTE_SHADE_HIT_CAP_START,
      ),
    ).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
  });

  it("divides the budget by the MARGINAL cost, not by a whole submission over its rays (fr-2ojg)", () => {
    // fr-2ojg's measured boxfold-pair model: ~88ms fixed per dispatch,
    // ~154us per hit beyond it. 7 x 88ms / 154us = 4000 hits, where the
    // shipped sizer before fr-2ojg sat at 64-256 — and 512 after it, this
    // model's own intercept/marginal ratio being what named that number
    // rather than anything measured (see shadeHitAllowanceUs).
    expect(
      shadeHitBatchSize(
        { interceptUs: 88_000, marginalUs: 154 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(4000);
  });

  it("widens a latency-bound dispatch instead of refusing to (fr-2ojg)", () => {
    // 400ms of fixed cost, 500us per hit: the ceiling caps the predicted
    // total at 2s, so the sizer buys the 1.6s that leaves — 3200 hits.
    // Under a fixed 250ms target the allowance would be negative and this
    // would floor at 64 — a 50x throughput loss for no reduction in the
    // submission wall, since the wall is the 400ms.
    expect(
      shadeHitBatchSize(
        { interceptUs: 400_000, marginalUs: 500 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(3200);
  });

  it("keeps buying hits right up to the ceiling", () => {
    // A 1.4s intercept is 1.4s whatever the width, so the sizer spends
    // what the 2s ceiling leaves — 600ms of hits at 500us each — rather
    // than declining to widen a dispatch it cannot shorten. At a 1s
    // ceiling this same model floored at 64 hits for the same 1.4s: 19x
    // fewer hits for the same wall, which is the trapdoor
    // SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS's placement exists to
    // keep out of the range real scenes measure in.
    expect(
      shadeHitBatchSize(
        { interceptUs: 1_400_000, marginalUs: 500 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(1200);
  });

  it("never collapses below one workgroup when per-hit cost is enormous (fr-d6g5)", () => {
    expect(
      shadeHitBatchSize(
        { interceptUs: 0, marginalUs: 400_000 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
    // A cap below one workgroup can't reduce submission wall either, so
    // the floor overrides it.
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 400_000 }, 8)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
  });

  it("lets cheap measured costs fill the earned capacity, no further", () => {
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 1_000 }, 64)).toBe(
      64,
    );
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 1_000 }, 4096)).toBe(
      250,
    );
  });
});

describe("nextShadeHitCost", () => {
  it("fits the measurement it just took — the split double-counts nothing", () => {
    const cost = nextShadeHitCost(
      { interceptUs: 40_000, marginalUs: 300 },
      256,
      190_000,
    );
    expect(cost.interceptUs + 256 * cost.marginalUs).toBeCloseTo(190_000, 3);
  });

  it("credits a one-workgroup dispatch to the INTERCEPT — it cannot be about per-hit cost", () => {
    // 64 hits at 97.9ms from an empty model: w = 64/(64+512) = 0.111, so
    // ~89% of it lands on the fixed term. The truth on that scene was
    // 88ms fixed and 154us/hit.
    const cost = nextShadeHitCost(initialShadeHitCost(), 64, 97_856);
    expect(cost.interceptUs).toBeGreaterThan(0.85 * 97_856);
    expect(cost.marginalUs).toBeLessThan(200);
  });

  it("credits a wide dispatch to the MARGINAL — that is what a wide one measures", () => {
    const cost = nextShadeHitCost(initialShadeHitCost(), 4096, 700_000);
    expect(4096 * cost.marginalUs).toBeGreaterThan(0.85 * 700_000);
  });

  it("shrugs off a QUEUE-LIMITED batch instead of shrinking on it (fr-2ojg)", () => {
    // The converged boxfold-pair model, then a sweep that only had 100
    // hits to give — and 5% dearer than priced, so there is a real
    // surprise to attribute rather than a no-op.
    const before = { interceptUs: 88_000, marginalUs: 154 };
    const measuredUs = 1.05 * (88_000 + 100 * 154);
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;

    // The OLD reading of that same dispatch: a whole submission over its
    // rays is 1.14ms per hit, 7.4x the marginal, which the spike-lift EMA
    // took instantly and which sizes 219 hits — a 4.8x cut off the back
    // of a batch that was small because the QUEUE was, not the region.
    const wholeSubmissionUsPerHit = measuredUs / 100;
    expect(wholeSubmissionUsPerHit).toBeGreaterThan(7 * before.marginalUs);
    expect(
      Math.floor(
        (SURFACE_COMPUTE_PASS_TARGET_MS * 1000) / wholeSubmissionUsPerHit,
      ),
    ).toBeLessThan(0.25 * shadeHitBatchSize(before, cap));

    // The pivot hands a 100-hit measurement mostly to the intercept, so
    // the next batch barely moves. (At PIVOT = 0 — the single-term model
    // this replaced — it would fall to 0.75x and this would fail.)
    const after = nextShadeHitCost(before, 100, measuredUs);
    expect(shadeHitBatchSize(after, cap)).toBeGreaterThan(
      0.85 * shadeHitBatchSize(before, cap),
    );
  });

  it("cuts the next batch hard on a genuine cost spike", () => {
    // The same converged model walking into a band 30x more expensive per
    // hit at 1024 hits — the scanline-clustered near-surface silhouette
    // the whole slow-trust policy exists for. ONE observation lifts the
    // marginal by more than an order and cuts the next batch by more than
    // 6x — and the cut is not the ceiling doing it, which is worth
    // pinning: the marginal alone accounts for it, since a batch sized
    // against the pass target on the new marginal is the same order.
    const before = { interceptUs: 88_000, marginalUs: 154 };
    const spiked = nextShadeHitCost(before, 1024, 88_000 + 1024 * 154 * 30);
    expect(spiked.marginalUs).toBeGreaterThan(10 * before.marginalUs);
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;
    expect(shadeHitBatchSize(spiked, cap)).toBeLessThan(
      shadeHitBatchSize(before, cap) / 6,
    );
  });

  it("will not become optimistic faster than the capacity ladder grows (fr-2ojg)", () => {
    // A wildly cheap measurement against a converged model — a wide batch
    // of ground-plane terminals, which fr-rhn5 queues WITH the hits but
    // which shade analytically. Clamped at zero the marginal would read
    // "hits are free" and the sizer would ask for the entire capacity on
    // one dispatch's evidence, which on a fold monster is a multi-second
    // submission. The decay floor holds it to a halving, i.e. at most a
    // doubling of the next batch — the rate the ladder already enforces.
    const before = { interceptUs: 500_000, marginalUs: 900 };
    const after = nextShadeHitCost(before, 2048, 1_000);
    expect(after.marginalUs).toBeGreaterThanOrEqual(
      before.marginalUs * SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
    );
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;
    expect(shadeHitBatchSize(after, cap)).toBeLessThanOrEqual(
      2 * shadeHitBatchSize(before, cap),
    );
    // Repeated cheap measurements DO get there — the floor is a rate
    // limit, not a pin.
    let cost = before;
    for (let i = 0; i < 20; i++) cost = nextShadeHitCost(cost, 2048, 1_000);
    expect(cost.marginalUs).toBeLessThan(1);
  });

  it("converges on its target width within a frame's worth of dispatches (fr-2ojg)", () => {
    // The whole sizer, run against fr-2ojg's measured cost curve for the
    // boxfold pair: 88ms of fixed dispatch cost plus 154us per hit. It
    // reaches its target width in single digits, and the capacity ladder
    // — not the model — is what paces the climb, so no batch is ever
    // wider than measured-cheap evidence supports.
    const costOf = (n: number): number => 88_000 + 154 * n;
    let cost = initialShadeHitCost();
    let cap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    const widths: number[] = [];
    for (let i = 0; i < 10; i++) {
      const budgetMs = shadeHitBudgetUs(cost.interceptUs) / 1000;
      const n = shadeHitBatchSize(cost, cap);
      const measuredUs = costOf(n);
      widths.push(n);
      // No dispatch on the way up may pass double the budget it was
      // sized for — the bound the capacity ladder is there to keep.
      expect(measuredUs / 1000).toBeLessThan(2 * budgetMs);
      cost = nextShadeHitCost(cost, n, measuredUs);
      cap = nextShadeBatchSize(cap, measuredUs / 1000, budgetMs);
    }
    expect(widths[widths.length - 1]).toBe(
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
        SURFACE_COMPUTE_SHADE_COST_PIVOT,
    );
    // And the climb is the ladder's doubling, not a jump: every step at
    // most doubles the last.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(2 * widths[i - 1]);
    }
    // WHAT THIS DOES NOT SHOW, said here because an earlier version of
    // this test claimed the opposite: the model does NOT recover the two
    // physical terms, and cannot. nextShadeHitCost preserves
    // intercept = PIVOT x marginal identically, so the reported pair
    // lands near (88ms, 154us) here only because that curve's own ratio
    // happens to be near the pivot — feed it a curve of the same shape
    // with an eight times larger fixed cost and the same identity holds
    // and the same width comes out. The split is exact-fitting at the
    // width it measured, and that is all it is.
    expect(cost.interceptUs / cost.marginalUs).toBeCloseTo(
      SURFACE_COMPUTE_SHADE_COST_PIVOT,
      6,
    );
    const steep = (n: number): number => 700_000 + 154 * n;
    let other = initialShadeHitCost();
    let otherCap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    for (let i = 0; i < 10; i++) {
      const budgetMs = shadeHitBudgetUs(other.interceptUs) / 1000;
      const n = shadeHitBatchSize(other, otherCap);
      other = nextShadeHitCost(other, n, steep(n));
      otherCap = nextShadeBatchSize(otherCap, steep(n) / 1000, budgetMs);
    }
    expect(other.interceptUs / other.marginalUs).toBeCloseTo(
      SURFACE_COMPUTE_SHADE_COST_PIVOT,
      6,
    );
  });

  it("loses that ratio the moment the marginal's decay floor binds", () => {
    // The identity is UNCLAMPED algebra, and one of the clamps is
    // reachable in ordinary operation — an earlier draft of this file's
    // comments claimed it held "whatever the measurements say" and the
    // tests above all walk straight-line curves upward, so none of them
    // could see otherwise. The floor binds exactly when a dispatch
    // measures under HALF its prediction, and the ratio then becomes
    // 2 * PIVOT * (measured / predicted).
    const cost = {
      interceptUs: SURFACE_COMPUTE_SHADE_COST_PIVOT * 200,
      marginalUs: 200,
    };
    const n = 3584;
    const predictedUs = cost.interceptUs + n * cost.marginalUs;
    const measuredUs = predictedUs * 0.4;
    const after = nextShadeHitCost(cost, n, measuredUs);
    expect(after.marginalUs).toBe(
      cost.marginalUs * SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
    );
    expect(after.interceptUs / after.marginalUs).toBeCloseTo(
      2 * SURFACE_COMPUTE_SHADE_COST_PIVOT * 0.4,
      6,
    );
  });

  it("makes K x PIVOT an upper bound on the width, never a floor", () => {
    // Which is the property that actually matters, since the ratio is not
    // a constant: whatever the clamps do, the sizer may not come out
    // ASKING FOR MORE than the dial names. It errs narrow — the shipped
    // kaleido4 settle reports 3583 at its widest against a 2464 mean.
    const wide =
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
      SURFACE_COMPUTE_SHADE_COST_PIVOT;
    let cost = initialShadeHitCost();
    let cap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    // fr-fniy's own kaleido4 curve, driven with the drain pattern its own
    // record describes: full-width batches interleaved with the
    // queue-limited slivers the partial-batch HOLD releases on a present
    // interval, which is the pair that trips the floor.
    const costOf = (n: number): number => 283_100 + 64.8 * n;
    for (let i = 0; i < 40; i++) {
      const asked = shadeHitBatchSize(cost, cap);
      const sent = i % 4 === 1 ? Math.min(asked, 200) : asked;
      const budgetMs = shadeHitBudgetUs(cost.interceptUs) / 1000;
      const measuredUs = costOf(sent);
      expect(asked).toBeLessThanOrEqual(wide);
      expect(asked).toBeGreaterThanOrEqual(SURFACE_COMPUTE_WORKGROUP_SIZE);
      cost = nextShadeHitCost(cost, sent, measuredUs);
      cap = nextShadeBatchSize(cap, measuredUs / 1000, budgetMs);
    }
  });
});

describe("surfaceComputeProgressDone", () => {
  it("reads zero at frame start, before any dispatch", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 100,
        shadeQueued: 0,
        sweepSteps: 0,
        sliced: 0,
        stepsThisPass: 1,
        marchSteps: 160,
      }),
    ).toBe(0);
  });

  it("accrues continuous march credit mid-sweep — the in-sphere first sweep no longer parks at 0", () => {
    // 40 of the 100 active rays are sliced into the current 8-step pass:
    // 0.5 * 40 * (8/160) of the march half; the rest hold the (zero)
    // completed-sweep fraction.
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 100,
        shadeQueued: 0,
        sweepSteps: 0,
        sliced: 40,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(1);
  });

  it("credits terminal-but-unshaded rays half — the shipped fr-tdft behavior unchanged", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 0,
        shadeQueued: 60,
        sweepSteps: 20,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(70);
  });

  it("reaches exactly the ray total at frame completion", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 0,
        shadeQueued: 0,
        sweepSteps: 40,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(100);
  });

  it("caps a marching ray's credit at the terminal half once steps meet the budget", () => {
    // sweepSteps (200) may legitimately exceed marchSteps (160) while the
    // last exhausted rays drain: 90 terminal rays plus 10 active rays
    // capped at 0.5 each, never more.
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 10,
        shadeQueued: 0,
        sweepSteps: 200,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(95);
  });

  it("is continuous across a sweep boundary — dispatched-ray credit equals next sweep's base credit", () => {
    // A fully-dispatched sweep (sliced === active) folding stepsThisPass
    // into sweepSteps must not move the number when no rays terminated:
    // the monotonicity seam the doc comment argues for.
    const preBoundary = surfaceComputeProgressDone({
      rays: 100,
      active: 50,
      shadeQueued: 20,
      sweepSteps: 8,
      sliced: 50,
      stepsThisPass: 8,
      marchSteps: 160,
    });
    const postBoundary = surfaceComputeProgressDone({
      rays: 100,
      active: 50,
      shadeQueued: 20,
      sweepSteps: 16,
      sliced: 0,
      stepsThisPass: 8,
      marchSteps: 160,
    });
    expect(preBoundary).toBe(42.5);
    expect(postBoundary).toBe(42.5);
    expect(preBoundary).toBe(postBoundary);
  });
});

describe("subPixelSample (fr-vpbq)", () => {
  it("puts pass 0 at the pixel CENTRE exactly — the claim that a supersampled frame's first pass is the pre-fr-vpbq one", () => {
    // Not "close to" 0.5: every ray derivation used to spell the centre as a
    // literal 0.5, so anything else here makes pass 0 a different image and
    // the whole bit-identity argument false.
    expect(subPixelSample(0)).toEqual([0.5, 0.5]);
  });

  it("treats a negative index as pass 0 rather than walking off the sequence", () => {
    expect(subPixelSample(-1)).toEqual([0.5, 0.5]);
  });

  it("keeps every later pass strictly inside the pixel", () => {
    for (let s = 1; s < 64; s++) {
      const [x, y] = subPixelSample(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
    }
  });

  it("is deterministic and seedless — the same pass is the same offset on every device", () => {
    for (let s = 0; s < 16; s++) {
      expect(subPixelSample(s)).toEqual(subPixelSample(s));
    }
  });

  it("stratifies the eight passes the settle actually traces: eight distinct 4x4 cells, all four quadrants", () => {
    // The point of a low-discrepancy sequence over a jittered grid is that
    // stopping after ANY number of passes leaves an evenly covered pixel, and
    // the shipped count is where that has to hold. Measured: the first eight
    // offsets occupy eight distinct sixteenths AND all four quarters. (Not
    // asserted at sixteen, where the sequence does collide once — 15 cells,
    // not 16. Pinning the shipped count is the honest claim.)
    const cell = (n: number, s: number): string => {
      const [x, y] = subPixelSample(s);
      return `${Math.floor(x * n)},${Math.floor(y * n)}`;
    };
    const sixteenths = new Set(Array.from({ length: 8 }, (_, s) => cell(4, s)));
    const quarters = new Set(Array.from({ length: 8 }, (_, s) => cell(2, s)));
    expect(sixteenths.size).toBe(8);
    expect(quarters.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Deferred-teardown harness (fr-uec4)
//
// Pins the state machine `destroy()` / `releaseFrame()` / `destroyDevice()`
// make between them: a `destroy()` landing while a frame is still counted must
// not touch the device until that frame unwinds, and the device must never be
// destroyed twice. Tearing a device down under a frame parked on live
// submitted GPU work took the whole Firefox PROCESS down (fr-uec4), so this is
// the costliest thing in the file to get wrong — and a fake GPUDevice is the
// only way to drive a state machine whose real inputs are a GPU driver's
// timing. `scripts/surface-teardown.verify.mjs` stays the authority on real
// devices; these tests are the fast regression net under the counting.
//
// The renderer is built through its init-object constructor, the seam this
// suite exists for — the same one `flame-gpu-backend.test.ts` drives its twin
// through.
// ---------------------------------------------------------------------------

// `GPUBufferUsage` is a real runtime global in a browser/WebGPU context, not
// just the compile-time ambient type `@webgpu/types` declares — a frame's
// buffer allocation reads its flags directly, mirroring the real WebGPU API.
// Node has no such global, so a plain Node test run needs the same minimal
// stand-in a browser provides for free (values are the WebGPU spec's own flag
// bits; nothing here reads them beyond handing them to the fake `createBuffer`
// below, which ignores its argument entirely). Same stand-in, same reason, as
// flame-gpu-backend.test.ts's `GPUMapMode`.
globalThis.GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

/** A promise a test settles on its own schedule, independent of when the
 * class under test actually awaits it — mirrors flame-gpu-backend.test.ts's
 * helper of the same name. */
function deferred(): { promise: Promise<null>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<null>((res) => {
    resolve = () => {
      res(null);
    };
  });
  return { promise, resolve };
}

/** Resolves after a real macrotask boundary, by which point every microtask
 * queued so far has drained — a frame takes several internal `await`s to
 * reach the point it parks at. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The smallest frame the renderer will accept. Only `width`/`height` matter
 * to the teardown path (they size the per-ray buffers); every other field is
 * required by the type and never read before the frame parks. */
function frameSpec(): SurfaceComputeFrameSpec {
  return {
    width: 2,
    height: 2,
    invProjView: new Float32Array(16),
    camPos: [0, 0, 3],
    acceptPixelEps: 1e-3,
    tracePixelEps: 1e-3,
    maxDepth: 8,
    marchSteps: 32,
    shadowSteps: 0,
    aoTaps: 0,
    hitFloor: 1e-4,
    lightDir: [0, 1, 0],
    ambient: 0.2,
    bgTop: [0, 0, 0],
    bgBottom: [0, 0, 0],
    colorSource: 0,
    colorSpeed: 0.5,
    lut: null,
    lutVersion: 0,
    dither: false,
  };
}

interface TeardownHarness {
  renderer: SurfaceComputeRenderer;
  /** Spy on the fake device's own `destroy()` — the one call the whole
   * fr-uec4 state machine exists to TIME correctly. */
  deviceDestroy: ReturnType<typeof vi.fn>;
  /** One destroy spy per per-frame GPU buffer the renderer has allocated so
   * far (states/active/color/status + the two staging buffers). Grows as
   * frames allocate; a parked frame's staging buffers are exactly the ones
   * that must not be freed under it. */
  bufferDestroys: ReturnType<typeof vi.fn>[];
  /** Settles the device round trip an in-flight frame is parked on. A frame
   * makes several, and the FIRST — the error-scope pair `allocateFrameBuffers`
   * awaits over its buffer allocation (fr-biox) — is the one a fake device
   * reaches without reimplementing the march loop's readbacks. In production
   * a frame parks further in, on `mapAsync`/`onSubmittedWorkDone` over
   * submitted work; either way what is under test is the COUNTED SPAN, from
   * `renderFrame`'s increment to its `.finally` release, which is the same
   * span whichever await the frame happens to be sitting on. It settles with
   * NO error, so the frame resumes into the ordinary token check and unwinds
   * there — the real cancellation path a `destroy()` (or a newer frame) puts
   * it on, not an error path. */
  settleFrameWork: () => void;
  /** Resolves the device's `lost` promise, which is what a real device does
   * once it goes away — including when we destroyed it ourselves. */
  loseDevice: () => void;
}

/**
 * Builds a `SurfaceComputeRenderer` over a fake GPUDevice. The fake CONFIGURES
 * outcomes (a settle-on-demand device round trip, spies counting destroys) and
 * implements no GPU behavior: pipelines, layouts, bind groups and the LUT
 * texture/sampler are opaque casts, since nothing on the teardown path
 * inspects them. `lost` never settles unless a test calls `loseDevice`.
 */
function createHarness(): TeardownHarness {
  const work = deferred();
  const lost = deferred();
  const bufferDestroys: ReturnType<typeof vi.fn>[] = [];
  const deviceDestroy = vi.fn();
  const device = {
    lost: lost.promise,
    // Generous enough that a 2x2 frame is nowhere near the fr-biox ray
    // ceiling this renderer checks before it allocates anything.
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    pushErrorScope: () => {},
    // Both of the allocation's two pops share one promise, so a single
    // `settleFrameWork()` releases the parked frame.
    popErrorScope: () => work.promise,
    createBuffer: () => {
      const destroy = vi.fn();
      bufferDestroys.push(destroy);
      return { destroy } as unknown as GPUBuffer;
    },
    createBindGroup: () => ({}) as GPUBindGroup,
    destroy: deviceDestroy,
  } as unknown as GPUDevice;

  const renderer = new SurfaceComputeRenderer({
    device,
    // The teardown path never reads the target: the packers that do sit past
    // the point a parked frame has reached.
    target: { kind: "ifs" } as unknown as SurfaceComputeTarget,
    marchPipeline: {} as GPUComputePipeline,
    marchLayout: {} as GPUBindGroupLayout,
    shadePipeline: {} as GPUComputePipeline,
    shadeLayout: {} as GPUBindGroupLayout,
    marchPipelineNoSlab: null,
    shadePipelineNoSlab: null,
    paramsBuf: {} as GPUBuffer,
    shadeBuf: {} as GPUBuffer,
    mapsBuf: {} as GPUBuffer,
    shadeMapsBuf: {} as GPUBuffer,
    lutTex: { createView: () => ({}) } as unknown as GPUTexture,
    lutSamp: {} as GPUSampler,
    software: false,
  });

  return {
    renderer,
    deviceDestroy,
    bufferDestroys,
    settleFrameWork: work.resolve,
    loseDevice: lost.resolve,
  };
}

describe("SurfaceComputeRenderer teardown (fr-uec4)", () => {
  it("defers device.destroy() until an in-flight frame unwinds", async () => {
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();

    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    await frame;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("tears the device down synchronously when no frame is in flight", () => {
    const { renderer, deviceDestroy } = createHarness();
    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the device exactly once when destroy() is called twice during the deferred window", async () => {
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();

    renderer.destroy();
    renderer.destroy(); // second call while still deferred: must not re-commit the teardown.
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    await frame;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("waits for the LAST of two in-flight frames, not the first", async () => {
    // A frame is counted from its renderFrame CALL, not from when the chain
    // lets it run — so the second one here is in flight (queued behind the
    // first) without ever having touched the device, and destroy() owes it
    // the same wait. Both then unwind: the first at its post-allocation token
    // check, the second at its first, since destroy() moved the token.
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    // Read at the moment the first frame has fully unwound (its release runs
    // before its promise resolves) with the second still counted — the one
    // instant that tells "waits for the last" apart from "waits for one".
    let destroysWhenFirstUnwound = -1;
    const first = renderer.renderFrame(frameSpec()).then((frame) => {
      destroysWhenFirstUnwound = deviceDestroy.mock.calls.length;
      return frame;
    });
    // Only once the first is PARKED, or it would resolve null at its opening
    // token check (the second call supersedes it) and never be in flight at
    // the same time — a latest-wins request during a live frame is what
    // actually puts two of them in the count.
    await flushMicrotasks();
    const second = renderer.renderFrame(frameSpec());

    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(destroysWhenFirstUnwound).toBe(0);
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("never destroys the device a second time when a frame starts after the teardown", async () => {
    const { renderer, deviceDestroy } = createHarness();
    renderer.destroy(); // idle, so the device is already gone.
    expect(deviceDestroy).toHaveBeenCalledTimes(1);

    // The OTHER path into the real teardown: this frame is counted, resolves
    // null at its first token check (destroy() bumped the token) and then
    // releases — arriving at the teardown with `destroyed` already true, which
    // is exactly what the separate `deviceDestroyed` flag is there to catch.
    expect(await renderer.renderFrame(frameSpec())).toBeNull();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("never destroys a frame's buffers directly, leaving them to the device", async () => {
    // Freeing a staging buffer out from under a pending map is its own crash
    // vector — the reason the teardown hands everything to `device.destroy()`
    // rather than walking the buffers first (flame-gpu-backend's fr-mxkk
    // finding, one module over).
    const { renderer, bufferDestroys, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();
    expect(bufferDestroys.length).toBeGreaterThan(0); // the frame really allocated.

    renderer.destroy();
    settleFrameWork();
    await frame;

    bufferDestroys.forEach((destroy) =>
      expect(destroy).toHaveBeenCalledTimes(0),
    );
  });

  it("does not report a device loss that its own destroy() caused", async () => {
    // A real device resolves `lost` when it is destroyed, and onLost is the
    // session's cue to re-enter through the WebGL tracer — firing it on a
    // deliberate exit would toast the user and restart a mode they just left.
    const { renderer, loseDevice } = createHarness();
    const onLost = vi.fn();
    renderer.onLost = onLost;

    renderer.destroy();
    loseDevice();
    await flushMicrotasks();

    expect(onLost).not.toHaveBeenCalled();
    // The handler DID run — otherwise the assertion above passes vacuously.
    expect(renderer.lost).toBe(true);
  });
});
