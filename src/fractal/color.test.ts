import {
  LEGACY_POSITION_AXIS_COLORS,
  W_SIDE_PALETTES,
  buildColorModeLUT,
  buildColors,
  buildColors4,
  colorModeUsesGamma,
  colorModeUsesRampPalette,
  dimColorsExcept,
  hslToRgb,
  isLegacyPositionAxisColors,
  fourDColorModeUsesGamma,
  fourDColorModeUsesRampPalette,
  transformColors,
  wRampColor,
} from "./color";
import type { PositionAxisColors } from "./color";
import { buildPaletteLUT } from "./palette";
import type { CustomPalette } from "./palette";
import { runChaosGame } from "./chaos-game";
import { mulberry32 } from "./rng";
import { defaultTransforms } from "./presets";
import type { ChaosGameResult } from "./chaos-game";
import type { ChaosGame4Result } from "./chaos-game-4d";
import type { Bounds, Bounds4, Transform } from "./types";

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

  it("with no colorIndexes argument, reproduces the even i/count spread exactly", () => {
    const withoutArg = transformColors(4);
    const withUndefinedArray = transformColors(4, [
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    for (let i = 0; i < 4; i++) {
      expectRgbClose(withoutArg[i], hslToRgb(i / 4, 0.8, 0.6));
      expectRgbClose(withUndefinedArray[i], hslToRgb(i / 4, 0.8, 0.6));
    }
  });

  it("an authored colorIndex picks the hue position instead of the even spread", () => {
    const colors = transformColors(4, [undefined, 0.5, undefined, undefined]);
    // Map 1 authors 0.5 — same hue an even-spread map would get AT hue 0.5,
    // not the i/count spread's 1/4 it would otherwise land on.
    expectRgbClose(colors[1], hslToRgb(0.5, 0.8, 0.6));
  });

  it("mixed authored/absent: each map resolves independently", () => {
    const colors = transformColors(3, [0.9, undefined, 0.1]);
    expectRgbClose(colors[0], hslToRgb(0.9, 0.8, 0.6));
    // Map 1 authored nothing — falls back to its own i/count spread (1/3).
    expectRgbClose(colors[1], hslToRgb(1 / 3, 0.8, 0.6));
    expectRgbClose(colors[2], hslToRgb(0.1, 0.8, 0.6));
  });

  it("honors an authored 0 instead of silently falling back to the spread (?? not ||)", () => {
    // Map 1's authored 0 is falsy — a `||`-based fallback would read out the
    // derived i/count spread (1/3) instead of the authored value.
    const colors = transformColors(3, [undefined, 0, undefined]);
    expectRgbClose(colors[1], hslToRgb(0, 0.8, 0.6));
  });

  it("wraps an authored colorIndex of 1 to hue 0, matching hslToRgb's own cyclic convention", () => {
    const colors = transformColors(3, [undefined, 1, undefined]);
    expectRgbClose(colors[1], hslToRgb(0, 0.8, 0.6));
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

  it("transform mode: an authored colorIndex sets that map's identity hue", () => {
    const transforms: Transform[] = [
      { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        colorIndex: 0.9,
      },
      { id: 2, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ];
    const tiny: ChaosGameResult = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      transformIndices: new Uint8Array([0, 1, 2]),
      count: 3,
      bounds: zeroRangeBounds(),
    };
    const colors = buildColors(tiny, transforms, "transform");
    // Map 1 authored 0.9 — its point takes that hue, not the even 3-map
    // spread's 1/3 it would otherwise derive to.
    expectRgbClose([colors[3], colors[4], colors[5]], hslToRgb(0.9, 0.8, 0.6));
    // Its unauthored neighbours still land on their own i/count spread.
    expectRgbClose(
      [colors[0], colors[1], colors[2]],
      hslToRgb(0 / 3, 0.8, 0.6),
    );
    expectRgbClose(
      [colors[6], colors[7], colors[8]],
      hslToRgb(2 / 3, 0.8, 0.6),
    );
  });
});

describe("buildColors color contrast", () => {
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

describe("buildColors position axis colors", () => {
  // A single point at tx=0.5, ty=1, tz=0.25 within a unit cube — distinct
  // normalized coordinates on every axis, so a wrong axis→channel wiring
  // (unlike a degenerate tx=ty=tz fixture) would show up as a wrong value.
  function singlePointCloud(): ChaosGameResult {
    return {
      positions: new Float32Array([0.5, 1, 0.25]),
      transformIndices: new Uint8Array(1),
      count: 1,
      bounds: {
        minX: 0,
        maxX: 1,
        minY: 0,
        maxY: 1,
        minZ: 0,
        maxZ: 1,
        minR: 0,
        maxR: 1,
      },
    };
  }

  it("blends the three axis colors by normalized coordinate and clips at 1", () => {
    const cloud = singlePointCloud();
    const axes: PositionAxisColors = {
      x: [1, 0.5, 0],
      y: [0, 0.5, 1],
      z: [1, 1, 1],
    };
    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "position",
      1,
      "legacy",
      axes,
    );
    // tx=0.5, ty=1, tz=0.25.
    // r = 0.2 + 0.8*(0.5*1   + 1*0   + 0.25*1) = 0.8
    // g = 0.2 + 0.8*(0.5*0.5 + 1*0.5 + 0.25*1) = 1.0
    // b = min(1, 0.2 + 0.8*(0.5*0 + 1*1 + 0.25*1)) = min(1, 1.2) = 1
    expect(colors[0]).toBeCloseTo(0.8, 6);
    expect(colors[1]).toBeCloseTo(1.0, 6);
    expect(colors[2]).toBeCloseTo(1, 6);
  });

  it("reproduces the default position mapping exactly with explicit legacy axis colors", () => {
    const result = runChaosGame(defaultTransforms(), 300, mulberry32(5));
    const explicit = buildColors(
      result,
      defaultTransforms(),
      "position",
      1,
      "legacy",
      LEGACY_POSITION_AXIS_COLORS,
    );
    const legacy = buildColors(result, defaultTransforms(), "position");
    expect(explicit).toEqual(legacy);
  });

  // Pins the exact mapping AND its direction, mirroring the height ramp's
  // "not an inverted exponent" test above: gamma is applied to tx/ty/tz
  // BEFORE the axis-color blend, not after.
  it("applies gamma to the normalized coordinate before the axis-color blend", () => {
    const cloud = singlePointCloud();
    // A channel permutation (x -> b, y -> r, z -> g), so a mixed-up gamma
    // order would land on the wrong channel entirely rather than just a
    // slightly-off value.
    const axes: PositionAxisColors = {
      x: [0, 0, 1],
      y: [1, 0, 0],
      z: [0, 1, 0],
    };
    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "position",
      2,
      "legacy",
      axes,
    );
    // tx=0.5 -> 0.25, ty=1 -> 1, tz=0.25 -> 0.0625 (each squared by gamma 2).
    // r = 0.2 + 0.8*(ty') = 0.2 + 0.8*1      = 1.0
    // g = 0.2 + 0.8*(tz') = 0.2 + 0.8*0.0625 = 0.25
    // b = 0.2 + 0.8*(tx') = 0.2 + 0.8*0.25   = 0.4
    expect(colors[0]).toBeCloseTo(1.0, 6);
    expect(colors[1]).toBeCloseTo(0.25, 6);
    expect(colors[2]).toBeCloseTo(0.4, 6);
  });
});

describe("isLegacyPositionAxisColors", () => {
  it("is true for the exact legacy identity mapping", () => {
    expect(
      isLegacyPositionAxisColors({
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      }),
    ).toBe(true);
  });

  it("is false when any single channel deviates from the identity", () => {
    expect(
      isLegacyPositionAxisColors({
        x: [1, 0.1, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      }),
    ).toBe(false);
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
  // The drift guard for the solid render: the LUT and buildColors
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

describe("buildColorModeLUT rampPalette", () => {
  const blackToWhite: CustomPalette = {
    stops: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  };

  it("samples a preset palette directly at colorGamma 1 (spectrum, endpoints)", () => {
    const spectrum = buildPaletteLUT("spectrum");
    if (!spectrum) throw new Error("spectrum should have a LUT");
    const lut = buildColorModeLUT("height", 1, "spectrum");
    expectRgbClose(
      [lut[0], lut[1], lut[2]],
      [spectrum[0], spectrum[1], spectrum[2]],
    );
    expectRgbClose(
      [lut[765], lut[766], lut[767]],
      [spectrum[765], spectrum[766], spectrum[767]],
    );
  });

  it("is an identity resample of a linear custom palette at colorGamma 1", () => {
    const lut = buildColorModeLUT("height", 1, blackToWhite);
    for (const j of [0, 64, 128, 255]) {
      expect(lut[j * 3]).toBeCloseTo(j / 255, 6);
    }
  });

  it("bakes colorGamma into the palette path", () => {
    const lut = buildColorModeLUT("height", 2, blackToWhite);
    const expected = Math.min(255, ((128 / 255) ** 2 * 256) | 0) / 255;
    expect(lut[128 * 3]).toBeCloseTo(expected, 6);
  });

  it('treats an explicit "legacy" the same as omitting rampPalette, for both modes', () => {
    expect(buildColorModeLUT("height", 1)).toEqual(
      buildColorModeLUT("height", 1, "legacy"),
    );
    expect(buildColorModeLUT("radius", 1)).toEqual(
      buildColorModeLUT("radius", 1, "legacy"),
    );
  });
});

describe("buildColors rampPalette", () => {
  const blackToWhite: CustomPalette = {
    stops: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  };
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

  it("colors height mode by the custom palette instead of the built-in ramp", () => {
    const heights = [0, 0.5, 1];
    const positions = new Float32Array(heights.length * 3);
    heights.forEach((t, n) => {
      positions[n * 3 + 1] = t;
    });
    const cloud: ChaosGameResult = {
      positions,
      transformIndices: new Uint8Array(heights.length),
      count: heights.length,
      bounds: unitBounds,
    };

    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "height",
      1,
      blackToWhite,
    );

    // Exact at the endpoints — no rounding left to do at t = 0 or t = 1.
    expect(colors[0]).toBe(0);
    expect(colors[1]).toBe(0);
    expect(colors[2]).toBe(0);
    expect(colors[6]).toBe(1);
    expect(colors[7]).toBe(1);
    expect(colors[8]).toBe(1);
    // t = 0.5 goes through the same floor-based bucketing as the flame's
    // palette LUT indexing (writePaletteRampColor), not a plain lerp at 0.5.
    const expectedMid = Math.min(255, (0.5 * 256) | 0) / 255;
    expect(colors[3]).toBeCloseTo(expectedMid, 6);
    expect(colors[4]).toBeCloseTo(expectedMid, 6);
    expect(colors[5]).toBeCloseTo(expectedMid, 6);
  });

  it("colors radius mode by a preset palette's endpoints", () => {
    const ember = buildPaletteLUT("ember");
    if (!ember) throw new Error("ember should have a LUT");
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]); // r = 0, r = 1
    const cloud: ChaosGameResult = {
      positions,
      transformIndices: new Uint8Array(2),
      count: 2,
      bounds: unitBounds,
    };

    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "radius",
      1,
      "ember",
    );

    expectRgbClose(
      [colors[0], colors[1], colors[2]],
      [ember[0], ember[1], ember[2]],
    );
    expectRgbClose(
      [colors[3], colors[4], colors[5]],
      [ember[765], ember[766], ember[767]],
    );
  });

  it('treats an explicit "legacy" the same as omitting rampPalette, at a non-default gamma', () => {
    const result = runChaosGame(defaultTransforms(), 300, mulberry32(5));
    const omitted = buildColors(result, defaultTransforms(), "height", 2);
    const explicit = buildColors(
      result,
      defaultTransforms(),
      "height",
      2,
      "legacy",
    );
    expect(explicit).toEqual(omitted);
  });
});

describe("writePaletteRampColor clamps out-of-range t", () => {
  // A non-legacy ramp palette, so these route through writePaletteRampColor
  // rather than the built-in writeHeightColor (the existing degenerate-cloud
  // test at color.test.ts:132 only covers the legacy ramp). Endpoints are
  // exact (see the rampPalette tests above), so a clamped t reads as exactly
  // 0 or 1 on every channel with no tolerance needed.
  const blackToWhite: CustomPalette = {
    stops: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  };
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

  it("a negative t clamps to the ramp's low end, finite and NaN-free", () => {
    // py = -1 is below bounds.minY (0), so height's normalized t = -1.
    // Pre-fix, the unclamped low end indexed paletteLUT at a negative
    // offset — undefined — and writing undefined into a Float32Array stores
    // NaN in every channel.
    const cloud: ChaosGameResult = {
      positions: new Float32Array([0, -1, 0]),
      transformIndices: new Uint8Array(1),
      count: 1,
      bounds: unitBounds,
    };
    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "height",
      1,
      blackToWhite,
    );
    expect(Number.isFinite(colors[0])).toBe(true);
    expect(colors[0]).toBe(0);
    expect(colors[1]).toBe(0);
    expect(colors[2]).toBe(0);
  });

  it("a t of +Infinity clamps to the ramp's high end, not the low end", () => {
    // py = Infinity makes height's normalized t = Infinity. Pre-fix,
    // `(Infinity * 256) | 0` is 0 by ToInt32, so Math.min(255, 0) landed on
    // the LOW end — the wrong direction for a t that exceeds 1.
    const cloud: ChaosGameResult = {
      positions: new Float32Array([0, Infinity, 0]),
      transformIndices: new Uint8Array(1),
      count: 1,
      bounds: unitBounds,
    };
    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "height",
      1,
      blackToWhite,
    );
    expect(colors[0]).toBe(1);
    expect(colors[1]).toBe(1);
    expect(colors[2]).toBe(1);
  });

  it("a NaN t lands at index 0, finite and NaN-free", () => {
    // py = NaN makes height's normalized t = NaN. NaN fails both clamp
    // comparisons (t <= 0 and t >= 1), so the ternary falls through to
    // (t * 256) | 0 — ToInt32(NaN) is 0, landing on the same low-end index
    // as t <= 0 rather than propagating NaN into the output.
    const cloud: ChaosGameResult = {
      positions: new Float32Array([0, NaN, 0]),
      transformIndices: new Uint8Array(1),
      count: 1,
      bounds: unitBounds,
    };
    const colors = buildColors(
      cloud,
      defaultTransforms(),
      "height",
      1,
      blackToWhite,
    );
    expect(Number.isFinite(colors[0])).toBe(true);
    expect(colors[0]).toBe(0);
    expect(colors[1]).toBe(0);
    expect(colors[2]).toBe(0);
  });
});

describe("colorModeUsesRampPalette", () => {
  it("is true for height and radius", () => {
    expect(colorModeUsesRampPalette("height")).toBe(true);
    expect(colorModeUsesRampPalette("radius")).toBe(true);
  });

  it("is false for transform, position, and uniform", () => {
    expect(colorModeUsesRampPalette("transform")).toBe(false);
    expect(colorModeUsesRampPalette("position")).toBe(false);
    expect(colorModeUsesRampPalette("uniform")).toBe(false);
  });
});

describe("4D color dependency helpers", () => {
  it("exposes contrast only for Height, Radius, and Position", () => {
    expect(fourDColorModeUsesGamma("height")).toBe(true);
    expect(fourDColorModeUsesGamma("radius")).toBe(true);
    expect(fourDColorModeUsesGamma("position")).toBe(true);
    expect(fourDColorModeUsesGamma("transform")).toBe(false);
    expect(fourDColorModeUsesGamma("uniform")).toBe(false);
    expect(fourDColorModeUsesGamma("wBlueOrange")).toBe(false);
  });

  it("exposes the shared ramp palette only for Height and Radius", () => {
    expect(fourDColorModeUsesRampPalette("height")).toBe(true);
    expect(fourDColorModeUsesRampPalette("radius")).toBe(true);
    expect(fourDColorModeUsesRampPalette("position")).toBe(false);
    expect(fourDColorModeUsesRampPalette("uniform")).toBe(false);
    expect(fourDColorModeUsesRampPalette("wPurpleGreen")).toBe(false);
  });
});

/** Zero bounds for fixtures whose transform/radius mode does not read XYZ
 * bounds. Height/Position fixtures below provide their authored extents. */
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
  it("Height and Position exactly lift buildColors' raw-XYZ contrast and custom-axis semantics", () => {
    const bounds4: Bounds4 = {
      minX: -1,
      maxX: 3,
      minY: -2,
      maxY: 2,
      minZ: -3,
      maxZ: 1,
      minW: -10,
      maxW: 10,
    };
    const positions = new Float32Array([0, -1, -2, 1, 0, -1, 2, 1, 0]);
    const result4: ChaosGame4Result = {
      positions,
      w: new Float32Array([9, -7, 3]),
      transformIndices: new Uint8Array(3),
      count: 3,
      bounds: bounds4,
      center: [1, 0, -1, 0],
      radius: 10,
      originRadius: 10,
    };
    const bounds3: Bounds = {
      ...bounds4,
      minR: 0,
      maxR: 1,
    };
    const result3: ChaosGameResult = {
      positions,
      transformIndices: new Uint8Array(3),
      count: 3,
      bounds: bounds3,
    };
    const axes: PositionAxisColors = {
      x: [0.1, 0.9, 0.2],
      y: [0.8, 0.1, 0.3],
      z: [0.2, 0.4, 1],
    };

    expect(buildColors4(result4, 1, "height", "ember", undefined, 2)).toEqual(
      buildColors(result3, [], "height", 2, "ember"),
    );
    expect(
      buildColors4(result4, 1, "position", "legacy", undefined, 2, axes),
    ).toEqual(buildColors(result3, [], "position", 2, "legacy", axes));
  });

  it("uniform mode fills every point with the shared cyan", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([1, 2, 3, -4, -5, -6]),
      w: new Float32Array([7, 8]),
      transformIndices: new Uint8Array(2),
      count: 2,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
      originRadius: 1,
    };
    expect(Array.from(buildColors4(result, 1, "uniform"))).toEqual(
      [0.4, 0.8, 1, 0.4, 0.8, 1].map(Math.fround),
    );
  });

  it("transform mode colors each point by its producing transform", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      w: new Float32Array([0, 0, 0]),
      transformIndices: new Uint8Array([0, 2, 1]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
      originRadius: 1,
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
      originRadius: 1,
    };
    const colors = buildColors4(result, 2, "transform");
    expect(colors[0]).toBeCloseTo(1, 5);
    expect(colors[1]).toBeCloseTo(1, 5);
    expect(colors[2]).toBeCloseTo(1, 5);
  });

  it("transform mode: an authored colorIndex sets that map's identity hue", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      w: new Float32Array([0, 0, 0]),
      transformIndices: new Uint8Array([0, 1, 2]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
      originRadius: 1,
    };
    // Map 1 authors 0.9 (its neighbours don't) — threaded through as the
    // parallel colorIndexes array, exactly like buildColors' own transform
    // branch threads transforms.map(t => t.colorIndex).
    const colors = buildColors4(result, 3, "transform", "legacy", [
      undefined,
      0.9,
      undefined,
    ]);
    expectRgbClose(
      [colors[0], colors[1], colors[2]],
      hslToRgb(0 / 3, 0.8, 0.6),
    );
    expectRgbClose([colors[3], colors[4], colors[5]], hslToRgb(0.9, 0.8, 0.6));
    expectRgbClose(
      [colors[6], colors[7], colors[8]],
      hslToRgb(2 / 3, 0.8, 0.6),
    );
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
      originRadius: 2,
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

  it("radius mode applies the shared contrast exponent before its palette", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      w: new Float32Array(3),
      transformIndices: new Uint8Array(3),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 2,
      originRadius: 2,
    };
    const colors = buildColors4(result, 1, "radius", "spectrum", undefined, 2);
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    // Middle distance t=.5 becomes .25 and therefore palette bucket 64.
    expect(Array.from(colors.slice(3, 6))).toEqual(
      Array.from(lut.slice(64 * 3, 64 * 3 + 3)),
    );
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
      originRadius: 1,
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

describe("buildColors4 rampPalette", () => {
  it("radius mode samples the gradient palette over 4D distance from the center", () => {
    // Same 3-point fixture shape as the "radius mode spans the warm→cool
    // ramp" test above: center [0,0,0,0]; distances 0, 1, 2 → t = 0, 0.5, 1.
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
      w: new Float32Array([0, 0, 2]),
      transformIndices: new Uint8Array([0, 0, 0]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 2,
      originRadius: 2,
    };
    const colors = buildColors4(result, 1, "radius", "ember");
    const lut = buildPaletteLUT("ember");
    if (!lut) throw new Error("ember should have a LUT");

    // t = 0, 0.5, 1 index the LUT at 0, 128*3, 255*3 — the same
    // Math.min(255, (t * 256) | 0) bucketing writePaletteRampColor uses.
    expect(colors[0]).toBeCloseTo(lut[0], 5);
    expect(colors[1]).toBeCloseTo(lut[1], 5);
    expect(colors[2]).toBeCloseTo(lut[2], 5);
    expect(colors[3]).toBeCloseTo(lut[128 * 3], 5);
    expect(colors[4]).toBeCloseTo(lut[128 * 3 + 1], 5);
    expect(colors[5]).toBeCloseTo(lut[128 * 3 + 2], 5);
    expect(colors[6]).toBeCloseTo(lut[255 * 3], 5);
    expect(colors[7]).toBeCloseTo(lut[255 * 3 + 1], 5);
    expect(colors[8]).toBeCloseTo(lut[255 * 3 + 2], 5);
  });

  it('treats an explicit "legacy" the same as omitting rampPalette', () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
      w: new Float32Array([0, 0, 2]),
      transformIndices: new Uint8Array([0, 0, 0]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 2,
      originRadius: 2,
    };
    expect(buildColors4(result, 1, "radius", "legacy")).toEqual(
      buildColors4(result, 1, "radius"),
    );
  });

  it("a custom palette payload drives the ramp, from the first stop at the center to the last stop at the farthest point", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
      w: new Float32Array([0, 0, 2]),
      transformIndices: new Uint8Array([0, 0, 0]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 2,
      originRadius: 2,
    };
    const redToBlue: CustomPalette = {
      stops: [
        [1, 0, 0],
        [0, 0, 1],
      ],
    };
    const colors = buildColors4(result, 1, "radius", redToBlue);

    // Endpoints land exactly on the first/last stop (buildCustomPaletteLUT's
    // two-product lerp lands entry 0 on t=0 and entry 255 on t=1 exactly),
    // mirroring how the buildColors custom-stop test pins its
    // black-to-white endpoints.
    expect(colors[0]).toBeCloseTo(1, 5);
    expect(colors[1]).toBeCloseTo(0, 5);
    expect(colors[2]).toBeCloseTo(0, 5);
    expect(colors[6]).toBeCloseTo(0, 5);
    expect(colors[7]).toBeCloseTo(0, 5);
    expect(colors[8]).toBeCloseTo(1, 5);
  });

  it("transform mode ignores rampPalette", () => {
    const result: ChaosGame4Result = {
      positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      w: new Float32Array([0, 0, 0]),
      transformIndices: new Uint8Array([0, 2, 1]),
      count: 3,
      bounds: zeroBounds4(),
      center: [0, 0, 0, 0],
      radius: 1,
      originRadius: 1,
    };
    expect(buildColors4(result, 3, "transform", "ember")).toEqual(
      buildColors4(result, 3, "transform"),
    );
  });
});

describe("wRampColor", () => {
  const { wBlueOrange, wPurpleGreen, wCyanMagenta } = W_SIDE_PALETTES;

  it("is the dim gray notch (0.38 * 0.30) at s = 0, for any palette", () => {
    const dim = 0.38 * 0.3;
    expectRgbClose(wRampColor(0, wBlueOrange), [dim, dim, dim]);
    expectRgbClose(wRampColor(0, wPurpleGreen), [dim, dim, dim]);
    expectRgbClose(wRampColor(0, wCyanMagenta), [dim, dim, dim]);
  });

  it("is exactly side.pos at s = 1", () => {
    expectRgbClose(wRampColor(1, wBlueOrange), wBlueOrange.pos);
    expectRgbClose(wRampColor(1, wCyanMagenta), wCyanMagenta.pos);
  });

  it("is exactly side.neg at s = -1", () => {
    expectRgbClose(wRampColor(-1, wBlueOrange), wBlueOrange.neg);
    expectRgbClose(wRampColor(-1, wCyanMagenta), wCyanMagenta.neg);
  });

  it("clamps s beyond +/-1", () => {
    expectRgbClose(wRampColor(5, wBlueOrange), wRampColor(1, wBlueOrange));
    expectRgbClose(wRampColor(-5, wBlueOrange), wRampColor(-1, wBlueOrange));
  });

  it("brightness increases monotonically in |s|", () => {
    const samples = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
    function magnitude(s: number): number {
      const [r, g, b] = wRampColor(s, wPurpleGreen);
      return r + g + b;
    }
    let prev = -Infinity;
    for (const s of samples) {
      const mag = magnitude(s);
      expect(mag).toBeGreaterThan(prev);
      prev = mag;
    }
    // Symmetric in magnitude for the negative side too (different hue, same
    // brightness curve since |s| is what drives m).
    prev = -Infinity;
    for (const s of samples) {
      const mag = magnitude(-s);
      expect(mag).toBeGreaterThan(prev);
      prev = mag;
    }
  });
});

describe("dimColorsExcept", () => {
  // Colors below are all dyadic (power-of-two) fractions, and `dim` is 0.25 —
  // multiplying a dyadic float32 by a power of two is exact, so `toBe` can
  // assert bit-exact equality without float32 rounding noise.
  it("passes the kept transform's channels through bit-exact", () => {
    const colors = new Float32Array([
      0.5, 1.0, 0.25, 0.125, 0.25, 0.375, 0.75, 0.625, 0.375, 0.5, 0.5, 0.5,
    ]);
    const transformIndices = new Uint8Array([0, 1, 0, 2]);
    const out = dimColorsExcept(colors, transformIndices, 4, 0, 0.25);
    expect(out[0]).toBe(0.5);
    expect(out[1]).toBe(1.0);
    expect(out[2]).toBe(0.25);
    expect(out[6]).toBe(0.75);
    expect(out[7]).toBe(0.625);
    expect(out[8]).toBe(0.375);
  });

  it("scales every other point's channels by exactly dim", () => {
    const colors = new Float32Array([
      0.5, 1.0, 0.25, 0.125, 0.25, 0.375, 0.75, 0.625, 0.375, 0.5, 0.5, 0.5,
    ]);
    const transformIndices = new Uint8Array([0, 1, 0, 2]);
    const out = dimColorsExcept(colors, transformIndices, 4, 0, 0.25);
    expect(out[3]).toBe(0.03125);
    expect(out[4]).toBe(0.0625);
    expect(out[5]).toBe(0.09375);
    expect(out[9]).toBe(0.125);
    expect(out[10]).toBe(0.125);
    expect(out[11]).toBe(0.125);
  });

  it("does not mutate either input array", () => {
    const colors = new Float32Array([0.5, 1.0, 0.25, 0.1, 0.2, 0.3]);
    const colorsCopy = colors.slice();
    const transformIndices = new Uint8Array([0, 1]);
    const indicesCopy = transformIndices.slice();
    dimColorsExcept(colors, transformIndices, 2, 0, 0.25);
    expect(colors).toEqual(colorsCopy);
    expect(transformIndices).toEqual(indicesCopy);
  });

  it("returns a new allocation of length count * 3", () => {
    const colors = new Float32Array([0.5, 1.0, 0.25, 0.1, 0.2, 0.3]);
    const transformIndices = new Uint8Array([0, 1]);
    const out = dimColorsExcept(colors, transformIndices, 2, 0, 0.25);
    expect(out).not.toBe(colors);
    expect(out).toHaveLength(6);
  });

  it("dims every point when keep matches no transform index", () => {
    const colors = new Float32Array([0.5, 1.0, 0.25, 0.125, 0.25, 0.375]);
    const transformIndices = new Uint8Array([0, 1]);
    const out = dimColorsExcept(colors, transformIndices, 2, 7, 0.25);
    expect(out[0]).toBe(0.125);
    expect(out[1]).toBe(0.25);
    expect(out[2]).toBe(0.0625);
    expect(out[3]).toBe(0.03125);
    expect(out[4]).toBe(0.0625);
    expect(out[5]).toBe(0.09375);
  });
});
