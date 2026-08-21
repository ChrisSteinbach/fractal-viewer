import {
  PATTERN_DETAIL_FOOTPRINT_FULL,
  PATTERN_DETAIL_FOOTPRINT_OFF,
  PATTERN_DETAIL_MIX,
  PATTERN_DEFAULT_SCALE,
  PATTERN_MIN_NATIVE_SPAN,
  calibrateNativeCarrier,
  evaluateSurfacePattern,
  normalizeNativeCarrier,
  patternDetailGate,
  patternMacroSample,
  type PatternKind,
} from "./finish-pattern-model";
import type { Vec3 } from "./de-preview";

const base: Vec3 = [0.78, 0.61, 0.42];
const live = calibrateNativeCarrier([0, 0.01, 0.03, 0.2, 0.45, 0.72, 0.96, 1]);
const query = (pixelFootprint: number, rings = 0.45, sheets = 0.63) => ({
  objectP: [0.31, -0.27, 0.44] as Vec3,
  rings,
  sheets,
  ringsCalibration: live,
  sheetsCalibration: live,
  pixelFootprint,
});

describe("finish pattern prototype calibration", () => {
  it("uses deterministic p03/p97 interpolation and clamps normalized values", () => {
    const samples = Array.from({ length: 101 }, (_, i) => i / 100);
    const c = calibrateNativeCarrier(samples);
    expect(c.low).toBeCloseTo(0.03, 12);
    expect(c.high).toBeCloseTo(0.97, 12);
    expect(c.invSpan).toBeCloseTo(1 / 0.94, 12);
    expect(normalizeNativeCarrier(-1, c)).toBe(0);
    expect(normalizeNativeCarrier(2, c)).toBe(1);
  });

  it("disables a near-constant carrier instead of exploding its frequency", () => {
    const c = calibrateNativeCarrier([0.5, 0.501, 0.499, 0.502]);
    expect(c.high - c.low).toBeLessThan(PATTERN_MIN_NATIVE_SPAN);
    expect(c.enabled).toBe(false);
    expect(c.invSpan).toBe(0);
    expect(normalizeNativeCarrier(0.501, c)).toBe(0);
  });
});

describe("finish pattern prototype coordinate stack", () => {
  it("gates native detail from ordinary pixels into close-up pixels", () => {
    expect(patternDetailGate(PATTERN_DETAIL_FOOTPRINT_OFF)).toBe(0);
    expect(patternDetailGate(PATTERN_DETAIL_FOOTPRINT_FULL)).toBe(1);
    expect(patternDetailGate(1)).toBe(0);
    expect(patternDetailGate(0)).toBe(1);
  });

  it("wood is cylindrical around the authored axis before bounded irregularity", () => {
    const alongY = patternMacroSample("wood", "y", 4.5, [0.4, 0.1, 0]);
    const alongX = patternMacroSample("wood", "x", 4.5, [0.4, 0.1, 0]);
    // Swapping the axis swaps which component contributes to the cylinder's
    // radius; the deterministic wobble is bounded and cannot erase that.
    expect(Math.abs(alongY.phase - alongX.phase)).toBeGreaterThan(0.4);
  });

  it("wood irregularity is longitudinal rather than isotropic noise", () => {
    let axialGradient = 0;
    let crossGradient = 0;
    const h = 0.01;
    for (let iy = 0; iy < 21; iy++) {
      for (let ix = 0; ix < 21; ix++) {
        const u = -0.8 + (1.6 * ix) / 20;
        const a = -0.8 + (1.6 * iy) / 20;
        const phase = (x: number, y: number): number =>
          patternMacroSample("wood", "y", PATTERN_DEFAULT_SCALE.wood, [
            x,
            y,
            0.23,
          ]).phase;
        axialGradient += Math.abs(phase(u, a + h) - phase(u, a - h));
        crossGradient += Math.abs(phase(u + h, a) - phase(u - h, a));
      }
    }
    expect(crossGradient / axialGradient).toBeGreaterThan(5);
  });

  it("marble is sparse and strata contains at least three coherent layers", () => {
    const p0: Vec3 = [0.2, -0.4, 0.1];
    const p1: Vec3 = [0.2, 0.4, 0.1];
    const marble0 = patternMacroSample("marble", "y", 3.25, p0);
    const marble1 = patternMacroSample("marble", "y", 3.25, p1);
    const strata0 = patternMacroSample("strata", "y", 2.75, p0);
    const strata1 = patternMacroSample("strata", "y", 2.75, p1);
    expect(Math.abs(marble1.phase - marble0.phase)).toBeGreaterThan(0.25);
    expect(Math.abs(strata1.phase - strata0.phase)).toBeGreaterThan(1);

    let marbleCore = 0;
    let marbleHalo = 0;
    const sampleSize = 64;
    for (let y = 0; y < sampleSize; y++) {
      for (let x = 0; x < sampleSize; x++) {
        const ramp = patternMacroSample(
          "marble",
          "y",
          PATTERN_DEFAULT_SCALE.marble,
          [
            -1 + (2 * x) / (sampleSize - 1),
            -1 + (2 * y) / (sampleSize - 1),
            0.17,
          ],
        ).ramp;
        if (ramp > 0.9) marbleCore++;
        if (ramp > 0.58) marbleHalo++;
      }
    }
    const samples = sampleSize * sampleSize;
    expect(marbleCore / samples).toBeGreaterThanOrEqual(0.03);
    expect(marbleCore / samples).toBeLessThanOrEqual(0.12);
    expect(marbleHalo / samples).toBeGreaterThanOrEqual(0.1);
    expect(marbleHalo / samples).toBeLessThanOrEqual(0.28);

    let layers = 0;
    let inLayer = false;
    for (let i = 0; i < 1024; i++) {
      const a = -1 + (2 * i) / 1023;
      const now =
        patternMacroSample("strata", "y", PATTERN_DEFAULT_SCALE.strata, [
          0.17,
          a,
          0.23,
        ]).ramp > 0.58;
      if (now && !inLayer) layers++;
      inLayer = now;
    }
    expect(layers).toBeGreaterThanOrEqual(3);
  });

  it("crossfades complete macro and structured-detail ramp outputs", () => {
    const got = evaluateSurfacePattern(
      base,
      { kind: "wood", axis: "y", scale: 3.5, strength: 1 },
      query(0),
    );
    expect(got.detailMix).toBe(PATTERN_DETAIL_MIX.wood);
    expect(got.detailMix).toBeLessThanOrEqual(1);
    expect(got.outputRamp).toBeCloseTo(
      got.macroRamp * (1 - got.detailMix) + got.detailRamp * got.detailMix,
      14,
    );
  });

  it("macro-only ignores rings and sheets exactly", () => {
    const params = {
      kind: "marble" as const,
      axis: "y" as const,
      scale: 3.25,
      strength: 1,
    };
    const a = evaluateSurfacePattern(
      base,
      params,
      query(0, 0.1, 0.1),
      "macro-only",
    );
    const b = evaluateSurfacePattern(
      base,
      params,
      query(0, 0.9, 0.9),
      "macro-only",
    );
    expect(a.albedo).toEqual(b.albedo);
    expect(a.detailMix).toBe(0);
  });
});

describe("finish pattern prototype output", () => {
  it("none and strength zero are exact albedo identities", () => {
    expect(
      evaluateSurfacePattern(
        base,
        { kind: "none", axis: "y", scale: 99, strength: 1 },
        query(0),
      ).albedo,
    ).toEqual(base);
    for (const kind of ["wood", "marble", "strata"] as PatternKind[]) {
      expect(
        evaluateSurfacePattern(
          base,
          { kind, axis: "y", scale: 5, strength: 0 },
          query(0),
        ).albedo,
      ).toEqual(base);
    }
  });

  it("keeps every family finite and in gamut across a parameter grid", () => {
    for (const kind of ["wood", "marble", "strata"] as const)
      for (const axis of ["x", "y", "z"] as const)
        for (const scale of [0, 0.5, 4, 32])
          for (const strength of [-1, 0, 0.5, 1, 2])
            for (const footprint of [0, 0.002, 0.02]) {
              const got = evaluateSurfacePattern(
                base,
                { kind, axis, scale, strength },
                query(footprint),
              );
              for (const channel of got.albedo) {
                expect(Number.isFinite(channel)).toBe(true);
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(1);
              }
            }
  });
});
