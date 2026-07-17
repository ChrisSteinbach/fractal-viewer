import { contextAntialias, hexToRgb01 } from "./constants";

describe("hexToRgb01", () => {
  it("parses the channel extremes", () => {
    expect(hexToRgb01("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb01("#ffffff")).toEqual([1, 1, 1]);
  });

  it("parses each channel independently", () => {
    expect(hexToRgb01("#1f2039")).toEqual([31 / 255, 32 / 255, 57 / 255]);
  });
});

describe("contextAntialias", () => {
  it("keeps MSAA on a standard-density display", () => {
    expect(contextAntialias(1)).toBe(true);
    expect(contextAntialias(1.5)).toBe(true);
  });

  it("drops MSAA at high densities where the buffer already oversamples", () => {
    expect(contextAntialias(2)).toBe(false);
    expect(contextAntialias(3)).toBe(false);
  });

  it("lets ?msaa=0 force MSAA off on a low-density display", () => {
    expect(contextAntialias(1, "0")).toBe(false);
  });

  it("lets ?msaa force MSAA on at high density, bare or =1", () => {
    expect(contextAntialias(3, "")).toBe(true);
    expect(contextAntialias(2, "1")).toBe(true);
  });

  it("defers to the heuristic when the param is absent", () => {
    expect(contextAntialias(2, null)).toBe(false);
  });
});
