import { hexToRgb01 } from "./constants";

describe("hexToRgb01", () => {
  it("parses the channel extremes", () => {
    expect(hexToRgb01("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb01("#ffffff")).toEqual([1, 1, 1]);
  });

  it("parses each channel independently", () => {
    expect(hexToRgb01("#1f2039")).toEqual([31 / 255, 32 / 255, 57 / 255]);
  });
});
