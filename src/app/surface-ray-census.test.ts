import {
  decodeSurfaceRayCensus,
  exactSurfaceRayCensus,
  SURFACE_TRACE_ALPHA_COVERED,
  SURFACE_TRACE_ALPHA_EXHAUSTED,
  SURFACE_TRACE_ALPHA_MISS,
} from "./surface-ray-census";

describe("surface trace alpha census", () => {
  it("pins the three RGBA8 status codes", () => {
    expect([
      SURFACE_TRACE_ALPHA_MISS,
      SURFACE_TRACE_ALPHA_EXHAUSTED,
      SURFACE_TRACE_ALPHA_COVERED,
    ]).toEqual([0, 128, 255]);
  });

  it("decodes every RGBA8 terminal status exactly and ignores RGB", () => {
    const rgba = new Uint8Array([
      19,
      23,
      29,
      SURFACE_TRACE_ALPHA_MISS,
      31,
      37,
      41,
      SURFACE_TRACE_ALPHA_EXHAUSTED,
      43,
      47,
      53,
      SURFACE_TRACE_ALPHA_COVERED,
      59,
      61,
      67,
      SURFACE_TRACE_ALPHA_EXHAUSTED,
    ]);

    expect(decodeSurfaceRayCensus(rgba, 2, 2)).toEqual({
      rays: 4,
      covered: 1,
      miss: 1,
      exhausted: 2,
      exhaustedIndices: [1, 3],
    });
  });

  it("refuses malformed buffers and unknown status bytes", () => {
    expect(decodeSurfaceRayCensus(new Uint8Array(3), 1, 1)).toBeNull();
    expect(
      decodeSurfaceRayCensus(new Uint8Array([0, 0, 0, 127]), 1, 1),
    ).toBeNull();
    expect(decodeSurfaceRayCensus(new Uint8Array(), -1, 0)).toBeNull();
  });

  it("only constructs compute censuses that exactly partition the rays", () => {
    expect(exactSurfaceRayCensus(10, 3, 5, 2, [1, 9])).toEqual({
      rays: 10,
      covered: 3,
      miss: 5,
      exhausted: 2,
      exhaustedIndices: [1, 9],
    });
    expect(exactSurfaceRayCensus(10, 3, 5, 1, [1])).toBeNull();
    expect(exactSurfaceRayCensus(10, 3, 5, 3, [1, 2, 3])).toBeNull();
    expect(exactSurfaceRayCensus(10, 3, 5, 2, [1])).toBeNull();
    expect(exactSurfaceRayCensus(10, 3, 5, 2, [1, 1])).toBeNull();
    expect(exactSurfaceRayCensus(10, 3, 5, 2, [1, 10])).toBeNull();
  });
});
