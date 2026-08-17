import {
  buildSurfaceComputeBackground,
  fitSurfaceComputeRaster,
  marchChunkFor,
  nextShadeBatchSize,
  nextShadeHitEmaUs,
  nextStepsPerPass,
  resampleSurfacePixels,
  shadeHitBatchSize,
  SURFACE_COMPUTE_INITIAL_HIT_SHADE_US,
  SURFACE_COMPUTE_MARCH_CHUNK_MIN,
  SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
  SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
  SURFACE_COMPUTE_MAX_TILE_RAYS,
  SURFACE_COMPUTE_PASS_TARGET_MS,
  SURFACE_COMPUTE_RAY_STATE_BYTES,
  SURFACE_COMPUTE_SHADE_HIT_CAP_START,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  surfaceComputeBandStops,
  surfaceComputeMaxDispatchRays,
  surfaceComputeMaxFrameRays,
  surfaceComputeProgressDone,
  surfaceComputeTileRows,
  subPixelSample,
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

describe("nextShadeBatchSize", () => {
  it("doubles only while batches come in well under the target", () => {
    expect(nextShadeBatchSize(32, SURFACE_COMPUTE_PASS_TARGET_MS / 2 - 1)).toBe(
      64,
    );
    // In the holding band (between half and double the target) the batch
    // neither grows nor shrinks.
    expect(nextShadeBatchSize(32, SURFACE_COMPUTE_PASS_TARGET_MS)).toBe(32);
  });

  it("quarters on a big overshoot — the watchdog-safety bias", () => {
    expect(
      nextShadeBatchSize(256, SURFACE_COMPUTE_PASS_TARGET_MS * 2 + 1),
    ).toBe(64);
  });

  it("quarters down to the one-workgroup floor, never below (fr-d6g5)", () => {
    // Quartering from just above the floor lands exactly on it...
    expect(nextShadeBatchSize(256, 10_000)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
    // ...and quartering FROM the floor holds there rather than dropping
    // below it: a sub-workgroup batch buys no submission-wall safety (GPU
    // cost inside one workgroup is depth-, not width-dominated), so
    // shrinking further would only multiply worst-ray-cost submissions —
    // the fr-d6g5 park was exactly this floor missing, quartering all the
    // way to 1-ray batches.
    expect(nextShadeBatchSize(SURFACE_COMPUTE_WORKGROUP_SIZE, 10_000)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
  });

  it("caps at the batch ceiling", () => {
    expect(nextShadeBatchSize(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH, 1)).toBe(
      SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
    );
  });
});

describe("shadeHitBatchSize", () => {
  it("sizes the first batch from the pessimistic prior, clamped by the starting capacity", () => {
    // Prior 20ms/hit predicts 12 hits fit the 250ms target; the
    // one-workgroup starting capacity (fr-d6g5) wins until measurements
    // earn more.
    expect(
      shadeHitBatchSize(
        SURFACE_COMPUTE_INITIAL_HIT_SHADE_US,
        SURFACE_COMPUTE_SHADE_HIT_CAP_START,
      ),
    ).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
  });

  it("shrinks toward the one-workgroup floor as measured cost approaches the pass target — the near-surface grind regime", () => {
    // ~108ms/hit (full-width probes at the fr-p8bc near pose on Iris)
    // predicts 2 hits by cost alone, but the workgroup floor wins: a
    // sub-workgroup batch can't shrink submission wall any further (GPU
    // cost inside one workgroup is depth-, not width-dominated).
    expect(
      shadeHitBatchSize(108_000, SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });

  it("never collapses below one workgroup when the linear model breaks down (fr-d6g5)", () => {
    // At/past the pass-target cost per hit, the old code floored at a
    // single hit — but a 1-ray batch measures the FULL per-submission
    // wall as its per-hit cost, so the spike-lift EMA latches onto that
    // inflated reading and pins byCost at 0 forever (the fr-d6g5 park:
    // ~4.4 hits/s on the real driver). The floor is one workgroup instead.
    expect(
      shadeHitBatchSize(400_000, SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });

  it("the workgroup floor wins over a sub-workgroup cap", () => {
    // A cap below one workgroup can't reduce submission wall either, so
    // the floor overrides it.
    expect(shadeHitBatchSize(400_000, 8)).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });

  it("lets cheap measured costs fill the earned capacity, no further", () => {
    // ~1ms/hit (cheap-probe shading) predicts 250 hits, but capacity is
    // whatever the double/quarter policy has earned.
    expect(shadeHitBatchSize(1_000, 64)).toBe(64);
    expect(shadeHitBatchSize(1_000, 4096)).toBe(250);
  });
});

describe("nextShadeHitEmaUs", () => {
  it("lifts INSTANTLY to a measured spike — the queue's scanline order says an expensive region just started", () => {
    expect(nextShadeHitEmaUs(1_000, 108_000)).toBe(108_000);
  });

  it("decays slowly toward cheaper measurements — re-trusting a cheap region costs a few conservative batches, never a hang", () => {
    expect(nextShadeHitEmaUs(108_000, 1_000)).toBeCloseTo(
      108_000 * 0.6 + 1_000 * 0.4,
      6,
    );
    // The decay converges: repeated cheap measurements do reach the cheap
    // cost rather than pinning conservative forever.
    let ema = 108_000;
    for (let i = 0; i < 30; i++) ema = nextShadeHitEmaUs(ema, 1_000);
    expect(ema).toBeLessThan(1_100);
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
