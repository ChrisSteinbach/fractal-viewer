import { predictCaptureMs, solidCaptureMsPerPx } from "./capture-cost";

describe("solidCaptureMsPerPx", () => {
  it("divides the measured wall by the pixel count", () => {
    expect(solidCaptureMsPerPx(4482, 3840 * 2160)).toBeCloseTo(
      4482 / (3840 * 2160),
      12,
    );
  });

  it("keeps a zero-millisecond wall, which is a real measurement", () => {
    // A capture too fast for the clock's resolution is exactly the case
    // that must never open a modal — dropping it would fall back to the
    // scale heuristic and flash one.
    expect(solidCaptureMsPerPx(0, 640 * 480)).toBe(0);
  });

  it("refuses a wall from a clock that went backwards", () => {
    expect(solidCaptureMsPerPx(-3, 640 * 480)).toBeNull();
  });

  it("refuses a non-finite wall", () => {
    expect(solidCaptureMsPerPx(Number.NaN, 640 * 480)).toBeNull();
  });

  it("refuses a zero pixel count rather than dividing by it", () => {
    expect(solidCaptureMsPerPx(274, 0)).toBeNull();
  });

  it("refuses a negative pixel count", () => {
    expect(solidCaptureMsPerPx(274, -1)).toBeNull();
  });
});

describe("predictCaptureMs", () => {
  it("scales the per-pixel cost by the export's pixel count", () => {
    expect(predictCaptureMs(0.0005, 3840 * 2160)).toBeCloseTo(4147.2, 6);
  });

  it("propagates the absence of evidence", () => {
    expect(predictCaptureMs(null, 3840 * 2160)).toBeNull();
  });

  it("predicts four times the cost for four times the pixels", () => {
    // The prediction is linear because the march is: the same rays, more
    // of them.
    const oneX = predictCaptureMs(0.0005, 1920 * 1080);
    const twoX = predictCaptureMs(0.0005, 3840 * 2160);
    expect(oneX).not.toBeNull();
    expect(twoX).toBeCloseTo((oneX as number) * 4, 9);
  });

  it("predicts zero from a zero per-pixel cost", () => {
    expect(predictCaptureMs(0, 3840 * 2160)).toBe(0);
  });

  it("refuses a zero pixel count", () => {
    expect(predictCaptureMs(0.0005, 0)).toBeNull();
  });
});
