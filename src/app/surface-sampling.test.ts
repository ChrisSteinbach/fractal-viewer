import { describe, expect, it } from "vitest";
import {
  effectiveSurfaceSamples,
  nearestSurfaceAntialiasSamples,
  parseSurfaceSamplesOverride,
} from "./surface-sampling";

describe("Surface antialias sampling", () => {
  it("snaps authored values to supported detents", () => {
    expect(nearestSurfaceAntialiasSamples(1)).toBe(1);
    expect(nearestSurfaceAntialiasSamples(7)).toBe(8);
    expect(nearestSurfaceAntialiasSamples(64)).toBe(16);
  });

  it("accepts only integer diagnostic overrides from 1 through 64", () => {
    expect(parseSurfaceSamplesOverride("?surfacesamples=12")).toBe(12);
    expect(parseSurfaceSamplesOverride("?surfacesamples=0")).toBeNull();
    expect(parseSurfaceSamplesOverride("?surfacesamples=2.5")).toBeNull();
    expect(parseSurfaceSamplesOverride("?surfacesamples=nope")).toBeNull();
  });

  it("lets a valid diagnostic override win without changing the authored value", () => {
    expect(effectiveSurfaceSamples(16, 3)).toBe(3);
    expect(effectiveSurfaceSamples(16, null)).toBe(16);
  });
});
