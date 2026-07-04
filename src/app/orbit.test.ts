import type { Bounds } from "../fractal/types";
import {
  BOOT_CAMERA_POSITION,
  MAX_PHI,
  MAX_RADIUS,
  MIN_PHI,
  MIN_RADIUS,
  OrbitCamera,
  boundsCenter,
  fitRadius,
  smoothstep,
  sphericalToCartesian,
} from "./orbit";

function expectVecClose(actual: number[], expected: number[]): void {
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 10));
}

describe("sphericalToCartesian", () => {
  it("places a point on the +Z axis at phi = pi/2, theta = 0", () => {
    expectVecClose(
      sphericalToCartesian({ radius: 5, theta: 0, phi: Math.PI / 2 }),
      [0, 0, 5],
    );
  });

  it("places a point on the +Y axis at phi = 0", () => {
    expectVecClose(
      sphericalToCartesian({ radius: 3, theta: 1, phi: 0 }),
      [0, 3, 0],
    );
  });
});

describe("OrbitCamera", () => {
  it("round-trips its starting position", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    expectVecClose(orbit.position(), [5, 4, 5]);
  });

  it("clamps phi when rotated past the poles", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    orbit.rotate(0, 100000);
    expect(orbit.spherical.phi).toBeCloseTo(MIN_PHI, 10);
    orbit.rotate(0, -100000);
    expect(orbit.spherical.phi).toBeCloseTo(MAX_PHI, 10);
  });

  it("clamps radius when dollied in and out", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    orbit.dolly(1000);
    expect(orbit.spherical.radius).toBe(MAX_RADIUS);
    orbit.dolly(0.00001);
    expect(orbit.spherical.radius).toBe(MIN_RADIUS);
  });

  it("moves the target (and camera) when panned", () => {
    const orbit = new OrbitCamera([0, 0, 5]);
    orbit.panBy(2, -1, 0);
    expect(orbit.target).toEqual([2, -1, 0]);
    expectVecClose(orbit.position(), [2, -1, 5]);
  });

  it("changes azimuth when rotated horizontally", () => {
    const orbit = new OrbitCamera([0, 0, 5]);
    const before = orbit.spherical.theta;
    orbit.rotate(50, 0);
    expect(orbit.spherical.theta).not.toBe(before);
  });
});

describe("boundsCenter", () => {
  it("returns the per-axis midpoint of the bounds", () => {
    const bounds: Bounds = {
      minX: 1,
      maxX: 3,
      minY: -2,
      maxY: 2,
      minZ: 5,
      maxZ: 7,
      minR: 0,
      maxR: 0,
    };
    expectVecClose(boundsCenter(bounds), [2, 0, 6]);
  });
});

describe("fitRadius", () => {
  const unitCube: Bounds = {
    minX: -0.5,
    maxX: 0.5,
    minY: -0.5,
    maxY: 0.5,
    minZ: -0.5,
    maxZ: 0.5,
    minR: 0,
    maxR: 0,
  };

  it("frames a unit cube at square aspect", () => {
    // r = sqrt(3)/2 (half the cube's diagonal), halfAngle = 30 deg either
    // axis since aspect = 1, so distance = r * margin / tan(30 deg), which
    // simplifies (tan(30 deg) = 1/sqrt(3)) to exactly 1.875.
    const expected = ((Math.sqrt(3) / 2) * 1.25) / Math.tan(Math.PI / 6);
    expect(expected).toBeCloseTo(1.875, 6);
    expect(fitRadius(unitCube, Math.PI / 3, 1)).toBeCloseTo(1.875, 6);
  });

  it("uses the vertical half-angle at wide aspect, same as square", () => {
    // For aspect >= 1 the vertical half-angle is always the narrower
    // (binding) one, so widening the horizontal FOV further never shrinks
    // the vertical constraint -- this matches the square-aspect case
    // exactly, it's not a copy-paste mistake.
    expect(fitRadius(unitCube, Math.PI / 3, 2)).toBeCloseTo(1.875, 6);
  });

  it("uses the horizontal half-angle at tall aspect", () => {
    // aspect < 1 makes the horizontal half-angle the narrower (binding) one.
    const halfFovX = Math.atan(Math.tan(Math.PI / 6) * 0.5);
    const expected = ((Math.sqrt(3) / 2) * 1.25) / Math.tan(halfFovX);
    const actual = fitRadius(unitCube, Math.PI / 3, 0.5);
    expect(actual).toBeCloseTo(expected, 10);
    expect(actual).toBeGreaterThan(1.875);
  });

  it("scales distance linearly with margin", () => {
    const base = fitRadius(unitCube, Math.PI / 3, 1);
    const scaled = fitRadius(unitCube, Math.PI / 3, 1, 2.5);
    expect(scaled).toBeCloseTo(base * 2, 6);
  });

  it("falls back to the boot camera's radius for degenerate bounds", () => {
    const zeroBounds: Bounds = {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minR: 0,
      maxR: 0,
    };
    const expected = Math.hypot(...BOOT_CAMERA_POSITION);
    expect(fitRadius(zeroBounds, Math.PI / 3, 1)).toBeCloseTo(expected, 10);
  });

  it("clamps to MAX_RADIUS for a hugely divergent system", () => {
    const hugeBounds: Bounds = {
      minX: -50,
      maxX: 50,
      minY: -50,
      maxY: 50,
      minZ: -50,
      maxZ: 50,
      minR: 0,
      maxR: 0,
    };
    expect(fitRadius(hugeBounds, Math.PI / 3, 1)).toBe(MAX_RADIUS);
  });

  it("clamps to MIN_RADIUS for a tiny near-point system", () => {
    const tinyBounds: Bounds = {
      minX: -0.0005,
      maxX: 0.0005,
      minY: -0.0005,
      maxY: 0.0005,
      minZ: -0.0005,
      maxZ: 0.0005,
      minR: 0,
      maxR: 0,
    };
    expect(fitRadius(tinyBounds, Math.PI / 3, 1)).toBe(MIN_RADIUS);
  });
});

describe("smoothstep", () => {
  it("returns 0 at x = 0", () => {
    expect(smoothstep(0)).toBe(0);
  });

  it("returns 1 at x = 1", () => {
    expect(smoothstep(1)).toBe(1);
  });

  it("returns 0.5 at the midpoint", () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it("clamps below the [0, 1] range", () => {
    expect(smoothstep(-3)).toBe(0);
  });

  it("clamps above the [0, 1] range", () => {
    expect(smoothstep(10)).toBe(1);
  });
});
