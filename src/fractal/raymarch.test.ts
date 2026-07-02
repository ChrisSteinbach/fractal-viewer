import { mandelbulbDistance } from "./raymarch";

// The GPU raymarcher mirrors this DE in GLSL; these pin the reference math so
// the shader has a tested target. Behaviour, not implementation: each asserts
// a property a sphere-tracing raymarcher relies on.

describe("mandelbulbDistance", () => {
  it("reports the origin as inside the set (distance 0)", () => {
    // The centre never escapes, so it must read as solid — a ray reaching it
    // has hit the surface, not sailed through empty space.
    expect(mandelbulbDistance(0, 0, 0, 8, 8)).toBe(0);
  });

  it("reports a point deep inside the bulb as inside the set (distance 0)", () => {
    // A small interior point's orbit stays bounded for every iteration.
    expect(mandelbulbDistance(0.1, 0, 0, 8, 12)).toBe(0);
  });

  it("returns a positive, finite distance for a point well outside", () => {
    const d = mandelbulbDistance(5, 0, 0, 8, 8);
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });

  it("is deterministic — the same point always estimates the same distance", () => {
    const a = mandelbulbDistance(1.3, -0.7, 0.4, 8, 10);
    const b = mandelbulbDistance(1.3, -0.7, 0.4, 8, 10);
    expect(a).toBe(b);
  });

  it("stays finite across a grid straddling the surface", () => {
    // No NaN/Inf may leak into a marcher: sweep points from inside to outside.
    for (let x = -2; x <= 2; x += 0.25) {
      for (let y = -2; y <= 2; y += 0.5) {
        for (let z = -2; z <= 2; z += 0.5) {
          const d = mandelbulbDistance(x, y, z, 8, 10);
          expect(Number.isFinite(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("resolves more of the surface as the iteration budget grows", () => {
    // (1,0,0) sits on the boundary: one iteration can't yet tell it escapes
    // (reads as inside), but a deeper budget watches its orbit fly out.
    const shallow = mandelbulbDistance(1, 0, 0, 8, 1);
    const deep = mandelbulbDistance(1, 0, 0, 8, 8);
    expect(shallow).toBe(0);
    expect(deep).toBeGreaterThan(0);
  });

  it("depends on the power parameter (different bulb, different field)", () => {
    // Same probe point, different exponent ⇒ a genuinely different fractal, so
    // the estimated distance must move — proves power is actually wired in.
    const power8 = mandelbulbDistance(1.2, 0.3, 0.2, 8, 10);
    const power4 = mandelbulbDistance(1.2, 0.3, 0.2, 4, 10);
    expect(power8).not.toBe(power4);
  });
});
