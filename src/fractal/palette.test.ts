import { FLAME_PALETTES, FLAME_PALETTE_IDS, buildPaletteLUT } from "./palette";
import type { FlamePaletteId } from "./palette";

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
