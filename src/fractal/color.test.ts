import {
  buildColorModeLUT,
  buildColors,
  buildColors4,
  colorModeUsesGamma,
  hslToRgb,
  transformColors,
} from "./color";
import { runChaosGame } from "./chaos-game";
import { mulberry32 } from "./rng";
import { defaultTransforms } from "./presets";
import type { ChaosGameResult } from "./chaos-game";
import type { ChaosGame4Result } from "./chaos-game-4d";
import type { Bounds, Bounds4 } from "./types";

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

describe("buildColors color contrast (fr-8sk)", () => {
  const result = runChaosGame(defaultTransforms(), 300, mulberry32(5));

  // A small hand-built cloud whose points span the full [0, 1] normalized
  // range on every axis and radius, so gamma's effect on the interior points
  // (0.5, 0.625, 0.75, …) is easy to tell apart from the endpoints (which
  // gamma always leaves fixed).
  function spanningCloud(): ChaosGameResult {
    return {
      // (0,0,0), (1,1,1), (-1,-1,-1), (0.5, 0.25, 0.75)
      positions: new Float32Array([
        0, 0, 0, 1, 1, 1, -1, -1, -1, 0.5, 0.25, 0.75,
      ]),
      transformIndices: new Uint8Array(4),
      count: 4,
      bounds: {
        minX: -1,
        maxX: 1,
        minY: -1,
        maxY: 1,
        minZ: -1,
        maxZ: 1,
        minR: 0,
        maxR: Math.sqrt(3),
      },
    };
  }

  it("omitting gamma matches an explicit gamma of 1 for transform mode", () => {
    expect(buildColors(result, defaultTransforms(), "transform")).toEqual(
      buildColors(result, defaultTransforms(), "transform", 1),
    );
  });

  it("omitting gamma matches an explicit gamma of 1 for height mode", () => {
    expect(buildColors(result, defaultTransforms(), "height")).toEqual(
      buildColors(result, defaultTransforms(), "height", 1),
    );
  });

  it("omitting gamma matches an explicit gamma of 1 for radius mode", () => {
    expect(buildColors(result, defaultTransforms(), "radius")).toEqual(
      buildColors(result, defaultTransforms(), "radius", 1),
    );
  });

  it("omitting gamma matches an explicit gamma of 1 for position mode", () => {
    expect(buildColors(result, defaultTransforms(), "position")).toEqual(
      buildColors(result, defaultTransforms(), "position", 1),
    );
  });

  it("omitting gamma matches an explicit gamma of 1 for uniform mode", () => {
    expect(buildColors(result, defaultTransforms(), "uniform")).toEqual(
      buildColors(result, defaultTransforms(), "uniform", 1),
    );
  });

  it("gamma 2 changes height mode's output relative to gamma 1", () => {
    const cloud = spanningCloud();
    const linear = buildColors(cloud, defaultTransforms(), "height", 1);
    const contrasty = buildColors(cloud, defaultTransforms(), "height", 2);
    expect(Array.from(contrasty)).not.toEqual(Array.from(linear));
  });

  it("gamma 2 changes radius mode's output relative to gamma 1", () => {
    const cloud = spanningCloud();
    const linear = buildColors(cloud, defaultTransforms(), "radius", 1);
    const contrasty = buildColors(cloud, defaultTransforms(), "radius", 2);
    expect(Array.from(contrasty)).not.toEqual(Array.from(linear));
  });

  it("gamma 2 changes position mode's output relative to gamma 1", () => {
    const cloud = spanningCloud();
    const linear = buildColors(cloud, defaultTransforms(), "position", 1);
    const contrasty = buildColors(cloud, defaultTransforms(), "position", 2);
    expect(Array.from(contrasty)).not.toEqual(Array.from(linear));
  });

  it("gamma 2 leaves transform mode byte-identical to gamma 1", () => {
    const linear = buildColors(result, defaultTransforms(), "transform", 1);
    const contrasty = buildColors(result, defaultTransforms(), "transform", 2);
    expect(contrasty).toEqual(linear);
  });

  it("gamma 2 leaves uniform mode byte-identical to gamma 1", () => {
    const linear = buildColors(result, defaultTransforms(), "uniform", 1);
    const contrasty = buildColors(result, defaultTransforms(), "uniform", 2);
    expect(contrasty).toEqual(linear);
  });

  // Pins the exact mapping AND its direction: a point at normalized height
  // 0.25 under gamma 2 must land on the very same ramp color as a point at
  // 0.0625 (= 0.25 ** 2, exact in binary) under the linear mapping — gamma
  // above 1 pushes interior values DOWN the ramp. An inverted implementation
  // (t ** (1/gamma)) would pass every "output differs" test above but fail
  // this one.
  it("maps a normalized coordinate to exactly t ** gamma, not an inverted exponent", () => {
    function pointAtHeight(py: number): ChaosGameResult {
      return {
        positions: new Float32Array([0, py, 0]),
        transformIndices: new Uint8Array(1),
        count: 1,
        bounds: {
          minX: -1,
          maxX: 1,
          minY: 0,
          maxY: 1,
          minZ: -1,
          maxZ: 1,
          minR: 0,
          maxR: 2,
        },
      };
    }
    const contrasty = buildColors(
      pointAtHeight(0.25),
      defaultTransforms(),
      "height",
      2,
    );
    const linear = buildColors(
      pointAtHeight(0.0625),
      defaultTransforms(),
      "height",
      1,
    );
    expect(contrasty).toEqual(linear);
  });
});

describe("colorModeUsesGamma", () => {
  it("is true for height, radius, and position", () => {
    expect(colorModeUsesGamma("height")).toBe(true);
    expect(colorModeUsesGamma("radius")).toBe(true);
    expect(colorModeUsesGamma("position")).toBe(true);
  });

  it("is false for transform and uniform", () => {
    expect(colorModeUsesGamma("transform")).toBe(false);
    expect(colorModeUsesGamma("uniform")).toBe(false);
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

describe("buildColorModeLUT", () => {
  // The drift guard for the solid render (fr-c1d): the LUT and buildColors
  // share one ramp definition, and this pins that fact — points placed at
  // exact LUT sample coordinates must get the same colors from both paths.
  const unitBounds: Bounds = {
    minX: 0,
    maxX: 1,
    minY: 0,
    maxY: 1,
    minZ: 0,
    maxZ: 1,
    minR: 0,
    maxR: 1,
  };
  const samples = [0, 51, 128, 204, 255];

  it("matches buildColors' height ramp at LUT sample points", () => {
    const positions = new Float32Array(samples.length * 3);
    samples.forEach((i, n) => {
      positions[n * 3 + 1] = i / 255;
    });
    const cloud: ChaosGameResult = {
      positions,
      transformIndices: new Uint8Array(samples.length),
      count: samples.length,
      bounds: unitBounds,
    };

    const colors = buildColors(cloud, defaultTransforms(), "height");
    const lut = buildColorModeLUT("height");
    samples.forEach((i, n) => {
      expectRgbClose(
        [colors[n * 3], colors[n * 3 + 1], colors[n * 3 + 2]],
        [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]],
      );
    });
  });

  it("matches buildColors' radius ramp at LUT sample points", () => {
    const positions = new Float32Array(samples.length * 3);
    samples.forEach((i, n) => {
      positions[n * 3] = i / 255; // r = x for points on the +x axis.
    });
    const cloud: ChaosGameResult = {
      positions,
      transformIndices: new Uint8Array(samples.length),
      count: samples.length,
      bounds: unitBounds,
    };

    const colors = buildColors(cloud, defaultTransforms(), "radius");
    const lut = buildColorModeLUT("radius");
    samples.forEach((i, n) => {
      expectRgbClose(
        [colors[n * 3], colors[n * 3 + 1], colors[n * 3 + 2]],
        [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]],
      );
    });
  });

  it("reshapes the height ramp for a non-default gamma, but pins both endpoints", () => {
    const linear = buildColorModeLUT("height", 1);
    const contrasty = buildColorModeLUT("height", 2);
    expect(Array.from(contrasty)).not.toEqual(Array.from(linear));
    expectRgbClose(
      [contrasty[0], contrasty[1], contrasty[2]],
      [linear[0], linear[1], linear[2]],
    );
    const last = 255 * 3;
    expectRgbClose(
      [contrasty[last], contrasty[last + 1], contrasty[last + 2]],
      [linear[last], linear[last + 1], linear[last + 2]],
    );
  });

  it("reshapes the radius ramp for a non-default gamma, but pins both endpoints", () => {
    const linear = buildColorModeLUT("radius", 1);
    const contrasty = buildColorModeLUT("radius", 2);
    expect(Array.from(contrasty)).not.toEqual(Array.from(linear));
    expectRgbClose(
      [contrasty[0], contrasty[1], contrasty[2]],
      [linear[0], linear[1], linear[2]],
    );
    const last = 255 * 3;
    expectRgbClose(
      [contrasty[last], contrasty[last + 1], contrasty[last + 2]],
      [linear[last], linear[last + 1], linear[last + 2]],
    );
  });
});

/** Bounds4 plays no part in buildColors4 (it reads `center`/`positions`/`w`
 * directly, never the box) — zeroed out so the fixtures below can stay
 * literal about the fields that actually matter. */
function zeroBounds4(): Bounds4 {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minW: 0,
    maxW: 0,
  };
}

describe("buildColors4", () => {
  it("transform mode colors each point by its producing transform", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      w: new Float32Array([0, 0, 0]),
      transformIndices: new Uint8Array([0, 2, 1]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
    };
    const colors = buildColors4(result, 3, "transform");
    const palette = transformColors(3);
    for (let i = 0; i < 3; i++) {
      const rgb = palette[result.transformIndices[i]];
      const o = i * 3;
      expect(colors[o]).toBeCloseTo(rgb[0], 5);
      expect(colors[o + 1]).toBeCloseTo(rgb[1], 5);
      expect(colors[o + 2]).toBeCloseTo(rgb[2], 5);
    }
  });

  it("transform mode falls back to white for an out-of-range index", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0]),
      w: new Float32Array([0]),
      transformIndices: new Uint8Array([7]),
      count: 1,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
    };
    const colors = buildColors4(result, 2, "transform");
    expect(colors[0]).toBeCloseTo(1, 5);
    expect(colors[1]).toBeCloseTo(1, 5);
    expect(colors[2]).toBeCloseTo(1, 5);
  });

  it("radius mode spans the warm→cool ramp over 4D distance from the center", () => {
    // center [0,0,0,0]; point 0 sits AT the center (d=0, nearest); point 1 is
    // 1 unit away in x (d=1); point 2 is 2 units away in w ALONE (d=2) — a
    // pure-w offset, so this only comes out farthest if the distance is
    // genuinely 4D (a 3D-only radius would read it as 0).
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
      w: new Float32Array([0, 0, 2]),
      transformIndices: new Uint8Array([0, 0, 0]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 2,
    };
    const colors = buildColors4(result, 1, "radius");
    const near = hslToRgb(0, 0.85, 0.55);
    const far = hslToRgb(0.7, 0.85, 0.55);
    expect(colors[0]).toBeCloseTo(near[0], 5);
    expect(colors[1]).toBeCloseTo(near[1], 5);
    expect(colors[2]).toBeCloseTo(near[2], 5);
    expect(colors[6]).toBeCloseTo(far[0], 5);
    expect(colors[7]).toBeCloseTo(far[1], 5);
    expect(colors[8]).toBeCloseTo(far[2], 5);
  });

  it("radius mode is NaN-free when every point is equidistant", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([1, 0, 0, 0, 1, 0]),
      w: new Float32Array([0, 0]),
      transformIndices: new Uint8Array([0, 0]),
      count: 2,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
    };
    const colors = buildColors4(result, 1, "radius");
    expect(colors).toHaveLength(6);
    for (const channel of colors) expect(Number.isFinite(channel)).toBe(true);
    // minD === maxD here, so the `|| 1` degenerate-range guard kicks in and
    // every point normalizes to t=0 — the warm end of the ramp.
    const warm = hslToRgb(0, 0.85, 0.55);
    expect(colors[0]).toBeCloseTo(warm[0], 5);
    expect(colors[1]).toBeCloseTo(warm[1], 5);
    expect(colors[2]).toBeCloseTo(warm[2], 5);
    expect(colors[3]).toBeCloseTo(warm[0], 5);
    expect(colors[4]).toBeCloseTo(warm[1], 5);
    expect(colors[5]).toBeCloseTo(warm[2], 5);
  });
});
