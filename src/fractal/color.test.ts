import { buildColors, hslToRgb, transformColors } from "./color";
import { runChaosGame } from "./chaos-game";
import { mulberry32 } from "./rng";
import { defaultTransforms } from "./presets";
import type { ChaosGameResult } from "./chaos-game";
import type { Bounds } from "./types";

function expectRgbClose(actual: number[], expected: number[]): void {
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 4));
}

describe("hslToRgb", () => {
  it("returns grey when saturation is zero", () => {
    expectRgbClose(hslToRgb(0.3, 0, 0.5), [0.5, 0.5, 0.5]);
  });

  it("matches THREE.Color.setHSL for a saturated hue", () => {
    // h=0 (red), s=0.8, l=0.6 → r high, g/b low.
    expectRgbClose(hslToRgb(0, 0.8, 0.6), [0.92, 0.28, 0.28]);
  });

  it("wraps hue and clamps lightness", () => {
    expectRgbClose(hslToRgb(1, 0.8, 0.6), hslToRgb(0, 0.8, 0.6));
    expectRgbClose(hslToRgb(0.5, 0.5, 2), [1, 1, 1]);
  });
});

describe("transformColors", () => {
  it("returns one color per transform", () => {
    expect(transformColors(4)).toHaveLength(4);
  });

  it("starts at red for the first transform", () => {
    expectRgbClose(transformColors(4)[0], hslToRgb(0, 0.8, 0.6));
  });
});

describe("buildColors", () => {
  const result = runChaosGame(defaultTransforms(), 300, mulberry32(5));

  it("produces three channels per point", () => {
    const colors = buildColors(result, defaultTransforms(), "transform");
    expect(colors).toHaveLength(result.count * 3);
  });

  it("paints every point cyan in uniform mode", () => {
    const colors = buildColors(result, defaultTransforms(), "uniform");
    for (let i = 0; i < result.count; i++) {
      expectRgbClose(
        [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]],
        [0.4, 0.8, 1.0],
      );
    }
  });

  it("keeps position colors within the [0.2, 1.0] band", () => {
    const colors = buildColors(result, defaultTransforms(), "position");
    for (const channel of colors) {
      expect(channel).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(channel).toBeLessThanOrEqual(1.0 + 1e-6);
    }
  });

  it("recolors a fixed cloud: switching mode changes colors, not point count", () => {
    // The app caches one ChaosGameResult and rebuilds colors over it when the
    // palette changes, so a color-mode switch must recolor the same cloud
    // without needing a fresh (re-rolled) run.
    const height = buildColors(result, defaultTransforms(), "height");
    const radius = buildColors(result, defaultTransforms(), "radius");
    expect(radius).toHaveLength(height.length);
    expect(Array.from(radius)).not.toEqual(Array.from(height));
  });

  it("handles a degenerate cloud without dividing by zero", () => {
    const flat: ChaosGameResult = {
      positions: new Float32Array([1, 1, 1, 1, 1, 1]),
      transformIndices: new Uint8Array([0, 0]),
      count: 2,
      bounds: zeroRangeBounds(),
    };
    const colors = buildColors(flat, defaultTransforms(), "height");
    expect(colors).toHaveLength(6);
    expect(Number.isFinite(colors[0])).toBe(true);
  });
});

function zeroRangeBounds(): Bounds {
  return {
    minX: 1,
    maxX: 1,
    minY: 1,
    maxY: 1,
    minZ: 1,
    maxZ: 1,
    minR: Math.sqrt(3),
    maxR: Math.sqrt(3),
  };
}
