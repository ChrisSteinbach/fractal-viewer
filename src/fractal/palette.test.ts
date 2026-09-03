import {
  FLAME_PALETTES,
  FLAME_PALETTE_IDS,
  buildPaletteLUT,
  resolvePalette,
  seedCustomStops,
  rgbToHex,
  hexToRgb,
  CUSTOM_PALETTE_ID,
  CUSTOM_PALETTE_SEED_STOPS,
} from "./palette";
import type { FlamePaletteId, RgbStop, CustomPalette } from "./palette";

/** Every gradient palette (i.e. excluding the "legacy" per-transform sentinel). */
const GRADIENT_IDS = FLAME_PALETTE_IDS.filter(
  (id): id is Exclude<FlamePaletteId, "legacy"> => id !== "legacy",
);

describe("FLAME_PALETTE_IDS", () => {
  it("is exactly FLAME_PALETTES' keys, legacy first", () => {
    expect(FLAME_PALETTE_IDS).toEqual(Object.keys(FLAME_PALETTES));
    expect(FLAME_PALETTE_IDS[0]).toBe("legacy");
  });
});

describe("buildPaletteLUT", () => {
  it("returns null for the legacy per-transform sentinel", () => {
    expect(buildPaletteLUT("legacy")).toBeNull();
  });

  it("builds a 256×3 interleaved RGB table for a gradient palette", () => {
    const lut = buildPaletteLUT("spectrum");
    expect(lut).not.toBeNull();
    expect(lut).toHaveLength(768);
  });

  it("keeps every channel within [0, 1] for every gradient palette", () => {
    for (const id of GRADIENT_IDS) {
      const lut = buildPaletteLUT(id);
      if (!lut) throw new Error(`${id} should have a LUT`);
      for (let i = 0; i < lut.length; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(0);
        expect(lut[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  // spectrum's red channel has coefficients a=b=0.5, c=1, d=0, so
  // red(t) = 0.5 + 0.5·cos(2π·t) hits its peak of exactly 1 at t=0 and t=1 —
  // pinning both endpoints verifies the a + b·cos(2π(c·t + d)) wiring end to end.
  it("pins spectrum's red endpoints to the cosine peak", () => {
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    expect(lut[0]).toBeCloseTo(1, 6); // red at t = 0
    expect(lut[765]).toBeCloseTo(1, 6); // red at t = 1 (index 255)
  });

  it("separates channels by phase (they are not all equal at a sample)", () => {
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    // At t=0, red is at its peak (1) but green/blue are phase-shifted off it.
    expect(lut[1]).not.toBe(lut[0]);
    expect(lut[2]).not.toBe(lut[0]);
  });

  it("varies along t rather than being a flat color", () => {
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const midRed = lut[128 * 3];
    expect(midRed).not.toBeCloseTo(lut[0], 3); // red sweeps between the endpoints and the middle.
  });

  it("produces distinct tables for distinct ids", () => {
    const spectrum = buildPaletteLUT("spectrum");
    const sunset = buildPaletteLUT("sunset");
    expect(Array.from(sunset!)).not.toEqual(Array.from(spectrum!));
  });
});

describe("buildPaletteLUT with a CustomPalette", () => {
  it("sets entry 0 to the first stop and entry 255 to the last stop exactly", () => {
    const stops: RgbStop[] = [
      [0.25, 0.5, 0.75],
      [0.75, 0.25, 1],
      [1, 0.75, 0.125],
    ];
    const lut = buildPaletteLUT({ stops });
    if (!lut) throw new Error("custom palette should have a LUT");
    expect([lut[0], lut[1], lut[2]]).toEqual(stops[0]);
    expect([lut[765], lut[766], lut[767]]).toEqual(stops[2]);
  });

  it("lands entry 255 exactly on the last stop for non-dyadic channel values", () => {
    // 0.9 → 0.05 is the fixture where the naive `from + (to - from) * f`
    // lerp misses the endpoint by an ulp at f = 1; the two-product form the
    // implementation uses yields the stop itself, so the stored value is
    // exactly fround(stop) — see buildCustomPaletteLUT's doc.
    const stops: RgbStop[] = [
      [0.9, 0.9, 0.9],
      [0.05, 0.05, 0.05],
    ];
    const lut = buildPaletteLUT({ stops });
    if (!lut) throw new Error("custom palette should have a LUT");
    expect(lut[0]).toBe(Math.fround(0.9));
    expect(lut[765]).toBe(Math.fround(0.05));
  });

  it("interpolates linearly between two stops", () => {
    const stops: RgbStop[] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    const lut = buildPaletteLUT({ stops });
    if (!lut) throw new Error("custom palette should have a LUT");
    for (const i of [0, 1, 64, 128, 200, 255]) {
      expect(lut[i * 3]).toBeCloseTo(i / 255, 6);
      expect(lut[i * 3 + 1]).toBeCloseTo(i / 255, 6);
      expect(lut[i * 3 + 2]).toBeCloseTo(i / 255, 6);
    }
  });

  it("interpolates within the enclosing segment for 3+ stops", () => {
    // Red→green→blue over two equal segments; entry 51 is t=0.2, which lands
    // 0.4 of the way through the first segment (red→green): r=0.6, g=0.4, b=0.
    const stops: RgbStop[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const lut = buildPaletteLUT({ stops });
    if (!lut) throw new Error("custom palette should have a LUT");
    expect(lut[51 * 3]).toBeCloseTo(0.6, 6);
    expect(lut[51 * 3 + 1]).toBeCloseTo(0.4, 6);
    expect(lut[51 * 3 + 2]).toBeCloseTo(0, 6);
  });

  it("clamps out-of-range stop channels into [0, 1]", () => {
    const stops: RgbStop[] = [
      [-0.5, 1.5, 0.5],
      [1.5, -0.5, 0.5],
    ];
    const lut = buildPaletteLUT({ stops });
    if (!lut) throw new Error("custom palette should have a LUT");
    expect([lut[0], lut[1], lut[2]]).toEqual([0, 1, 0.5]);
    expect([lut[765], lut[766], lut[767]]).toEqual([1, 0, 0.5]);
  });
});

// A synthetic 256-entry ramp carrying the two features an 8-stop point
// sample destroys: a ONE-ENTRY bright band (entry 100 = white amid black)
// and a HARD hue jump (adjacent entries red→blue with nothing between).
// The old import path sampled 8 evenly-spaced entries and piecewise-lerped
// them, which interpolates straight across both features — the band's
// amplitude dropped to 0 and the jump smeared into a smooth blend.
const bandedEntries: RgbStop[] = Array.from({ length: 256 }, (_, i) => {
  if (i === 100) return [1, 1, 1];
  if (i === 200) return [1, 0, 0];
  if (i === 201) return [0, 0, 1];
  return [0, 0, 0];
});

describe("buildPaletteLUT with a RampPalette", () => {
  it("preserves a one-entry bright band at full amplitude", () => {
    const lut = buildPaletteLUT({ kind: "ramp", entries: bandedEntries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    expect([lut[100 * 3], lut[100 * 3 + 1], lut[100 * 3 + 2]]).toEqual([
      1, 1, 1,
    ]);
  });

  it("keeps the band's black neighbors black instead of interpolating across it", () => {
    const lut = buildPaletteLUT({ kind: "ramp", entries: bandedEntries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    for (const i of [99, 101]) {
      expect([lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]]).toEqual([0, 0, 0]);
    }
  });

  it("survives a hard hue jump between adjacent entries", () => {
    const lut = buildPaletteLUT({ kind: "ramp", entries: bandedEntries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    expect([lut[200 * 3], lut[200 * 3 + 1], lut[200 * 3 + 2]]).toEqual([
      1, 0, 0,
    ]);
    expect([lut[201 * 3], lut[201 * 3 + 1], lut[201 * 3 + 2]]).toEqual([
      0, 0, 1,
    ]);
  });

  it("copies a 256-entry ramp straight through, exactly", () => {
    const entries: RgbStop[] = Array.from({ length: 256 }, (_, i) => [
      i / 255,
      (255 - i) / 255,
      (i % 7) / 255,
    ]);
    const lut = buildPaletteLUT({ kind: "ramp", entries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    // The LUT is a Float32Array, so "straight through, exactly" means the
    // stored value is exactly fround(entry) — the same pin the
    // CustomPalette endpoint test above makes.
    for (let i = 0; i < 256; i++) {
      expect([lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]]).toEqual([
        Math.fround(entries[i][0]),
        Math.fround(entries[i][1]),
        Math.fround(entries[i][2]),
      ]);
    }
  });

  it("piecewise-lerps a sparse ramp exactly like the same stops as a CustomPalette", () => {
    const entries: RgbStop[] = [
      [0.25, 0.5, 0.75],
      [1, 0.75, 0.125],
      [0, 0, 1],
    ];
    const rampLut = buildPaletteLUT({ kind: "ramp", entries });
    const customLut = buildPaletteLUT({ stops: entries });
    expect(Array.from(rampLut!)).toEqual(Array.from(customLut!));
  });

  it("averages an over-256 ramp by bin overlap rather than point-sampling it", () => {
    // 512 entries: black for the first half, white for the second. The
    // boundary between output entries 127 and 128 is clean — 127's
    // footprint [254, 256) is entirely black, 128's [256, 258) entirely
    // white — where point sampling could smear or alias the step.
    const entries: RgbStop[] = Array.from({ length: 512 }, (_, i) =>
      i < 256 ? ([0, 0, 0] as const) : ([1, 1, 1] as const),
    );
    const lut = buildPaletteLUT({ kind: "ramp", entries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    expect([lut[127 * 3], lut[127 * 3 + 1], lut[127 * 3 + 2]]).toEqual([
      0, 0, 0,
    ]);
    expect([lut[128 * 3], lut[128 * 3 + 1], lut[128 * 3 + 2]]).toEqual([
      1, 1, 1,
    ]);
  });

  it("averages a one-entry band that a point sample would miss entirely", () => {
    // A 512-entry ramp with white only at source entry 101 — an odd index,
    // so neither of output entry 50's straddled cells is centered on it.
    // Overlap weighting gives entry 50 (footprint [100, 102)) the mean
    // 0.5; a 256-way point sample picking even source indices would read 0.
    const entries: RgbStop[] = Array.from(
      { length: 512 },
      () => [0, 0, 0] as const,
    );
    entries[101] = [1, 1, 1];
    const lut = buildPaletteLUT({ kind: "ramp", entries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    expect(lut[50 * 3]).toBeCloseTo(0.5, 6);
    expect(lut[50 * 3 + 1]).toBeCloseTo(0.5, 6);
    expect(lut[50 * 3 + 2]).toBeCloseTo(0.5, 6);
  });

  it("keeps every averaged channel within [0, 1]", () => {
    const entries: RgbStop[] = Array.from({ length: 300 }, (_, i) => [
      ((i * 7) % 256) / 255,
      ((i * 13) % 256) / 255,
      ((i * 29) % 256) / 255,
    ]);
    const lut = buildPaletteLUT({ kind: "ramp", entries });
    if (!lut) throw new Error("ramp palette should have a LUT");
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe("resolvePalette", () => {
  it("passes a preset id through unchanged", () => {
    expect(resolvePalette("sunset", undefined)).toBe("sunset");
  });

  it("passes legacy through unchanged", () => {
    expect(resolvePalette("legacy", undefined)).toBe("legacy");
  });

  it("returns the custom payload unchanged when one is given", () => {
    const custom: CustomPalette = {
      stops: [
        [0, 0, 0],
        [1, 1, 1],
      ],
    };
    expect(resolvePalette(CUSTOM_PALETTE_ID, custom)).toBe(custom);
  });

  it("passes a ramp payload through unchanged", () => {
    const ramp = { kind: "ramp" as const, entries: bandedEntries };
    expect(resolvePalette(CUSTOM_PALETTE_ID, ramp)).toBe(ramp);
  });

  it("falls back to a 5-stop seeded gradient when custom has no payload", () => {
    const resolved = resolvePalette(CUSTOM_PALETTE_ID, undefined);
    if (typeof resolved === "string" || "kind" in resolved)
      throw new Error("expected a custom stops palette");
    expect(resolved.stops).toHaveLength(5);
  });
});

describe("seedCustomStops", () => {
  it("returns CUSTOM_PALETTE_SEED_STOPS stops", () => {
    expect(seedCustomStops("spectrum")).toHaveLength(CUSTOM_PALETTE_SEED_STOPS);
  });

  it("byte-quantizes every channel", () => {
    for (const stop of seedCustomStops("aurora")) {
      for (const channel of stop) {
        expect(Number.isInteger(channel * 255)).toBe(true);
      }
    }
  });

  it("seeds from spectrum's LUT at entries 0, 64, 128, 191, and 255", () => {
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const expected = [0, 64, 128, 191, 255].map((i): RgbStop => [
      Math.round(lut[i * 3] * 255) / 255,
      Math.round(lut[i * 3 + 1] * 255) / 255,
      Math.round(lut[i * 3 + 2] * 255) / 255,
    ]);
    expect(seedCustomStops("spectrum")).toEqual(expected);
  });

  it("seeds legacy the same as spectrum (legacy has no gradient of its own)", () => {
    expect(seedCustomStops("legacy")).toEqual(seedCustomStops("spectrum"));
  });

  it("seeds custom (re-seeding) the same as spectrum", () => {
    expect(seedCustomStops(CUSTOM_PALETTE_ID)).toEqual(
      seedCustomStops("spectrum"),
    );
  });
});

describe("rgbToHex", () => {
  it("encodes a stop as a lowercase #rrggbb string", () => {
    expect(rgbToHex([1, 0, 0.5])).toBe("#ff0080");
  });

  it("clamps out-of-range channels before encoding", () => {
    expect(rgbToHex([-1, 2, 0])).toBe("#00ff00");
  });
});

describe("hexToRgb", () => {
  it("parses a #rrggbb string into byte-normalized channels", () => {
    expect(hexToRgb("#ff0080")).toEqual([1, 0, 128 / 255]);
  });

  it("accepts uppercase hex digits", () => {
    expect(hexToRgb("#FF0080")).toEqual([1, 0, 128 / 255]);
  });

  it("round-trips back to the same string through rgbToHex", () => {
    const rgb = hexToRgb("#3c9e7a");
    if (!rgb) throw new Error("expected a parsed color");
    expect(rgbToHex(rgb)).toBe("#3c9e7a");
  });

  it("rejects a string missing the leading #", () => {
    expect(hexToRgb("ff0000")).toBeNull();
  });

  it("rejects a string one digit short", () => {
    expect(hexToRgb("#ff000")).toBeNull();
  });

  it("rejects a string one digit too long", () => {
    expect(hexToRgb("#ff00000")).toBeNull();
  });

  it("rejects non-hex characters", () => {
    expect(hexToRgb("#gg0000")).toBeNull();
  });

  it("rejects a 4-digit string", () => {
    expect(hexToRgb("#ff00")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(hexToRgb("")).toBeNull();
  });
});
