import { resizeGuideComponent } from "./interactions";
import { MIN_GUIDE_SCALE, MAX_GUIDE_SCALE } from "./constants";

describe("resizeGuideComponent", () => {
  it("multiplies a positive component by the factor", () => {
    expect(resizeGuideComponent(0.5, 1.05)).toBeCloseTo(0.525);
  });

  it("preserves a mirrored (negative) component's sign", () => {
    expect(resizeGuideComponent(-0.5, 1.05)).toBeCloseTo(-0.525);
  });

  it("clamps the grown magnitude to the guide ceiling on both signs", () => {
    expect(resizeGuideComponent(1.95, 1.2)).toBe(MAX_GUIDE_SCALE);
    expect(resizeGuideComponent(-1.95, 1.2)).toBe(-MAX_GUIDE_SCALE);
  });

  it("clamps the shrunk magnitude to the guide floor on both signs", () => {
    expect(resizeGuideComponent(0.06, 0.5)).toBe(MIN_GUIDE_SCALE);
    expect(resizeGuideComponent(-0.06, 0.5)).toBe(-MIN_GUIDE_SCALE);
  });

  it("grows a zero component to the positive floor", () => {
    expect(resizeGuideComponent(0, 1.05)).toBe(MIN_GUIDE_SCALE);
  });
});
