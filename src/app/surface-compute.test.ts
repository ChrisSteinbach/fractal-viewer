import {
  buildSurfaceComputeBackground,
  marchChunkFor,
  nextShadeBatchSize,
  nextShadeHitEmaUs,
  nextStepsPerPass,
  resampleSurfacePixels,
  shadeHitBatchSize,
  SURFACE_COMPUTE_INITIAL_HIT_SHADE_US,
  SURFACE_COMPUTE_MARCH_CHUNK_MIN,
  SURFACE_COMPUTE_MAX_SHADE_BATCH,
  SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
  SURFACE_COMPUTE_PASS_TARGET_MS,
  SURFACE_COMPUTE_SHADE_HIT_CAP_START,
} from "./surface-compute";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";

describe("buildSurfaceComputeBackground", () => {
  it("fills each row with the kernel's own bottom-to-top gradient at pixel centers", () => {
    // 2x4: row 0 is the BOTTOM (the kernel's py=0 is ndcY=-1), sampled at
    // v=(py+0.5)/h — the GLSL main()'s mix(uBgBottom, uBgTop, vUv.y) with
    // pack4x8unorm's round-half-up quantization.
    const rows = buildSurfaceComputeBackground(2, 4);
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
    expect(nextShadeBatchSize(2, 10_000)).toBe(1);
    expect(nextShadeBatchSize(1, 10_000)).toBe(1);
  });

  it("caps at the batch ceiling", () => {
    expect(nextShadeBatchSize(SURFACE_COMPUTE_MAX_SHADE_BATCH, 1)).toBe(
      SURFACE_COMPUTE_MAX_SHADE_BATCH,
    );
  });
});

describe("shadeHitBatchSize", () => {
  it("sizes the first batch from the pessimistic prior, clamped by the starting capacity", () => {
    // Prior 20ms/hit predicts 12 hits fit the 250ms target; the slow-trust
    // cap of 8 wins until measurements earn more.
    expect(
      shadeHitBatchSize(
        SURFACE_COMPUTE_INITIAL_HIT_SHADE_US,
        SURFACE_COMPUTE_SHADE_HIT_CAP_START,
      ),
    ).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
  });

  it("shrinks to a single hit when the measured cost approaches the pass target — the near-surface grind regime", () => {
    // ~108ms/hit (full-width probes at the fr-p8bc near pose on Iris):
    // two hits fit the 250ms target, never a watchdog-scale batch.
    expect(shadeHitBatchSize(108_000, SURFACE_COMPUTE_MAX_SHADE_BATCH)).toBe(2);
    // At or past the target per hit, one hit is the irreducible unit.
    expect(shadeHitBatchSize(400_000, SURFACE_COMPUTE_MAX_SHADE_BATCH)).toBe(1);
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
