import {
  MAX_PHI,
  MAX_RADIUS,
  MIN_PHI,
  MIN_RADIUS,
  OrbitCamera,
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
