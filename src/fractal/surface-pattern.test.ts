import {
  PATTERN_DEFAULT_SCALE,
  PATTERN_DETAIL_SCALE_MULTIPLIER,
  PATTERN_NATIVE_WARP_CYCLES,
  SURFACE_PATTERN_AXIS_WIRE_ID,
  SURFACE_PATTERN_KIND_WIRE_ID,
  calibrateNativeCarrier,
  evaluateSurfacePattern,
  normalizeNativeCarrier,
  patternDetailGate,
  patternMacroSample,
  resolveSurfacePattern,
  surfacePatternAxisFromWireId,
  surfacePatternKindFromWireId,
  type NativeCalibration,
  type PatternKind,
} from "./surface-pattern";
import type { Vec3 } from "./types";

const base: Vec3 = [0.78, 0.61, 0.42];
const live: NativeCalibration = calibrateNativeCarrier(
  Array.from({ length: 101 }, (_, i) => i / 100),
);
const query = (pixelFootprint: number) => ({
  objectP: [0.31, -0.27, 0.44] as Vec3,
  rings: 0.45,
  sheets: 0.63,
  ringsCalibration: live,
  sheetsCalibration: live,
  pixelFootprint,
});

describe("surface pattern document domain", () => {
  it("pins append-only family and axis wire ids", () => {
    expect(SURFACE_PATTERN_KIND_WIRE_ID).toEqual({
      none: 0,
      wood: 1,
      marble: 2,
      strata: 3,
    });
    expect(SURFACE_PATTERN_AXIS_WIRE_ID).toEqual({ x: 0, y: 1, z: 2 });
    expect([0, 1, 2, 3, 99].map(surfacePatternKindFromWireId)).toEqual([
      "none",
      "wood",
      "marble",
      "strata",
      "none",
    ]);
    expect([0, 1, 2, 99].map(surfacePatternAxisFromWireId)).toEqual([
      "x",
      "y",
      "z",
      "y",
    ]);
  });

  it("resolves absence to exact none and family defaults to the accepted V3 values", () => {
    expect(resolveSurfacePattern(undefined)).toEqual({
      kind: "none",
      axis: "y",
      scale: 1,
      strength: 0,
    });
    for (const kind of ["wood", "marble", "strata"] as const) {
      expect(resolveSurfacePattern({ kind, axis: "y" })).toEqual({
        kind,
        axis: "y",
        scale: PATTERN_DEFAULT_SCALE[kind],
        strength: 1,
      });
    }
  });

  it("is total and owns numeric clamps rather than persistence", () => {
    expect(
      resolveSurfacePattern({
        kind: "wood",
        axis: "x",
        scale: -4,
        strength: 7,
      }),
    ).toEqual({ kind: "wood", axis: "x", scale: 0.5, strength: 1 });
    expect(
      resolveSurfacePattern({
        kind: "marble",
        axis: "z",
        scale: 90,
        strength: -2,
      }),
    ).toEqual({ kind: "marble", axis: "z", scale: 32, strength: 0 });
    expect(
      resolveSurfacePattern({
        kind: "strata",
        axis: "y",
        scale: NaN,
        strength: Infinity,
      }),
    ).toEqual({ kind: "strata", axis: "y", scale: 2.6, strength: 1 });
    expect(
      resolveSurfacePattern({ kind: "bogus", axis: "q" } as never),
    ).toEqual({ kind: "none", axis: "y", scale: 1, strength: 0 });
  });
});

describe("accepted V3 surface pattern oracle", () => {
  it("pins calibration, detail, and native-warp constants", () => {
    expect(live.low).toBeCloseTo(0.03, 12);
    expect(live.high).toBeCloseTo(0.97, 12);
    expect(normalizeNativeCarrier(-1, live)).toBe(0);
    expect(normalizeNativeCarrier(2, live)).toBe(1);
    expect(patternDetailGate(0.012)).toBe(0);
    expect(patternDetailGate(0.009)).toBe(1);
    expect(PATTERN_DETAIL_SCALE_MULTIPLIER).toEqual({
      wood: 1,
      marble: 1.25,
      strata: 1,
    });
    expect(PATTERN_NATIVE_WARP_CYCLES).toEqual({
      wood: 0.08,
      marble: 0.1,
      strata: 0.08,
    });
  });

  it("keeps absent and zero-strength patterns exact albedo identities", () => {
    expect(
      evaluateSurfacePattern(base, resolveSurfacePattern(undefined), query(0))
        .albedo,
    ).toEqual(base);
    for (const kind of ["wood", "marble", "strata"] as const) {
      expect(
        evaluateSurfacePattern(
          base,
          { kind, axis: "y", scale: 5, strength: 0 },
          query(0),
        ).albedo,
      ).toEqual(base);
    }
  });

  it("keeps material macrostructure distinct and every resolved output finite", () => {
    const phases = (["wood", "marble", "strata"] as const).map(
      (kind) =>
        patternMacroSample(
          kind,
          "y",
          PATTERN_DEFAULT_SCALE[kind],
          [0.2, -0.4, 0.1],
        ).phase,
    );
    expect(new Set(phases.map((x) => x.toFixed(6))).size).toBe(3);
    for (const kind of ["none", "wood", "marble", "strata"] as PatternKind[])
      for (const axis of ["x", "y", "z"] as const)
        for (const scale of [0.5, 4, 32])
          for (const strength of [0, 0.5, 1]) {
            const got = evaluateSurfacePattern(
              base,
              { kind, axis, scale, strength },
              query(0.003),
            );
            for (const channel of got.albedo) {
              expect(Number.isFinite(channel)).toBe(true);
              expect(channel).toBeGreaterThanOrEqual(0);
              expect(channel).toBeLessThanOrEqual(1);
            }
          }
  });
});
