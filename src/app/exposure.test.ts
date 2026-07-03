import { glowExposure, CALIBRATION_DENSITY } from "./exposure";

describe("glowExposure", () => {
  // Shared baseline inputs that produce a mid-range density.
  const base = {
    numPoints: 100_000,
    boundsRadius: 2,
    cameraDistance: 8,
    fovY: Math.PI / 3,
    viewportHeight: 800,
  };

  function call(overrides: Partial<typeof base> = {}): number {
    const p = { ...base, ...overrides };
    return glowExposure(
      p.numPoints,
      p.boundsRadius,
      p.cameraDistance,
      p.fovY,
      p.viewportHeight,
    );
  }

  it("lowers the factor when numPoints doubles (denser cloud)", () => {
    const f1 = call({ numPoints: 50_000 });
    const f2 = call({ numPoints: 100_000 });
    expect(f2).toBeLessThan(f1);
  });

  it("lowers the factor when cameraDistance doubles (denser projection)", () => {
    // Doubling distance halves projected radius → quarters area → density goes
    // UP → factor goes DOWN. The cloud is a smaller, denser spot on screen.
    const f1 = call({ cameraDistance: 4 });
    const f2 = call({ cameraDistance: 8 });
    expect(f2).toBeLessThan(f1);
  });

  it("returns exactly 1 when density equals the calibration density", () => {
    // Construct inputs so density == CALIBRATION_DENSITY.
    const boundsRadius = 1;
    const cameraDistance = 1;
    const fovY = Math.PI / 3;
    const viewportHeight = 1000;

    const halfTan = Math.tan(fovY * 0.5);
    const rpx =
      (boundsRadius / (cameraDistance * halfTan)) * (viewportHeight * 0.5);
    const area = Math.PI * rpx * rpx;
    const numPoints = CALIBRATION_DENSITY * Math.max(area, 1);

    const factor = glowExposure(
      numPoints,
      boundsRadius,
      cameraDistance,
      fovY,
      viewportHeight,
    );
    expect(factor).toBeCloseTo(1, 10);
  });

  it("clamps the factor at 1.5 for very sparse clouds", () => {
    const factor = call({ numPoints: 1 });
    expect(factor).toBe(1.5);
  });

  it("clamps the factor at 0.05 for extremely dense clouds", () => {
    const factor = call({ numPoints: 1e12 });
    expect(factor).toBe(0.05);
  });

  describe("degenerate inputs return 1 (neutral)", () => {
    const edgeCases: [string, Partial<typeof base>][] = [
      ["numPoints = 0", { numPoints: 0 }],
      ["boundsRadius = 0", { boundsRadius: 0 }],
      ["cameraDistance = 0", { cameraDistance: 0 }],
      ["fovY = 0", { fovY: 0 }],
      ["viewportHeight = 0", { viewportHeight: 0 }],
      ["numPoints = NaN", { numPoints: NaN }],
      ["boundsRadius = NaN", { boundsRadius: NaN }],
      ["cameraDistance = NaN", { cameraDistance: NaN }],
      ["fovY = NaN", { fovY: NaN }],
      ["viewportHeight = NaN", { viewportHeight: NaN }],
      ["numPoints = Infinity", { numPoints: Infinity }],
      ["boundsRadius = Infinity", { boundsRadius: Infinity }],
      ["cameraDistance = Infinity", { cameraDistance: Infinity }],
      ["fovY = Infinity", { fovY: Infinity }],
      ["viewportHeight = Infinity", { viewportHeight: Infinity }],
    ];

    for (const [label, overrides] of edgeCases) {
      it(label, () => {
        const result = call(overrides);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBe(1);
      });
    }
  });
});
